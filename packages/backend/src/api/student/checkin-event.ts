import { submitEvent } from "../../attendance/checkin";
import { readCheckinForm } from "../../card/form";
import { json, route } from "../../http/handler";
import { requireConsent } from "../../student/consent";

/**
 * POST /api/windows/{id}/events — multipart {nonce, frames×3, lat, lng, accuracyM, clientYaw?} → 200
 * {eventId, result, reason, message, serverTime, distanceM, attemptsLeft, lateMinutes, evidenceUrl} (T077, plan "Luồng quyết định").
 * Đồng ý điều khoản được kiểm TRƯỚC khi đọc body; độ dài body (≤ 4 MB) trước khi parse; nonce + vị trí trước khi xử lý ảnh (FR-082).
 * Lượt có kết luận luôn trả 200 (kể cả rejected/retry); 409 ALREADY_DONE không tạo lượt. Rate limit theo SV.
 */
export const POST = route<{ id: string }>({ roles: ["student"] }, async ({ req, session, params, ip }) => {
  await requireConsent(session!.sub);
  const form = await readCheckinForm(req);
  return json(await submitEvent(session!, params.id, form, { ip, userAgent: req.headers.get("user-agent") }));
});
