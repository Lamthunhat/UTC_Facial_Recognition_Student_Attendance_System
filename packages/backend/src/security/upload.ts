import "server-only";
import { createHash } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import sharp, { type Metadata, type OutputInfo } from "sharp";

/**
 * T031 — Kiểm tra file ảnh tải lên (FR-090): dung lượng, kiểu thực (magic bytes), số điểm ảnh,
 * rồi giải mã + mã hoá lại thành JPEG để loại metadata (EXIF/GPS) và nội dung lạ chèn trong file.
 */
export type ImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/heic";

export class UploadError extends Error {
  constructor(
    public readonly code: "FILE_TOO_LARGE" | "UNSUPPORTED_TYPE" | "IMAGE_TOO_LARGE" | "CORRUPT_IMAGE" | "EMPTY",
    message: string,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

export interface SanitizedImage {
  buffer: Buffer; // JPEG đã mã hoá lại
  sha256: string; // băm của bản đã mã hoá lại
  originalSha256: string; // băm file gốc (phát hiện nộp trùng)
  width: number;
  height: number;
}

export async function sanitizeImage(
  input: Buffer,
  opts: { maxBytes: number; allowed: ImageMime[]; maxPixels?: number; maxSide?: number; quality?: number },
): Promise<SanitizedImage> {
  if (input.length === 0) throw new UploadError("EMPTY", "File rỗng");
  if (input.length > opts.maxBytes) throw new UploadError("FILE_TOO_LARGE", "File vượt dung lượng cho phép");

  const detected = await fileTypeFromBuffer(input);
  if (!detected || !opts.allowed.includes(detected.mime as ImageMime)) {
    throw new UploadError("UNSUPPORTED_TYPE", "Định dạng file không được hỗ trợ");
  }

  const maxPixels = opts.maxPixels ?? 40_000_000;
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: false }).metadata();
  } catch {
    throw new UploadError("CORRUPT_IMAGE", "Không đọc được ảnh");
  }
  if (!meta.width || !meta.height) throw new UploadError("CORRUPT_IMAGE", "Không đọc được kích thước ảnh");
  if (meta.width * meta.height > maxPixels) throw new UploadError("IMAGE_TOO_LARGE", "Ảnh có độ phân giải quá lớn");

  let out: { data: Buffer; info: OutputInfo };
  try {
    out = await sharp(input, { limitInputPixels: maxPixels, failOn: "error" })
      .rotate() // áp hướng EXIF trước khi bỏ metadata
      .resize({ width: opts.maxSide ?? 2048, height: opts.maxSide ?? 2048, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: opts.quality ?? 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new UploadError("CORRUPT_IMAGE", "Ảnh bị hỏng");
  }

  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  return {
    buffer: out.data,
    sha256: sha(out.data),
    originalSha256: sha(input),
    width: out.info.width,
    height: out.info.height,
  };
}
