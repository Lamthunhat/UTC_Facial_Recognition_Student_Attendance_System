/**
 * T032 — Chống CSV/Formula injection khi xuất .xlsx/.csv (FR-091, OWASP).
 * Chuỗi bắt đầu (sau khoảng trắng) bằng = + - @ tab hoặc CR được thêm tiền tố ' để bảng tính coi là văn bản.
 */
const DANGEROUS = /^[\s]*[=+\-@\t\r]/;

export function escapeFormula<T>(value: T): T | string {
  if (typeof value !== "string" || value.length === 0) return value;
  if (/^[\t\r]/.test(value) || DANGEROUS.test(value)) return `'${value}`;
  return value;
}
