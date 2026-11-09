import { issueCardNonce } from "../../card/register";
import { json, route } from "../../http/handler";

/**
 * POST /api/student/card/nonce — → {nonce, expiresAt} (hạn 2 phút, dùng một lần).
 * Từ chối trước khi cấp: chưa đồng ý (403 CONSENT_REQUIRED), không thuộc lớp đang hoạt động (403 NOT_ENROLLED),
 * đã có thẻ (409). Rate limit 6/phút/SV.
 */
export const POST = route({ roles: ["student"] }, async ({ session }) => {
  return json(await issueCardNonce(session!));
});
