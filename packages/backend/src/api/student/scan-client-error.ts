import { z } from "zod";
import { CLIENT_ERROR_CODES, recordClientError } from "../../attendance/checkin";
import { HttpError } from "../../http/errors";
import { route } from "../../http/handler";
import { requireConsent } from "../../student/consent";

/**
 * POST /api/scan-sessions/{id}/client-error — {code, detail?}: lỗi camera/vị trí/mạng của thiết bị vào phiên quét của
 * CHÍNH SV (T083, FR-111) → 204. Đồng ý điều khoản kiểm TRƯỚC khi đọc body (nên không khai báo `body` cho route()).
 */
const Body = z.object({ code: z.enum(CLIENT_ERROR_CODES), detail: z.string().trim().max(200).optional() }).strict();
const MAX_BYTES = 2_000;

export const POST = route<{ id: string }>({ roles: ["student"] }, async ({ req, session, params }) => {
  await requireConsent(session!.sub);
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BYTES) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Dữ liệu gửi lên quá lớn.");
  let data: unknown;
  try {
    data = JSON.parse(raw || "{}");
  } catch {
    throw new HttpError(400, "BAD_JSON", "Dữ liệu gửi lên không hợp lệ.");
  }
  await recordClientError(session!, params.id, Body.parse(data));
  return new Response(null, { status: 204 });
});
