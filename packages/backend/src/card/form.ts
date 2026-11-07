import "server-only";
import { HttpError } from "../http/errors";
import { CARD_IMAGE_MAX_BYTES } from "./register";

/**
 * Đọc form multipart {nonce, image} của POST /api/student/card — gọi SAU khi đã kiểm quyền.
 * Chặn theo content-length trước khi đọc body (ảnh ≤ 1 MB + ~16 KB cho phần bao multipart và trường nonce).
 */
const MAX_REQUEST = CARD_IMAGE_MAX_BYTES + 16 * 1024;
const tooLarge = () => new HttpError(413, "PAYLOAD_TOO_LARGE", "Ảnh vượt quá 1 MB.");

export async function readCardForm(req: Request): Promise<{ nonce: string; image: Buffer }> {
  const len = req.headers.get("content-length");
  if (len === null) throw new HttpError(411, "LENGTH_REQUIRED", "Thiếu độ dài dữ liệu gửi lên.");
  if (!Number.isFinite(Number(len)) || Number(len) > MAX_REQUEST) throw tooLarge();
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    throw new HttpError(400, "BAD_FORM", "Dữ liệu gửi lên không hợp lệ.");
  }
  const nonce = fd.get("nonce");
  const image = fd.get("image");
  if (typeof nonce !== "string" || !image || typeof image === "string") {
    throw new HttpError(422, "VALIDATION_ERROR", "Thiếu ảnh thẻ hoặc mã phiên chụp.");
  }
  if (image.size > CARD_IMAGE_MAX_BYTES) throw tooLarge();
  return { nonce: nonce.slice(0, 64), image: Buffer.from(await image.arrayBuffer()) };
}
