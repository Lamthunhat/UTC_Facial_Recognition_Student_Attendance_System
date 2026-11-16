import "server-only";
import { HttpError } from "../http/errors";
import { CARD_IMAGE_MAX_BYTES, LIVE_FRAME_COUNT, LIVE_FRAME_MAX_BYTES } from "./register";

/**
 * Đọc form multipart {nonce, image, frames×3} của POST /api/student/card — gọi SAU khi đã kiểm quyền + đồng ý.
 * Chặn theo content-length trước khi đọc body: tổng request ≤ 4 MB (FR-090, dưới giới hạn 4,5 MB của Vercel);
 * sau khi đọc: ảnh thẻ ≤ 1 MB, mỗi khung mặt trực tiếp ≤ 1 MB, đúng 3 khung.
 * `clientYaw` (tuỳ chọn, chuỗi JSON) chỉ được dùng ở preview/dev (face/yaw-debug.ts); production bỏ qua.
 */
export const CARD_REQUEST_MAX_BYTES = 4 * 1024 * 1024;
const tooLarge = (what: string) => new HttpError(413, "PAYLOAD_TOO_LARGE", `${what} vượt quá dung lượng cho phép.`);

export async function readCardForm(req: Request): Promise<{ nonce: string; image: Buffer; frames: Buffer[]; clientYaw?: string }> {
  const len = req.headers.get("content-length");
  if (len === null) throw new HttpError(411, "LENGTH_REQUIRED", "Thiếu độ dài dữ liệu gửi lên.");
  if (!Number.isFinite(Number(len)) || Number(len) > CARD_REQUEST_MAX_BYTES) throw tooLarge("Dữ liệu gửi lên");
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    throw new HttpError(400, "BAD_FORM", "Dữ liệu gửi lên không hợp lệ.");
  }
  const nonce = fd.get("nonce");
  const image = fd.get("image");
  const frames = fd.getAll("frames").filter((f) => typeof f !== "string") as Exclude<ReturnType<FormData["get"]>, string | null>[];
  if (typeof nonce !== "string" || !image || typeof image === "string") {
    throw new HttpError(422, "VALIDATION_ERROR", "Thiếu ảnh thẻ hoặc mã phiên chụp.");
  }
  if (image.size > CARD_IMAGE_MAX_BYTES) throw tooLarge("Ảnh thẻ (tối đa 1 MB)");
  if (frames.length !== LIVE_FRAME_COUNT) {
    throw new HttpError(422, "VALIDATION_ERROR", "Cần đúng 3 khung hình khuôn mặt theo hướng dẫn.");
  }
  if (frames.some((f) => f.size > LIVE_FRAME_MAX_BYTES)) throw tooLarge("Khung hình khuôn mặt (tối đa 1 MB/khung)");
  const clientYaw = fd.get("clientYaw");
  return {
    nonce: nonce.slice(0, 64),
    ...(typeof clientYaw === "string" ? { clientYaw: clientYaw.slice(0, 200) } : {}),
    image: Buffer.from(await image.arrayBuffer()),
    frames: await Promise.all(frames.map(async (f) => Buffer.from(await f.arrayBuffer()))),
  };
}
