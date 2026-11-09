import "server-only";
import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";

/**
 * Dấu vân tay có khoá cho giá trị nhạy cảm cần ghi nhật ký (vd. mã SV trong security_events): nối được các lần dò
 * cùng một giá trị mà không lưu giá trị gốc (mã SV ~1e9 khả năng → băm thường dò ngược được).
 * Khoá RIÊNG `LOG_HMAC_SECRET`, tách khỏi `JWT_SECRET`: xoay khoá phiên không làm đứt chuỗi liên kết trong log,
 * lộ khoá log không giả mạo được phiên.
 * Biến được kiểm LÚC KHỞI ĐỘNG (startup.ts / instrumentation.ts); assert dưới đây chỉ phòng hờ — không bao giờ
 * rơi về khoá mặc định đoán được.
 */
export function logFingerprint(purpose: string, value: string): string {
  const key = process.env.LOG_HMAC_SECRET;
  assert(key && key.length >= 32, "LOG_HMAC_SECRET thiếu hoặc < 32 ký tự (lẽ ra đã bị chặn lúc khởi động)");
  return createHmac("sha256", key).update(`${purpose}:${value}`).digest("hex").slice(0, 16);
}
