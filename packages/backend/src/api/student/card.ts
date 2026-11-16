import { readCardForm } from "../../card/form";
import { myCardStatus, registerCard } from "../../card/register";
import { requireConsent } from "../../student/consent";
import { json, route } from "../../http/handler";

/**
 * GET  /api/student/card — trạng thái thẻ của chính SV (không có ảnh / embedding / lý do nghi vấn). Cần đã đồng ý.
 * POST /api/student/card — multipart {nonce, image} → 201 {status: 'active'|'pending_review', decodedCode}.
 *   Đồng ý điều khoản được kiểm TRƯỚC khi đọc body; nonce trước khi xử lý ảnh (FR-082).
 *   422 CODE_MISMATCH / UNREADABLE / NO_PORTRAIT / MULTIPLE_FACES / UNSUPPORTED_TYPE; 413 ảnh > 1 MB.
 *   Preview/dev: nhận thêm `clientYaw`, trả `yawDebug` (so sánh yaw client ↔ server) — face/yaw-debug.ts; production không.
 */
export const GET = route({ roles: ["student"] }, async ({ session }) => {
  await requireConsent(session!.sub);
  return json({ card: await myCardStatus(session!.sub) });
});

export const POST = route({ roles: ["student"] }, async ({ req, session, ip }) => {
  await requireConsent(session!.sub);
  const form = await readCardForm(req);
  return json(await registerCard(session!, form, ip), { status: 201 });
});
