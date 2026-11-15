import { needsWasm } from "@utc/backend/security/headers";

/**
 * CSP gắn với DOCUMENT: điều hướng phía client (next/link, router.push) giữ nguyên CSP của trang đã tải. Route nhận diện
 * mặt cần 'wasm-unsafe-eval' (needsWasm — cùng định nghĩa với middleware) → điều hướng vào HOẶC ra khỏi các route đó phải
 * tải document mới (để trình duyệt nhận CSP đúng của trang đích).
 */
export function crossesCspBoundary(from: string, to: string): boolean {
  const path = (u: string) => u.split(/[?#]/)[0] || "/";
  return needsWasm(path(from)) !== needsWasm(path(to));
}
