import { issueScanNonce } from "../../attendance/checkin";
import { json, route } from "../../http/handler";
import { requireConsent } from "../../student/consent";

/**
 * POST /api/windows/{id}/scan-nonce — → {nonce, challenge, expiresAt, scanSessionId, attemptsLeft, window} (T077).
 * Kiểm trước khi cấp: đồng ý điều khoản (403), thuộc lớp (403 NOT_ENROLLED), thẻ đã duyệt (412 CARD_REQUIRED /
 * CARD_PENDING_REVIEW), khung đang mở (410 WINDOW_CLOSED), đã check-in (403 NO_CHECKIN), chưa xong (409 ALREADY_DONE),
 * còn lượt (409 ATTEMPTS_EXHAUSTED); rate limit theo SV. Không trả vị trí GV (Constitution I).
 */
export const POST = route<{ id: string }>({ roles: ["student"] }, async ({ session, params }) => {
  await requireConsent(session!.sub);
  return json(await issueScanNonce(session!, params.id));
});
