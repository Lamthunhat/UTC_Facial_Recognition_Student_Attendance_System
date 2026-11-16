import "server-only";
import { HttpError } from "../http/errors";
import { LIVE_FRAME_COUNT, LIVE_FRAME_MAX_BYTES } from "./live";
import { CARD_IMAGE_MAX_BYTES } from "./register";

/**
 * Đọc form multipart của POST /api/student/card {nonce, image, frames×3}, POST /api/student/liveness-probe
 * {nonce, frames×3} và POST /api/windows/{id}/events {nonce, frames×3, lat, lng, accuracyM} — gọi SAU khi đã kiểm
 * quyền + đồng ý.
 * Chặn theo content-length trước khi đọc body: tổng request ≤ 4 MB (FR-090, dưới giới hạn 4,5 MB của Vercel);
 * sau khi đọc: ảnh thẻ ≤ 1 MB, mỗi khung mặt trực tiếp ≤ 1 MB, đúng 3 khung.
 * `clientYaw` (tuỳ chọn, chuỗi JSON) chỉ được dùng ở preview/dev (face/yaw-debug.ts); production bỏ qua.
 */
export const CARD_REQUEST_MAX_BYTES = 4 * 1024 * 1024;
const tooLarge = (what: string) => new HttpError(413, "PAYLOAD_TOO_LARGE", `${what} vượt quá dung lượng cho phép.`);
type FileEntry = Exclude<ReturnType<FormData["get"]>, string | null>;

export async function readForm(req: Request): Promise<FormData> {
  const len = req.headers.get("content-length");
  if (len === null) throw new HttpError(411, "LENGTH_REQUIRED", "Thiếu độ dài dữ liệu gửi lên.");
  if (!Number.isFinite(Number(len)) || Number(len) > CARD_REQUEST_MAX_BYTES) throw tooLarge("Dữ liệu gửi lên");
  try {
    return await req.formData();
  } catch {
    throw new HttpError(400, "BAD_FORM", "Dữ liệu gửi lên không hợp lệ.");
  }
}

/** nonce + đúng 3 khung mặt (mỗi khung ≤ 1 MB) + clientYaw tuỳ chọn. */
export async function liveFields(fd: FormData, missing: string) {
  const nonce = fd.get("nonce");
  if (typeof nonce !== "string") throw new HttpError(422, "VALIDATION_ERROR", missing);
  const frames = fd.getAll("frames").filter((f) => typeof f !== "string") as FileEntry[];
  if (frames.length !== LIVE_FRAME_COUNT) {
    throw new HttpError(422, "VALIDATION_ERROR", "Cần đúng 3 khung hình khuôn mặt theo hướng dẫn.");
  }
  if (frames.some((f) => f.size > LIVE_FRAME_MAX_BYTES)) throw tooLarge("Khung hình khuôn mặt (tối đa 1 MB/khung)");
  const clientYaw = fd.get("clientYaw");
  return {
    nonce: nonce.slice(0, 64),
    ...(typeof clientYaw === "string" ? { clientYaw: clientYaw.slice(0, 200) } : {}),
    frames: await Promise.all(frames.map(async (f) => Buffer.from(await f.arrayBuffer()))),
  };
}

export async function readCardForm(req: Request): Promise<{ nonce: string; image: Buffer; frames: Buffer[]; clientYaw?: string }> {
  const fd = await readForm(req);
  const image = fd.get("image");
  if (typeof fd.get("nonce") !== "string" || !image || typeof image === "string") {
    throw new HttpError(422, "VALIDATION_ERROR", "Thiếu ảnh thẻ hoặc mã phiên chụp.");
  }
  if (image.size > CARD_IMAGE_MAX_BYTES) throw tooLarge("Ảnh thẻ (tối đa 1 MB)");
  const live = await liveFields(fd, "Thiếu ảnh thẻ hoặc mã phiên chụp.");
  return { ...live, image: Buffer.from(await image.arrayBuffer()) };
}

export async function readLiveForm(req: Request): Promise<{ nonce: string; frames: Buffer[]; clientYaw?: string }> {
  return liveFields(await readForm(req), "Thiếu mã phiên chụp.");
}

/** Lượt điểm danh: nonce + 3 khung + vị trí (chuỗi; kiểm giá trị ở geo/location-check.ts trước khi xử lý ảnh). */
export async function readCheckinForm(req: Request) {
  const fd = await readForm(req);
  const live = await liveFields(fd, "Thiếu mã phiên chụp.");
  const str = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v.slice(0, 40) : undefined;
  };
  return { ...live, lat: str("lat"), lng: str("lng"), accuracyM: str("accuracyM") };
}
