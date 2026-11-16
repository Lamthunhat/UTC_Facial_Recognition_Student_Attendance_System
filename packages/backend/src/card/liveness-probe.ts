import "server-only";
import { randomInt } from "node:crypto";
import type { SessionClaims } from "../auth/jwt";
import { isChallenge, type Challenge } from "../face/liveness";
import { parseClientYaw, yawDebugEnabled, yawDebugReport, type YawDebugReport } from "../face/yaw-debug";
import { notFound, tooManyRequests } from "../http/errors";
import { badNonce, consumeNonce, issueNonce } from "../security/nonce";
import { enforce, hit, RULES } from "../security/rate-limit";
import { requireConsent } from "../student/consent";
import { evaluateLiveFrames, sanitizeLiveFrames } from "./live";
import { cardDeps } from "./register";

/**
 * Thử liveness KHÔNG tốn lượt đăng ký thẻ — CHỈ preview/dev (yawDebugEnabled), production 404.
 * POST /api/student/liveness-probe/nonce → {nonce, expiresAt, challenge}
 * POST /api/student/liveness-probe {nonce, frames×3, clientYaw?} → 200 {passed, yawDebug}
 * Chạy ĐÚNG pipeline liveness của đăng ký thẻ (card/live.ts: sanitize → phân tích → thử thách quay đầu → cùng một
 * người) nhưng không cần ảnh thẻ; không lưu ảnh / embedding / dòng DB (ngoài nonce và bộ đếm), không ghi audit.
 * Lượt: bộ đếm RIÊNG 30/giờ/SV (RULES.livenessProbe) — không đụng 6/giờ + 20/giờ của đăng ký thẻ.
 * Đồng ý điều khoản vẫn bắt buộc (khung mặt là dữ liệu sinh trắc — Constitution IV).
 *
 * Nonce dùng purpose "card" (không cần migration enum cho công cụ chỉ ở preview) nhưng challenge bọc trong
 * {kind: "liveness_probe", challenge}: đăng ký thẻ chỉ nhận challenge dạng mảng → nonce probe bị 403 BAD_NONCE ở đó,
 * và ngược lại probe từ chối nonce thẻ.
 */
const PROBE_KIND = "liveness_probe";

export function assertProbeEnabled() {
  if (!yawDebugEnabled()) throw notFound();
}

/** Kiểm rẻ, chạy TRƯỚC khi đọc body: bật công cụ (404) → đồng ý điều khoản (403). */
export async function assertCanProbe(studentId: string) {
  assertProbeEnabled();
  await requireConsent(studentId);
}

export async function issueProbeNonce(session: SessionClaims) {
  await assertCanProbe(session.sub);
  await enforce(`probe-nonce:${session.sub}`, RULES.scanNonce);
  const challenge: Challenge = randomInt(2) === 0 ? ["left", "right"] : ["right", "left"];
  const n = await issueNonce(session.sub, "card", { challenge: { kind: PROBE_KIND, challenge } });
  return { nonce: n.nonce, expiresAt: n.expiresAt, challenge };
}

function probeChallenge(stored: unknown): Challenge | null {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  const s = stored as { kind?: unknown; challenge?: unknown };
  return s.kind === PROBE_KIND && isChallenge(s.challenge) ? s.challenge : null;
}

export async function runLivenessProbe(
  session: SessionClaims,
  input: { nonce: string; frames: Buffer[]; clientYaw?: string },
  ip: string | null,
): Promise<{ passed: boolean; yawDebug: YawDebugReport }> {
  await assertCanProbe(session.sub);
  const { challenge: stored } = await consumeNonce({ nonce: input.nonce, studentId: session.sub, purpose: "card", ip });
  const challenge = probeChallenge(stored);
  if (!challenge) throw badNonce();
  const used = await hit(`liveness-probe:${session.sub}`, RULES.livenessProbe);
  if (!used.allowed) throw tooManyRequests(used.retryAfterSec);

  const frames = await sanitizeLiveFrames(input.frames);
  const r = await evaluateLiveFrames(frames, challenge, cardDeps().analyzeLive);
  const yawDebug = yawDebugReport(r.faces, challenge, parseClientYaw(input.clientYaw), r.ok ? null : r.reason);
  return { passed: r.ok, yawDebug };
}
