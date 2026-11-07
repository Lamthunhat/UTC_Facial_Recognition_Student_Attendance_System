import { useTestAppDb } from "@utc/database/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readJson } from "../../support/http";
import { NO_PARAMS } from "../../../src/http/handler";
import { POST as login } from "../../../src/api/auth/staff-login";
import { POST as logout } from "../../../src/api/auth/logout";
import { GET as me } from "../../../src/api/me";
import { hashPassword } from "../../../src/auth/password";
import { SESSION_COOKIE } from "../../../src/auth/session";

let ctx: Awaited<ReturnType<typeof useTestAppDb>>;
const ORIGIN = "http://localhost";
let ipSeq = 1;

function post(body: unknown, ip = `10.0.0.${ipSeq++}`) {
  return new Request(`${ORIGIN}/api/auth/staff/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "x-real-ip": ip },
    body: JSON.stringify(body),
  });
}
const cookieFrom = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";

beforeAll(async () => {
  process.env.JWT_SECRET = "integration-secret-integration-secret-xx";
  ctx = await useTestAppDb();
  const h = await hashPassword("matkhau-dung-123");
  await ctx.pg.query(
    `insert into users (email,password_hash,full_name,role) values
     ('gv@utc.edu.vn',$1,'Nguyễn Kim Sao','instructor'),
     ('admin@utc.edu.vn',$1,'Quản trị','admin'),
     ('khoa@utc.edu.vn',$1,'Bị khoá','instructor')`,
    [h],
  );
  await ctx.pg.query(`update users set is_locked = true where email='khoa@utc.edu.vn'`);
}, 120_000);
afterAll(() => ctx.close());

describe("POST /api/auth/staff/login (T035)", () => {
  it("đúng mật khẩu → 200, cookie phiên, vai trò", async () => {
    const res = await login(post({ email: "GV@utc.edu.vn ", password: "matkhau-dung-123" }), NO_PARAMS);
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({ user: { role: "instructor", fullName: "Nguyễn Kim Sao" } });
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^${SESSION_COOKIE}=.+HttpOnly`));
  });

  it("sai mật khẩu và email không tồn tại trả cùng một thông báo (chống dò email)", async () => {
    const a = await login(post({ email: "gv@utc.edu.vn", password: "sai-mat-khau-1" }), NO_PARAMS);
    const b = await login(post({ email: "khongco@utc.edu.vn", password: "sai-mat-khau-1" }), NO_PARAMS);
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await readJson(a)).toEqual(await readJson(b));
  });

  it("tài khoản bị khoá không đăng nhập được (cùng thông báo chung)", async () => {
    const res = await login(post({ email: "khoa@utc.edu.vn", password: "matkhau-dung-123" }), NO_PARAMS);
    expect(res.status).toBe(401);
    expect((await readJson(res)).error.code).toBe("LOGIN_FAILED");
  });

  it("sai 5 lần liên tiếp → khoá 15 phút, kể cả khi nhập đúng sau đó (FR-081)", async () => {
    await ctx.pg.query(`insert into users (email,password_hash,full_name,role) select 'lock@utc.edu.vn', password_hash, 'X','instructor' from users where email='gv@utc.edu.vn'`);
    for (let i = 0; i < 5; i++) await login(post({ email: "lock@utc.edu.vn", password: "sai-mat-khau-xx" }), NO_PARAMS);
    const res = await login(post({ email: "lock@utc.edu.vn", password: "matkhau-dung-123" }), NO_PARAMS);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    const ev = await ctx.pg.query(`select count(*)::int as n from security_events where type='login_failed'`);
    expect((ev.rows[0] as { n: number }).n).toBeGreaterThanOrEqual(5);
  });

  it("body sai schema → 422; trường lạ bị từ chối", async () => {
    expect((await login(post({ email: "gv@utc.edu.vn" }), NO_PARAMS)).status).toBe(422);
    expect((await login(post({ email: "gv@utc.edu.vn", password: "x".repeat(12), role: "admin" }), NO_PARAMS)).status).toBe(422);
  });

  it("đăng nhập → /api/me → đăng xuất → phiên bị thu hồi", async () => {
    const res = await login(post({ email: "admin@utc.edu.vn", password: "matkhau-dung-123" }), NO_PARAMS);
    const cookie = cookieFrom(res);
    const meReq = () => new Request(`${ORIGIN}/api/me`, { headers: { cookie } });
    const m = await me(meReq(), NO_PARAMS);
    expect(m.status).toBe(200);
    expect(await readJson(m)).toMatchObject({ user: { role: "admin", email: "admin@utc.edu.vn" } });
    const out = await logout(new Request(`${ORIGIN}/api/auth/logout`, { method: "POST", headers: { cookie, origin: ORIGIN } }), NO_PARAMS);
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await me(meReq(), NO_PARAMS)).status).toBe(401);
  });
});
