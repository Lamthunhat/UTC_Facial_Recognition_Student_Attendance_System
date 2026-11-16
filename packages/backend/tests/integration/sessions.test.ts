import { useTestAppDb } from "@utc/database/testing";
import { vnDateOf, vnDateTime } from "@utc/shared/periods";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as openCheckin } from "../../src/api/classes/open-checkin";
import { GET as sessionsToday } from "../../src/api/classes/sessions-today";
import { PATCH as patchSession } from "../../src/api/sessions/session";
import { POST as spotCheck } from "../../src/api/sessions/spot-check";
import { POST as closeWindow } from "../../src/api/windows/close";
import { vnWeekday } from "../../src/attendance/window-times";
import { createSession, SESSION_COOKIE } from "../../src/auth/session";
import { resetNowForTest, setNowForTest } from "../../src/clock";
import { readJson } from "../support/http";

/**
 * T074/T076 (+ T100) — GV mở check-in cho buổi hôm nay (tâm GPS + sai số; muộn tính từ lúc mở), khung check-out tự tạo
 * theo giờ kết thúc tiết cuối ± độ lệch lớp, đổi phòng / bỏ check-out, đóng sớm, kiểm tra đột xuất.
 * Đồng hồ ứng dụng cố định bằng setNowForTest (giờ VN của buổi tiết 1–3 hôm nay) → test không phụ thuộc giờ chạy.
 */
const O = "http://localhost";
let ctx: Awaited<ReturnType<typeof useTestAppDb>>;
const q = <T = Record<string, unknown>>(s: string, a: unknown[] = []) => ctx.pg.query<T>(s, a).then((r) => r.rows);
const ids: Record<string, string> = {};
const cookie: Record<string, string> = {};
const TODAY = vnDateOf(new Date());
const at = (hhmm: string) => vnDateTime(TODAY, hhmm);
const daysFromToday = (n: number) => vnDateOf(new Date(Date.now() + n * 86_400_000));
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });
const req = (path: string, c: string, body?: unknown, method = "POST") =>
  new Request(`${O}${path}`, {
    method,
    headers: { origin: O, "content-type": "application/json", cookie: c },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const GPS = { lat: 21.02741, lng: 105.80123, accuracyM: 12 };
const open = (cls: string, who = "gv1", body: Record<string, unknown> = {}) =>
  openCheckin(req(`/api/classes/${ids[cls]}/sessions/open-checkin`, cookie[who], { ...GPS, ...body }), params({ id: ids[cls] }));

beforeAll(async () => {
  process.env.JWT_SECRET = "integration-secret-integration-secret-xx";
  ctx = await useTestAppDb();
  for (const [k, role] of [["gv1", "instructor"], ["gv2", "instructor"], ["admin", "admin"]] as const) {
    ids[k] = (await q<{ id: string }>(`insert into users (email,password_hash,full_name,role) values ($1,'x',$1,$2) returning id`, [`${k}@x`, role]))[0].id;
    cookie[k] = `${SESSION_COOKIE}=${(await createSession(ids[k], role)).token}`;
  }
  const sv = (await q<{ id: string }>(`insert into students (student_code,last_name,first_name) values ('231230900','Lê','Sv') returning id`))[0].id;
  cookie.sv = `${SESSION_COOKIE}=${(await createSession(sv, "student")).token}`;
  const cls = async (key: string, opts: { start?: string; end?: string; room?: string } = {}) => {
    ids[key] = (
      await q<{ id: string }>(
        `insert into classes (instructor_id, code, course_name, start_date, end_date, default_room, radius_m) values ($1,$2,'HP',$3,$4,$5,60) returning id`,
        [ids.gv1, key, opts.start ?? daysFromToday(-30), opts.end ?? daysFromToday(60), opts.room ?? "301-A7-A7"],
      )
    )[0].id;
  };
  await cls("K"); // lịch hôm nay tiết 1–3 + tiết 7–9
  await cls("K2"); // lịch hôm nay tiết 1–3 (mở rồi đóng sớm, đổi phòng…)
  await cls("KOLD", { start: daysFromToday(-100), end: daysFromToday(-1) }); // đã kết thúc
  await cls("KMAKE"); // không có lịch hôm nay → chỉ học bù
  for (const [c, f, l] of [["K", 1, 3], ["K", 7, 9], ["K2", 1, 3], ["KOLD", 1, 3]] as const) {
    await q(`insert into class_schedules (class_id, weekday, first_period, last_period, room) values ($1,$2,$3,$4,null)`, [ids[c], vnWeekday(TODAY), f, l]);
  }
}, 120_000);
afterAll(async () => {
  resetNowForTest();
  await ctx.close();
});
beforeEach(() => setNowForTest(() => at("07:02")));

describe("GET /api/classes/{id}/sessions/today", () => {
  it("buổi theo lịch hôm nay: tiết, giờ, phòng (phòng mặc định của lớp), chưa mở", async () => {
    const res = await sessionsToday(req(`/api/classes/${ids.K}/sessions/today`, cookie.gv1, undefined, "GET"), params({ id: ids.K }));
    expect(res.status).toBe(200);
    const { sessions } = await readJson(res);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({
      sessionId: null,
      kind: "scheduled",
      firstPeriod: 1,
      lastPeriod: 3,
      room: "301-A7-A7",
      startsAt: at("07:00").toISOString(),
      endsAt: at("09:25").toISOString(),
      windows: [],
    });
  });
  it("lớp của GV khác → 404", async () => {
    const res = await sessionsToday(req(`/api/classes/${ids.K}/sessions/today`, cookie.gv2, undefined, "GET"), params({ id: ids.K }));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/classes/{id}/sessions/open-checkin", () => {
  it("mở buổi tiết 1–3: lưu tâm GPS + sai số; check-in 15'; check-out 9:15–9:35; audit trong transaction", async () => {
    const res = await open("K", "gv1", { firstPeriod: 1 });
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.warnings).toEqual([]);
    expect(body.session).toMatchObject({ date: TODAY, firstPeriod: 1, lastPeriod: 3, room: "301-A7-A7", kind: "scheduled" });
    expect(body.checkinWindow).toMatchObject({ type: "check_in", opensAt: at("07:02").toISOString(), closesAt: at("07:17").toISOString(), radiusM: 60 });
    expect(body.checkoutWindow).toMatchObject({ type: "check_out", opensAt: at("09:15").toISOString(), closesAt: at("09:35").toISOString() });
    const [s] = await q<{ center_lat: number; center_lng: number; center_accuracy_m: number }>(`select center_lat, center_lng, center_accuracy_m from sessions where id=$1`, [body.session.id]);
    expect(s).toEqual({ center_lat: 21.02741, center_lng: 105.80123, center_accuracy_m: 12 });
    expect(await q(`select 1 from audit_logs where action='session.open_checkin' and target_id=$1`, [body.session.id])).toHaveLength(1);
    // Vị trí GV không bao giờ nằm trong phản hồi cho SV — ở đây chỉ kiểm phản hồi GV có dạng mong đợi
    const today = await readJson(await sessionsToday(req(`/api/classes/${ids.K}/sessions/today`, cookie.gv1, undefined, "GET"), params({ id: ids.K })));
    expect(today.sessions[0].sessionId).toBe(body.session.id);
    expect(today.sessions[0].windows.map((w: { type: string; open: boolean }) => [w.type, w.open])).toEqual([
      ["check_in", true],
      ["check_out", false],
    ]);
  });

  it("mở lại check-in cùng buổi → 409 CHECKIN_EXISTS (FR-025)", async () => {
    const res = await open("K", "gv1", { firstPeriod: 1 });
    expect(res.status).toBe(409);
    expect((await readJson(res)).error.code).toBe("CHECKIN_EXISTS");
  });

  it("sai số GPS của GV > 50 m → vẫn mở, kèm cảnh báo LOW_GPS_ACCURACY; bán kính + thời lượng chỉnh được", async () => {
    setNowForTest(() => at("12:55"));
    const res = await open("K", "gv1", { firstPeriod: 7, accuracyM: 80, radiusM: 120, checkinMinutes: 20 });
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.warnings).toEqual(["LOW_GPS_ACCURACY"]);
    expect(body.checkinWindow).toMatchObject({ radiusM: 120, closesAt: at("13:15").toISOString() });
  });

  it("không chỉ định tiết: chọn buổi chưa kết thúc sớm nhất trong lịch hôm nay", async () => {
    const res = await open("K2");
    expect(res.status).toBe(201);
    expect((await readJson(res)).session).toMatchObject({ firstPeriod: 1, lastPeriod: 3 });
  });

  it("học bù: khai báo tiết + phòng, lớp không có lịch hôm nay", async () => {
    setNowForTest(() => at("18:20"));
    expect((await open("KMAKE")).status).toBe(422); // không có lịch hôm nay
    const res = await open("KMAKE", "gv1", { kind: "makeup", firstPeriod: 13, lastPeriod: 15, room: "201-A2" });
    expect(res.status).toBe(201);
    expect((await readJson(res)).session).toMatchObject({ kind: "makeup", firstPeriod: 13, lastPeriod: 15, room: "201-A2" });
  });

  it.each<[string, () => Promise<Response>, number, string]>([
    ["buổi đã kết thúc", async () => (setNowForTest(() => at("09:30")), open("K2", "gv1", { firstPeriod: 1 })), 409, "SESSION_ENDED"],
    ["lớp đã kết thúc", () => open("KOLD"), 422, "OUTSIDE_CLASS_DATES"],
    ["ngày khác hôm nay", () => open("K", "gv1", { firstPeriod: 7, date: daysFromToday(1) }), 422, "DATE_NOT_TODAY"],
    ["tiết không có trong lịch hôm nay", () => open("K", "gv1", { firstPeriod: 4 }), 422, "NO_SCHEDULE"],
    ["học bù thiếu tiết", () => open("KMAKE", "gv1", { kind: "makeup" }), 422, "VALIDATION_ERROR"],
  ])("%s → %d %s", async (_n, call, status, code) => {
    const res = await call();
    expect(res.status).toBe(status);
    expect((await readJson(res)).error.code).toBe(code);
  });

  it.each([
    [{ lat: 91 }],
    [{ accuracyM: 0 }],
    [{ radiusM: 5 }],
    [{ checkinMinutes: 0 }],
    [{ extra: 1 }],
  ])("đầu vào sai %j → 422", async (over) => {
    expect((await open("K", "gv1", over)).status).toBe(422);
  });

  it("GV khác / SV → 404 / 403", async () => {
    expect((await open("K", "gv2")).status).toBe(404);
    expect((await open("K", "sv")).status).toBe(403);
  });
});

describe("PATCH /api/sessions/{id} — đổi phòng, bỏ check-out", () => {
  const sessionOf = async (cls: string) => (await q<{ id: string }>(`select id from sessions where class_id=$1 order by first_period limit 1`, [ids[cls]]))[0].id;

  it("đổi phòng trước giờ kết thúc + bỏ check-out → audit cũ → mới", async () => {
    const id = await sessionOf("K");
    const res = await patchSession(req(`/api/sessions/${id}`, cookie.gv1, { room: "405-A9", checkoutSkipped: true }, "PATCH"), params({ id }));
    expect(res.status).toBe(200);
    expect((await readJson(res)).session).toMatchObject({ room: "405-A9", checkoutSkipped: true });
    const [a] = await q<{ meta: Record<string, unknown> }>(`select meta from audit_logs where action='session.update' and target_id=$1`, [id]);
    expect(a.meta).toMatchObject({ before: { room: "301-A7-A7", checkoutSkipped: false }, after: { room: "405-A9", checkoutSkipped: true } });
  });
  it("sau giờ kết thúc buổi không đổi phòng được (409)", async () => {
    const id = await sessionOf("K");
    setNowForTest(() => at("09:30"));
    const res = await patchSession(req(`/api/sessions/${id}`, cookie.gv1, { room: "X" }, "PATCH"), params({ id }));
    expect(res.status).toBe(409);
    expect((await readJson(res)).error.code).toBe("SESSION_ENDED");
  });
  it("body rỗng / GV khác → 422 / 404", async () => {
    const id = await sessionOf("K");
    expect((await patchSession(req(`/api/sessions/${id}`, cookie.gv1, {}, "PATCH"), params({ id }))).status).toBe(422);
    expect((await patchSession(req(`/api/sessions/${id}`, cookie.gv2, { room: "X" }, "PATCH"), params({ id }))).status).toBe(404);
  });
});

describe("POST /api/windows/{id}/close — đóng sớm", () => {
  it("đóng khung đang mở; đóng lần nữa → 409; GV khác → 404", async () => {
    const [w] = await q<{ id: string }>(
      `select w.id from attendance_windows w join sessions s on s.id = w.session_id where s.class_id=$1 and w.type='check_in'`,
      [ids.K2],
    );
    setNowForTest(() => at("07:05"));
    expect((await closeWindow(req(`/api/windows/${w.id}/close`, cookie.gv2), params({ id: w.id }))).status).toBe(404);
    const res = await closeWindow(req(`/api/windows/${w.id}/close`, cookie.gv1), params({ id: w.id }));
    expect(res.status).toBe(200);
    expect((await readJson(res)).window).toMatchObject({ closedEarlyAt: at("07:05").toISOString(), open: false });
    expect(await q(`select 1 from audit_logs where action='window.close' and target_id=$1`, [w.id])).toHaveLength(1);
    const again = await closeWindow(req(`/api/windows/${w.id}/close`, cookie.gv1), params({ id: w.id }));
    expect(again.status).toBe(409);
  });
});

describe("POST /api/sessions/{id}/spot-check — kiểm tra đột xuất (FR-021/022)", () => {
  const sid = async () => (await q<{ id: string }>(`select id from sessions where class_id=$1 and first_period=7`, [ids.K]))[0].id;
  it("mặc định 5 phút, bán kính như khung check-in; đang có đột xuất mở → 409", async () => {
    setNowForTest(() => at("14:00"));
    const id = await sid();
    const res = await spotCheck(req(`/api/sessions/${id}/spot-check`, cookie.gv1, {}), params({ id }));
    expect(res.status).toBe(201);
    expect((await readJson(res)).window).toMatchObject({ type: "spot_check", opensAt: at("14:00").toISOString(), closesAt: at("14:05").toISOString(), radiusM: 120 });
    const again = await spotCheck(req(`/api/sessions/${id}/spot-check`, cookie.gv1, { minutes: 3 }), params({ id }));
    expect(again.status).toBe(409);
    expect((await readJson(again)).error.code).toBe("SPOT_CHECK_OPEN");
  });
  it("3 phút; ngoài 3–5 phút → 422; sau giờ kết thúc buổi → 409", async () => {
    const id = await sid();
    setNowForTest(() => at("14:30"));
    expect((await spotCheck(req(`/api/sessions/${id}/spot-check`, cookie.gv1, { minutes: 6 }), params({ id }))).status).toBe(422);
    const ok = await spotCheck(req(`/api/sessions/${id}/spot-check`, cookie.gv1, { minutes: 3 }), params({ id }));
    expect((await readJson(ok)).window.closesAt).toBe(at("14:33").toISOString());
    setNowForTest(() => at("15:30"));
    expect((await spotCheck(req(`/api/sessions/${id}/spot-check`, cookie.gv1, {}), params({ id }))).status).toBe(409);
  });
});
