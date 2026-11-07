import { clearSessionCookie, revokeSession } from "../../auth/session";
import { route } from "../../http/handler";

/** POST /api/auth/logout — thu hồi phiên hiện tại (nếu có) và xoá cookie. */
export const POST = route({}, async ({ session }) => {
  if (session) await revokeSession(session.sid);
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearSessionCookie(), "Cache-Control": "no-store" } });
});
