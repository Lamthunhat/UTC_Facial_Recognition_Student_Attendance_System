import "server-only";
import { randomInt, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@utc/database";
import { studentCards, students } from "@utc/database/schema";
import { vnDateOf } from "@utc/shared/periods";
import { writeAudit } from "../audit";
import type { SessionClaims } from "../auth/jwt";
import { removeObjects, signedUrl, uploadObject, type Bucket } from "../evidence/storage";
import { isChallenge, type Challenge, type LiveFrameError } from "../face/liveness";
import { cosine } from "../face/similarity";
import { parseClientYaw, yawDebugEnabled, yawDebugReport, type YawDebugReport } from "../face/yaw-debug";
import { HttpError, tooManyRequests } from "../http/errors";
import { log } from "../log";
import { consumeNonce, issueNonce } from "../security/nonce";
import { enforce, hit, refund, RULES } from "../security/rate-limit";
import { sanitizeImage, UploadError } from "../security/upload";
import { ALLOWED_IMAGE_TYPES, evaluateLiveFrames, sanitizeLiveFrames, uploadErrorToHttp } from "./live";
import { requireConsent } from "../student/consent";
import { decodeCard, type DecodeStats } from "./decode";
import { stepTimer } from "./step-timer";
import { analyzePortraits, type AnalyzedPortraits } from "./portrait";
import { cardPurgeAfter } from "./retention";
import { duplicateDecision, evaluateCard, nameAppearsIn, ocrNameLine, type CardRejectCode, type CardReviewReason, type DecodedCode } from "./verify";

/**
 * T058 — Đăng ký thẻ sinh viên (US6, FR-045…FR-049, FR-045a, Principle I/III/IV, FR-082).
 * Thứ tự: đồng ý → thuộc lớp đang hoạt động → chưa có thẻ hiệu lực → tiêu thụ nonce (kèm thử thách quay đầu)
 * → rate limit (chỉ tính lượt có nonce hợp lệ, tức lượt tốn CPU) → sanitize thẻ + 3 khung mặt trực tiếp
 * → giải mã thẻ ∥ phân tích chân dung → luật evaluateCard → liveness 3 khung → embedding
 * → so mặt trực tiếp với chân dung thẻ → kiểm trùng 1:N với SV chung lớp
 * → CHỈ KHI ĐÃ QUA HẾT mới lưu ảnh thẻ + chân dung (bucket private) → ghi DB + audit trong một transaction
 *   (DB lỗi thì xoá ảnh vừa lưu). Thẻ bị từ chối ở bất kỳ bước nào: không lưu file, không ghi DB.
 * Khung mặt trực tiếp KHÔNG BAO GIỜ được lưu (FR-051) — chỉ lưu độ tương đồng.
 * Trùng mặt / mặt trực tiếp lệch thẻ / tên không khớp KHÔNG chặn: thẻ vào pending_review để giảng viên quyết (Principle III).
 */

export interface CardStorage {
  upload(bucket: Bucket, path: string, body: Buffer, contentType: string): Promise<string>;
  remove(bucket: Bucket, paths: string[]): Promise<void>;
  signedUrl(bucket: Bucket, path: string): Promise<string>;
}
export interface CardDeps {
  decode(jpeg: Buffer): Promise<{ decoded: DecodedCode | null; text: string; stats?: DecodeStats }>;
  analyzeFaces(jpeg: Buffer): Promise<AnalyzedPortraits>;
  /** Phân tích một khung mặt trực tiếp (cùng pipeline ONNX; tách riêng để test giả lập từng khung). */
  analyzeLive(jpeg: Buffer): Promise<AnalyzedPortraits>;
  storage: CardStorage;
}

const realDeps: CardDeps = {
  decode: decodeCard,
  analyzeFaces: analyzePortraits,
  analyzeLive: analyzePortraits,
  storage: { upload: uploadObject, remove: removeObjects, signedUrl: (b, p) => signedUrl(b, p) },
};
let deps: CardDeps = realDeps;

/** Chỉ dùng trong test: thay giải mã thẻ / khuôn mặt / kho ảnh bằng bản giả (không có ảnh mặt thật trong repo). */
export function setCardDepsForTest(d: CardDeps) {
  if (process.env.NODE_ENV === "production") throw new Error("setCardDepsForTest chỉ dùng trong test");
  deps = d;
}
export function resetCardDepsForTest() {
  deps = realDeps;
}
export const cardDeps = () => deps;

export const CARD_IMAGE_MAX_BYTES = 1024 * 1024; // FR-090: ảnh thẻ ≤ 1 MB
export { LIVE_FRAME_COUNT, LIVE_FRAME_MAX_BYTES } from "./live";

const threshold = (name: string, fallback: number) => {
  const v = Number(process.env[name] ?? fallback);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : fallback;
};
/** Ngưỡng trùng mặt 1:N — mặc định 0,45, CHỜ HIỆU CHỈNH T011 (research R1). Đọc trực tiếp để không cần toàn bộ env(). */
export const duplicateThreshold = () => threshold("DUPLICATE_ABOVE", 0.45);
/** Mặt trực tiếp ↔ chân dung thẻ: dưới ngưỡng → LIVE_MISMATCH (cùng ngưỡng "khớp thẻ" CARD_ACCEPT_ABOVE của điểm danh). */
export const liveMatchThreshold = () => threshold("CARD_ACCEPT_ABOVE", 0.5);

const REJECT_MESSAGES: Record<CardRejectCode, string> = {
  CODE_MISMATCH: "Thẻ không thuộc mã sinh viên này.",
  UNREADABLE: "Không đọc được thẻ (ảnh mờ, loá hoặc không thấy mã). Đặt thẻ trên nền phẳng, đủ sáng, chụp thẳng, rõ nét rồi thử lại.",
  NO_PORTRAIT: "Không thấy ảnh chân dung trên thẻ. Chụp trọn mặt trước thẻ, không để tay hay vật khác che ảnh.",
  MULTIPLE_FACES: "Ảnh có nhiều hơn một khuôn mặt. Chỉ chụp riêng mặt trước thẻ sinh viên của bạn.",
};

const LIVE_MESSAGES: Record<LiveFrameError, string> = {
  LIVE_NO_FACE: "Không thấy khuôn mặt của bạn trong khung hình. Giữ mặt trong khung, đủ sáng rồi thử lại.",
  LIVE_MULTIPLE_FACES: "Có nhiều hơn một người trong khung hình. Chỉ một mình bạn trước camera.",
  LIVENESS_FAILED: "Chưa xác nhận được người thật: hãy làm đúng hướng dẫn quay đầu rồi thử lại.",
};

/** Kiểm tra rẻ, chạy trước khi cấp nonce và trước khi xử lý ảnh. */
export async function assertCanRegisterCard(studentId: string, today = vnDateOf(new Date())) {
  await requireConsent(studentId);
  const db = await getDb();
  const enrolled = await db.execute(sql`
    select 1 from enrollments e join classes c on c.id = e.class_id
    where e.student_id = ${studentId} and e.status = 'active' and c.end_date >= ${today}::date limit 1`);
  const rows = Array.isArray(enrolled) ? enrolled : (enrolled as { rows: unknown[] }).rows;
  if (rows.length === 0) throw new HttpError(403, "NOT_ENROLLED", "Bạn chưa thuộc lớp học phần nào đang hoạt động.");
  const [live] = await db
    .select({ status: studentCards.status })
    .from(studentCards)
    .where(and(eq(studentCards.studentId, studentId), inArray(studentCards.status, ["active", "pending_review"])))
    .limit(1);
  if (live?.status === "active") {
    throw new HttpError(409, "CARD_ALREADY_REGISTERED", "Bạn đã đăng ký thẻ. Muốn đăng ký lại, hãy nhờ giảng viên cho phép.");
  }
  if (live?.status === "pending_review") {
    throw new HttpError(409, "CARD_PENDING_REVIEW", "Thẻ của bạn đang chờ giảng viên duyệt.");
  }
}

export async function issueCardNonce(session: SessionClaims) {
  await assertCanRegisterCard(session.sub);
  await enforce(`card-nonce:${session.sub}`, RULES.scanNonce);
  // Thử thách quay đầu ngẫu nhiên (research R2): chặn phát lại video/ảnh quay sẵn.
  const challenge: Challenge = randomInt(2) === 0 ? ["left", "right"] : ["right", "left"];
  const n = await issueNonce(session.sub, "card", { challenge });
  // Preview/dev: báo client gửi kèm yaw lúc chụp để so với server (face/yaw-debug.ts). Production: không có trường này.
  return { nonce: n.nonce, expiresAt: n.expiresAt, challenge, ...(yawDebugEnabled() ? { yawDebug: true as const } : {}) };
}

/** Lỗi phía server đã phân loại — lượt đăng ký thẻ được hoàn (lỗi 500 không phân loại thì không). */
const REFUNDABLE_CODES = new Set(["STORAGE_BUCKET_MISSING", "STORAGE_UNAVAILABLE", "OCR_UNAVAILABLE"]);

type CardInput = { nonce: string; image: Buffer; frames: Buffer[]; clientYaw?: string };
type CardResult = { status: "active" | "pending_review"; decodedCode: string; yawDebug?: YawDebugReport };

export async function registerCard(
  session: SessionClaims,
  input: CardInput,
  ip: string | null,
): Promise<CardResult> {
  const studentId = session.sub;
  await assertCanRegisterCard(studentId);
  const { challenge } = await consumeNonce({ nonce: input.nonce, studentId, purpose: "card", ip });
  if (!isChallenge(challenge)) throw new HttpError(403, "BAD_NONCE", "Phiên chụp không hợp lệ. Vui lòng chụp lại.");
  // Tính lượt — chỉ lượt đã qua nonce hợp lệ. Lỗi từ đây trở đi kèm remainingAttempts để UI báo số lượt còn lại.
  // 6 lượt/giờ (lượt lỗi phía server đã phân loại được hoàn) + trần tổng 20 lượt/giờ (không bao giờ hoàn).
  const attemptKey = `card:${studentId}`;
  const attempt = await hit(attemptKey, RULES.cardRegister);
  if (!attempt.allowed) throw tooManyRequests(attempt.retryAfterSec, { remainingAttempts: 0 });
  const total = await hit(`card-total:${studentId}`, RULES.cardRegisterTotal);
  if (!total.allowed) throw tooManyRequests(total.retryAfterSec, { remainingAttempts: 0 });
  const remaining = (attemptsUsed: number) =>
    Math.max(0, Math.min(RULES.cardRegister.limit - attemptsUsed, RULES.cardRegisterTotal.limit - total.count));
  const remainingAttempts = remaining(attempt.count);
  // Thời gian từng bước — chỉ log ở dev (đo hiệu năng cục bộ; production không ghi)
  const timer: ReturnType<typeof stepTimer> & { decodeStats?: DecodeStats } = stepTimer();
  try {
    return await processCard(session, studentId, input, challenge, timer);
  } catch (e) {
    // Lỗi phía server ĐÃ PHÂN LOẠI (không phải lỗi của ảnh/SV) → hoàn lượt 6/giờ; trần tổng vẫn tính.
    if (e instanceof HttpError && REFUNDABLE_CODES.has(e.code)) {
      await refund(attemptKey);
      throw e.withExtra({ remainingAttempts: remaining(attempt.count - 1) });
    }
    if (e instanceof HttpError && e.status < 500) throw e.withExtra({ remainingAttempts });
    throw e; // lỗi không phân loại (500): không hoàn, không kèm remainingAttempts
  } finally {
    if (process.env.NODE_ENV === "development") log.info("card_register_timing", { ms: timer.done(), decode: timer.decodeStats });
  }
}

async function processCard(
  session: SessionClaims,
  studentId: string,
  input: CardInput,
  challenge: Challenge,
  timer: ReturnType<typeof stepTimer> & { decodeStats?: DecodeStats },
): Promise<CardResult> {
  let jpeg: Buffer;
  try {
    jpeg = (await sanitizeImage(input.image, { maxBytes: CARD_IMAGE_MAX_BYTES, allowed: ALLOWED_IMAGE_TYPES, maxSide: 2048, quality: 90 })).buffer;
  } catch (e) {
    if (e instanceof UploadError) throw uploadErrorToHttp(e);
    throw e;
  }
  const frames = await sanitizeLiveFrames(input.frames);

  timer.mark("sanitize");
  const db = await getDb();
  const [me] = await db
    .select({ code: students.studentCode, lastName: students.lastName, firstName: students.firstName })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  if (!me) throw new HttpError(401, "UNAUTHORIZED", "Bạn cần đăng nhập.");

  const [{ decoded, text, stats }, portraits] = await Promise.all([deps.decode(jpeg), deps.analyzeFaces(jpeg)]);
  timer.decodeStats = stats;
  timer.mark("decode_and_portrait");
  const nameMatched = text.trim() ? nameAppearsIn(text, `${me.lastName} ${me.firstName}`) : null;
  const verdict = evaluateCard({ sessionCode: me.code, decoded, faces: portraits.faces, nameMatched });
  if (!verdict.ok) throw new HttpError(422, verdict.error, REJECT_MESSAGES[verdict.error]);

  // Liveness (FR-045a): 3 khung mặt trực tiếp đúng thử thách quay đầu và cùng một người. Sai → từ chối.
  const liveCheck = await evaluateLiveFrames(frames, challenge, deps.analyzeLive);
  // Preview/dev: yaw server từng khung + yaw client + lý do (công cụ hiệu chỉnh). Production: không có, không log.
  const debugOn = yawDebugEnabled();
  const clientYaw = debugOn ? parseClientYaw(input.clientYaw) : null;
  const debug = (reason: Parameters<typeof yawDebugReport>[3]) =>
    debugOn ? { yawDebug: yawDebugReport(liveCheck.faces, challenge, clientYaw, reason) } : {};
  if (!liveCheck.ok) throw new HttpError(422, liveCheck.error, LIVE_MESSAGES[liveCheck.error], {}, debug(liveCheck.reason));
  const liveEmbeddings = liveCheck.embeddings;

  timer.mark("liveness");
  const embedding = await portraits.embed(verdict.faceIndex);
  if (embedding.length !== 512) throw new Error(`Embedding sai số chiều: ${embedding.length}`);
  const portrait = await portraits.crop(verdict.faceIndex);
  // Mặt trực tiếp (khung nhìn thẳng) có phải người trên thẻ không — lệch thì giảng viên duyệt, KHÔNG từ chối.
  const liveSimilarity = cosine(liveEmbeddings[liveCheck.centerIndex], embedding);

  // Trùng mặt 1:N: chỉ so với thẻ hiệu lực của SV học CHUNG ít nhất một lớp (đang ghi danh) — FR-048, US6-6.
  const vec = `[${embedding.join(",")}]`;
  const res = await db.execute<{ student_id: string; similarity: number }>(sql`
    select sc.student_id, 1 - (sc.embedding <=> ${vec}::vector) as similarity
    from student_cards sc
    where sc.status in ('active', 'pending_review') and sc.embedding is not null and sc.student_id <> ${studentId}
      and sc.student_id in (
        select peer.student_id from enrollments mine
        join enrollments peer on peer.class_id = mine.class_id and peer.status = 'active'
        where mine.student_id = ${studentId} and mine.status = 'active')
    order by sc.embedding <=> ${vec}::vector
    limit 5`);
  const matches = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as { student_id: string; similarity: number }[];
  const dup = duplicateDecision(matches.map((m) => ({ studentId: m.student_id, similarity: Number(m.similarity) })), duplicateThreshold());

  const reviewReasons: CardReviewReason[] = [
    ...(dup ? (["DUPLICATE_FACE"] as const) : []),
    ...(liveSimilarity < liveMatchThreshold() ? (["LIVE_MISMATCH"] as const) : []),
    ...verdict.reviewReasons,
  ];
  const status = reviewReasons.length ? "pending_review" : "active";
  const cardId = randomUUID();
  const cardPath = `${studentId}/${cardId}/card.jpg`;
  const portraitPath = `${studentId}/${cardId}/portrait.jpg`;

  timer.mark("match");
  const uploaded: string[] = [];
  try {
    uploaded.push(await deps.storage.upload("cards", cardPath, jpeg, "image/jpeg"));
    uploaded.push(await deps.storage.upload("cards", portraitPath, portrait, "image/jpeg"));
    await db.transaction(async (tx) => {
      await tx.insert(studentCards).values({
        id: cardId,
        studentId,
        cardImagePath: cardPath,
        portraitImagePath: portraitPath,
        embedding,
        decodedCode: decoded!.code,
        decodeMethod: decoded!.method,
        status,
        reviewReasons,
        duplicateStudentId: dup?.studentId ?? null,
        duplicateSimilarity: dup?.similarity ?? null,
        nameMatched,
        liveSimilarity,
        // Chỉ lưu dòng họ tên OCR khi cần giảng viên đối chiếu (tối thiểu hoá dữ liệu)
        ocrName: reviewReasons.includes("NAME_MISMATCH") ? ocrNameLine(text) : null,
        purgeAfter: await cardPurgeAfter(tx, studentId),
      });
      await writeAudit(session, "card.register", { type: "student_card", id: cardId }, { status, method: decoded!.method, reviewReasons, liveSimilarity: Math.round(liveSimilarity * 1000) / 1000 }, tx);
    });
  } catch (e) {
    if (uploaded.length) await deps.storage.remove("cards", uploaded).catch((err) => log.error("card_cleanup_failed", { err: String(err) }));
    const err = e as { code?: string; cause?: { code?: string } };
    if (err?.code === "23505" || err?.cause?.code === "23505") {
      throw new HttpError(409, "CARD_ALREADY_REGISTERED", "Bạn đã đăng ký thẻ.");
    }
    throw e;
  }
  // Không trả lý do chờ duyệt cho SV (không lộ là mặt trùng với ai) — chỉ giảng viên xem (card/admin.ts).
  timer.mark("save");
  return { status, decodedCode: decoded!.code, ...debug(null) };
}

/** Trạng thái thẻ của chính SV — không trả embedding, đường dẫn ảnh hay lý do nghi vấn. */
/**
 * Trạng thái thẻ cho chính SV (không lý do, không ảnh). Không có thẻ hiệu lực → xem thẻ gần nhất:
 * `deleted` do giảng viên từ chối (có reviewed_by) → "rejected"; `replaced` (giảng viên/Admin đặt lại) → "reset".
 * Cả hai: SV đăng ký lại được. (Cron xoá hết hạn — Polish — phải không để lại `deleted` + reviewed_by.)
 */
export type MyCardStatus = "active" | "pending_review" | "rejected" | "reset";

export async function myCardStatus(studentId: string): Promise<{ status: MyCardStatus; registeredAt: Date } | null> {
  const db = await getDb();
  const [c] = await db
    .select({ status: studentCards.status, registeredAt: studentCards.registeredAt, reviewedBy: studentCards.reviewedBy })
    .from(studentCards)
    .where(eq(studentCards.studentId, studentId))
    .orderBy(sql`case when ${studentCards.status} in ('active','pending_review') then 0 else 1 end`, desc(studentCards.registeredAt))
    .limit(1);
  if (!c) return null;
  if (c.status === "active" || c.status === "pending_review") return { status: c.status, registeredAt: c.registeredAt };
  if (c.status === "deleted" && c.reviewedBy) return { status: "rejected", registeredAt: c.registeredAt };
  if (c.status === "replaced") return { status: "reset", registeredAt: c.registeredAt };
  return null;
}
