import { useTestAppDb } from "@utc/database/testing";
import { vnDateOf } from "@utc/shared/periods";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as studentLogin } from "../../src/api/auth/student-login";
import { getSession, revokeSession } from "../../src/auth/session";
import { NO_PARAMS } from "../../src/http/handler";
import { readJson } from "../support/http";

/**
 * T054 — Đăng nhập sinh viên chỉ bằng mã SV (FR-004, FR-081, FR-083, FR-095).
 * Mọi lý do thất bại (không tồn tại, không thuộc lớp đang hoạt động, sai định dạng) trả CÙNG một phản hồi.
 */
const O = "http://localhost";
const FAIL_MSG = "Không đăng nhập được. Kiểm tra lại mã sinh viên hoặc liên hệ giảng viên.";

let ctx: Awaited<ReturnType<typeof useTestAppDb>>;
let activeStudentId = "";

const login = (studentCode: unknown, ip = "10.0.0.1") =>
  studentLogin(
    new Request(`${O}/api/auth/student/login`, {
      method: "POST",
      headers: { origin: O, "content-type": "application/json", "x-real-ip": ip },
      body: JSON.stringify({ studentCode }),
    }),
    NO_PARAMS,
  );

const daysFromToday = (n: number) => vnDateOf(new Date(Date.now() + n * 86_400_000));

beforeAll(async () => {
  process.env.JWT_SECRET = "integration-secret-integration-secret-xx";
  ctx = await useTestAppDb();
  const q = <T>(sql: string, args: unknown[] = []) => ctx.pg.query<T>(sql, args).then((r) => r.rows);
  const [gv] = await q<{ id: string }>(`insert into users (email,password_hash,full_name,role) values ('gv@x','x','GV','instructor') returning id`);
  const mkClass = async (code: string, start: string, end: string) =>
    (await q<{ id: string }>(`insert into classes (instructor_id, code, course_name, start_date, end_date) values ($1,$2,'HP',$3,$4) returning id`, [gv.id, code, start, end]))[0].id;
  const mkStudent = async (code: string, last: string, first: string) =>
    (await q<{ id: string }>(`insert into students (student_code,last_name,first_name) values ($1,$2,$3) returning id`, [code, last, first]))[0].id;

  const running = await mkClass("DANG-HOC", daysFromToday(-30), daysFromToday(30));
  const ended = await mkClass("DA-KET-THUC", daysFromToday(-120), daysFromToday(-20));
  const upcoming = await mkClass("SAP-HOC", daysFromToday(5), daysFromToday(90));

  activeStudentId = await mkStudent("231230801", "Nguyễn Văn", "An"); // lớp đang học
  const withdrawn = await mkStudent("231230802", "Trần Thị", "Bình"); // đã rút khỏi lớp đang học
  const endedOnly = await mkStudent("231230803", "Lê Minh", "Cường"); // chỉ có lớp đã kết thúc
  const upcomingOnly = await mkStudent("231230804", "Phạm Quốc", "Dũng"); // lớp chưa bắt đầu
  await mkStudent("231230805", "Vũ Đức", "Hà"); // không thuộc lớp nào
  for (const [c, s, st] of [
    [running, activeStudentId, "active"],
    [running, withdrawn, "withdrawn"],
    [ended, endedOnly, "active"],
    [upcoming, upcomingOnly, "active"],
  ] as const) {
    await q(`insert into enrollments (class_id, student_id, status) values ($1,$2,$3)`, [c, s, st]);
  }
}, 120_000);
afterAll(() => ctx.close());

describe("POST /api/auth/student/login", () => {
  it("mã thuộc lớp đang học → 200, phiên role=student có sid, cookie phiên trình duyệt (không Max-Age)", async () => {
    const res = await login("231230801");
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.student).toMatchObject({ id: activeStudentId, code: "231230801", fullName: "Nguyễn Văn An", consentAt: null, hasActiveCard: false });

    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).not.toMatch(/Max-Age/i); // FR-004: hết hạn khi đóng trình duyệt
    const token = cookie.split(";")[0];
    const session = await getSession(new Request(O, { headers: { cookie: token } }));
    expect(session).toMatchObject({ sub: activeStudentId, role: "student" });
    const [row] = (await ctx.pg.query<{ actor_type: string; ttl: number }>(
      `select actor_type, extract(epoch from (expires_at - created_at))::int as ttl from user_sessions where sid = $1`,
      [session!.sid],
    )).rows;
    expect(row.actor_type).toBe("student");
    expect(row.ttl).toBeLessThanOrEqual(2 * 3600 + 5); // tối đa 2 giờ

    // sid thu hồi được
    await revokeSession(session!.sid);
    expect(await getSession(new Request(O, { headers: { cookie: token } }))).toBeNull();
  });

  it("mã có khoảng trắng thừa vẫn đăng nhập được", async () => {
    expect((await login(" 231230801 ", "10.0.0.2")).status).toBe(200);
  });

  it("mọi lý do thất bại trả cùng 401 LOGIN_FAILED + cùng thông báo (FR-083)", async () => {
    const cases = ["231230805" /* không thuộc lớp */, "231230802" /* đã rút */, "231230803" /* lớp đã kết thúc */, "999999999" /* không tồn tại */, "abc", "12"];
    const bodies: string[] = [];
    let ip = 10;
    for (const c of cases) {
      const res = await login(c, `10.0.1.${ip++}`);
      expect(res.status, `mã ${c}`).toBe(401);
      bodies.push(JSON.stringify(await readJson(res)));
    }
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0])).toEqual({ error: { code: "LOGIN_FAILED", message: FAIL_MSG } });
  });

  it("lớp chưa bắt đầu vẫn tính là đang hoạt động (đăng ký thẻ trước buổi đầu)", async () => {
    expect((await login("231230804", "10.0.2.1")).status).toBe(200);
  });

  it("body sai kiểu (số, thiếu trường, trường lạ) cũng chỉ trả LOGIN_FAILED, không lộ chi tiết kiểm tra", async () => {
    for (const body of [{ studentCode: 231230801 }, {}, { studentCode: "231230801", role: "admin" }]) {
      const res = await studentLogin(
        new Request(`${O}/api/auth/student/login`, {
          method: "POST",
          headers: { origin: O, "content-type": "application/json", "x-real-ip": "10.0.3.1" },
          body: JSON.stringify(body),
        }),
        NO_PARAMS,
      );
      expect(res.status).toBe(401);
      expect((await readJson(res)).error.code).toBe("LOGIN_FAILED");
    }
  });

  it("mỗi lần thất bại ghi security_events login_failed (không lưu nguyên mã SV)", async () => {
    await login("231239999", "10.0.4.1");
    const rows = (await ctx.pg.query<{ meta: Record<string, unknown> }>(
      `select meta from security_events where type = 'login_failed' and ip = '10.0.4.1'`,
    )).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].meta).toMatchObject({ kind: "student" });
    expect(JSON.stringify(rows[0].meta)).not.toContain("231239999");
  });

  it("rate limit theo IP: 10 lần/5 phút, lần 11 → 429 + Retry-After + security_events rate_limited", async () => {
    const ip = "10.9.9.9";
    for (let i = 0; i < 10; i++) expect((await login(`2312400${String(i).padStart(2, "0")}`, ip)).status).toBe(401);
    const res = await login("231230801", ip); // kể cả mã đúng
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50)); // ghi sự kiện không chặn phản hồi
    const n = (await ctx.pg.query<{ n: number }>(`select count(*)::int as n from security_events where type='rate_limited' and ip=$1`, [ip])).rows[0].n;
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it("rate limit theo mã SV: 5 lần/5 phút dù đổi IP, lần 6 → 429", async () => {
    const code = "231230866"; // mã chưa dùng ở ca nào khác
    for (let i = 0; i < 5; i++) expect((await login(code, `10.7.0.${i}`)).status).toBe(401);
    expect((await login(code, "10.7.0.99")).status).toBe(429);
  });
});
