import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertOwnsClass, assertOwnsSession, requireRole } from "../../../src/auth/guards";
import { createSession, getSession, revokeAllSessions, revokeSession, SESSION_COOKIE } from "../../../src/auth/session";
import { useTestAppDb } from "@utc/database/testing";

let ctx: Awaited<ReturnType<typeof useTestAppDb>>;
let gvA: string, gvB: string, admin: string, classA: string, sessionA: string;

const reqWith = (token?: string) =>
  new Request("http://localhost/api/x", { headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {} });

beforeAll(async () => {
  process.env.JWT_SECRET = "integration-secret-integration-secret-xx";
  ctx = await useTestAppDb();
  const ins = async (email: string, role: string) =>
    (await ctx.pg.query<{ id: string }>(`insert into users (email,password_hash,full_name,role) values ($1,'x','N',$2) returning id`, [email, role])).rows[0].id;
  gvA = await ins("a@x.vn", "instructor");
  gvB = await ins("b@x.vn", "instructor");
  admin = await ins("ad@x.vn", "admin");
  classA = (await ctx.pg.query<{ id: string }>(`insert into classes (instructor_id,code,course_name,start_date,end_date) values ($1,'L1','M','2026-09-07','2026-12-20') returning id`, [gvA])).rows[0].id;
  sessionA = (await ctx.pg.query<{ id: string }>(`insert into sessions (class_id,date,first_period,last_period,starts_at,ends_at,room,kind) values ($1,'2026-11-14',1,3,now(),now()+interval '2 hours','301','scheduled') returning id`, [classA])).rows[0].id;
}, 60_000);
afterAll(() => ctx.close());

describe("phiên đăng nhập (T025)", () => {
  it("tạo phiên → cookie httpOnly, đọc lại được", async () => {
    const s = await createSession(gvA, "instructor");
    expect(s.cookie).toMatch(/HttpOnly/);
    expect(s.cookie).toMatch(/SameSite=Lax/);
    expect(await getSession(reqWith(s.token))).toMatchObject({ sub: gvA, role: "instructor" });
  });
  it("không có cookie → null", async () => {
    expect(await getSession(reqWith())).toBeNull();
  });
  it("thu hồi một phiên", async () => {
    const s = await createSession(gvA, "instructor");
    await revokeSession(s.sid);
    expect(await getSession(reqWith(s.token))).toBeNull();
  });
  it("thu hồi mọi phiên của một người (FR-094)", async () => {
    const s1 = await createSession(gvB, "instructor");
    const s2 = await createSession(gvB, "instructor");
    await revokeAllSessions(gvB);
    expect(await getSession(reqWith(s1.token))).toBeNull();
    expect(await getSession(reqWith(s2.token))).toBeNull();
  });
});

describe("guards (T027)", () => {
  it("requireRole: chưa đăng nhập → 401, sai vai trò → 403", () => {
    expect(() => requireRole(null, ["admin"])).toThrow(expect.objectContaining({ status: 401 }));
    expect(() => requireRole({ sub: gvA, role: "instructor", sid: "x" }, ["admin"])).toThrow(
      expect.objectContaining({ status: 403 }),
    );
  });
  it("giảng viên chỉ thấy lớp của mình; lớp người khác → 404", async () => {
    await expect(assertOwnsClass({ sub: gvA, role: "instructor", sid: "x" }, classA)).resolves.toBeUndefined();
    await expect(assertOwnsClass({ sub: gvB, role: "instructor", sid: "x" }, classA)).rejects.toMatchObject({ status: 404 });
    await expect(assertOwnsClass({ sub: admin, role: "admin", sid: "x" }, classA)).resolves.toBeUndefined();
    await expect(assertOwnsClass({ sub: gvA, role: "instructor", sid: "x" }, "not-a-uuid")).rejects.toMatchObject({ status: 404 });
  });
  it("buổi học của lớp người khác → 404", async () => {
    await expect(assertOwnsSession({ sub: gvA, role: "instructor", sid: "x" }, sessionA)).resolves.toBeUndefined();
    await expect(assertOwnsSession({ sub: gvB, role: "instructor", sid: "x" }, sessionA)).rejects.toMatchObject({ status: 404 });
  });
});
