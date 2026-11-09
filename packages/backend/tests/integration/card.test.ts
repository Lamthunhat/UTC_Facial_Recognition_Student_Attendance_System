import { useTestAppDb } from "@utc/database/testing";
import { CONSENT_VERSION } from "@utc/shared/consent";
import { vnDateOf, vnDateTime } from "@utc/shared/periods";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as staffGetCard } from "../../src/api/admin/student-card";
import { POST as staffResetCard } from "../../src/api/admin/student-card-reset";
import { POST as staffReviewCard } from "../../src/api/admin/student-card-review";
import { GET as myCard, POST as uploadCard } from "../../src/api/student/card";
import { GET as myClasses } from "../../src/api/student/classes";
import { GET as classCards } from "../../src/api/classes/cards";
import { POST as cardNonce } from "../../src/api/student/card-nonce";
import { POST as giveConsent } from "../../src/api/student/consent";
import { createSession, SESSION_COOKIE } from "../../src/auth/session";
import { resetCardDepsForTest, setCardDepsForTest, type CardDeps } from "../../src/card/register";
import type { PortraitFace } from "../../src/card/verify";
import { addStudent } from "../../src/roster/commit";
import { updateClass } from "../../src/classes/service";
import { NO_PARAMS } from "../../src/http/handler";
import { readJson } from "../support/http";

/**
 * T055 (+ T061, T064) — Đồng ý điều khoản, nonce, đăng ký thẻ, kiểm trùng 1:N, duyệt/đặt lại thẻ, hạn giữ ảnh thẻ.
 * Giải mã thẻ + khuôn mặt được thay bằng bản giả (setCardDepsForTest) — không dùng ảnh mặt thật;
 * DB, nonce, sanitize ảnh (sharp), pgvector, audit đều chạy thật trên PGlite.
 */
const O = "http://localhost";
let ctx: Awaited<ReturnType<typeof useTestAppDb>>;
const q = <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => ctx.pg.query<T>(sql, args).then((r) => r.rows);

// ---------- dữ liệu ----------
const ids: Record<string, string> = {};
const cookie: Record<string, string> = {};
const daysFromToday = (n: number) => vnDateOf(new Date(Date.now() + n * 86_400_000));
const K1_END = daysFromToday(40);
const K2_END = daysFromToday(60);
const addDays = (d: string, n: number) => vnDateOf(new Date(vnDateTime(d, "12:00").getTime() + n * 86_400_000));
const purgeFor = (end: string) => vnDateTime(addDays(end, 31), "00:00").toISOString(); // = 30 ngày sau ngày kết thúc

/** PRNG có seed (mulberry32) → vector ngẫu nhiên; hai seed khác nhau gần như trực giao (cosine ≈ 0). */
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
/** Vector 512 chiều đơn vị theo một "khuôn mặt" (seed); cùng seed → cosine 1, khác seed → ~0; noise làm lệch nhẹ. */
function faceVector(seed: number, noise = 0): number[] {
  const base = randomVector(seed);
  const jitter = randomVector(seed + 10_000);
  const v = base.map((x, i) => x + noise * jitter[i]);
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

// ---------- bản giả cho decode/face/storage ----------
const goodFaceBase: PortraitFace = { score: 0.95, box: { x1: 40, y1: 150, x2: 280, y2: 450 }, sharpness: 0.6 };
const uploads: { bucket: string; path: string; body: Buffer; contentType: string }[] = [];
const removed: { bucket: string; paths: string[] }[] = [];
let nextDecode: Awaited<ReturnType<CardDeps["decode"]>>;
let nextFaces: PortraitFace[];
let nextEmbedding: number[];
// Khung hình trực tiếp: "follow" = làm đúng thử thách của nonce vừa cấp; "reverse" = quay ngược; "static" = ảnh tĩnh nhìn thẳng
let liveMode: "follow" | "reverse" | "static" = "follow";
let liveEmbedding: number[] | null = null; // null = cùng khuôn mặt với chân dung thẻ
let lastChallenge: ["left" | "right", "left" | "right"] = ["left", "right"];
let liveFrameNo = 0;

/** 5 điểm mốc cho một tư thế (ảnh không lật: quay trái của SV → mũi lệch phải ảnh). */
const kpsFor = (pose: "left" | "right" | "center"): [number, number][] => {
  const off = pose === "left" ? 0.3 : pose === "right" ? -0.3 : 0;
  return [[100, 100], [160, 100], [130 + off * 60, 130], [108, 160], [152, 160]];
};
const liveFace = (pose: "left" | "right" | "center"): PortraitFace => ({ ...goodFaceBase, kps: kpsFor(pose) });

const fakeDeps: CardDeps = {
  decode: async () => nextDecode,
  analyzeFaces: async () => ({
    faces: nextFaces,
    embed: async () => nextEmbedding,
    crop: async () => sharp({ create: { width: 120, height: 150, channels: 3, background: "#ccc" } }).jpeg().toBuffer(),
  }),
  analyzeLive: async () => {
    const i = liveFrameNo++ % 3;
    const [a, b] = lastChallenge;
    const seq: ("left" | "right" | "center")[] =
      liveMode === "static" ? ["center", "center", "center"] : liveMode === "reverse" ? [b, "center", a] : [a, "center", b];
    return { faces: [liveFace(seq[i])], embed: async () => liveEmbedding ?? nextEmbedding, crop: async () => Buffer.alloc(0) };
  },
  storage: {
    upload: async (bucket, path, body, contentType) => {
      uploads.push({ bucket, path, body, contentType });
      return path;
    },
    remove: async (bucket, paths) => {
      removed.push({ bucket, paths });
    },
    signedUrl: async (bucket, path) => `https://storage.test/${bucket}/${path}?token=t`,
  },
};
const goodFace: PortraitFace = goodFaceBase;
const scenario = (code: string, seed: number, over: Partial<{ method: "barcode" | "ocr"; text: string; faces: PortraitFace[] }> = {}) => {
  nextDecode = { decoded: { code, method: over.method ?? "barcode" }, text: over.text ?? "" };
  nextFaces = over.faces ?? [goodFace];
  nextEmbedding = faceVector(seed);
  liveMode = "follow";
  liveEmbedding = null;
};

// ---------- request helpers ----------
const json = (path: string, c: string, body?: unknown, method = "POST") =>
  new Request(`${O}${path}`, {
    method,
    headers: { origin: O, "content-type": "application/json", cookie: c },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });

async function photo(opts: { exif?: boolean; size?: number } = {}) {
  let img = sharp({ create: { width: opts.size ?? 1000, height: Math.round((opts.size ?? 1000) * 0.63), channels: 3, background: "#e8eef5" } });
  if (opts.exif) img = img.withExif({ IFD0: { Copyright: "may-anh-sv", ImageDescription: "GPS 21.0278,105.8019" } });
  return img.jpeg({ quality: 90 }).toBuffer();
}

async function multipart(c: string, fields: Record<string, string | Buffer | Buffer[]>, extra: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "string") fd.append(k, v);
    else for (const b of Array.isArray(v) ? v : [v]) fd.append(k, new Blob([new Uint8Array(b)], { type: "image/jpeg" }), "anh.jpg");
  }
  const tmp = new Request(`${O}/api/student/card`, { method: "POST", body: fd });
  const body = Buffer.from(await tmp.arrayBuffer());
  return new Request(`${O}/api/student/card`, {
    method: "POST",
    body,
    headers: { origin: O, cookie: c, "content-type": tmp.headers.get("content-type")!, "content-length": String(body.length), ...extra },
  });
}

const consent = (who: string) => giveConsent(json("/api/student/consent", cookie[who], { version: CONSENT_VERSION }), NO_PARAMS);
async function nonceFor(who: string): Promise<string> {
  const res = await cardNonce(json("/api/student/card/nonce", cookie[who]), NO_PARAMS);
  expect(res.status, `nonce cho ${who}`).toBe(200);
  const body = await readJson(res);
  lastChallenge = body.challenge;
  return body.nonce;
}
let selfies: Buffer[] = [];
async function submit(who: string, nonce?: string, image?: Buffer, frames?: Buffer[]) {
  liveFrameNo = 0;
  const n = nonce ?? (await nonceFor(who));
  return uploadCard(await multipart(cookie[who], { nonce: n, image: image ?? (await photo()), frames: frames ?? selfies }), NO_PARAMS);
}
const liveCard = async (who: string) =>
  (await q<{ id: string; status: string; review_reasons: string[]; duplicate_student_id: string | null; duplicate_similarity: number | null; purge_after: Date; dims: number; decode_method: string; name_matched: boolean | null; live_similarity: number | null }>(
    `select id, status, review_reasons, duplicate_student_id, duplicate_similarity, purge_after, vector_dims(embedding) as dims, decode_method, name_matched, live_similarity
     from student_cards where student_id = $1 and status in ('active','pending_review')`,
    [ids[who]],
  ))[0];

beforeAll(async () => {
  process.env.JWT_SECRET = "integration-secret-integration-secret-xx";
  ctx = await useTestAppDb();
  setCardDepsForTest(fakeDeps);
  selfies = await Promise.all(
    [0, 1, 2].map((i) => sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 120 + i, g: 110, b: 100 } } }).jpeg().toBuffer()),
  );
  const user = async (key: string, role: string) => {
    ids[key] = (await q<{ id: string }>(`insert into users (email,password_hash,full_name,role) values ($1,'x',$1,$2) returning id`, [`${key}@x`, role]))[0].id;
    cookie[key] = `${SESSION_COOKIE}=${(await createSession(ids[key], role as "admin" | "instructor")).token}`;
  };
  await user("gv1", "instructor");
  await user("gv2", "instructor");
  await user("admin", "admin");
  const cls = async (key: string, gv: string, end: string) => {
    ids[key] = (await q<{ id: string }>(`insert into classes (instructor_id, code, course_name, start_date, end_date) values ($1,$2,'HP',$3,$4) returning id`, [ids[gv], key, daysFromToday(-30), end]))[0].id;
  };
  await cls("K1", "gv1", K1_END);
  await cls("K2", "gv2", K2_END);
  const sv = async (key: string, code: string, last: string, first: string, classes: string[]) => {
    ids[key] = (await q<{ id: string }>(`insert into students (student_code,last_name,first_name) values ($1,$2,$3) returning id`, [code, last, first]))[0].id;
    for (const c of classes) await q(`insert into enrollments (class_id, student_id) values ($1,$2)`, [ids[c], ids[key]]);
    cookie[key] = `${SESSION_COOKIE}=${(await createSession(ids[key], "student")).token}`;
  };
  await sv("A", "231230801", "Nguyễn Văn", "An", ["K1"]);
  await sv("B", "231230802", "Trần Thị", "Bình", ["K1"]); // có sẵn thẻ (mặt seed 2)
  await sv("D", "231230804", "Phạm Quốc", "Dũng", ["K2"]); // lớp khác, có sẵn thẻ (mặt seed 4)
  await sv("F", "231230806", "Hoàng Thị", "Giang", ["K1"]);
  await sv("G", "231230807", "Đặng Thu", "Hải", ["K1"]);
  await sv("H", "231230808", "Bùi Thanh", "Hương", ["K1"]);
  await sv("O", "231230809", "Ngô Thị", "Linh", ["K1"]);
  await sv("N", "231230810", "Đỗ Hữu", "Khánh", []); // không thuộc lớp nào
  await sv("L", "231230811", "Lê Văn", "Lâm", ["K1"]); // ca liveness
  await sv("P", "231230812", "Phan Thị", "Phương", ["K1"]); // ca thẻ bị từ chối không lưu gì
  for (const [who, seed] of [["B", 2], ["D", 4]] as const) {
    await q(
      `insert into student_cards (student_id, embedding, decoded_code, decode_method, status) values ($1, $2::vector, $3, 'barcode', 'active')`,
      [ids[who], `[${faceVector(seed).join(",")}]`, who === "B" ? "231230802" : "231230804"],
    );
  }
}, 120_000);
afterAll(async () => {
  resetCardDepsForTest();
  await ctx.close();
});
beforeEach(async () => {
  uploads.length = 0;
  removed.length = 0;
  await q(`delete from rate_limits`); // mỗi ca độc lập; ca kiểm rate limit tự làm trong một `it`
});

describe("đồng ý xử lý dữ liệu sinh trắc (FR-050, Constitution IV)", () => {
  it("chưa đồng ý → API thẻ trả 403 CONSENT_REQUIRED", async () => {
    const n = await cardNonce(json("/api/student/card/nonce", cookie.A), NO_PARAMS);
    expect(n.status).toBe(403);
    expect((await readJson(n)).error.code).toBe("CONSENT_REQUIRED");
    const c = await uploadCard(await multipart(cookie.A, { nonce: "00000000-0000-4000-8000-000000000000", image: await photo() }), NO_PARAMS);
    expect(c.status).toBe(403);
    expect((await readJson(c)).error.code).toBe("CONSENT_REQUIRED");
  });

  it("sai phiên bản văn bản → 422; đúng → 204, lưu thời điểm + phiên bản + audit", async () => {
    const bad = await giveConsent(json("/api/student/consent", cookie.A, { version: "1999-01-01" }), NO_PARAMS);
    expect(bad.status).toBe(422);
    expect((await readJson(bad)).error.code).toBe("CONSENT_VERSION_MISMATCH");
    expect((await consent("A")).status).toBe(204);
    const [s] = await q<{ consent_at: Date | null; consent_version: string }>(`select consent_at, consent_version from students where id=$1`, [ids.A]);
    expect(s.consent_at).not.toBeNull();
    expect(s.consent_version).toBe(CONSENT_VERSION);
    const audit = await q(`select 1 from audit_logs where action='consent.give' and actor_id=$1`, [ids.A]);
    expect(audit).toHaveLength(1);
  });

  it("giảng viên không gọi được API sinh viên", async () => {
    expect((await giveConsent(json("/api/student/consent", cookie.gv1, { version: CONSENT_VERSION }), NO_PARAMS)).status).toBe(403);
  });
});

describe("nonce dùng một lần (FR-082)", () => {
  beforeAll(async () => {
    for (const who of ["B", "D", "F", "G", "H", "O", "N"]) await consent(who);
  });

  it("cấp nonce: hạn ~2 phút", async () => {
    const res = await cardNonce(json("/api/student/card/nonce", cookie.F), NO_PARAMS);
    const { nonce, expiresAt } = await readJson(res);
    expect(nonce).toMatch(/^[0-9a-f-]{36}$/);
    const ttl = (Date.parse(expiresAt) - Date.now()) / 1000;
    expect(ttl).toBeGreaterThan(100);
    expect(ttl).toBeLessThanOrEqual(121);
  });

  it("SV không thuộc lớp nào → 403 NOT_ENROLLED (trước khi xử lý ảnh)", async () => {
    const res = await cardNonce(json("/api/student/card/nonce", cookie.N), NO_PARAMS);
    expect(res.status).toBe(403);
    expect((await readJson(res)).error.code).toBe("NOT_ENROLLED");
  });

  it("nonce hết hạn / của SV khác / sai định dạng → 403 BAD_NONCE + security_events bad_nonce", async () => {
    scenario("231230806", 6);
    const expired = await nonceFor("F");
    await q(`update scan_nonces set expires_at = now() - interval '1 second' where nonce = $1`, [expired]);
    const ofOther = await nonceFor("G");
    for (const n of [expired, ofOther, "khong-phai-uuid"]) {
      const res = await submit("F", n);
      expect(res.status, n).toBe(403);
      expect((await readJson(res)).error.code).toBe("BAD_NONCE");
    }
    expect(uploads).toHaveLength(0); // chưa xử lý / lưu ảnh nào
    const ev = await q(`select 1 from security_events where type='bad_nonce' and actor_id=$1`, [ids.F]);
    expect(ev.length).toBeGreaterThanOrEqual(3);
  });

  it("nonce đã dùng (kể cả lượt bị từ chối) không dùng lại được", async () => {
    scenario("231239999", 6); // thẻ người khác → CODE_MISMATCH, nonce vẫn bị tiêu
    const n = await nonceFor("G");
    expect((await submit("G", n)).status).toBe(422);
    const again = await submit("G", n);
    expect(again.status).toBe(403);
    expect((await readJson(again)).error.code).toBe("BAD_NONCE");
  });
});

describe("POST /api/student/card — đăng ký thẻ", () => {
  it("ảnh > 1 MB → 413; không phải ảnh → 422 UNSUPPORTED_TYPE", async () => {
    scenario("231230801", 1);
    const big = await uploadCard(
      await multipart(cookie.A, { nonce: await nonceFor("A"), image: Buffer.alloc(1_100_000, 7), frames: selfies }),
      NO_PARAMS,
    );
    expect(big.status).toBe(413);
    const text = await uploadCard(await multipart(cookie.A, { nonce: await nonceFor("A"), image: Buffer.from("day khong phai la anh, chi la chu thoi"), frames: selfies }), NO_PARAMS);
    expect(text.status).toBe(422);
    expect((await readJson(text)).error.code).toBe("UNSUPPORTED_TYPE");
  });

  it("mã trên thẻ khác mã đăng nhập → 422 CODE_MISMATCH 'Thẻ không thuộc mã sinh viên này'", async () => {
    scenario("231230802", 1);
    const res = await submit("A");
    expect(res.status).toBe(422);
    expect(await readJson(res)).toMatchObject({ error: { code: "CODE_MISMATCH", message: expect.stringContaining("Thẻ không thuộc mã sinh viên này") } });
  });

  it("không thấy chân dung → 422 NO_PORTRAIT; mờ → 422 UNREADABLE", async () => {
    scenario("231230801", 1, { faces: [] });
    expect((await readJson(await submit("A"))).error.code).toBe("NO_PORTRAIT");
    scenario("231230801", 1, { faces: [{ ...goodFace, sharpness: 0.001 }] });
    expect((await readJson(await submit("A"))).error.code).toBe("UNREADABLE");
  });

  it("thẻ hợp lệ → 201 active; embedding 512-d; ảnh JPEG đã bỏ EXIF lưu bucket private 'cards'; purge_after = kết thúc lớp + 30 ngày", async () => {
    scenario("231230801", 1);
    const res = await submit("A", undefined, await photo({ exif: true }));
    expect(res.status).toBe(201);
    expect(await readJson(res)).toEqual({ status: "active", decodedCode: "231230801" });

    const card = await liveCard("A");
    expect(card).toMatchObject({ status: "active", dims: 512, decode_method: "barcode", review_reasons: [] });
    expect(new Date(card.purge_after).toISOString()).toBe(purgeFor(K1_END));

    expect(uploads.map((u) => [u.bucket, u.path, u.contentType])).toEqual([
      ["cards", `${ids.A}/${card.id}/card.jpg`, "image/jpeg"],
      ["cards", `${ids.A}/${card.id}/portrait.jpg`, "image/jpeg"],
    ]);
    const meta = await sharp(uploads[0].body).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined(); // đã mã hoá lại, bỏ EXIF
    const audit = await q<{ meta: Record<string, unknown> }>(`select meta from audit_logs where action='card.register' and actor_id=$1`, [ids.A]);
    expect(audit[0].meta).toMatchObject({ status: "active", method: "barcode" });
  });

  it("đã có thẻ hợp lệ → 409 CARD_ALREADY_REGISTERED (đăng ký lại cần giảng viên đặt lại)", async () => {
    const n = await cardNonce(json("/api/student/card/nonce", cookie.A), NO_PARAMS);
    expect(n.status).toBe(409);
    expect((await readJson(n)).error.code).toBe("CARD_ALREADY_REGISTERED");
  });

  it("GET /api/student/card: SV xem trạng thái thẻ của mình, không có embedding/đường dẫn ảnh", async () => {
    const body = await readJson(await myCard(json("/api/student/card", cookie.A, undefined, "GET"), NO_PARAMS));
    expect(body.card).toMatchObject({ status: "active" });
    expect(JSON.stringify(body)).not.toMatch(/embedding|portrait|card\.jpg/);
  });

  it("trùng mặt với thẻ của SV khác CÙNG lớp → không chặn, giữ pending_review cho giảng viên (US6-6, Principle III)", async () => {
    nextDecode = { decoded: { code: "231230806", method: "barcode" }, text: "" };
    nextFaces = [goodFace];
    nextEmbedding = faceVector(2, 0.15); // gần giống mặt B
    const res = await submit("F");
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body).toEqual({ status: "pending_review", decodedCode: "231230806" }); // không lộ là trùng với ai
    const card = await liveCard("F");
    expect(card.review_reasons).toEqual(["DUPLICATE_FACE"]);
    expect(card.duplicate_student_id).toBe(ids.B);
    expect(card.duplicate_similarity).toBeGreaterThanOrEqual(0.6);
  });

  it("trùng mặt với SV ở lớp KHÁC (không chung lớp nào) → không đánh dấu", async () => {
    scenario("231230807", 4); // giống hệt mặt D (lớp K2), G chỉ học K1
    const res = await submit("G");
    expect((await readJson(res)).status).toBe("active");
    expect((await liveCard("G")).review_reasons).toEqual([]);
  });

  it("mã đọc bằng OCR và họ tên không khớp → pending_review NAME_MISMATCH", async () => {
    scenario("231230808", 8, { method: "ocr", text: "Họ tên: NGUYỄN VĂN TÈO\nMSSV: 231230808" });
    expect((await readJson(await submit("H"))).status).toBe("pending_review");
    const card = await liveCard("H");
    expect(card.review_reasons).toEqual(["NAME_MISMATCH"]);
    expect(card.name_matched).toBe(false);
    // dòng họ tên đọc bằng OCR được lưu để giảng viên đối chiếu (không phải dữ liệu sinh trắc)
    expect((await q<{ ocr_name: string | null }>(`select ocr_name from student_cards where id=$1`, [card.id]))[0].ocr_name).toBe("NGUYỄN VĂN TÈO");
  });

  it("6 lượt/giờ/SV; mỗi lỗi kèm remainingAttempts giảm dần; lượt 7 → 429 với remainingAttempts 0 + Retry-After", async () => {
    scenario("231239999", 9); // thẻ người khác → 422, mỗi lần vẫn tính lượt
    const remaining: number[] = [];
    const freshNonceQuota = () => q(`delete from rate_limits where key like 'card-nonce:%'`); // giữ nguyên bộ đếm lượt đăng ký
    for (let i = 0; i < 6; i++) {
      await freshNonceQuota();
      const res = await submit("O");
      expect(res.status, `lượt ${i + 1}`).toBe(422);
      const { error } = await readJson(res);
      expect(error.code).toBe("CODE_MISMATCH");
      remaining.push(error.remainingAttempts);
    }
    expect(remaining).toEqual([5, 4, 3, 2, 1, 0]);
    await freshNonceQuota();
    const blocked = await submit("O");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    expect((await readJson(blocked)).error).toMatchObject({ code: "RATE_LIMITED", remainingAttempts: 0 });
  });

  it("lỗi trước khi tính lượt (nonce sai) không tiêu lượt và không có remainingAttempts", async () => {
    const res = await submit("O", "00000000-0000-4000-8000-000000000000");
    expect(res.status).toBe(403);
    expect((await readJson(res)).error.remainingAttempts).toBeUndefined();
  });
});

describe("ảnh khuôn mặt trực tiếp + thử thách quay đầu khi đăng ký thẻ (FR-045a)", () => {
  beforeAll(async () => {
    for (const who of ["L", "P"]) await consent(who);
  });
  const countCards = async (who: string) => (await q<{ n: number }>(`select count(*)::int as n from student_cards where student_id=$1`, [ids[who]]))[0].n;

  it("nonce thẻ kèm thử thách ngẫu nhiên: hoán vị của left/right", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const res = await cardNonce(json("/api/student/card/nonce", cookie.L), NO_PARAMS);
      const { challenge } = await readJson(res);
      expect([...challenge].sort()).toEqual(["left", "right"]);
      seen.add(challenge.join(","));
      await q(`delete from rate_limits`);
    }
    expect(seen.size).toBe(2); // cả hai thứ tự đều xuất hiện (xác suất trượt 2^-11)
  });

  it("thiếu khung hình / không đủ 3 khung → 422", async () => {
    scenario("231230811", 21);
    const none = await uploadCard(await multipart(cookie.L, { nonce: await nonceFor("L"), image: await photo() }), NO_PARAMS);
    expect(none.status).toBe(422);
    const two = await uploadCard(await multipart(cookie.L, { nonce: await nonceFor("L"), image: await photo(), frames: selfies.slice(0, 2) }), NO_PARAMS);
    expect(two.status).toBe(422);
  });

  it("tổng request > 4 MB → 413 trước khi đọc body", async () => {
    const req = await multipart(cookie.L, { nonce: await nonceFor("L"), image: await photo(), frames: selfies }, { "content-length": String(4 * 1024 * 1024 + 1) });
    expect((await uploadCard(req, NO_PARAMS)).status).toBe(413);
  });

  it("quay ngược thử thách → 422 LIVENESS_FAILED; ảnh tĩnh → 422 LIVENESS_FAILED; không lưu gì", async () => {
    scenario("231230811", 21);
    liveMode = "reverse";
    const r1 = await submit("L");
    expect(r1.status).toBe(422);
    expect((await readJson(r1)).error.code).toBe("LIVENESS_FAILED");
    await q(`delete from rate_limits`);
    scenario("231230811", 21);
    liveMode = "static";
    expect((await readJson(await submit("L"))).error.code).toBe("LIVENESS_FAILED");
    expect(uploads).toHaveLength(0);
    expect(await countCards("L")).toBe(0);
  });

  it("3 khung không cùng một người → 422 LIVENESS_FAILED", async () => {
    scenario("231230811", 21);
    let n = 0;
    const realLive = fakeDeps.analyzeLive;
    fakeDeps.analyzeLive = async (img) => {
      const r = await realLive(img);
      const k = n++;
      return { ...r, embed: async () => (k === 2 ? faceVector(99) : nextEmbedding) };
    };
    try {
      expect((await readJson(await submit("L"))).error.code).toBe("LIVENESS_FAILED");
    } finally {
      fakeDeps.analyzeLive = realLive;
    }
    expect(await countCards("L")).toBe(0);
  });

  it("mặt trực tiếp khác chân dung thẻ → KHÔNG từ chối: 201 pending_review LIVE_MISMATCH; khung hình không bị lưu", async () => {
    scenario("231230811", 21);
    liveEmbedding = faceVector(22); // người khác cầm thẻ của L
    const res = await submit("L");
    expect(res.status).toBe(201);
    expect(await readJson(res)).toEqual({ status: "pending_review", decodedCode: "231230811" });
    const card = await liveCard("L");
    expect(card.review_reasons).toEqual(["LIVE_MISMATCH"]);
    expect(card.live_similarity).toBeLessThan(0.5);
    expect(uploads.map((u) => u.path.split("/").pop())).toEqual(["card.jpg", "portrait.jpg"]); // không lưu ảnh mặt trực tiếp (FR-051)
  });

  it("mặt trực tiếp khớp chân dung → active, lưu live_similarity", async () => {
    // P: đúng người, làm đúng thử thách
    scenario("231230812", 23);
    const res = await submit("P");
    expect((await readJson(res)).status).toBe("active");
    expect((await liveCard("P")).live_similarity).toBeGreaterThan(0.99);
  });

  it("thẻ bị từ chối ở bước đọc thẻ (CODE_MISMATCH / NO_PORTRAIT / UNREADABLE) → không upload, không ghi DB", async () => {
    await q(`update student_cards set status='replaced' where student_id=$1`, [ids.P]); // cho P đăng ký lại
    const before = await countCards("P");
    const auditsOf = async () => (await q(`select 1 from audit_logs where action='card.register' and actor_id=$1`, [ids.P])).length;
    const auditBefore = await auditsOf();
    for (const s of [
      () => scenario("231239999", 23),
      () => scenario("231230812", 23, { faces: [] }),
      () => { nextDecode = { decoded: null, text: "" }; nextFaces = [goodFace]; },
    ]) {
      s();
      await q(`delete from rate_limits`);
      expect((await submit("P")).status).toBe(422);
    }
    expect(uploads).toHaveLength(0);
    expect(await countCards("P")).toBe(before);
    expect(await auditsOf()).toBe(auditBefore);
  });
});

describe("giảng viên/admin: xem, duyệt, đặt lại thẻ (FR-049, T061)", () => {
  const staffReq = (who: string, sv: string, action: "" | "reset" | "review", body?: unknown) => {
    const path = `/api/admin/students/${ids[sv]}/card${action ? `/${action}` : ""}`;
    const req = json(path, cookie[who], body, action ? "POST" : "GET");
    const p = params({ id: ids[sv] });
    return action === "" ? staffGetCard(req, p) : action === "reset" ? staffResetCard(req, p) : staffReviewCard(req, p);
  };

  it("giảng viên của lớp xem thẻ chờ duyệt: lý do, SV bị trùng, link ảnh ngắn hạn", async () => {
    const res = await staffReq("gv1", "F", "");
    expect(res.status).toBe(200);
    const { card } = await readJson(res);
    expect(card).toMatchObject({
      status: "pending_review",
      reviewReasons: ["DUPLICATE_FACE"],
      duplicateOf: { studentId: ids.B, code: "231230802", fullName: "Trần Thị Bình" },
      portraitUrl: expect.stringContaining("/cards/"),
      cardUrl: expect.stringContaining("/cards/"),
    });
    expect(card.duplicateOf.similarity).toBeGreaterThanOrEqual(0.6);
    expect(card).toMatchObject({ rosterName: "Hoàng Thị Giang", ocrName: null, liveSimilarity: expect.any(Number) });
    expect(JSON.stringify(card)).not.toMatch(/embedding/);
  });

  it("thẻ NAME_MISMATCH: giảng viên thấy dòng họ tên OCR cạnh họ tên trong danh sách", async () => {
    const { card } = await readJson(await staffReq("gv1", "H", ""));
    expect(card).toMatchObject({ reviewReasons: ["NAME_MISMATCH"], ocrName: "NGUYỄN VĂN TÈO", rosterName: "Bùi Thanh Hương" });
  });

  it("giảng viên không dạy SV đó → 404 cho xem / duyệt / đặt lại (chống IDOR)", async () => {
    expect((await staffReq("gv2", "F", "")).status).toBe(404);
    expect((await staffReq("gv2", "F", "review", { decision: "approve" })).status).toBe(404);
    expect((await staffReq("gv2", "F", "reset", { reason: "thử" })).status).toBe(404);
  });

  it("duyệt pending_review → active, ghi reviewed_by + audit", async () => {
    const res = await staffReq("gv1", "F", "review", { decision: "approve", note: "Đã đối chiếu trực tiếp" });
    expect(res.status).toBe(200);
    const [c] = await q<{ status: string; reviewed_by: string }>(`select status, reviewed_by from student_cards where student_id=$1 and status='active'`, [ids.F]);
    expect(c).toEqual({ status: "active", reviewed_by: ids.gv1 });
    expect(await q(`select 1 from audit_logs where action='card.review' and target_id=$1`, [ids.F])).toHaveLength(1);
    // thẻ không còn chờ duyệt → duyệt lại báo 409
    expect((await staffReq("gv1", "F", "review", { decision: "approve" })).status).toBe(409);
  });

  it("từ chối pending_review → deleted, xoá ảnh + embedding", async () => {
    const res = await staffReq("gv1", "H", "review", { decision: "reject", note: "Tên không khớp" });
    expect(res.status).toBe(200);
    const [c] = await q<{ status: string; emb: boolean; p: string | null }>(
      `select status, embedding is null as emb, portrait_image_path as p from student_cards where student_id=$1 order by registered_at desc limit 1`,
      [ids.H],
    );
    expect(c).toEqual({ status: "deleted", emb: true, p: null });
    expect(removed.flatMap((r) => r.paths).some((p) => p.startsWith(`${ids.H}/`))).toBe(true);
    // SV thấy "bị từ chối" — không kèm lý do / ghi chú của giảng viên
    const mine = await readJson(await myCard(json("/api/student/card", cookie.H, undefined, "GET"), NO_PARAMS));
    expect(mine.card).toMatchObject({ status: "rejected" });
    expect(JSON.stringify(mine)).not.toMatch(/NAME_MISMATCH|Tên không khớp|reason|note/i);
  });

  it("admin đặt lại thẻ: thẻ cũ → replaced (giữ lịch sử, xoá dữ liệu sinh trắc), audit + security_events card_replaced, SV đăng ký lại được", async () => {
    const res = await staffReq("admin", "A", "reset", { reason: "SV được cấp thẻ mới" });
    expect(res.status).toBe(200);
    const rows = await q<{ status: string; emb: boolean }>(`select status, embedding is null as emb from student_cards where student_id=$1`, [ids.A]);
    expect(rows).toEqual([{ status: "replaced", emb: true }]);
    expect(await q(`select 1 from audit_logs where action='card.reset' and target_id=$1`, [ids.A])).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(await q(`select 1 from security_events where type='card_replaced' and actor_id=$1`, [ids.admin])).toHaveLength(1);
    expect(removed.flatMap((r) => r.paths).some((p) => p.startsWith(`${ids.A}/`))).toBe(true);
    const mine = await readJson(await myCard(json("/api/student/card", cookie.A, undefined, "GET"), NO_PARAMS));
    expect(mine.card).toMatchObject({ status: "reset" });
    expect(JSON.stringify(mine)).not.toMatch(/SV được cấp thẻ mới/);

    scenario("231230801", 11);
    expect((await readJson(await submit("A"))).status).toBe("active");
  });

  it("đặt lại khi không có thẻ hiệu lực → 404 NO_CARD; thiếu lý do → 422", async () => {
    const none = await staffReq("gv1", "O", "reset", { reason: "SV làm mất thẻ" });
    expect(none.status).toBe(404);
    expect((await readJson(none)).error.code).toBe("NO_CARD");
    expect((await staffReq("gv1", "A", "reset", {})).status).toBe(422);
  });

  it("ghi audit lỗi → đặt lại thẻ bị huỷ (audit trong cùng transaction)", async () => {
    await ctx.pg.exec(`
      create function fail_audit() returns trigger language plpgsql as $f$ begin raise exception 'audit down'; end $f$;
      create trigger audit_down before insert on audit_logs for each row execute function fail_audit();`);
    try {
      const res = await staffReq("gv1", "G", "reset", { reason: "thử rollback" });
      expect(res.status).toBe(500);
      expect((await liveCard("G")).status).toBe("active");
    } finally {
      await ctx.pg.exec(`drop trigger audit_down on audit_logs; drop function fail_audit();`);
    }
  });
});

describe("hạn giữ ảnh thẻ cập nhật theo lớp (FR-054, T064)", () => {
  const purgeOf = async (who: string) => new Date((await liveCard(who)).purge_after).toISOString();
  const gv1 = () => ({ sub: ids.gv1, role: "instructor" as const, sid: "t" });

  it("được thêm vào lớp kết thúc muộn hơn → purge_after kéo dài theo lớp đó", async () => {
    expect(await purgeOf("G")).toBe(purgeFor(K1_END));
    await addStudent({ sub: ids.gv2, role: "instructor", sid: "t" }, ids.K2, "231230807");
    expect(await purgeOf("G")).toBe(purgeFor(K2_END));
  });

  it("đổi ngày kết thúc lớp → cập nhật purge_after của mọi SV trong lớp", async () => {
    const newEnd = addDays(K1_END, 7);
    await updateClass(gv1(), ids.K1, { endDate: newEnd });
    expect(await purgeOf("F")).toBe(purgeFor(newEnd));
    expect(await purgeOf("G")).toBe(purgeFor(K2_END)); // K2 vẫn muộn hơn
  });
});

describe("GET /api/classes/{id}/cards — danh sách SV + trạng thái thẻ cho giảng viên (T063)", () => {
  const list = (who: string, cls: string) => classCards(json(`/api/classes/${ids[cls]}/cards`, cookie[who], undefined, "GET"), params({ id: ids[cls] }));

  it("giảng viên lớp khác → 404; admin xem được", async () => {
    expect((await list("gv2", "K1")).status).toBe(404);
    expect((await list("admin", "K1")).status).toBe(200);
  });

  it("mỗi SV đang học có trạng thái thẻ; lý do chờ duyệt chỉ ở thẻ pending_review; không có ảnh/embedding", async () => {
    await q(`insert into student_cards (student_id, decoded_code, decode_method, status, review_reasons, live_similarity)
             values ($1, '231230809', 'barcode', 'pending_review', '["LIVE_MISMATCH"]'::jsonb, 0.31)`, [ids.O]);
    const fresh = (await q<{ id: string }>(`insert into students (student_code,last_name,first_name) values ('231230899','Vũ Minh','Quân') returning id`))[0].id;
    await q(`insert into enrollments (class_id, student_id) values ($1,$2)`, [ids.K1, fresh]);
    const res = await list("gv1", "K1");
    expect(res.status).toBe(200);
    const { students } = await readJson(res);
    const by = Object.fromEntries(students.map((s: { code: string }) => [s.code, s]));
    expect(by["231230809"]).toMatchObject({ studentId: ids.O, fullName: "Ngô Thị Linh", card: { status: "pending_review", reviewReasons: ["LIVE_MISMATCH"] } });
    expect(by["231230802"].card).toMatchObject({ status: "active", reviewReasons: [] });
    expect(by["231230808"].card).toMatchObject({ status: "rejected" }); // H bị từ chối ở trên
    expect(by["231230899"].card).toBeNull(); // SV mới chưa có thẻ
    expect(by["231230804"]).toBeUndefined(); // D học lớp K2
    expect(JSON.stringify(students)).not.toMatch(/embedding|cards\/|https?:/);
  });
});

describe("GET /api/student/classes — lớp của SV (T062)", () => {
  it("chỉ lớp đang ghi danh active và chưa kết thúc; không có lớp người khác", async () => {
    const ended = (await q<{ id: string }>(`insert into classes (instructor_id, code, course_name, start_date, end_date, default_room) values ($1,'CU','HP cũ',$2,$3,'P1') returning id`, [ids.gv1, daysFromToday(-200), daysFromToday(-100)]))[0].id;
    const left = (await q<{ id: string }>(`insert into classes (instructor_id, code, course_name, start_date, end_date) values ($1,'RUT','HP rút',$2,$3) returning id`, [ids.gv1, daysFromToday(-10), daysFromToday(50)]))[0].id;
    const s = (await q<{ id: string }>(`insert into students (student_code,last_name,first_name) values ('231230898','Trịnh Văn','Sơn') returning id`))[0].id;
    await q(`insert into enrollments (class_id, student_id, status) values ($1,$4,'active'), ($2,$4,'active'), ($3,$4,'withdrawn')`, [ids.K1, ended, left, s]);
    cookie.S = `${SESSION_COOKIE}=${(await createSession(s, "student")).token}`;
    await consent("S");
    const res = await myClasses(json("/api/student/classes", cookie.S, undefined, "GET"), NO_PARAMS);
    expect(res.status).toBe(200);
    const { classes } = await readJson(res);
    expect(classes).toEqual([{ classId: ids.K1, code: "K1", courseName: "HP", room: null, openWindow: null }]);
  });
});
