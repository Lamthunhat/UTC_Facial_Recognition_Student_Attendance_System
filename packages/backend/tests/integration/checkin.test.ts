import { useTestAppDb } from "@utc/database/testing";
import { CONSENT_VERSION } from "@utc/shared/consent";
import { vnDateOf, vnDateTime } from "@utc/shared/periods";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as openCheckin } from "../../src/api/classes/open-checkin";
import { POST as spotCheck } from "../../src/api/sessions/spot-check";
import { POST as submitEvent } from "../../src/api/student/checkin-event";
import { GET as myClasses } from "../../src/api/student/classes";
import { GET as geoReverse } from "../../src/api/student/geo-reverse";
import { POST as clientError } from "../../src/api/student/scan-client-error";
import { POST as scanNonce } from "../../src/api/student/scan-nonce";
import { POST as giveConsent } from "../../src/api/student/consent";
import { POST as closeWindow } from "../../src/api/windows/close";
import { resetCheckinDepsForTest, setCheckinDepsForTest, type CheckinDeps } from "../../src/attendance/checkin";
import { recordPurgeAfter, vnWeekday } from "../../src/attendance/window-times";
import { createSession, SESSION_COOKIE } from "../../src/auth/session";
import { resetNowForTest, setNowForTest } from "../../src/clock";
import { NO_PARAMS } from "../../src/http/handler";
import { attendanceRecordV1 } from "../../src/records/schema";
import { readJson } from "../support/http";

/**
 * T067 + luồng check-in US2 (+ T085/T086 trùng mặt, T097/T099 check-out & đột xuất, T083, T072 API địa chỉ).
 * Nhận diện khuôn mặt + kho ảnh + Goong được thay bằng bản giả; DB (PGlite + pgvector), nonce, rate limit, sanitize ảnh,
 * đóng dấu ảnh (sharp + font thật), hồ sơ JSON chạy thật. Bản giả đọc "khuôn mặt nào, tư thế nào, mấy mặt" từ MÀU của
 * khung hình → các request song song không dùng chung biến trạng thái.
 */
const O = "http://localhost";
let ctx: Awaited<ReturnType<typeof useTestAppDb>>;
const q = <T = Record<string, unknown>>(s: string, a: unknown[] = []) => ctx.pg.query<T>(s, a).then((r) => r.rows);
const ids: Record<string, string> = {};
const cookie: Record<string, string> = {};
const TODAY = vnDateOf(new Date());
const at = (hhmm: string) => vnDateTime(TODAY, hhmm);
const daysFromToday = (n: number) => vnDateOf(new Date(Date.now() + n * 86_400_000));
const CLASS_END = daysFromToday(60);
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });
const CENTER = { lat: 21.02741, lng: 105.80123 };
const near = { ...CENTER, accuracyM: 15 };
const north = (m: number) => ({ lat: CENTER.lat + m / 111_195, lng: CENTER.lng });

// ---------- khuôn mặt giả: vector 512 chiều theo "người" ----------
function randomVector(seed: number): number[] {
  let a = seed >>> 0;
  return Array.from({ length: 512 }, () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  });
}
const norm = (v: number[]) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
/** Vector đơn vị có cosine ĐÚNG `sim` với `base` (Gram–Schmidt với một vector ngẫu nhiên). */
function withSimilarity(base: number[], sim: number, seed: number): number[] {
  const b = norm(base);
  const r = randomVector(seed);
  const o = norm(r.map((x, i) => x - dot(r, b) * b[i]));
  return b.map((x, i) => sim * x + Math.sqrt(1 - sim * sim) * o[i]);
}
/** Bảng "khuôn mặt": chỉ số (mã hoá vào màu khung hình) → vector. */
const faces: number[][] = [];
const face = (v: number[]) => faces.push(v) - 1;
const person = (seed: number) => face(norm(randomVector(seed)));

type Pose = "left" | "right" | "center";
const POSE_CODE: Record<Pose, number> = { center: 0, left: 1, right: 2 };
const POSES: Pose[] = ["center", "left", "right"];
/** Khung hình giả: BỀ RỘNG = 300 + chỉ số khuôn mặt, G = tư thế × 80, B = số mặt × 80 (sanitize giữ kích thước ≤ 1280). */
const frameCache = new Map<string, Buffer>();
async function frame(faceIdx: number, pose: Pose, n = 1): Promise<Buffer> {
  const key = `${faceIdx}/${pose}/${n}`;
  if (!frameCache.has(key)) {
    frameCache.set(
      key,
      await sharp({ create: { width: 300 + faceIdx, height: 240, channels: 3, background: { r: 120, g: POSE_CODE[pose] * 80, b: n * 80 } } })
        .jpeg({ quality: 95 })
        .toBuffer(),
    );
  }
  return frameCache.get(key)!;
}
const kpsFor = (pose: Pose): [number, number][] => {
  const off = pose === "left" ? 0.3 : pose === "right" ? -0.3 : 0;
  return [[100, 100], [160, 100], [130 + off * 60, 130], [108, 160], [152, 160]];
};
const box = { x1: 40, y1: 50, x2: 240, y2: 230 };

// ---------- bản giả cho nhận diện / kho ảnh / Goong ----------
const analyzeCalls = { n: 0 };
const uploads: { bucket: string; path: string; body: Buffer }[] = [];
const removed: string[] = [];
let geocodeAddress: string | null = "3 Cầu Giấy, Láng Thượng, Đống Đa, Hà Nội";
const fakeDeps: CheckinDeps = {
  analyzeLive: async (jpeg) => {
    analyzeCalls.n++;
    const img = sharp(jpeg);
    const idx = ((await img.metadata()).width ?? 0) - 300;
    const [, g, b] = (await img.stats()).channels.map((c) => c.mean);
    const pose = POSES[Math.round(g / 80)];
    const n = Math.round(b / 80);
    return {
      faces: Array.from({ length: n }, () => ({ score: 0.95, box, kps: kpsFor(pose), sharpness: 0.6 })),
      embed: async () => faces[idx],
      crop: async () => Buffer.alloc(0),
    };
  },
  storage: {
    upload: async (bucket, path, body) => {
      uploads.push({ bucket, path, body });
      return path;
    },
    remove: async (_bucket, paths) => void removed.push(...paths),
    signedUrl: async (bucket, path) => `https://storage.test/${bucket}/${path}?token=t`,
  },
  reverseGeocode: async () => geocodeAddress,
};

// ---------- request ----------
const UA = "Mozilla/5.0 (Linux; Android 15) Chrome/140.0 Mobile";
const json = (path: string, c: string, body?: unknown, method = "POST") =>
  new Request(`${O}${path}`, {
    method,
    headers: { origin: O, "content-type": "application/json", cookie: c, "user-agent": UA },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
async function multipart(path: string, c: string, fields: Record<string, string | Buffer[]>, extra: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "string") fd.append(k, v);
    else for (const b of v) fd.append(k, new Blob([new Uint8Array(b)], { type: "image/jpeg" }), "khung.jpg");
  }
  const tmp = new Request(`${O}${path}`, { method: "POST", body: fd });
  const body = Buffer.from(await tmp.arrayBuffer());
  return new Request(`${O}${path}`, {
    method: "POST",
    body,
    headers: { origin: O, cookie: c, "content-type": tmp.headers.get("content-type")!, "content-length": String(body.length), "user-agent": UA, ...extra },
  });
}

type Challenge = ["left" | "right", "left" | "right"];
const challengeOf = new Map<string, Challenge>();
async function getNonce(who: string, windowId: string) {
  const res = await scanNonce(json(`/api/windows/${windowId}/scan-nonce`, cookie[who]), params({ id: windowId }));
  const body = await readJson(res);
  if (res.status === 200) challengeOf.set(body.nonce, body.challenge);
  return { res, body };
}
/** Lấy nonce rồi gửi 3 khung theo thử thách (follow) / ngược (reverse) / ảnh tĩnh; `faceIdx` = khuôn mặt trong ảnh. */
async function checkIn(
  who: string,
  windowId: string,
  o: { faceIdx?: number; gps?: { lat: number; lng: number; accuracyM: number }; mode?: "follow" | "reverse" | "static"; faceCount?: number; nonce?: string } = {},
) {
  let nonce = o.nonce;
  if (!nonce) {
    const n = await getNonce(who, windowId);
    expect(n.res.status, `nonce cho ${who}: ${JSON.stringify(n.body)}`).toBe(200);
    nonce = n.body.nonce as string;
  }
  const challenge: Challenge = challengeOf.get(nonce) ?? ["left", "right"];
  const [a, b] = challenge;
  const seq: Pose[] = o.mode === "static" ? ["center", "center", "center"] : o.mode === "reverse" ? [b, "center", a] : [a, "center", b];
  const idx = o.faceIdx ?? faceOf[who];
  const frames = await Promise.all(seq.map((p, i) => frame(idx, p, i === 1 ? (o.faceCount ?? 1) : 1)));
  const g = o.gps ?? near;
  const res = await submitEvent(
    await multipart(`/api/windows/${windowId}/events`, cookie[who], { nonce, lat: String(g.lat), lng: String(g.lng), accuracyM: String(g.accuracyM), frames }),
    params({ id: windowId }),
  );
  return { res, body: await readJson(res) };
}
const eventsOf = (who: string, windowId: string) =>
  q<{ id: string; result: string; reason: string; attempt_no: number; dims: number | null; evidence_path: string | null; late_minutes: number | null; record: unknown; duplicate_of: string[] | null; purge_after: Date; record_purge_after: Date; server_time: Date; image_sha256: string | null; address_text: string | null; card_similarity: number | null; checkin_similarity: number | null }>(
    `select id, result, reason, attempt_no, vector_dims(embedding) as dims, evidence_path, late_minutes, record, duplicate_of, purge_after, record_purge_after,
            server_time, image_sha256, address_text, card_similarity, checkin_similarity
     from attendance_events where student_id = $1 and window_id = $2 order by server_time, attempt_no`,
    [ids[who], windowId],
  );
const windowOf = async (cls: string, type: string) =>
  (await q<{ id: string }>(`select w.id from attendance_windows w join sessions s on s.id = w.session_id where s.class_id = $1 and w.type = $2 order by w.opens_at desc limit 1`, [ids[cls], type]))[0].id;

// ---------- dữ liệu ----------
const faceOf: Record<string, number> = {};
async function addStudent(key: string, code: string, classes: string[], card: "active" | "pending_review" | "none" = "active", cardVec?: number[]) {
  ids[key] = (await q<{ id: string }>(`insert into students (student_code,last_name,first_name) values ($1,'Họ',$2) returning id`, [code, key]))[0].id;
  for (const c of classes) await q(`insert into enrollments (class_id, student_id) values ($1,$2)`, [ids[c], ids[key]]);
  cookie[key] = `${SESSION_COOKIE}=${(await createSession(ids[key], "student")).token}`;
  await giveConsent(json("/api/student/consent", cookie[key], { version: CONSENT_VERSION }), NO_PARAMS);
  faceOf[key] ??= person(code.charCodeAt(8) * 7 + Number(code.slice(-3)));
  if (card !== "none") {
    const vec = cardVec ?? faces[faceOf[key]];
    await q(`insert into student_cards (student_id, embedding, decoded_code, decode_method, status) values ($1, $2::vector, $3, 'barcode', $4)`, [
      ids[key],
      `[${vec.join(",")}]`,
      code,
      card,
    ]);
  }
}
const LOAD = 40;

beforeAll(async () => {
  process.env.JWT_SECRET = "integration-secret-integration-secret-xx";
  ctx = await useTestAppDb();
  setCheckinDepsForTest(fakeDeps);
  setNowForTest(() => at("07:02"));
  ids.gv = (await q<{ id: string }>(`insert into users (email,password_hash,full_name,role) values ('gv@x','x','GV','instructor') returning id`))[0].id;
  cookie.gv = `${SESSION_COOKIE}=${(await createSession(ids.gv, "instructor")).token}`;
  for (const k of ["K", "K3", "KL"]) {
    ids[k] = (
      await q<{ id: string }>(
        `insert into classes (instructor_id, code, course_name, start_date, end_date, default_room, radius_m) values ($1,$2,'Khai phá dữ liệu',$3,$4,'301-A7-A7',50) returning id`,
        [ids.gv, `${k}-Khai phá dữ liệu-1-1-26(N03)`, daysFromToday(-30), CLASS_END],
      )
    )[0].id;
    await q(`insert into class_schedules (class_id, weekday, first_period, last_period) values ($1,$2,1,3)`, [ids[k], vnWeekday(TODAY)]);
  }
  // Lớp K: các ca thử. K3: lớp thứ hai của F (cùng người ở hai lớp khác nhau).
  for (const [k, code] of [["A", "231230701"], ["B", "231230702"], ["C", "231230703"], ["D", "231230704"], ["F", "231230706"], ["G", "231230707"], ["H", "231230708"], ["Z", "231230726"], ["Y", "231230725"]] as const) {
    await addStudent(k, code, k === "F" ? ["K", "K3"] : ["K"]);
  }
  // E: thẻ hơi giống mặt D (0,6 — qua ngưỡng thẻ) → E dùng mặt D để điểm danh: không bị từ chối thẻ, phải bị bắt TRÙNG
  await addStudent("E", "231230705", ["K"], "active", withSimilarity(faces[faceOf.D], 0.6, 501));
  // C: mặt trực tiếp lệch thẻ vùng biên (0,42)
  faceOf.Cb = face(withSimilarity(faces[faceOf.C], 0.42, 502));
  // H: check-in và check-out bằng hai mặt khác nhau, cả hai đều "qua" thẻ (0,6) nhưng giống nhau chỉ 0,36
  const hCard = faces[faceOf.H];
  faceOf.Hin = face(withSimilarity(hCard, 0.6, 503));
  const hOut = withSimilarity(hCard, 0.6, 504);
  faceOf.Hout = face(hOut);
  // Hai người song song trùng mặt (khoá theo khung): Y dùng mặt Z, thẻ Y giống mặt Z 0,6
  await q(`update student_cards set embedding = $1::vector where student_id = $2`, [`[${withSimilarity(faces[faceOf.Z], 0.6, 505).join(",")}]`, ids.Y]);
  await addStudent("P", "231230709", ["K"], "pending_review");
  await addStudent("N", "231230710", ["K"], "none");
  await addStudent("W", "231230711", ["K3"]); // không thuộc lớp K
  for (let i = 0; i < LOAD; i++) await addStudent(`L${i}`, `2312308${String(i).padStart(2, "0")}`, ["KL"]);
  for (const k of ["K", "K3", "KL"]) {
    const res = await openCheckin(json(`/api/classes/${ids[k]}/sessions/open-checkin`, cookie.gv, { ...CENTER, accuracyM: 10 }), params({ id: ids[k] }));
    expect(res.status, k).toBe(201);
  }
  ids.wK = await windowOf("K", "check_in");
  ids.wK3 = await windowOf("K3", "check_in");
  ids.wKL = await windowOf("KL", "check_in");
}, 300_000);
afterAll(async () => {
  resetCheckinDepsForTest();
  resetNowForTest();
  await ctx.close();
});
beforeEach(async () => {
  setNowForTest(() => at("07:05"));
  uploads.length = 0;
  removed.length = 0;
  analyzeCalls.n = 0;
  geocodeAddress = "3 Cầu Giấy, Láng Thượng, Đống Đa, Hà Nội";
  await q(`delete from rate_limits`);
});

describe("POST /api/windows/{id}/scan-nonce", () => {
  it("cấp nonce + thử thách + phiên quét; KHÔNG lộ vị trí GV (tâm buổi)", async () => {
    const { res, body } = await getNonce("A", ids.wK);
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ attemptsLeft: 3, window: { id: ids.wK, type: "check_in", room: "301-A7-A7", closesAt: at("07:17").toISOString() } });
    expect(body.scanSessionId).toBe(body.nonce);
    expect([["left", "right"], ["right", "left"]]).toContainEqual(body.challenge);
    expect(JSON.stringify(body)).not.toMatch(/21\.027|105\.801|center/i);
    expect(await q(`select 1 from scan_sessions where id = $1 and student_id = $2 and window_id = $3`, [body.nonce, ids.A, ids.wK])).toHaveLength(1);
  });

  it.each<[string, string, () => string, number, string]>([
    ["không thuộc lớp", "W", () => ids.wK, 403, "NOT_ENROLLED"],
    ["chưa có thẻ", "N", () => ids.wK, 412, "CARD_REQUIRED"],
    ["thẻ chưa duyệt", "P", () => ids.wK, 412, "CARD_PENDING_REVIEW"],
    ["khung không tồn tại", "A", () => "00000000-0000-4000-8000-000000000000", 404, "NOT_FOUND"],
    ["id sai định dạng", "A", () => "abc", 404, "NOT_FOUND"],
  ])("%s → %d %s", async (_n, who, w, status, code) => {
    const { res, body } = await getNonce(who, w());
    expect(res.status).toBe(status);
    expect(body.error.code).toBe(code);
  });

  it("thẻ chưa duyệt: thông báo nói rõ", async () => {
    const { body } = await getNonce("P", ids.wK);
    expect(body.error.message).toMatch(/chờ giảng viên duyệt/);
  });
});

describe("POST /api/windows/{id}/events — chặn sớm trước khi xử lý ảnh (T067, FR-082)", () => {
  it("ảnh 10 MB → 413 trước khi đọc body (không đọc, không phân tích ảnh)", async () => {
    const big = Buffer.alloc(10 * 1024 * 1024, 1);
    const r = await multipart(`/api/windows/${ids.wK}/events`, cookie.A, { nonce: "x", lat: "21", lng: "105", accuracyM: "10", frames: [big] });
    const t = performance.now(); // chỉ đo phía server (không tính dựng request 10 MB trong test)
    const res = await submitEvent(r, params({ id: ids.wK }));
    const ms = performance.now() - t;
    console.info(`413 cho body 10 MB: ${ms.toFixed(1)} ms`);
    expect(res.status).toBe(413);
    // Bằng chứng chắc chắn "từ chối trước khi xử lý ảnh": body không hề được đọc, không phân tích ảnh.
    // (Thời gian tuyệt đối dao động khi các worker test khác chiếm CPU — đo riêng ~vài chục ms; ngưỡng nới để không chập chờn.)
    expect(r.bodyUsed).toBe(false);
    expect(analyzeCalls.n).toBe(0);
    expect(ms).toBeLessThan(1000);
  });

  it("thiếu nonce → 422; nonce sai → 403 BAD_NONCE; không phân tích ảnh", async () => {
    const frames = await Promise.all(["left", "center", "right"].map((p) => frame(faceOf.A, p as Pose)));
    const fields = { lat: "21.02741", lng: "105.80123", accuracyM: "10", frames };
    const r = await multipart(`/api/windows/${ids.wK}/events`, cookie.A, fields);
    const t = performance.now();
    const res = await submitEvent(r, params({ id: ids.wK }));
    const ms = performance.now() - t;
    console.info(`422 thiếu nonce: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(1000);
    expect(res.status).toBe(422);
    const bad = await submitEvent(await multipart(`/api/windows/${ids.wK}/events`, cookie.A, { ...fields, nonce: "00000000-0000-4000-8000-000000000000" }), params({ id: ids.wK }));
    expect(bad.status).toBe(403);
    expect((await readJson(bad)).error.code).toBe("BAD_NONCE");
    expect(analyzeCalls.n).toBe(0);
  });

  it("toạ độ không hợp lệ → 422, không phân tích ảnh, không ghi lượt", async () => {
    const { res } = await checkIn("Z", ids.wK, { gps: { lat: 91, lng: 105, accuracyM: 10 } });
    expect(res.status).toBe(422);
    expect(analyzeCalls.n).toBe(0);
    expect(await eventsOf("Z", ids.wK)).toHaveLength(0);
  });

  it("nonce của khung khác → 403", async () => {
    const n = await getNonce("F", ids.wK3);
    const { res } = await checkIn("F", ids.wK, { nonce: n.body.nonce });
    expect(res.status).toBe(403);
  });
});

describe("check-in hợp lệ (US2-4)", () => {
  it("valid: giờ server, muộn tính từ lúc mở, ảnh đóng dấu lưu SAU khi qua mọi kiểm tra, hồ sơ JSON hợp lệ", async () => {
    const { res, body } = await checkIn("A", ids.wK, { gps: { ...north(20), accuracyM: 12 } });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ result: "valid", reason: "ok", serverTime: at("07:05").toISOString(), attemptsLeft: 3, lateMinutes: 3 });
    expect(body.distanceM).toBeCloseTo(20, 0);
    expect(body.evidenceUrl).toMatch(/^https:\/\/storage\.test\/evidence\//);
    const [e] = await eventsOf("A", ids.wK);
    expect(e).toMatchObject({ result: "valid", reason: "ok", attempt_no: 1, dims: 512, late_minutes: 3, address_text: "3 Cầu Giấy, Láng Thượng, Đống Đa, Hà Nội" });
    expect(e.image_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(e.card_similarity).toBeCloseTo(1, 3);
    expect(new Date(e.purge_after).toISOString()).toBe(new Date(at("07:05").getTime() + 7 * 86_400_000).toISOString());
    expect(new Date(e.record_purge_after).toISOString()).toBe(recordPurgeAfter(CLASS_END).toISOString());
    // ảnh: đúng bucket private, đường dẫn theo buổi/khung/lượt, JPEG đã đóng dấu (dải tối ở đáy)
    expect(uploads).toHaveLength(1);
    expect(uploads[0].bucket).toBe("evidence");
    expect(uploads[0].path).toBe(e.evidence_path);
    expect(uploads[0].path).toMatch(new RegExp(`/${ids.wK}/${e.id}\\.jpg$`));
    const w = (await sharp(uploads[0].body).metadata()).width!;
    const band = async (top: number) => (await sharp(await sharp(uploads[0].body).extract({ left: 0, top, width: w, height: 30 }).toBuffer()).stats()).channels[0];
    expect((await band(0)).max).toBeLessThan(160); // phần trên: nền đồng màu (R = 120)
    expect((await band(210)).max).toBeGreaterThan(200); // dải đáy: có chữ trắng
    // hồ sơ
    const rec = attendanceRecordV1.parse(e.record);
    expect(rec.ids).toMatchObject({ windowType: "check_in", studentCode: "231230701", attempt: 1 });
    expect(rec.location).toMatchObject({ address: "3 Cầu Giấy, Láng Thượng, Đống Đa, Hà Nội", room: "301-A7-A7", radiusM: 50 });
    expect(rec.liveness?.passed).toBe(true);
    expect(rec.evidence.imageStored).toBe(true);
    expect(rec.device).toMatchObject({ browser: "Chrome 140", os: "Android 15" });
    expect(JSON.stringify(rec)).not.toMatch(/embedding/);
  });

  it("đã có lượt hợp lệ → nonce 409 ALREADY_DONE, không tạo lượt mới (US2-9)", async () => {
    const { res, body } = await getNonce("A", ids.wK);
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("ALREADY_DONE");
    expect(await eventsOf("A", ids.wK)).toHaveLength(1);
  });

  it("thiếu GOONG (không có địa chỉ) → ảnh và hồ sơ ghi toạ độ", async () => {
    geocodeAddress = null;
    const { body } = await checkIn("G", ids.wK);
    expect(body.result).toBe("valid");
    const [e] = await eventsOf("G", ids.wK);
    expect(e.address_text).toBeNull();
    expect(attendanceRecordV1.parse(e.record).location?.address).toBeNull();
  });
});

describe("thử lại / từ chối / lượt còn lại (US2-5…8, FR-040)", () => {
  it("chuỗi B: sai số lớn (retry) → ngoài phạm vi → không thấy mặt (retry) → sai thử thách → mặt người khác → hết lượt", async () => {
    const step = async (o: Parameters<typeof checkIn>[2], result: string, reason: string, left: number) => {
      const before = analyzeCalls.n;
      const { res, body } = await checkIn("B", ids.wK, o);
      expect(res.status, JSON.stringify(body)).toBe(200);
      expect([body.result, body.reason, body.attemptsLeft]).toEqual([result, reason, left]);
      return analyzeCalls.n - before;
    };
    expect(await step({ gps: { ...north(5), accuracyM: 150 } }, "retry", "low_accuracy", 3)).toBe(0); // không xử lý ảnh
    expect(await step({ gps: { ...north(500), accuracyM: 10 } }, "rejected", "out_of_range", 2)).toBe(0);
    await step({ faceCount: 0 }, "retry", "no_face", 2);
    await step({ faceCount: 2 }, "retry", "multiple_faces", 2);
    await step({ mode: "static" }, "rejected", "liveness_failed", 1);
    await step({ faceIdx: faceOf.Z }, "rejected", "card_mismatch", 0);
    const n = await getNonce("B", ids.wK);
    expect(n.res.status).toBe(409);
    expect(n.body.error.code).toBe("ATTEMPTS_EXHAUSTED");
    const ev = await eventsOf("B", ids.wK);
    expect(ev.map((e) => [e.result, e.reason, e.attempt_no])).toEqual([
      ["retry", "low_accuracy", 1],
      ["rejected", "out_of_range", 1],
      ["retry", "no_face", 2],
      ["retry", "multiple_faces", 2],
      ["rejected", "liveness_failed", 2],
      ["rejected", "card_mismatch", 3],
    ]);
    // lượt bị từ chối / thử lại: KHÔNG lưu ảnh, KHÔNG lưu vector; mọi lượt đều có hồ sơ hợp lệ
    expect(ev.every((e) => e.evidence_path === null && e.dims === null)).toBe(true);
    expect(uploads).toHaveLength(0);
    for (const e of ev) expect(attendanceRecordV1.safeParse(e.record).success).toBe(true);
    expect((attendanceRecordV1.parse(ev[1].record).steps.at(-1) as { detail: string }).detail).toBe("500 m > 50 m");
  });

  it("thẻ vùng biên → suspect; SV KHÔNG thấy lý do nghi vấn (GV xem trong hồ sơ)", async () => {
    const { body } = await checkIn("C", ids.wK, { faceIdx: faceOf.Cb });
    expect(body).toMatchObject({ result: "suspect", reason: null });
    expect(body.message).toMatch(/giảng viên/);
    const [e] = await eventsOf("C", ids.wK);
    expect([e.result, e.reason]).toEqual(["suspect", "card_borderline"]);
    expect(e.card_similarity).toBeCloseTo(0.42, 2);
    expect(uploads).toHaveLength(1); // nghi vấn vẫn lưu ảnh để GV xem
  });
});

describe("một khuôn mặt cho nhiều mã trong cùng khung (US3, FR-036/037)", () => {
  it("D rồi E cùng mặt → CẢ HAI nghi vấn, duplicate_of hai chiều, hồ sơ D có followUp, audit", async () => {
    expect((await checkIn("D", ids.wK)).body.result).toBe("valid");
    const { body } = await checkIn("E", ids.wK, { faceIdx: faceOf.D });
    expect(body.result).toBe("suspect");
    const [d] = await eventsOf("D", ids.wK);
    const [e] = await eventsOf("E", ids.wK);
    expect([e.result, e.reason, e.duplicate_of]).toEqual(["suspect", "duplicate_face", [d.id]]);
    expect([d.result, d.reason, d.duplicate_of]).toEqual(["suspect", "duplicate_face", [e.id]]);
    const recD = attendanceRecordV1.parse(d.record);
    expect(recD.decision.result).toBe("valid"); // quyết định lúc đó giữ nguyên
    expect(recD.followUps).toEqual([{ at: at("07:05").toISOString(), reason: "duplicate_face", byEvent: e.id, byStudentCode: "231230705", similarity: 1 }]);
    expect(attendanceRecordV1.parse(e.record).matching?.maxOther).toEqual({ similarity: 1, studentCode: "231230704" });
    expect(await q(`select 1 from audit_logs where action = 'attendance.flag_duplicate' and target_id = $1`, [d.id])).toHaveLength(1);
  });

  it("cùng người ở hai lớp khác nhau → cả hai hợp lệ (FR-037)", async () => {
    expect((await checkIn("F", ids.wK)).body.result).toBe("valid");
    expect((await checkIn("F", ids.wK3)).body.result).toBe("valid");
  });

  it("hai lượt trùng mặt gửi ĐỒNG THỜI vẫn bị bắt (khoá theo khung)", async () => {
    const [nz, ny] = await Promise.all([getNonce("Z", ids.wK), getNonce("Y", ids.wK)]);
    const [rz, ry] = await Promise.all([
      checkIn("Z", ids.wK, { nonce: nz.body.nonce, faceIdx: faceOf.Z }),
      checkIn("Y", ids.wK, { nonce: ny.body.nonce, faceIdx: faceOf.Z }),
    ]);
    // lượt commit trước có thể trả "valid" (lúc đó chưa trùng ai) rồi bị lượt sau chuyển nghi vấn trong DB
    expect([rz.res.status, ry.res.status]).toEqual([200, 200]);
    const ev = await q<{ result: string; reason: string }>(`select result, reason from attendance_events where window_id = $1 and student_id in ($2,$3)`, [ids.wK, ids.Z, ids.Y]);
    expect(ev.map((e) => [e.result, e.reason])).toEqual([["suspect", "duplicate_face"], ["suspect", "duplicate_face"]]);
  });
});

describe("40 SV check-in cùng phiên (tải đồng thời)", () => {
  it("40 lượt song song: không lỗi, đúng 40 lượt hợp lệ, không trùng bản ghi", async () => {
    const t = performance.now();
    const out = await Promise.all(Array.from({ length: LOAD }, (_, i) => checkIn(`L${i}`, ids.wKL)));
    const ms = performance.now() - t;
    expect(out.map((o) => o.res.status)).toEqual(Array(LOAD).fill(200));
    expect(out.map((o) => o.body.result)).toEqual(Array(LOAD).fill("valid"));
    const [{ n, students }] = await q<{ n: number; students: number }>(
      `select count(*)::int as n, count(distinct student_id)::int as students from attendance_events where window_id = $1`,
      [ids.wKL],
    );
    expect([n, students]).toEqual([LOAD, LOAD]);
    expect(uploads).toHaveLength(LOAD);
    console.info(`40 lượt song song (PGlite, nhận diện giả): ${Math.round(ms)} ms`);
  }, 120_000);

  it("một SV gửi 2 lượt cùng lúc (2 nonce) → 1 hợp lệ, 1 bị 409 ALREADY_DONE; ảnh của lượt thua bị dọn", async () => {
    await q(`delete from attendance_events where student_id = $1`, [ids.L0]);
    const [n1, n2] = await Promise.all([getNonce("L0", ids.wKL), getNonce("L0", ids.wKL)]);
    const [a, b] = await Promise.all([checkIn("L0", ids.wKL, { nonce: n1.body.nonce }), checkIn("L0", ids.wKL, { nonce: n2.body.nonce })]);
    expect([a.res.status, b.res.status].sort()).toEqual([200, 409]);
    expect([a.body, b.body].find((x) => x.error)?.error.code).toBe("ALREADY_DONE");
    const kept = (await eventsOf("L0", ids.wKL)).filter((e) => e.result === "valid" || e.result === "suspect");
    expect(kept).toHaveLength(1);
    // ảnh của lượt thua (nếu đã kịp lưu) bị xoá — chỉ còn đúng 1 ảnh
    expect(uploads.filter((u) => !removed.includes(u.path)).map((u) => u.path)).toEqual([kept[0].evidence_path]);
  });
});

describe("check-out & kiểm tra đột xuất (US4, FR-041/043)", () => {
  it("chưa check-in → nonce 403 NO_CHECKIN; đã check-in đúng mặt → valid; khác mặt → CẢ HAI nghi vấn", async () => {
    // H check-in bằng mặt Hin
    expect((await checkIn("H", ids.wK, { faceIdx: faceOf.Hin })).body.result).toBe("valid");
    setNowForTest(() => at("09:20"));
    const wOut = await windowOf("K", "check_out");
    const nc = await getNonce("N", wOut);
    expect(nc.res.status).toBe(412); // N không có thẻ: kiểm thẻ trước
    const w = await getNonce("W", wOut);
    expect(w.body.error.code).toBe("NOT_ENROLLED");
    await addStudent("Q", "231230712", ["K"]);
    const q1 = await getNonce("Q", wOut);
    expect([q1.res.status, q1.body.error.code]).toEqual([403, "NO_CHECKIN"]);

    expect((await checkIn("A", wOut)).body).toMatchObject({ result: "valid", lateMinutes: null });
    const [aOut] = await eventsOf("A", wOut);
    expect(aOut.checkin_similarity).toBeCloseTo(1, 3);

    const { body } = await checkIn("H", wOut, { faceIdx: faceOf.Hout });
    expect(body.result).toBe("suspect");
    const [hIn] = await eventsOf("H", ids.wK);
    const [hOut] = await eventsOf("H", wOut);
    expect([hOut.result, hOut.reason]).toEqual(["suspect", "checkin_mismatch"]);
    expect(hOut.checkin_similarity).toBeCloseTo(0.36, 1);
    expect([hIn.result, hIn.reason]).toEqual(["suspect", "checkin_mismatch"]);
    expect(attendanceRecordV1.parse(hIn.record).followUps?.[0]).toMatchObject({ reason: "checkin_mismatch", byEvent: hOut.id });
  });

  it("GV bỏ check-out → khung check-out coi như đóng (410)", async () => {
    setNowForTest(() => at("09:20"));
    const wOut = await windowOf("K3", "check_out");
    const sid = (await q<{ session_id: string }>(`select session_id from attendance_windows where id = $1`, [wOut]))[0].session_id;
    await q(`update sessions set checkout_skipped = true where id = $1`, [sid]);
    const { res, body } = await getNonce("F", wOut);
    expect([res.status, body.error.code]).toEqual([410, "WINDOW_CLOSED"]);
  });

  it("kiểm tra đột xuất: SV đã check-in xác minh lại được", async () => {
    setNowForTest(() => at("08:00"));
    const sid = (await q<{ id: string }>(`select id from sessions where class_id = $1`, [ids.K]))[0].id;
    const res = await spotCheck(json(`/api/sessions/${sid}/spot-check`, cookie.gv, {}), params({ id: sid }));
    expect(res.status).toBe(201);
    const w = (await readJson(res)).window.id;
    expect((await checkIn("F", w)).body.result).toBe("valid");
  });
});

describe("khung đóng (US2-10)", () => {
  it("nonce lấy trước khi GV đóng sớm → lượt gửi sau ghi 'rejected/window_closed'; nonce mới → 410", async () => {
    await addStudent("R", "231230713", ["K3"]);
    setNowForTest(() => at("07:06"));
    const n = await getNonce("R", ids.wK3);
    expect(n.res.status).toBe(200);
    expect((await closeWindow(json(`/api/windows/${ids.wK3}/close`, cookie.gv), params({ id: ids.wK3 }))).status).toBe(200);
    setNowForTest(() => at("07:07"));
    const { body } = await checkIn("R", ids.wK3, { nonce: n.body.nonce });
    expect([body.result, body.reason]).toEqual(["rejected", "window_closed"]);
    expect(analyzeCalls.n).toBe(0);
    const again = await getNonce("R", ids.wK3);
    expect([again.res.status, again.body.error.code]).toEqual([410, "WINDOW_CLOSED"]);
  });
});

describe("GET /api/student/classes — đánh dấu lớp đang mở (US2-1, FR-030)", () => {
  it("lớp có khung mở → openWindow {id, type, closesAt, done}", async () => {
    setNowForTest(() => at("07:05"));
    const res = await myClasses(json("/api/student/classes", cookie.F, undefined, "GET"), NO_PARAMS);
    const { classes } = await readJson(res);
    const k = classes.find((c: { classId: string }) => c.classId === ids.K);
    expect(k.openWindow).toMatchObject({ id: ids.wK, type: "check_in", closesAt: at("07:17").toISOString(), done: true });
    setNowForTest(() => at("12:00"));
    const later = await readJson(await myClasses(json("/api/student/classes", cookie.F, undefined, "GET"), NO_PARAMS));
    expect(later.classes.every((c: { openWindow: unknown }) => c.openWindow === null)).toBe(true);
  });
});

describe("POST /api/scan-sessions/{id}/client-error (T083, FR-111)", () => {
  it("SV báo lỗi thiết bị vào phiên quét của mình; phiên của người khác → 404; mã lạ → 422", async () => {
    await addStudent("S", "231230714", ["K"]);
    const n = await getNonce("S", ids.wK);
    const sid = n.body.scanSessionId;
    const call = (who: string, body: unknown) => clientError(json(`/api/scan-sessions/${sid}/client-error`, cookie[who], body), params({ id: sid }));
    expect((await call("S", { code: "geo_denied", detail: "User denied Geolocation" })).status).toBe(204);
    expect((await call("A", { code: "network" })).status).toBe(404);
    expect((await call("S", { code: "hack" })).status).toBe(422);
    const [s] = await q<{ client_errors: { code: string; detail: string; at: string }[] }>(`select client_errors from scan_sessions where id = $1`, [sid]);
    expect(s.client_errors).toHaveLength(1);
    expect(s.client_errors[0]).toMatchObject({ code: "geo_denied", detail: "User denied Geolocation" });
  });
});

describe("GET /api/geo/reverse (T072) — địa chỉ từ toạ độ của CHÍNH SV", () => {
  it("trả địa chỉ; toạ độ sai → 422; quá 6 lượt/phút → 429", async () => {
    const call = (qs: string) => geoReverse(json(`/api/geo/reverse?${qs}`, cookie.A, undefined, "GET"), NO_PARAMS);
    const ok = await call("lat=21.02741&lng=105.80123");
    expect(ok.status).toBe(200);
    expect(await readJson(ok)).toEqual({ address: "3 Cầu Giấy, Láng Thượng, Đống Đa, Hà Nội" });
    expect((await call("lat=abc&lng=105")).status).toBe(422);
    for (let i = 0; i < 4; i++) await call("lat=21&lng=105");
    expect((await call("lat=21&lng=105")).status).toBe(429);
  });
});

describe("yawDebug cho check-in (chỉ preview/dev)", () => {
  it("preview: nonce báo yawDebug, lượt gửi kèm clientYaw → phản hồi có bảng yaw; production: không", async () => {
    await addStudent("V", "231230715", ["K"]);
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    try {
      const n = await getNonce("V", ids.wK);
      expect(n.body.yawDebug).toBe(true);
      const { body } = await checkIn("V", ids.wK, { nonce: n.body.nonce, mode: "static" });
      expect(body.reason).toBe("liveness_failed");
      expect(body.yawDebug?.frames).toHaveLength(3);
      vi.stubEnv("VERCEL_ENV", "production");
      const p = await getNonce("V", ids.wK);
      expect(p.body.yawDebug).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
