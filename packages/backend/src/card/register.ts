import "server-only";
import { randomInt, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@utc/database";
import { studentCards, students } from "@utc/database/schema";
import { vnDateOf } from "@utc/shared/periods";
import { writeAudit } from "../audit";
import type { SessionClaims } from "../auth/jwt";
import { removeObjects, signedUrl, uploadObject, type Bucket } from "../evidence/storage";
import { checkLiveFrames, isChallenge, LIVENESS_RULES, samePerson, type Challenge, type LiveFrameError } from "../face/liveness";
import { cosine } from "../face/similarity";
import { HttpError } from "../http/errors";
import { log } from "../log";
import { consumeNonce, issueNonce } from "../security/nonce";
import { enforce, RULES } from "../security/rate-limit";
import { sanitizeImage, UploadError } from "../security/upload";
import { requireConsent } from "../student/consent";
import { decodeCard } from "./decode";
import { analyzePortraits, type AnalyzedPortraits } from "./portrait";
import { cardPurgeAfter } from "./retention";
import { duplicateDecision, evaluateCard, nameAppearsIn, type CardRejectCode, type CardReviewReason, type DecodedCode } from "./verify";

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
  decode(jpeg: Buffer): Promise<{ decoded: DecodedCode | null; text: string }>;
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
export const LIVE_FRAME_MAX_BYTES = 1024 * 1024; // FR-090: mỗi khung mặt trực tiếp ≤ 1 MB
export const LIVE_FRAME_COUNT = 3;

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
  return { nonce: n.nonce, expiresAt: n.expiresAt, challenge };
}

function uploadErrorToHttp(e: UploadError) {
  return e.code === "FILE_TOO_LARGE"
    ? new HttpError(413, "PAYLOAD_TOO_LARGE", "Ảnh vượt quá 1 MB.")
    : new HttpError(422, e.code, e.code === "UNSUPPORTED_TYPE" ? "Ảnh không đúng định dạng (chỉ nhận JPEG/PNG/WebP/HEIC)." : "Không đọc được ảnh. Vui lòng chụp lại.");
}

export async function registerCard(
  session: SessionClaims,
  input: { nonce: string; image: Buffer; frames: Buffer[] },
  ip: string | null,
): Promise<{ status: "active" | "pending_review"; decodedCode: string }> {
  const studentId = session.sub;
  await assertCanRegisterCard(studentId);
  const { challenge } = await consumeNonce({ nonce: input.nonce, studentId, purpose: "card", ip });
  if (!isChallenge(challenge)) throw new HttpError(403, "BAD_NONCE", "Phiên chụp không hợp lệ. Vui lòng chụp lại.");
  await enforce(`card:${studentId}`, RULES.cardRegister);
  if (input.frames.length !== LIVE_FRAME_COUNT) {
    throw new HttpError(422, "VALIDATION_ERROR", "Cần đúng 3 khung hình khuôn mặt theo hướng dẫn.");
  }

  const allowed: ("image/jpeg" | "image/png" | "image/webp" | "image/heic")[] = ["image/jpeg", "image/png", "image/webp", "image/heic"];
  let jpeg: Buffer;
  let frames: Buffer[];
  try {
    jpeg = (await sanitizeImage(input.image, { maxBytes: CARD_IMAGE_MAX_BYTES, allowed, maxSide: 2048, quality: 90 })).buffer;
    frames = await Promise.all(
      input.frames.map(async (f) => (await sanitizeImage(f, { maxBytes: LIVE_FRAME_MAX_BYTES, allowed, maxSide: 1280, quality: 85 })).buffer),
    );
  } catch (e) {
    if (e instanceof UploadError) throw uploadErrorToHttp(e);
    throw e;
  }

  const db = await getDb();
  const [me] = await db
    .select({ code: students.studentCode, lastName: students.lastName, firstName: students.firstName })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  if (!me) throw new HttpError(401, "UNAUTHORIZED", "Bạn cần đăng nhập.");

  const [{ decoded, text }, portraits] = await Promise.all([deps.decode(jpeg), deps.analyzeFaces(jpeg)]);
  const nameMatched = text.trim() ? nameAppearsIn(text, `${me.lastName} ${me.firstName}`) : null;
  const verdict = evaluateCard({ sessionCode: me.code, decoded, faces: portraits.faces, nameMatched });
  if (!verdict.ok) throw new HttpError(422, verdict.error, REJECT_MESSAGES[verdict.error]);

  // Liveness (FR-045a): 3 khung mặt trực tiếp đúng thử thách quay đầu và cùng một người. Sai → từ chối.
  const live = await Promise.all(frames.map((f) => deps.analyzeLive(f)));
  const liveCheck = checkLiveFrames(
    live.map((l) => l.faces.filter((f) => f.kps).map((f) => ({ box: f.box, kps: f.kps! }))),
    challenge,
  );
  if (!liveCheck.ok) throw new HttpError(422, liveCheck.error, LIVE_MESSAGES[liveCheck.error]);
  const liveEmbeddings = await Promise.all(live.map((l) => l.embed(0)));
  if (!samePerson(liveEmbeddings, liveCheck.centerIndex, LIVENESS_RULES.samePersonMin)) {
    throw new HttpError(422, "LIVENESS_FAILED", LIVE_MESSAGES.LIVENESS_FAILED);
  }

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
  return { status, decodedCode: decoded!.code };
}

/** Trạng thái thẻ của chính SV — không trả embedding, đường dẫn ảnh hay lý do nghi vấn. */
export async function myCardStatus(studentId: string) {
  const db = await getDb();
  const [c] = await db
    .select({ status: studentCards.status, registeredAt: studentCards.registeredAt })
    .from(studentCards)
    .where(and(eq(studentCards.studentId, studentId), inArray(studentCards.status, ["active", "pending_review"])))
    .limit(1);
  return c ?? null;
}
