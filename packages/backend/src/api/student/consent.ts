import { z } from "zod";
import { giveConsent } from "../../student/consent";
import { route } from "../../http/handler";

/** POST /api/student/consent — {version} → 204. Lưu thời điểm + phiên bản văn bản đã đồng ý (FR-050). */
const Body = z.object({ version: z.string().min(1).max(32) }).strict();

export const POST = route({ roles: ["student"], body: Body, maxBodyBytes: 1_000 }, async ({ session, body }) => {
  await giveConsent(session!, body.version);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
});
