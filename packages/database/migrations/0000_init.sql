-- Extensions cần có trước khi tạo bảng (data-model.md)
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('admin', 'instructor', 'student', 'system');--> statement-breakpoint
CREATE TYPE "public"."card_status" AS ENUM('active', 'pending_review', 'replaced', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."cell_value" AS ENUM('valid', 'suspect', 'rejected', 'absent', 'excused');--> statement-breakpoint
CREATE TYPE "public"."decode_method" AS ENUM('barcode', 'ocr');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'kept', 'changed');--> statement-breakpoint
CREATE TYPE "public"."enrollment_status" AS ENUM('active', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."event_reason" AS ENUM('ok', 'out_of_range', 'low_accuracy', 'no_face', 'multiple_faces', 'card_mismatch', 'card_borderline', 'duplicate_face', 'checkin_mismatch', 'liveness_failed', 'window_closed', 'not_enrolled', 'no_checkin', 'already_done', 'attempts_exhausted');--> statement-breakpoint
CREATE TYPE "public"."event_result" AS ENUM('valid', 'suspect', 'rejected', 'retry');--> statement-breakpoint
CREATE TYPE "public"."evidence_type" AS ENUM('document', 'chat');--> statement-breakpoint
CREATE TYPE "public"."leave_auto_status" AS ENUM('passed', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."leave_reason" AS ENUM('illness', 'family', 'school_duty', 'other');--> statement-breakpoint
CREATE TYPE "public"."leave_status" AS ENUM('pending', 'approved', 'rejected', 'unused');--> statement-breakpoint
CREATE TYPE "public"."nonce_purpose" AS ENUM('card', 'checkin');--> statement-breakpoint
CREATE TYPE "public"."part_of_day" AS ENUM('sang', 'chieu', 'toi');--> statement-breakpoint
CREATE TYPE "public"."security_event_type" AS ENUM('login_failed', 'rate_limited', 'forbidden', 'bad_nonce', 'card_replaced', 'ai_out_of_scope', 'csrf_blocked');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('scheduled', 'makeup');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'instructor');--> statement-breakpoint
CREATE TYPE "public"."window_type" AS ENUM('check_in', 'check_out', 'spot_check');--> statement-breakpoint
CREATE TABLE "ai_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instructor_id" uuid NOT NULL,
	"question" text NOT NULL,
	"filter_spec" jsonb,
	"row_count" integer,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"message" text NOT NULL,
	"attachment_path" text,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"instructor_note" text,
	"override_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "dispute_msg_len" CHECK (char_length("attendance_disputes"."message") between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "attendance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"window_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"attempt_no" smallint NOT NULL,
	"server_time" timestamp with time zone DEFAULT now() NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"accuracy_m" real,
	"distance_m" real,
	"card_similarity" real,
	"checkin_similarity" real,
	"duplicate_of" uuid[],
	"liveness_passed" boolean,
	"embedding" vector(512),
	"evidence_path" text,
	"address_text" text,
	"result" "event_result" NOT NULL,
	"reason" "event_reason" NOT NULL,
	"late_minutes" real,
	"image_sha256" text,
	"record" jsonb NOT NULL,
	"purge_after" timestamp with time zone NOT NULL,
	"record_purge_after" timestamp with time zone NOT NULL,
	CONSTRAINT "attempt_range" CHECK ("attendance_events"."attempt_no" between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "attendance_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"type" "window_type" NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"closed_early_at" timestamp with time zone,
	"radius_m" smallint NOT NULL,
	CONSTRAINT "window_order" CHECK ("attendance_windows"."closes_at" > "attendance_windows"."opens_at")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"first_period" smallint NOT NULL,
	"last_period" smallint NOT NULL,
	"room" text,
	CONSTRAINT "weekday_range" CHECK ("class_schedules"."weekday" between 2 and 8),
	CONSTRAINT "schedule_order" CHECK ("class_schedules"."last_period" >= "class_schedules"."first_period")
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instructor_id" uuid NOT NULL,
	"code" text NOT NULL,
	"course_name" text NOT NULL,
	"semester" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"default_room" text,
	"radius_m" smallint DEFAULT 50 NOT NULL,
	"checkin_minutes" smallint DEFAULT 15 NOT NULL,
	"checkout_offset_before_min" smallint DEFAULT 10 NOT NULL,
	"checkout_offset_after_min" smallint DEFAULT 10 NOT NULL,
	"leave_auto_approve" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_duration_15_weeks" CHECK ("classes"."end_date" >= "classes"."start_date" and "classes"."end_date" - "classes"."start_date" <= 105),
	CONSTRAINT "class_radius" CHECK ("classes"."radius_m" between 10 and 500)
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"class_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" "enrollment_status" DEFAULT 'active' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "enrollments_class_id_student_id_pk" PRIMARY KEY("class_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "geocode_cache" (
	"cell" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"leave_request_id" uuid NOT NULL,
	"storage_path" text,
	"sha256" text NOT NULL,
	"ocr_text_hash" text
);
--> statement-breakpoint
CREATE TABLE "leave_request_sessions" (
	"leave_request_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	CONSTRAINT "leave_request_sessions_leave_request_id_session_id_pk" PRIMARY KEY("leave_request_id","session_id")
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"reason_category" "leave_reason" NOT NULL,
	"reason_text" text,
	"evidence_type" "evidence_type" NOT NULL,
	"leave_date" date NOT NULL,
	"extraction" jsonb,
	"checks" jsonb,
	"auto_status" "leave_auto_status" NOT NULL,
	"status" "leave_status" DEFAULT 'pending' NOT NULL,
	"auto_approved" boolean DEFAULT false NOT NULL,
	"decided_by" uuid,
	"decision_reason" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purge_after" timestamp with time zone NOT NULL,
	CONSTRAINT "leave_reason_len" CHECK ("leave_requests"."reason_text" is null or char_length("leave_requests"."reason_text") <= 500),
	CONSTRAINT "chat_never_auto" CHECK (not ("leave_requests"."evidence_type" = 'chat' and "leave_requests"."auto_approved"))
);
--> statement-breakpoint
CREATE TABLE "login_failures" (
	"email" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "manual_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"window_type" "window_type" NOT NULL,
	"old_value" "cell_value",
	"new_value" "cell_value" NOT NULL,
	"reason" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "override_reason_len" CHECK (char_length("manual_overrides"."reason") >= 5)
);
--> statement-breakpoint
CREATE TABLE "periods" (
	"number" smallint PRIMARY KEY NOT NULL,
	"part_of_day" "part_of_day" NOT NULL,
	"starts_at" time NOT NULL,
	"ends_at" time NOT NULL,
	CONSTRAINT "period_range" CHECK ("periods"."number" between 1 and 16),
	CONSTRAINT "period_order" CHECK ("periods"."ends_at" > "periods"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_nonces" (
	"nonce" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"window_id" uuid,
	"purpose" "nonce_purpose" NOT NULL,
	"challenge" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scan_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"window_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"record_purge_after" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "security_event_type" NOT NULL,
	"ip" "inet",
	"actor_id" uuid,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"date" date NOT NULL,
	"first_period" smallint NOT NULL,
	"last_period" smallint NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"room" text NOT NULL,
	"kind" "session_kind" NOT NULL,
	"center_lat" double precision,
	"center_lng" double precision,
	"center_accuracy_m" real,
	"checkout_skipped" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"number" smallint PRIMARY KEY NOT NULL,
	"first_period" smallint NOT NULL,
	"last_period" smallint NOT NULL,
	CONSTRAINT "shift_order" CHECK ("shifts"."last_period" >= "shifts"."first_period")
);
--> statement-breakpoint
CREATE TABLE "student_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"card_image_path" text,
	"portrait_image_path" text,
	"embedding" vector(512),
	"decoded_code" text NOT NULL,
	"decode_method" "decode_method" NOT NULL,
	"status" "card_status" NOT NULL,
	"reviewed_by" uuid,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purge_after" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_code" text NOT NULL,
	"last_name" text NOT NULL,
	"first_name" text NOT NULL,
	"admin_class" text,
	"cohort" text,
	"consent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_student_code_unique" UNIQUE("student_code"),
	CONSTRAINT "student_code_format" CHECK ("students"."student_code" ~ '^[0-9]{6,12}$')
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"sid" text PRIMARY KEY NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "ai_queries" ADD CONSTRAINT "ai_queries_instructor_id_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_disputes" ADD CONSTRAINT "attendance_disputes_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_disputes" ADD CONSTRAINT "attendance_disputes_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_disputes" ADD CONSTRAINT "attendance_disputes_override_id_manual_overrides_id_fk" FOREIGN KEY ("override_id") REFERENCES "public"."manual_overrides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_window_id_attendance_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."attendance_windows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_windows" ADD CONSTRAINT "attendance_windows_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_first_period_periods_number_fk" FOREIGN KEY ("first_period") REFERENCES "public"."periods"("number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_last_period_periods_number_fk" FOREIGN KEY ("last_period") REFERENCES "public"."periods"("number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_instructor_id_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_documents" ADD CONSTRAINT "leave_documents_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request_sessions" ADD CONSTRAINT "leave_request_sessions_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request_sessions" ADD CONSTRAINT "leave_request_sessions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_overrides" ADD CONSTRAINT "manual_overrides_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_overrides" ADD CONSTRAINT "manual_overrides_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_overrides" ADD CONSTRAINT "manual_overrides_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_nonces" ADD CONSTRAINT "scan_nonces_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_nonces" ADD CONSTRAINT "scan_nonces_window_id_attendance_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."attendance_windows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_sessions" ADD CONSTRAINT "scan_sessions_window_id_attendance_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."attendance_windows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_sessions" ADD CONSTRAINT "scan_sessions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_first_period_periods_number_fk" FOREIGN KEY ("first_period") REFERENCES "public"."periods"("number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_last_period_periods_number_fk" FOREIGN KEY ("last_period") REFERENCES "public"."periods"("number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_first_period_periods_number_fk" FOREIGN KEY ("first_period") REFERENCES "public"."periods"("number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_last_period_periods_number_fk" FOREIGN KEY ("last_period") REFERENCES "public"."periods"("number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_cards" ADD CONSTRAINT "student_cards_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_cards" ADD CONSTRAINT "student_cards_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_decision_per_window" ON "attendance_events" USING btree ("window_id","student_id") WHERE "attendance_events"."result" in ('valid','suspect');--> statement-breakpoint
CREATE INDEX "events_window" ON "attendance_events" USING btree ("window_id");--> statement-breakpoint
CREATE INDEX "events_student" ON "attendance_events" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "events_purge" ON "attendance_events" USING btree ("purge_after");--> statement-breakpoint
CREATE INDEX "windows_session" ON "attendance_windows" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "class_code_per_instructor" ON "classes" USING btree ("instructor_id","code");--> statement-breakpoint
CREATE INDEX "enrollments_student" ON "enrollments" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "leave_docs_sha" ON "leave_documents" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "leave_docs_text" ON "leave_documents" USING btree ("ocr_text_hash");--> statement-breakpoint
CREATE INDEX "security_events_time" ON "security_events" USING btree ("created_at","type");--> statement-breakpoint
CREATE UNIQUE INDEX "session_unique_slot" ON "sessions" USING btree ("class_id","date","first_period");--> statement-breakpoint
CREATE INDEX "sessions_date" ON "sessions" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "one_live_card_per_student" ON "student_cards" USING btree ("student_id") WHERE "student_cards"."status" in ('active','pending_review');