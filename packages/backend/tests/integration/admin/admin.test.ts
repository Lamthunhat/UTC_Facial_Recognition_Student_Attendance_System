import { useTestAppDb } from "@utc/database/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readJson } from "../../support/http";
import { NO_PARAMS } from "../../../src/http/handler";
import { GET as attendance } from "../../../src/api/admin/attendance";
import { GET as listInstructors, POST as createInstructor } from "../../../src/api/admin/instructors";
import { PATCH as updateInstructor } from "../../../src/api/admin/instructor";
import { GET as getPeriods, PUT as putPeriods } from "../../../src/api/admin/periods";
import { createSession, getSession, SESSION_COOKIE } from "../../../src/auth/session";
import { POST as login } from "../../../src/api/auth/staff-login";
import { DEFAULT_PERIODS } from "@utc/shared/periods";

let ctx: Awaited<ReturnType<typeof useTestAppDb>>;
let adminCookie = "";
let gvCookie = "";
let adminId = "";
const O = "http://localhost";

const req = (path: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request(`${O}${path}`, {
    ...init,
    headers: { origin: O, "content-type": "application/json", ...(init.cookie ? { cookie: init.cookie } : {}), ...init.headers },
  });
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });

beforeAll(async () => {
  process.env.JWT_SECRET = "integration-secret-integration-secret-xx";
  ctx = await useTestAppDb();
  adminId = (await ctx.pg.query<{ id: string }>(`insert into users (email,password_hash,full_name,role) values ('ad@utc.edu.vn','x','Admin','admin') returning id`)).rows[0].id;
  const gv = (await ctx.pg.query<{ id: string }>(`insert into users (email,password_hash,full_name,role) values ('gv0@utc.edu.vn','x','GV0','instructor') returning id`)).rows[0].id;
  adminCookie = `${SESSION_COOKIE}=${(await createSession(adminId, "admin")).token}`;
  gvCookie = `${SESSION_COOKIE}=${(await createSession(gv, "instructor")).token}`;
}, 120_000);
afterAll(() => ctx.close());

describe("quản lý giảng viên (T037)", () => {
  let newId = "";
  it("giảng viên không gọi được API admin → 403", async () => {
    expect((await listInstructors(req("/api/admin/instructors", { cookie: gvCookie }), NO_PARAMS)).status).toBe(403);
  });

  it("tạo giảng viên → 201, đăng nhập được bằng mật khẩu đã đặt", async () => {
    const res = await createInstructor(
      req("/api/admin/instructors", { method: "POST", cookie: adminCookie, body: JSON.stringify({ email: "Moi@UTC.edu.vn", fullName: "Trần Văn Mới", password: "matkhau-moi-123" }) }),
      NO_PARAMS,
    );
    expect(res.status).toBe(201);
    newId = (await readJson(res)).instructor.id;
    const l = await login(req("/api/auth/staff/login", { method: "POST", headers: { "x-real-ip": "1.1.1.1" }, body: JSON.stringify({ email: "moi@utc.edu.vn", password: "matkhau-moi-123" }) }), NO_PARAMS);
    expect(l.status).toBe(200);
  });

  it("email trùng → 409; mật khẩu ngắn → 422", async () => {
    const dup = await createInstructor(req("/api/admin/instructors", { method: "POST", cookie: adminCookie, body: JSON.stringify({ email: "moi@utc.edu.vn", fullName: "Trùng Email", password: "matkhau-moi-123" }) }), NO_PARAMS);
    expect(dup.status).toBe(409);
    const short = await createInstructor(req("/api/admin/instructors", { method: "POST", cookie: adminCookie, body: JSON.stringify({ email: "a@utc.edu.vn", fullName: "X", password: "ngan" }) }), NO_PARAMS);
    expect(short.status).toBe(422);
  });

  it("danh sách có giảng viên mới, không lộ password_hash", async () => {
    const res = await listInstructors(req("/api/admin/instructors", { cookie: adminCookie }), NO_PARAMS);
    const body = await readJson(res);
    expect(body.instructors.map((i: { email: string }) => i.email)).toContain("moi@utc.edu.vn");
    expect(JSON.stringify(body)).not.toMatch(/password/i);
  });

  it("khoá tài khoản → thu hồi mọi phiên đang mở (FR-094) + ghi audit", async () => {
    const s = await createSession(newId, "instructor");
    const r = new Request(`${O}/x`, { headers: { cookie: `${SESSION_COOKIE}=${s.token}` } });
    expect(await getSession(r)).not.toBeNull();
    const res = await updateInstructor(
      req(`/api/admin/instructors/${newId}`, { method: "PATCH", cookie: adminCookie, body: JSON.stringify({ isLocked: true }) }),
      params({ id: newId }),
    );
    expect(res.status).toBe(200);
    expect(await getSession(r)).toBeNull();
    const audit = await ctx.pg.query(`select action from audit_logs where target_id=$1`, [newId]);
    expect(audit.rows.map((x) => (x as { action: string }).action)).toContain("instructor.lock");
  });

  it("không sửa được tài khoản admin qua API giảng viên → 404", async () => {
    const res = await updateInstructor(
      req(`/api/admin/instructors/${adminId}`, { method: "PATCH", cookie: adminCookie, body: JSON.stringify({ isLocked: true }) }),
      params({ id: adminId }),
    );
    expect(res.status).toBe(404);
  });
});

describe("bảng tiết học (T037, FR-010a)", () => {
  const body = (over: Partial<Record<number, { startsAt: string; endsAt: string }>> = {}) =>
    JSON.stringify({
      periods: DEFAULT_PERIODS.map((p) => ({ number: p.number, startsAt: p.startsAt, endsAt: p.endsAt, ...over[p.number] })),
    });

  it("đọc 16 tiết", async () => {
    const res = await getPeriods(req("/api/admin/periods", { cookie: adminCookie }), NO_PARAMS);
    expect((await readJson(res)).periods).toHaveLength(16);
  });

  it("sửa giờ tiết 1 → lưu được", async () => {
    const res = await putPeriods(req("/api/admin/periods", { method: "PUT", cookie: adminCookie, body: body({ 1: { startsAt: "06:55", endsAt: "07:45" } }) }), NO_PARAMS);
    expect(res.status).toBe(200);
    const after = await getPeriods(req("/api/admin/periods", { cookie: adminCookie }), NO_PARAMS);
    expect((await readJson(after)).periods[0]).toMatchObject({ number: 1, startsAt: "06:55" });
  });

  it("từ chối tiết chồng giờ hoặc kết thúc trước bắt đầu", async () => {
    const overlap = await putPeriods(req("/api/admin/periods", { method: "PUT", cookie: adminCookie, body: body({ 2: { startsAt: "07:30", endsAt: "08:35" } }) }), NO_PARAMS);
    expect(overlap.status).toBe(422);
    const reversed = await putPeriods(req("/api/admin/periods", { method: "PUT", cookie: adminCookie, body: body({ 5: { startsAt: "11:10", endsAt: "10:25" } }) }), NO_PARAMS);
    expect(reversed.status).toBe(422);
  });
});

describe("dữ liệu điểm danh toàn trường (T038, FR-002)", () => {
  beforeAll(async () => {
    const gv = (await ctx.pg.query<{ id: string }>(`select id from users where email='gv0@utc.edu.vn'`)).rows[0].id;
    const st = (await ctx.pg.query<{ id: string }>(`insert into students (student_code,last_name,first_name) values ('231230001','Lê','An') returning id`)).rows[0].id;
    const cls = (await ctx.pg.query<{ id: string }>(`insert into classes (instructor_id,code,course_name,semester,start_date,end_date) values ($1,'KPDL-N03','Khai phá dữ liệu','1-2026-2027','2026-09-07','2026-12-20') returning id`, [gv])).rows[0].id;
    const ses = (await ctx.pg.query<{ id: string }>(`insert into sessions (class_id,date,first_period,last_period,starts_at,ends_at,room,kind) values ($1,'2026-11-14',1,3,'2026-11-14T00:00Z','2026-11-14T02:25Z','301-A7','scheduled') returning id`, [cls])).rows[0].id;
    const w = (await ctx.pg.query<{ id: string }>(`insert into attendance_windows (session_id,type,opens_at,closes_at,radius_m) values ($1,'check_in','2026-11-14T00:00Z','2026-11-14T00:15Z',50) returning id`, [ses])).rows[0].id;
    await ctx.pg.query(`insert into attendance_events (window_id,student_id,attempt_no,result,reason,record,purge_after,record_purge_after) values ($1,$2,1,'rejected','out_of_range','{}',now(),now()),($1,$2,2,'valid','ok','{}',now(),now())`, [w, st]);
  });

  it("tổng hợp theo lớp, lọc theo khoảng ngày; ghi audit khi admin xem", async () => {
    const res = await attendance(req("/api/admin/attendance?from=2026-11-01&to=2026-11-30", { cookie: adminCookie }), NO_PARAMS);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.total).toBe(1);
    expect(body.rows[0]).toMatchObject({ classCode: "KPDL-N03", instructorName: "GV0", sessions: 1, valid: 1, rejected: 1, suspect: 0 });
    const none = await readJson(await attendance(req("/api/admin/attendance?from=2026-12-01&to=2026-12-31", { cookie: adminCookie }), NO_PARAMS));
    expect(none.rows).toHaveLength(0);
    const audit = await ctx.pg.query(`select count(*)::int n from audit_logs where action='admin.attendance.view'`);
    expect((audit.rows[0] as { n: number }).n).toBeGreaterThan(0);
  });

  it("tham số sai định dạng → 422; giảng viên → 403", async () => {
    expect((await attendance(req("/api/admin/attendance?from=14-11-2026", { cookie: adminCookie }), NO_PARAMS)).status).toBe(422);
    expect((await attendance(req("/api/admin/attendance", { cookie: gvCookie }), NO_PARAMS)).status).toBe(403);
  });
});
