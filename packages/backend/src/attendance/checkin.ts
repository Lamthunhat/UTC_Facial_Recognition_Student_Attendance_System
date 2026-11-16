import "server-only";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, type AppDb } from "@utc/database";
import { attendanceEvents, scanSessions } from "@utc/database/schema";
import { writeAudit } from "../audit";
import { isUuid } from "../auth/guards";
import type { SessionClaims } from "../auth/jwt";
import { evaluateLiveFrames, sanitizeLiveFrames } from "../card/live";
import { analyzePortraits, type AnalyzedPortraits } from "../card/portrait";
import { stepTimer } from "../card/step-timer";
import { now } from "../clock";
import { removeObjects, signedUrl, uploadObject, type Bucket } from "../evidence/storage";
import { stampEvidence } from "../evidence/stamp";
import { headYaw, isChallenge, type Challenge } from "../face/liveness";
import { cosine } from "../face/similarity";
import { parseClientYaw, yawDebugEnabled, yawDebugReport, type YawDebugReport } from "../face/yaw-debug";
import { assessLocation, parseGpsFix, type LocationAssessment } from "../geo/location-check";
import { reverseGeocode } from "../geo/reverse-geocode";
import { HttpError, notFound, tooManyRequests } from "../http/errors";
import { log } from "../log";
import { buildRecord, type RecordInput } from "../records/build";
import type { RecordFollowUp } from "../records/schema";
import { badNonce, consumeNonce, issueNonce } from "../security/nonce";
import { enforce, hit, RULES } from "../security/rate-limit";
import { attemptsLeft, Decision, MAX_REJECTED_ATTEMPTS, type DuplicateMatch, type FaceThresholds, type Verdict, type WindowType } from "./decide";
import { faceThresholds } from "./thresholds";
import { evidencePurgeAfter, isWindowOpen, lateMinutes, recordPurgeAfter } from "./window-times";

/**
 * T075/T077/T082/T083 (+ T086 trùng mặt, T099 so lượt check-in) — Lượt điểm danh của SV (plan.md "Luồng quyết định").
 *
 * POST /api/windows/{id}/scan-nonce: kiểm rẻ (khung, ghi danh, thẻ đã duyệt, đã check-in, chưa xong, còn lượt) → nonce
 *   dùng một lần + thử thách quay đầu ngẫu nhiên + phiên quét (scan_sessions, FR-111). Không trả tâm buổi.
 * POST /api/windows/{id}/events: nonce → rate limit theo SV → GPS (trước khi xử lý ảnh) → điều kiện khung → vị trí
 *   → 3 khung (liveness, cùng pipeline với đăng ký thẻ: card/live.ts) → so thẻ (2 ngưỡng) → so lượt check-in
 *   (check-out/đột xuất) → [đóng dấu + lưu ảnh] → transaction có khoá theo khung: trùng mặt mã khác → ghi lượt + hồ sơ,
 *   chuyển các lượt liên quan sang nghi vấn, audit.
 * - MỌI lượt có kết luận (kể cả dừng sớm, thử lại) đều ghi một dòng + hồ sơ attendance-record.v1 (Constitution III);
 *   riêng "đã điểm danh" → 409, không tạo lượt mới (US2-9).
 * - Ảnh bằng chứng (khung nhìn thẳng, đã đóng dấu) + vector CHỈ lưu với lượt hợp lệ/nghi vấn, SAU khi qua mọi kiểm tra;
 *   khung liveness không bao giờ lưu (FR-051). Xoá sau 7 ngày (purge_after); hồ sơ giữ tới hết lớp + 30 ngày.
 * - Nghi vấn KHÔNG tự từ chối: GV quyết (Constitution III). SV không thấy lý do nghi vấn (như đăng ký thẻ).
 */

export interface CheckinDeps {
  analyzeLive(jpeg: Buffer): Promise<AnalyzedPortraits>;
  storage: {
    upload(bucket: Bucket, path: string, body: Buffer, contentType: string): Promise<string>;
    remove(bucket: Bucket, paths: string[]): Promise<void>;
    signedUrl(bucket: Bucket, path: string): Promise<string>;
  };
  reverseGeocode(lat: number, lng: number): Promise<string | null>;
}
const realDeps: CheckinDeps = {
  analyzeLive: analyzePortraits,
  storage: { upload: uploadObject, remove: removeObjects, signedUrl: (b, p) => signedUrl(b, p) },
  reverseGeocode,
};
let deps: CheckinDeps = realDeps;
export function setCheckinDepsForTest(d: CheckinDeps) {
  if (process.env.NODE_ENV === "production") throw new Error("setCheckinDepsForTest chỉ dùng trong test");
  deps = d;
}
export function resetCheckinDepsForTest() {
  deps = realDeps;
}

const rowsOf = <T>(res: unknown): T[] => (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as T[];
const WINDOW_LABEL: Record<WindowType, string> = { check_in: "Check-in", check_out: "Check-out", spot_check: "Kiểm tra đột xuất" };

// ---------- ngữ cảnh khung ----------
interface WindowCtx {
  windowId: string;
  type: WindowType;
  opensAt: Date;
  closesAt: Date;
  closedEarlyAt: Date | null;
  radiusM: number;
  sessionId: string;
  room: string;
  centerLat: number | null;
  centerLng: number | null;
  checkoutSkipped: boolean;
  classCode: string;
  courseName: string;
  classEnd: string;
  checkinOpensAt: Date | null;
  enrolled: boolean;
  studentCode: string;
  card: { status: "active" | "pending_review"; embedding: string } | null;
}

async function loadCtx(db: AppDb, windowId: string, studentId: string): Promise<WindowCtx | null> {
  const res = await db.execute(sql`
    select w.id as window_id, w.type, w.opens_at, w.closes_at, w.closed_early_at, w.radius_m,
           s.id as session_id, s.room, s.center_lat, s.center_lng, s.checkout_skipped,
           c.code as class_code, c.course_name, c.end_date::text as class_end,
           (select ci.opens_at from attendance_windows ci where ci.session_id = s.id and ci.type = 'check_in' order by ci.opens_at limit 1) as checkin_opens_at,
           exists (select 1 from enrollments e where e.class_id = c.id and e.student_id = ${studentId} and e.status = 'active') as enrolled,
           (select st.student_code from students st where st.id = ${studentId}) as student_code,
           (select sc.status from student_cards sc where sc.student_id = ${studentId} and sc.status in ('active','pending_review')
             order by sc.status = 'active' desc limit 1) as card_status,
           (select sc.embedding::text from student_cards sc where sc.student_id = ${studentId} and sc.status = 'active' limit 1) as card_embedding
    from attendance_windows w join sessions s on s.id = w.session_id join classes c on c.id = s.class_id
    where w.id = ${windowId}`);
  const [r] = rowsOf<Record<string, unknown>>(res);
  if (!r) return null;
  const d = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string));
  return {
    windowId: r.window_id as string,
    type: r.type as WindowType,
    opensAt: d(r.opens_at)!,
    closesAt: d(r.closes_at)!,
    closedEarlyAt: d(r.closed_early_at),
    radiusM: Number(r.radius_m),
    sessionId: r.session_id as string,
    room: r.room as string,
    centerLat: r.center_lat === null ? null : Number(r.center_lat),
    centerLng: r.center_lng === null ? null : Number(r.center_lng),
    checkoutSkipped: Boolean(r.checkout_skipped),
    classCode: r.class_code as string,
    courseName: r.course_name as string,
    classEnd: r.class_end as string,
    checkinOpensAt: d(r.checkin_opens_at),
    enrolled: Boolean(r.enrolled),
    studentCode: r.student_code as string,
    card:
      r.card_status === "active" && r.card_embedding
        ? { status: "active", embedding: r.card_embedding as string }
        : r.card_status === "pending_review"
          ? { status: "pending_review", embedding: "" }
          : null,
  };
}

/** Lượt của chính SV trong khung + lượt check-in hợp lệ/nghi vấn của buổi (cho check-out/đột xuất). */
async function loadHistory(db: AppDb, ctx: WindowCtx, studentId: string) {
  const res = await db.execute(sql`
    select
      exists (select 1 from attendance_events where window_id = ${ctx.windowId} and student_id = ${studentId} and result in ('valid','suspect')) as done,
      (select count(*)::int from attendance_events where window_id = ${ctx.windowId} and student_id = ${studentId} and result = 'rejected'
         and reason in ('out_of_range','liveness_failed','card_mismatch')) as rejected,
      (select json_build_object('lat', lat, 'lng', lng, 'accuracyM', accuracy_m, 'at', server_time) from attendance_events
         where window_id = ${ctx.windowId} and student_id = ${studentId} and lat is not null order by server_time desc limit 1) as prior,
      (select e.id from attendance_events e join attendance_windows w on w.id = e.window_id
         where w.session_id = ${ctx.sessionId} and w.type = 'check_in' and e.student_id = ${studentId} and e.result in ('valid','suspect')
         order by e.server_time limit 1) as checkin_event`);
  const [r] = rowsOf<{ done: boolean; rejected: number; prior: { lat: number; lng: number; accuracyM: number; at: string } | string | null; checkin_event: string | null }>(res);
  const prior = typeof r.prior === "string" ? JSON.parse(r.prior) : r.prior;
  return {
    alreadyDone: Boolean(r.done),
    rejectedCount: Number(r.rejected),
    prior: prior && prior.lat !== null ? { lat: Number(prior.lat), lng: Number(prior.lng), accuracyM: Number(prior.accuracyM), at: new Date(prior.at) } : null,
    checkinEventId: r.checkin_event,
  };
}

// ---------- POST /api/windows/{id}/scan-nonce ----------
export async function issueScanNonce(session: SessionClaims, windowId: string) {
  const studentId = session.sub;
  if (!isUuid(windowId)) throw notFound();
  const db = await getDb();
  const ctx = await loadCtx(db, windowId, studentId);
  if (!ctx) throw notFound();
  if (!ctx.enrolled) throw new HttpError(403, "NOT_ENROLLED", "Bạn không có trong danh sách lớp này.");
  if (!ctx.card) throw new HttpError(412, "CARD_REQUIRED", "Bạn cần đăng ký thẻ sinh viên trước khi điểm danh.");
  if (ctx.card.status === "pending_review") {
    throw new HttpError(412, "CARD_PENDING_REVIEW", "Thẻ sinh viên của bạn đang chờ giảng viên duyệt — chưa điểm danh được. Liên hệ giảng viên nếu cần gấp.");
  }
  const at = now();
  if ((ctx.type === "check_out" && ctx.checkoutSkipped) || !isWindowOpen(ctx, at)) {
    throw new HttpError(410, "WINDOW_CLOSED", at < ctx.opensAt ? "Khung điểm danh chưa mở." : "Hết giờ điểm danh.");
  }
  const h = await loadHistory(db, ctx, studentId);
  if (ctx.type !== "check_in" && !h.checkinEventId) throw new HttpError(403, "NO_CHECKIN", "Bạn chưa check-in hợp lệ trong buổi này.");
  if (h.alreadyDone) throw new HttpError(409, "ALREADY_DONE", "Bạn đã điểm danh trong khung này.");
  if (h.rejectedCount >= MAX_REJECTED_ATTEMPTS) {
    throw new HttpError(409, "ATTEMPTS_EXHAUSTED", "Bạn đã hết lượt thử trong khung này. Liên hệ giảng viên nếu có nhầm lẫn.");
  }
  await enforce(`checkin-nonce:${studentId}`, RULES.scanNonce);
  const challenge: Challenge = randomInt(2) === 0 ? ["left", "right"] : ["right", "left"];
  const n = await issueNonce(studentId, "checkin", { windowId, challenge });
  await db.insert(scanSessions).values({ id: n.nonce, windowId, studentId, issuedAt: at, recordPurgeAfter: recordPurgeAfter(ctx.classEnd) });
  return {
    nonce: n.nonce,
    expiresAt: n.expiresAt,
    challenge,
    scanSessionId: n.nonce,
    attemptsLeft: attemptsLeft(h.rejectedCount),
    window: { id: windowId, type: ctx.type, closesAt: (ctx.closedEarlyAt ?? ctx.closesAt).toISOString(), classCode: ctx.classCode, courseName: ctx.courseName, room: ctx.room },
    ...(yawDebugEnabled() ? { yawDebug: true as const } : {}),
  };
}

// ---------- POST /api/windows/{id}/events ----------
export interface EventInput {
  nonce: string;
  frames: Buffer[];
  lat: unknown;
  lng: unknown;
  accuracyM: unknown;
  clientYaw?: string;
}
export interface EventResponse {
  eventId: string;
  result: Verdict["result"];
  /** null khi nghi vấn — SV không thấy lý do (GV xem trong hồ sơ). */
  reason: Verdict["reason"] | null;
  message: string;
  serverTime: string;
  distanceM: number | null;
  attemptsLeft: number;
  lateMinutes: number | null;
  evidenceUrl: string | null;
  yawDebug?: YawDebugReport;
}

const MESSAGES: Partial<Record<Verdict["reason"], string>> = {
  ok: "Điểm danh hợp lệ.",
  out_of_range: "Bạn đang ở ngoài phạm vi lớp học.",
  low_accuracy: "Vị trí chưa đủ chính xác. Hãy ra gần cửa sổ / bật định vị chính xác rồi thử lại (không tính lượt).",
  no_face: "Không thấy khuôn mặt. Giữ mặt trong khung, đủ sáng rồi chụp lại (không tính lượt).",
  multiple_faces: "Có nhiều hơn một người trong khung hình. Chỉ một mình bạn trước camera (không tính lượt).",
  liveness_failed: "Chưa xác nhận được người thật: hãy làm đúng hướng dẫn quay đầu.",
  card_mismatch: "Khuôn mặt không khớp ảnh trên thẻ sinh viên đã đăng ký.",
  window_closed: "Hết giờ điểm danh.",
  not_enrolled: "Bạn không có trong danh sách lớp này.",
  no_checkin: "Bạn chưa check-in hợp lệ trong buổi này.",
  attempts_exhausted: "Bạn đã hết lượt thử trong khung này.",
};
const SUSPECT_MESSAGE = "Đã ghi nhận lượt điểm danh — cần giảng viên xem lại.";

const faceSide = (b: { x1: number; y1: number; x2: number; y2: number }) => Math.min(b.x2 - b.x1, b.y2 - b.y1);
const vecLiteral = (v: number[]) => `[${v.join(",")}]`;
const parseVec = (s: string) => s.slice(1, -1).split(",").map(Number);

export async function submitEvent(
  session: SessionClaims,
  windowId: string,
  input: EventInput,
  meta: { ip: string | null; userAgent: string | null },
): Promise<EventResponse> {
  const studentId = session.sub;
  const timer = stepTimer();
  if (!isUuid(windowId)) throw notFound();
  // 1. nonce (dùng một lần, đúng SV + đúng khung) — trước mọi thao tác nặng (FR-082)
  const { challenge: stored } = await consumeNonce({ nonce: input.nonce, studentId, purpose: "checkin", windowId, ip: meta.ip });
  if (!isChallenge(stored)) throw badNonce();
  const challenge = stored;
  const used = await hit(`checkin:${studentId}`, RULES.checkinSubmit);
  if (!used.allowed) throw tooManyRequests(used.retryAfterSec);
  const fix = parseGpsFix({ lat: input.lat, lng: input.lng, accuracyM: input.accuracyM });
  if (!fix) throw new HttpError(422, "VALIDATION_ERROR", "Vị trí gửi lên không hợp lệ. Bật định vị rồi thử lại.");
  timer.mark("nonce");

  const db = await getDb();
  const ctx = await loadCtx(db, windowId, studentId);
  if (!ctx) throw notFound();
  if (!ctx.card || ctx.card.status !== "active") throw new HttpError(412, "CARD_REQUIRED", "Bạn cần thẻ sinh viên đã được duyệt để điểm danh.");
  const h = await loadHistory(db, ctx, studentId);
  const T = faceThresholds();
  const d = new Decision();
  const base = {
    db,
    ctx,
    studentId,
    scanSession: input.nonce,
    attempt: Math.min(h.rejectedCount + 1, 10),
    rejectedCount: h.rejectedCount,
    meta,
    thresholds: T,
    challenge,
  };
  timer.mark("load");

  // 2. điều kiện khung / ghi danh / đã check-in / lượt
  const at = now();
  if (
    d.preconditions({
      windowType: ctx.type,
      windowOpen: isWindowOpen(ctx, at),
      enrolled: ctx.enrolled,
      hasCheckin: h.checkinEventId !== null,
      checkoutSkipped: ctx.checkoutSkipped,
      alreadyDone: h.alreadyDone,
      rejectedCount: h.rejectedCount,
    })
  ) {
    const v = d.verdict();
    if (v.reason === "already_done") throw new HttpError(409, "ALREADY_DONE", "Bạn đã điểm danh trong khung này.");
    return finish(base, v, { timer });
  }

  // 3. GPS — trước khi xử lý ảnh (không tốn CPU nhận diện cho lượt ở xa / sai số lớn)
  if (ctx.centerLat === null || ctx.centerLng === null) throw new HttpError(409, "CHECKIN_NOT_OPENED", "Buổi học chưa mở điểm danh.");
  const loc = assessLocation(fix, { lat: ctx.centerLat, lng: ctx.centerLng }, ctx.radiusM, { now: at, prior: h.prior });
  const locRec = { fix, loc };
  if (d.location(loc)) return finish(base, d.verdict(), { timer, locRec });
  timer.mark("gps");
  const addressP = deps.reverseGeocode(fix.lat, fix.lng).catch(() => null); // song song với nhận diện

  // 4. ảnh: sanitize (bỏ EXIF) → liveness 3 khung theo thử thách (cùng pipeline với đăng ký thẻ)
  const frames = await sanitizeLiveFrames(input.frames);
  timer.mark("sanitize");
  const live = await evaluateLiveFrames(frames, challenge, deps.analyzeLive);
  timer.mark("liveness");
  const debugOn = yawDebugEnabled();
  const yawDebug = debugOn
    ? yawDebugReport(live.faces, challenge, parseClientYaw(input.clientYaw), live.ok ? null : live.reason)
    : undefined;
  const yaws = live.faces.map((fs) => (fs.length === 1 ? headYaw(fs[0].kps, fs[0].box) : null));
  const liveRec = { live, yaws };
  if (d.liveness(live.ok ? { ok: true } : { ok: false, error: live.error })) return finish(base, d.verdict(), { timer, locRec, liveRec, yawDebug });
  if (!live.ok) throw new Error("unreachable");

  // 5. so với chân dung thẻ (2 ngưỡng)
  const center = live.embeddings[live.centerIndex];
  const cardSim = cosine(center, parseVec(ctx.card.embedding));
  // 6. check-out / đột xuất: so với lượt check-in hợp lệ của chính mã (FR-043)
  let checkinSim: number | null = null;
  if (ctx.type !== "check_in" && h.checkinEventId) {
    const r = rowsOf<{ sim: number | null }>(
      await db.execute(sql`select 1 - (embedding <=> ${vecLiteral(center)}::vector) as sim from attendance_events where id = ${h.checkinEventId} and embedding is not null`),
    );
    checkinSim = r[0]?.sim === undefined || r[0]?.sim === null ? null : Number(r[0].sim);
  }
  const matchRec = { cardSim, checkinSim };
  if (d.card(cardSim, T) || d.checkin(ctx.type, checkinSim, T)) return finish(base, d.verdict(), { timer, locRec, liveRec, matchRec, yawDebug });
  timer.mark("match");

  // 7–8. đã qua mọi kiểm tra có thể từ chối → đóng dấu + lưu ảnh (trước transaction để không giữ khoá khung khi upload)
  const eventId = randomUUID();
  const address = await addressP;
  timer.mark("geocode_wait");
  const stamped = await stampEvidence(frames[live.centerIndex], {
    serverTime: at,
    address,
    lat: fix.lat,
    lng: fix.lng,
    classCode: ctx.classCode,
    room: ctx.room,
    windowLabel: WINDOW_LABEL[ctx.type],
  });
  const evidencePath = `${ctx.sessionId}/${ctx.windowId}/${eventId}.jpg`;
  await deps.storage.upload("evidence", evidencePath, stamped, "image/jpeg");
  timer.mark("stamp_upload");
  try {
    return await finish(base, null, {
      timer,
      locRec,
      liveRec,
      matchRec,
      yawDebug,
      stored: { eventId, center, address, evidencePath, sha256: createHash("sha256").update(input.frames[live.centerIndex]).digest("hex"), decision: d },
    });
  } catch (e) {
    await deps.storage.remove("evidence", [evidencePath]).catch((err) => log.error("evidence_cleanup_failed", { err: String(err) }));
    const err = e as { code?: string; cause?: { code?: string } };
    if (err?.code === "23505" || err?.cause?.code === "23505") throw new HttpError(409, "ALREADY_DONE", "Bạn đã điểm danh trong khung này.");
    throw e;
  }
}

interface FinishParts {
  timer: ReturnType<typeof stepTimer>;
  locRec?: { fix: { lat: number; lng: number; accuracyM: number }; loc: LocationAssessment };
  liveRec?: { live: Awaited<ReturnType<typeof evaluateLiveFrames>>; yaws: (number | null)[] };
  matchRec?: { cardSim: number; checkinSim: number | null };
  yawDebug?: YawDebugReport;
  /** Có khi lượt đã qua mọi kiểm tra có thể từ chối: ảnh đã lưu, còn bước trùng mặt trong transaction. */
  stored?: { eventId: string; center: number[]; address: string | null; evidencePath: string; sha256: string; decision: Decision };
}
interface FinishBase {
  db: AppDb;
  ctx: WindowCtx;
  studentId: string;
  scanSession: string;
  attempt: number;
  rejectedCount: number;
  meta: { ip: string | null; userAgent: string | null };
  thresholds: FaceThresholds;
  challenge: Challenge;
}

/** Ghi lượt + hồ sơ (một transaction, khoá theo khung khi có bước trùng mặt) và dựng phản hồi cho SV. */
async function finish(b: FinishBase, early: Verdict | null, p: FinishParts): Promise<EventResponse> {
  const { db, ctx } = b;
  const serverTime = now();
  const stored = p.stored;
  const result = await db.transaction(async (tx) => {
    let verdict = early!;
    let maxOther: { similarity: number; studentCode: string } | null = null;
    if (stored) {
      // Khoá theo khung: hai lượt trùng mặt gửi đồng thời không thể cùng "lọt" (plan bước 7, T086)
      await tx.execute(sql`select id from attendance_windows where id = ${ctx.windowId} for update`);
      const matches = rowsOf<{ id: string; student_code: string; similarity: number }>(
        await tx.execute(sql`
          select e.id, s.student_code, 1 - (e.embedding <=> ${vecLiteral(stored.center)}::vector) as similarity
          from attendance_events e join students s on s.id = e.student_id
          where e.window_id = ${ctx.windowId} and e.student_id <> ${b.studentId} and e.result in ('valid','suspect') and e.embedding is not null
          order by e.embedding <=> ${vecLiteral(stored.center)}::vector limit 5`),
      ).map<DuplicateMatch>((m) => ({ eventId: m.id, studentCode: m.student_code, similarity: Number(m.similarity) }));
      maxOther = matches[0] ? { similarity: Math.min(1, matches[0].similarity), studentCode: matches[0].studentCode } : null;
      stored.decision.duplicates(matches, b.thresholds);
      stored.decision.gpsAnomalies(p.locRec!.loc.anomalies);
      verdict = stored.decision.verdict();
    }
    const eventId = stored?.eventId ?? randomUUID();
    const keep = stored !== undefined; // hợp lệ / nghi vấn: lưu ảnh + vector
    const live = p.liveRec?.live;
    const recordInput: RecordInput = {
      ids: { session: ctx.sessionId, window: ctx.windowId, windowType: ctx.type, studentCode: ctx.studentCode, attempt: b.attempt, scanSession: b.scanSession },
      serverTime,
      userAgent: b.meta.userAgent,
      ip: b.meta.ip,
      location: p.locRec
        ? {
            ...p.locRec.fix,
            distanceM: p.locRec.loc.distanceM,
            radiusM: ctx.radiusM,
            address: stored?.address ?? null,
            room: ctx.room,
            anomalies: p.locRec.loc.anomalies,
          }
        : null,
      liveness: live
        ? {
            challenge: b.challenge,
            measuredYaw: p.liveRec!.yaws,
            passed: live.ok,
            sameFace: live.ok ? Math.min(...live.embeddings.filter((_, i) => i !== live.centerIndex).map((e) => cosine(e, live.embeddings[live.centerIndex]))) : null,
          }
        : null,
      image: live
        ? {
            facesDetected: live.faces.map((f) => f.length),
            faceBoxPx: live.ok ? faceSide(live.faces[live.centerIndex][0].box) : null,
            sharpness: null,
            frontalYaw: live.ok ? p.liveRec!.yaws[live.centerIndex] : null,
            sha256: stored?.sha256 ?? null,
          }
        : null,
      matching: p.matchRec ? { card: p.matchRec.cardSim, checkin: p.matchRec.checkinSim, maxOther } : null,
      thresholds: b.thresholds,
      verdict,
      evidence: { imageStored: keep, imagePurgeAfter: keep ? evidencePurgeAfter(serverTime) : null },
    };
    const record = buildRecord(recordInput);
    const late =
      ctx.type === "check_in" && (verdict.result === "valid" || verdict.result === "suspect") && ctx.checkinOpensAt ? lateMinutes(serverTime, ctx.checkinOpensAt) : null;
    await tx.insert(attendanceEvents).values({
      id: eventId,
      windowId: ctx.windowId,
      studentId: b.studentId,
      attemptNo: b.attempt,
      serverTime,
      lat: p.locRec?.fix.lat ?? null,
      lng: p.locRec?.fix.lng ?? null,
      accuracyM: p.locRec?.fix.accuracyM ?? null,
      distanceM: p.locRec?.loc.distanceM ?? null,
      cardSimilarity: p.matchRec?.cardSim ?? null,
      checkinSimilarity: p.matchRec?.checkinSim ?? null,
      duplicateOf: verdict.duplicateOf.length ? verdict.duplicateOf : null,
      livenessPassed: live ? live.ok : null,
      embedding: keep ? stored.center : null,
      evidencePath: keep ? stored.evidencePath : null,
      addressText: stored?.address ?? null,
      result: verdict.result,
      reason: verdict.reason,
      lateMinutes: late,
      imageSha256: stored?.sha256 ?? null,
      record,
      purgeAfter: evidencePurgeAfter(serverTime),
      recordPurgeAfter: recordPurgeAfter(ctx.classEnd),
    });
    // Lượt liên quan → nghi vấn (valid → suspect; đã nghi vấn thì giữ lý do cũ), ghi followUp vào hồ sơ + audit
    const flag = async (otherId: string, reason: "duplicate_face" | "checkin_mismatch", similarity: number) => {
      const followUp: RecordFollowUp = {
        at: serverTime.toISOString(),
        reason,
        byEvent: eventId,
        byStudentCode: ctx.studentCode,
        similarity: Math.round(Math.max(-1, Math.min(1, similarity)) * 1000) / 1000,
      };
      await tx.execute(sql`
        update attendance_events set
          reason = case when result = 'valid' then ${reason}::event_reason else reason end,
          result = case when result = 'valid' then 'suspect'::event_result else result end,
          duplicate_of = case when ${reason} = 'duplicate_face' then array_append(coalesce(duplicate_of, '{}'), ${eventId}::uuid) else duplicate_of end,
          record = jsonb_set(record, '{followUps}', coalesce(record->'followUps', '[]'::jsonb) || ${JSON.stringify([followUp])}::jsonb)
        where id = ${otherId}`);
      await writeAudit(
        null,
        reason === "duplicate_face" ? "attendance.flag_duplicate" : "attendance.flag_checkin_mismatch",
        { type: "attendance_event", id: otherId },
        { byEvent: eventId, similarity: followUp.similarity },
        tx,
      );
    };
    if (stored) {
      const sims = new Map<string, number>();
      for (const id of verdict.duplicateOf) {
        const r = rowsOf<{ s: number }>(await tx.execute(sql`select 1 - (embedding <=> ${vecLiteral(stored.center)}::vector) as s from attendance_events where id = ${id}`));
        sims.set(id, Number(r[0]?.s ?? 0));
      }
      for (const id of verdict.duplicateOf) await flag(id, "duplicate_face", sims.get(id)!);
      if (verdict.flags.includes("checkin_mismatch") && ctx.type !== "check_in") {
        const [ci] = rowsOf<{ id: string }>(
          await tx.execute(sql`
            select e.id from attendance_events e join attendance_windows w on w.id = e.window_id
            where w.session_id = ${ctx.sessionId} and w.type = 'check_in' and e.student_id = ${b.studentId} and e.result in ('valid','suspect')
            order by e.server_time limit 1`),
        );
        if (ci) await flag(ci.id, "checkin_mismatch", p.matchRec!.checkinSim!);
      }
    }
    return { eventId, verdict, late };
  });
  const v = result.verdict;
  const rejectedAfter = b.rejectedCount + (v.countsAsAttempt ? 1 : 0);
  let evidenceUrl: string | null = null;
  if (stored) evidenceUrl = await deps.storage.signedUrl("evidence", stored.evidencePath).catch(() => null);
  p.timer.mark("db");
  log.info("checkin_timing", { ms: p.timer.done(), type: ctx.type, result: v.result });
  return {
    eventId: result.eventId,
    result: v.result,
    reason: v.result === "suspect" ? null : v.reason,
    message: v.result === "suspect" ? SUSPECT_MESSAGE : (MESSAGES[v.reason] ?? "Đã ghi nhận."),
    serverTime: serverTime.toISOString(),
    distanceM: p.locRec ? Math.round(p.locRec.loc.distanceM * 10) / 10 : null,
    attemptsLeft: attemptsLeft(rejectedAfter),
    lateMinutes: result.late,
    evidenceUrl,
    ...(p.yawDebug ? { yawDebug: p.yawDebug } : {}),
  };
}

// ---------- POST /api/scan-sessions/{id}/client-error (T083) ----------
export const CLIENT_ERROR_CODES = ["camera_denied", "geo_denied", "network", "timeout", "camera_unavailable", "model_failed"] as const;
const MAX_CLIENT_ERRORS = 20;

export async function recordClientError(session: SessionClaims, scanSessionId: string, input: { code: (typeof CLIENT_ERROR_CODES)[number]; detail?: string }) {
  if (!isUuid(scanSessionId)) throw notFound();
  await enforce(`client-error:${session.sub}`, RULES.clientError);
  const db = await getDb();
  const entry = { at: now().toISOString(), code: input.code, ...(input.detail ? { detail: input.detail } : {}) };
  const res = await db.execute(sql`
    update scan_sessions set client_errors = case when jsonb_array_length(client_errors) < ${MAX_CLIENT_ERRORS}
      then client_errors || ${JSON.stringify([entry])}::jsonb else client_errors end
    where id = ${scanSessionId} and student_id = ${session.sub} returning id`);
  if (rowsOf(res).length === 0) throw notFound();
}

// ---------- lớp đang mở cho SV (GET /api/student/classes) ----------
export interface OpenWindowView {
  id: string;
  type: WindowType;
  closesAt: string;
  done: boolean;
}

/** Khung đang mở của mỗi lớp (check-in ưu tiên, rồi đột xuất, rồi check-out); khung check-out/đột xuất chỉ hiện khi SV đã check-in. */
export async function openWindowsFor(studentId: string, classIds: string[]): Promise<Map<string, OpenWindowView>> {
  const out = new Map<string, OpenWindowView>();
  if (!classIds.length) return out;
  const db = await getDb();
  const at = now();
  const rows = rowsOf<{ class_id: string; id: string; type: WindowType; closes_at: string; checkout_skipped: boolean; done: boolean; checked_in: boolean }>(
    await db.execute(sql`
      select s.class_id, w.id, w.type, coalesce(w.closed_early_at, w.closes_at) as closes_at, s.checkout_skipped,
        exists (select 1 from attendance_events e where e.window_id = w.id and e.student_id = ${studentId} and e.result in ('valid','suspect')) as done,
        exists (select 1 from attendance_events e join attendance_windows ci on ci.id = e.window_id
                where ci.session_id = s.id and ci.type = 'check_in' and e.student_id = ${studentId} and e.result in ('valid','suspect')) as checked_in
      from attendance_windows w join sessions s on s.id = w.session_id
      where s.class_id in (${sql.join(classIds.map((c) => sql`${c}::uuid`), sql`, `)})
        and w.opens_at <= ${at.toISOString()}::timestamptz and coalesce(w.closed_early_at, w.closes_at) > ${at.toISOString()}::timestamptz
      order by case w.type when 'check_in' then 0 when 'spot_check' then 1 else 2 end`),
  );
  for (const r of rows) {
    if (out.has(r.class_id)) continue;
    if (r.type !== "check_in" && (!r.checked_in || (r.type === "check_out" && r.checkout_skipped))) continue;
    out.set(r.class_id, { id: r.id, type: r.type, closesAt: new Date(r.closes_at).toISOString(), done: Boolean(r.done) });
  }
  return out;
}


/** Bộ đổi toạ độ → địa chỉ đang dùng (thật hoặc bản giả của test) — cho API /api/geo/reverse. */
export const checkinGeocoder = () => deps.reverseGeocode;
