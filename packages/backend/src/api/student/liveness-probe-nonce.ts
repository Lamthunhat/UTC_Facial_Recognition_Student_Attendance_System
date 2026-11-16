import { issueProbeNonce } from "../../card/liveness-probe";
import { json, route } from "../../http/handler";

/**
 * POST /api/student/liveness-probe/nonce — CHỈ preview/dev (production 404). → {nonce, expiresAt, challenge}.
 * Cần đã đồng ý điều khoản; không cần thuộc lớp hay chưa có thẻ. Rate limit 6/phút/SV. Xem card/liveness-probe.ts.
 */
export const POST = route({ roles: ["student"] }, async ({ session }) => json(await issueProbeNonce(session!)));
