import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Cấu hình fontconfig cho việc vẽ chữ lên ảnh bằng chứng (sharp → libvips → Pango → fontconfig).
 * - Function Vercel không có /etc/fonts/fonts.conf: tự cấp cấu hình chỉ trỏ tới font đóng gói (Be Vietnam Pro).
 * - KHÔNG khai báo <cachedir>: nhiều tiến trình cùng dựng cache fontconfig lần đầu có thể làm hỏng heap của tiến trình
 *   (tái hiện trên Windows khi các worker test chạy song song: 0xC0000374, ~1/25 tiến trình). Chỉ một thư mục với
 *   2 file font nên quét lại mỗi tiến trình là rẻ.
 * - Biến FONTCONFIG_FILE phải có trước lần vẽ chữ đầu tiên. Đặt qua process.env có hiệu lực trên Linux (Vercel);
 *   trên Windows thư viện C đọc bản sao môi trường riêng → test đặt biến từ vitest.config trước khi tạo worker.
 * Không phụ thuộc "server-only" để vitest.config dùng chung được.
 */
const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function fontconfigXml(fontDir: string): string {
  return `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>${xmlEscape(fontDir)}</dir>\n</fontconfig>\n`;
}

/** Ghi cấu hình (nếu quản trị chưa đặt FONTCONFIG_FILE) và đặt biến; trả đường dẫn cấu hình đang dùng. */
export function ensureFontconfig(fontDir: string): string {
  const existing = process.env.FONTCONFIG_FILE;
  if (existing) return existing;
  const posixDir = fontDir.split(path.sep).join("/");
  const dir = path.join(os.tmpdir(), "utc-fontconfig");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `fonts-${createHash("sha256").update(posixDir).digest("hex").slice(0, 12)}.conf`);
  // ghi file tạm rồi đổi tên: tiến trình khác không bao giờ đọc phải file ghi dở
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, fontconfigXml(posixDir));
  renameSync(tmp, file);
  process.env.FONTCONFIG_FILE = file;
  return file;
}
