import { useTestAppDb } from "@utc/database/testing";
import { CONSENT_VERSION } from "@utc/shared/consent";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as cardNonce } from "../../src/api/student/card-nonce";
import { POST as uploadCard } from "../../src/api/student/card";
import { POST as giveConsent } from "../../src/api/student/consent";
import { POST as probe } from "../../src/api/student/liveness-probe";
import { POST as probeNonce } from "../../src/api/student/liveness-probe-nonce";
import { createSession, SESSION_COOKIE } from "../../src/auth/session";
import { resetCardDepsForTest, setCardDepsForTest, type CardDeps } from "../../src/card/register";
import type { PortraitFace } from "../../src/card/verify";
import { NO_PARAMS } from "../../src/http/handler";
import { readJson } from "../support/http";

/**
 * POST /api/student/liveness-probe(/nonce) — thử liveness KHÔNG tốn lượt đăng ký thẻ, CHỈ preview/dev (production 404).
 * Chạy đúng pipeline liveness của đăng ký thẻ (sanitize → phân tích 3 khung → tư thế theo thử thách → cùng một người)
 * và trả bảng yawDebug. Không lưu ảnh / embedding / dòng DB nào ngoài nonce + bộ đếm riêng 30/giờ/SV.
 * Khuôn mặt giả lập (setCardDepsForTest) — không dùng ảnh mặt thật.
 */
const O = "http://localhost";
let ctx: Awaited<ReturnType<typeof useTestAppDb>>;
const q = <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => ctx.pg.query<T>(sql, args).then((r) => r.rows);
const ids: Record<string, string> = {};
const cookie: Record<string, string> = {};

const box = { x1: 40, y1: 150, x2: 280, y2: 450 };
const kpsFor = (pose: "left" | "right" | "center"): [number, number][] => {
  const off = pose === "left" ? 0.3 : pose === "right" ? -0.3 : 0;
  return [[100, 100], [160, 100], [130 + off * 60, 130], [108, 160], [152, 160]];
};
let liveMode: "follow" | "reverse" = "follow";
let lastChallenge: ["left" | "right", "left" | "right"] = ["left", "right"];
let frameNo = 0;
let otherPersonAt: number | null = null;
const vec = (seed: number) => Array.from({ length: 512 }, (_, i) => (i === seed ? 1 : 0));
const storageCalls: string[] = [];
const fakeDeps: CardDeps = {
  decode: async () => ({ decoded: null, text: "" }),
  analyzeFaces: async () => ({ faces: [], embed: async () => vec(0), crop: async () => Buffer.alloc(0) }),
  analyzeLive: async () => {
    const i = frameNo++ % 3;
    const [a, b] = lastChallenge;
    const seq = liveMode === "reverse" ? [b, "center", a] : [a, "center", b];
    const face: PortraitFace = { score: 0.95, box, sharpness: 0.6, kps: kpsFor(seq[i] as "left") };
    return { faces: [face], embed: async () => vec(i === otherPersonAt ? 7 : 1), crop: async () => Buffer.alloc(0) };
  },
  storage: {
    upload: async (_b, p) => (storageCalls.push(p), p),
    remove: async () => void storageCalls.push("remove"),
    signedUrl: async () => "x",
  },
};

const jsonReq = (path: string, c: string, body?: unknown) =>
  new Request(`${O}${path}`, {
    method: "POST",
    headers: { origin: O, "content-type": "application/json", cookie: c },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
let selfies: Buffer[] = [];
async function multipart(path: string, c: string, fields: Record<string, string | Buffer[]>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "string") fd.append(k, v);
    else for (const b of v) fd.append(k, new Blob([new Uint8Array(b)], { type: "image/jpeg" }), "anh.jpg");
  }
  const tmp = new Request(`${O}${path}`, { method: "POST", body: fd });
  const body = Buffer.from(await tmp.arrayBuffer());
  return new Request(`${O}${path}`, {
    method: "POST",
    body,
    headers: { origin: O, cookie: c, "content-type": tmp.headers.get("content-type")!, "content-length": String(body.length) },
  });
}
async function getProbeNonce(who: string) {
  const res = await probeNonce(jsonReq("/api/student/liveness-probe/nonce", cookie[who]), NO_PARAMS);
  return { res, body: res.status === 200 ? await readJson(res) : null };
}
async function runProbe(who: string, nonce?: string, clientYaw = "[0.45,0.01,-0.44]") {
  frameNo = 0;
  let n = nonce;
  if (!n) {
    const { body } = await getProbeNonce(who);
    lastChallenge = body.challenge;
    n = body.nonce as string;
  }
  return probe(await multipart("/api/student/liveness-probe", cookie[who], { nonce: n, frames: selfies, clientYaw }), NO_PARAMS);
}
const preview = () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_ENV", "preview");
};

beforeAll(async () => {
  process.env.JWT_SECRET = "integration-secret-integration-secret-xx";
  ctx = await useTestAppDb();
  setCardDepsForTest(fakeDeps);
  selfies = await Promise.all([0, 1, 2].map((i) => sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 90 + i, g: 100, b: 110 } } }).jpeg().toBuffer()));
  for (const [key, code] of [["S", "231231001"], ["T", "231231002"], ["U", "231231003"]] as const) {
    ids[key] = (await q<{ id: string }>(`insert into students (student_code,last_name,first_name) values ($1,'Thử','Nghiệm') returning id`, [code]))[0].id;
    cookie[key] = `${SESSION_COOKIE}=${(await createSession(ids[key], "student")).token}`;
  }
  for (const who of ["S", "T"]) {
    expect((await giveConsent(jsonReq("/api/student/consent", cookie[who], { version: CONSENT_VERSION }), NO_PARAMS)).status).toBe(204);
  }
}, 120_000);
afterAll(async () => {
  resetCardDepsForTest();
  await ctx.close();
});
beforeEach(async () => {
  liveMode = "follow";
  otherPersonAt = null;
  storageCalls.length = 0;
  await q(`delete from rate_limits`);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("production / không bật công cụ → 404", () => {
  it.each([
    ["production", { VERCEL: "1", VERCEL_ENV: "production" }],
    ["Vercel thiếu VERCEL_ENV", { VERCEL: "1" }],
    ["test/next start", {}],
  ])("%s: nonce và probe đều 404 NOT_FOUND", async (_l, env) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const { res } = await getProbeNonce("S");
    expect(res.status).toBe(404);
    expect((await readJson(res)).error.code).toBe("NOT_FOUND");
    const p = await runProbe("S", "00000000-0000-4000-8000-000000000000");
    expect(p.status).toBe(404);
  });
});

describe("preview: thử liveness không tốn lượt đăng ký thẻ", () => {
  it("chưa đồng ý điều khoản → 403 CONSENT_REQUIRED (Constitution IV), kể cả nonce", async () => {
    preview();
    const { res } = await getProbeNonce("U");
    expect(res.status).toBe(403);
    expect((await readJson(res)).error.code).toBe("CONSENT_REQUIRED");
  });

  it("nonce: {nonce, expiresAt, challenge} — challenge là hoán vị left/right; không cần thuộc lớp hay chưa có thẻ", async () => {
    preview();
    const { res, body } = await getProbeNonce("S");
    expect(res.status).toBe(200);
    expect([...body.challenge].sort()).toEqual(["left", "right"]);
    expect(typeof body.nonce).toBe("string");
  });

  it("làm đúng thử thách → 200 passed + yawDebug (3 khung ok, yaw client gửi kèm); không lưu gì, không tính lượt thẻ", async () => {
    preview();
    const cardsBefore = (await q(`select 1 from student_cards`)).length;
    const auditBefore = (await q(`select 1 from audit_logs`)).length;
    const res = await runProbe("S");
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.passed).toBe(true);
    expect(body.yawDebug.reason).toBeNull();
    expect(body.yawDebug.frames.map((f: { ok: boolean }) => f.ok)).toEqual([true, true, true]);
    expect(body.yawDebug.frames.map((f: { clientYaw: number }) => f.clientYaw)).toEqual([0.45, 0.01, -0.44]);
    expect(Object.keys(body).sort()).toEqual(["passed", "yawDebug"]); // không trả embedding / độ tương đồng
    expect(storageCalls).toEqual([]);
    expect((await q(`select 1 from student_cards`)).length).toBe(cardsBefore);
    expect((await q(`select 1 from audit_logs`)).length).toBe(auditBefore);
    const keys = (await q<{ key: string }>(`select key from rate_limits`)).map((r) => r.key);
    expect(keys).toContain(`liveness-probe:${ids.S}`);
    expect(keys.some((k) => k.startsWith("card:") || k.startsWith("card-total:"))).toBe(false);
  });

  it("quay ngược → 200 passed=false, reason LIVENESS_FAILED, khung 1 và 3 sai", async () => {
    preview();
    liveMode = "reverse";
    const body = await readJson(await runProbe("S"));
    expect(body.passed).toBe(false);
    expect(body.yawDebug.reason).toBe("LIVENESS_FAILED");
    expect(body.yawDebug.frames.map((f: { ok: boolean }) => f.ok)).toEqual([false, true, false]);
  });

  it("3 khung không cùng một người → passed=false, reason SAME_PERSON_FAILED", async () => {
    preview();
    otherPersonAt = 2;
    const body = await readJson(await runProbe("S"));
    expect(body.passed).toBe(false);
    expect(body.yawDebug.reason).toBe("SAME_PERSON_FAILED");
  });

  it("nonce dùng một lần; nonce của SV khác → 403 BAD_NONCE", async () => {
    preview();
    const { body } = await getProbeNonce("S");
    lastChallenge = body.challenge;
    expect((await runProbe("S", body.nonce)).status).toBe(200);
    expect((await readJson(await runProbe("S", body.nonce))).error.code).toBe("BAD_NONCE");
    const other = await getProbeNonce("T");
    expect((await readJson(await runProbe("S", other.body.nonce))).error.code).toBe("BAD_NONCE");
  });

  it("nonce probe KHÔNG dùng được để đăng ký thẻ, nonce thẻ KHÔNG dùng được cho probe", async () => {
    preview();
    // T chưa thuộc lớp nào → nonce thẻ bị từ chối trước khi cấp; cho T vào một lớp để lấy được nonce thẻ
    const gv = (await q<{ id: string }>(`insert into users (email,password_hash,full_name,role) values ('gvp@x','x','G','instructor') returning id`))[0].id;
    const cls = (await q<{ id: string }>(`insert into classes (instructor_id, code, course_name, start_date, end_date) values ($1,'KP','HP', current_date - 1, current_date + 30) returning id`, [gv]))[0].id;
    await q(`insert into enrollments (class_id, student_id) values ($1,$2)`, [cls, ids.T]);

    const pn = (await getProbeNonce("T")).body.nonce;
    const cardWithImage = await uploadCardWithImage("T", pn);
    expect(cardWithImage.status).toBe(403);
    expect((await readJson(cardWithImage)).error.code).toBe("BAD_NONCE");

    const cn = await readJson(await cardNonce(jsonReq("/api/student/card/nonce", cookie.T), NO_PARAMS));
    const res = await runProbe("T", cn.nonce);
    expect(res.status).toBe(403);
    expect((await readJson(res)).error.code).toBe("BAD_NONCE");
  });

  it("giới hạn riêng 30 lượt/giờ/SV: lượt 31 → 429", async () => {
    preview();
    expect((await runProbe("S")).status).toBe(200);
    await q(`update rate_limits set count = 30 where key = $1`, [`liveness-probe:${ids.S}`]);
    const blocked = await runProbe("S");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });

  it("không đủ 3 khung → 422 VALIDATION_ERROR", async () => {
    preview();
    const { body } = await getProbeNonce("S");
    const res = await probe(await multipart("/api/student/liveness-probe", cookie.S, { nonce: body.nonce, frames: selfies.slice(0, 2) }), NO_PARAMS);
    expect(res.status).toBe(422);
  });
});

async function uploadCardWithImage(who: string, nonce: string) {
  const image = await sharp({ create: { width: 1000, height: 630, channels: 3, background: "#e8eef5" } }).jpeg().toBuffer();
  const fd = new FormData();
  fd.append("nonce", nonce);
  fd.append("image", new Blob([new Uint8Array(image)], { type: "image/jpeg" }), "the.jpg");
  for (const b of selfies) fd.append("frames", new Blob([new Uint8Array(b)], { type: "image/jpeg" }), "k.jpg");
  const tmp = new Request(`${O}/api/student/card`, { method: "POST", body: fd });
  const body = Buffer.from(await tmp.arrayBuffer());
  return uploadCard(
    new Request(`${O}/api/student/card`, {
      method: "POST",
      body,
      headers: { origin: O, cookie: cookie[who], "content-type": tmp.headers.get("content-type")!, "content-length": String(body.length) },
    }),
    NO_PARAMS,
  );
}
