import { readLiveForm } from "../../card/form";
import { assertCanProbe, runLivenessProbe } from "../../card/liveness-probe";
import { json, route } from "../../http/handler";

/**
 * POST /api/student/liveness-probe — CHỈ preview/dev (production 404). multipart {nonce, frames×3, clientYaw?}
 * → 200 {passed, yawDebug}. Thử liveness không tốn lượt đăng ký thẻ (bộ đếm riêng 30/giờ/SV), không lưu gì.
 * Bật công cụ + đồng ý điều khoản được kiểm TRƯỚC khi đọc body. Xem card/liveness-probe.ts.
 */
export const POST = route({ roles: ["student"] }, async ({ req, session, ip }) => {
  await assertCanProbe(session!.sub);
  const form = await readLiveForm(req);
  return json(await runLivenessProbe(session!, form, ip));
});
