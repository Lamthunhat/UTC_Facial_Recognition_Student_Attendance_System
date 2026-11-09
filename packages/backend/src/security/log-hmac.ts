import "server-only";
import { createHmac } from "node:crypto";

/**
 * Dấu vân tay có khoá cho giá trị nhạy cảm cần ghi nhật ký (vd. mã SV trong security_events): nối được các lần dò
 * cùng một giá trị mà không lưu giá trị gốc (mã SV ~1e9 khả năng → băm thường dò ngược được).
 * Khoá RIÊNG `LOG_HMAC_SECRET`, tách khỏi `JWT_SECRET`: xoay khoá phiên không làm đứt chuỗi liên kết trong log,
 * lộ khoá log không giả mạo được phiên. Đọc lúc dùng; thiếu/ngắn → lỗi (không rơi về khoá mặc định).
 */
export function logFingerprint(purpose: string, value: string): string {
  const key = process.env.LOG_HMAC_SECRET;
  if (!key || key.length < 32) throw new Error("LOG_HMAC_SECRET chưa cấu hình hoặc quá ngắn (cần ≥ 32 ký tự)");
  return createHmac("sha256", key).update(`${purpose}:${value}`).digest("hex").slice(0, 16);
}
