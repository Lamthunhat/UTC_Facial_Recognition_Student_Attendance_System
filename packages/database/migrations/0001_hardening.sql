-- T020 — Phần Drizzle chưa diễn đạt được: tìm kiếm không dấu, chống khung giờ chồng nhau, RLS chặn mặc định.

-- Hàm bỏ dấu IMMUTABLE (unaccent gốc là STABLE nên không dùng được trong cột sinh/index).
-- search_path gồm "extensions" vì Supabase thường cài extension vào schema đó.
CREATE OR REPLACE FUNCTION public.f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  SET search_path = public, extensions, pg_catalog
  AS $$ SELECT replace(replace(unaccent('unaccent', $1), 'đ', 'd'), 'Đ', 'D') $$;
--> statement-breakpoint

-- FR-071: tìm theo mã SV / họ / tên / họ và tên, không phân biệt dấu & hoa thường.
ALTER TABLE "students" ADD COLUMN "search_text" text GENERATED ALWAYS AS (
  lower(public.f_unaccent(
    "student_code" || ' ' || "last_name" || ' ' || "first_name" || ' ' || coalesce("admin_class", '') || ' ' || coalesce("cohort", '')
  ))
) STORED;
--> statement-breakpoint
CREATE INDEX "students_search_trgm" ON "students" USING gin ("search_text" gin_trgm_ops);
--> statement-breakpoint

-- FR-025: không cho hai khung cùng loại chồng thời gian trong một buổi.
ALTER TABLE "attendance_windows" ADD CONSTRAINT "no_overlapping_windows"
  EXCLUDE USING gist ("session_id" WITH =, "type" WITH =, tstzrange("opens_at", "closes_at") WITH &&);
--> statement-breakpoint

-- Tối đa 2 phản hồi mỗi buổi mỗi sinh viên (FR-115).
CREATE OR REPLACE FUNCTION public.limit_disputes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM attendance_disputes WHERE session_id = NEW.session_id AND student_id = NEW.student_id) >= 2 THEN
    RAISE EXCEPTION 'DISPUTE_LIMIT' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "disputes_limit" BEFORE INSERT ON "attendance_disputes"
  FOR EACH ROW EXECUTE FUNCTION public.limit_disputes();
--> statement-breakpoint

-- Constitution IX / FR-093: bật RLS trên mọi bảng và KHÔNG tạo policy nào cho anon/authenticated
-- → nếu khoá anon của Supabase bị lộ cũng không đọc được gì. Server kết nối bằng role sở hữu bảng
-- (không FORCE RLS) nên không bị ảnh hưởng.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
  END IF;
END $$;
