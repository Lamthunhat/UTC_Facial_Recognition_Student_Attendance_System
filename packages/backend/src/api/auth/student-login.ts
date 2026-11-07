import { createSession } from "../../auth/session";
import { loginStudent } from "../../auth/student-login";
import { HttpError } from "../../http/errors";
import { json, route } from "../../http/handler";

/**
 * POST /api/auth/student/login — {studentCode} → {student} + cookie phiên (contracts/api.md §1).
 * Không khai báo body Zod trong route(): body sai kiểu/thừa trường cũng chỉ trả LOGIN_FAILED (FR-083, US-3a),
 * không trả 422 kèm chi tiết kiểm tra. Body giới hạn 1 KB.
 */
const MAX_BODY = 1_024;

async function readCode(req: Request): Promise<unknown> {
  if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Dữ liệu gửi lên quá lớn.");
  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_BODY) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Dữ liệu gửi lên quá lớn.");
  try {
    const body = JSON.parse(text) as unknown;
    if (body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 1 && "studentCode" in body) {
      return (body as { studentCode: unknown }).studentCode;
    }
  } catch {
    /* rơi xuống: coi như mã không hợp lệ */
  }
  return undefined;
}

export const POST = route({}, async ({ req, ip }) => {
  const studentCode = await readCode(req);
  const s = await loginStudent({ studentCode, ip });
  const session = await createSession(s.id, "student");
  return json(
    { student: { id: s.id, code: s.code, fullName: s.fullName, consentAt: s.consentAt, consentValid: s.consentValid, hasActiveCard: s.hasActiveCard } },
    { headers: { "Set-Cookie": session.cookie } },
  );
});
