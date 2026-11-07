import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedPeriodsSql } from "../src/seed/periods";
import { createTestDb } from "../src/testing";

/** T020/T021 — Migration chạy được và các ràng buộc quan trọng hoạt động đúng. */
let db: PGlite;
let instructorId: string;
let studentA: string;
let studentB: string;
let classId: string;
let sessionId: string;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(seedPeriodsSql());
  instructorId = (
    await db.query<{ id: string }>(
      `insert into users (email, password_hash, full_name, role) values ('gv@utc.edu.vn','x','Nguyễn Kim Sao','instructor') returning id`,
    )
  ).rows[0].id;
  studentA = (
    await db.query<{ id: string }>(
      `insert into students (student_code, last_name, first_name, admin_class, cohort) values ('231230821','Lưu Tùng','Lâm','CNTT3','K64') returning id`,
    )
  ).rows[0].id;
  studentB = (
    await db.query<{ id: string }>(
      `insert into students (student_code, last_name, first_name) values ('231230999','Đặng Thị','Đào') returning id`,
    )
  ).rows[0].id;
  classId = (
    await db.query<{ id: string }>(
      `insert into classes (instructor_id, code, course_name, start_date, end_date) values ($1,'Khai phá dữ liệu-1-1-26(N03.BT1)','Khai phá dữ liệu','2026-09-07','2026-12-20') returning id`,
      [instructorId],
    )
  ).rows[0].id;
  sessionId = (
    await db.query<{ id: string }>(
      `insert into sessions (class_id, date, first_period, last_period, starts_at, ends_at, room, kind)
       values ($1,'2026-11-14',1,3,'2026-11-14T00:00Z','2026-11-14T02:25Z','301-A7-A7','scheduled') returning id`,
      [classId],
    )
  ).rows[0].id;
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("seed tiết/ca", () => {
  it("có 16 tiết và 5 ca", async () => {
    expect((await db.query(`select * from periods`)).rows).toHaveLength(16);
    expect((await db.query(`select * from shifts`)).rows).toHaveLength(5);
  });
  it("seed chạy lại không lỗi (idempotent)", async () => {
    await expect(db.exec(seedPeriodsSql())).resolves.toBeDefined();
  });
});

describe("ràng buộc dữ liệu", () => {
  it("mã SV sai định dạng bị từ chối", async () => {
    await expect(
      db.query(`insert into students (student_code, last_name, first_name) values ('abc','A','B')`),
    ).rejects.toThrow(/student_code_format/);
  });

  it("lớp dài hơn 15 tuần bị từ chối (FR-010)", async () => {
    await expect(
      db.query(
        `insert into classes (instructor_id, code, course_name, start_date, end_date) values ($1,'X','X','2026-09-01','2026-12-16')`,
        [instructorId],
      ),
    ).rejects.toThrow(/class_duration_15_weeks/);
  });

  it("không cho hai khung check-in chồng giờ trong một buổi (FR-025)", async () => {
    await db.query(
      `insert into attendance_windows (session_id, type, opens_at, closes_at, radius_m) values ($1,'check_in','2026-11-14T00:00Z','2026-11-14T00:15Z',50)`,
      [sessionId],
    );
    await expect(
      db.query(
        `insert into attendance_windows (session_id, type, opens_at, closes_at, radius_m) values ($1,'check_in','2026-11-14T00:10Z','2026-11-14T00:20Z',50)`,
        [sessionId],
      ),
    ).rejects.toThrow(/no_overlapping_windows/);
    // khác loại thì được
    await db.query(
      `insert into attendance_windows (session_id, type, opens_at, closes_at, radius_m) values ($1,'check_out','2026-11-14T02:15Z','2026-11-14T02:35Z',50)`,
      [sessionId],
    );
  });

  it("mỗi SV tối đa một lượt hợp lệ/nghi vấn mỗi khung, nhưng nhiều lượt bị từ chối được", async () => {
    const w = (await db.query<{ id: string }>(`select id from attendance_windows where type='check_in'`)).rows[0].id;
    const ins = (result: string, n: number) =>
      db.query(
        `insert into attendance_events (window_id, student_id, attempt_no, result, reason, record, purge_after, record_purge_after)
         values ($1,$2,$3,$4,'ok','{}'::jsonb, now(), now())`,
        [w, studentA, n, result],
      );
    await ins("rejected", 1);
    await ins("retry", 2);
    await ins("valid", 3);
    await expect(ins("suspect", 4)).rejects.toThrow(/one_decision_per_window/);
  });

  it("đơn ảnh chat không thể tự duyệt (FR-106)", async () => {
    await expect(
      db.query(
        `insert into leave_requests (student_id, reason_category, evidence_type, leave_date, auto_status, auto_approved, purge_after)
         values ($1,'illness','chat','2026-11-14','passed', true, now())`,
        [studentA],
      ),
    ).rejects.toThrow(/chat_never_auto/);
  });

  it("sửa thủ công phải có lý do ≥ 5 ký tự và chấp nhận 'excused' (FR-064)", async () => {
    await expect(
      db.query(
        `insert into manual_overrides (session_id, student_id, window_type, new_value, reason, actor_id) values ($1,$2,'check_in','excused','ok',$3)`,
        [sessionId, studentA, instructorId],
      ),
    ).rejects.toThrow(/override_reason_len/);
    await db.query(
      `insert into manual_overrides (session_id, student_id, window_type, new_value, reason, actor_id) values ($1,$2,'check_in','excused','Đã xin phép qua chat',$3)`,
      [sessionId, studentA, instructorId],
    );
  });

  it("tối đa 2 phản hồi mỗi buổi mỗi SV (FR-115)", async () => {
    const ins = () =>
      db.query(`insert into attendance_disputes (session_id, student_id, message) values ($1,$2,'Em có đi học')`, [
        sessionId,
        studentB,
      ]);
    await ins();
    await ins();
    await expect(ins()).rejects.toThrow(/DISPUTE_LIMIT/);
  });

  it("vector 512 chiều lưu và so cosine được (pgvector)", async () => {
    const v = `[${Array.from({ length: 512 }, (_, i) => (i === 0 ? 1 : 0)).join(",")}]`;
    const r = await db.query<{ sim: number }>(`select 1 - ($1::vector <=> $1::vector) as sim`, [v]);
    expect(Number(r.rows[0].sim)).toBeCloseTo(1, 6);
  });
});

describe("tìm kiếm không dấu (FR-071)", () => {
  it.each([
    ["luu tung lam", "231230821"],
    ["TÙNG LÂM", "231230821"],
    ["dang thi dao", "231230999"],
    ["k64", "231230821"],
    ["2312309", "231230999"],
  ])("tìm %j ra %s", async (q, code) => {
    const r = await db.query<{ student_code: string }>(
      `select student_code from students where search_text like '%' || lower(f_unaccent($1)) || '%'`,
      [q],
    );
    expect(r.rows.map((x) => x.student_code)).toContain(code);
  });
});

describe("RLS bật trên mọi bảng (FR-093)", () => {
  it("không có bảng public nào thiếu RLS", async () => {
    const r = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`,
    );
    expect(r.rows).toEqual([]);
  });
});
