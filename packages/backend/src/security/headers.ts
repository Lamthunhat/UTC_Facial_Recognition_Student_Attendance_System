/**
 * T028 — Header bảo mật & CSP (FR-086, FR-088). Thuần, chạy được ở Edge (middleware).
 */
export interface CspOptions {
  nonce: string;
  dev?: boolean;
  /** Origin kho ảnh (Supabase) để hiển thị ảnh bằng chứng qua signed URL. */
  storageOrigin?: string;
}

export function buildCsp({ nonce, dev = false, storageOrigin }: CspOptions): string {
  const img = ["'self'", "blob:", "data:", storageOrigin].filter(Boolean).join(" ");
  const directives: Record<string, string> = {
    "default-src": "'self'",
    // strict-dynamic: chỉ script có nonce (và script do chúng nạp) được chạy
    "script-src": `'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src": `'self' 'unsafe-inline'`,
    "img-src": img,
    "font-src": "'self'",
    "media-src": "'self' blob:",
    "connect-src": dev ? "'self' ws: wss:" : "'self'",
    "worker-src": "'self' blob:",
    "frame-ancestors": "'none'",
    "form-action": "'self'",
    "base-uri": "'self'",
    "object-src": "'none'",
  };
  let csp = Object.entries(directives)
    .map(([k, v]) => `${k} ${v}`)
    .join("; ");
  if (!dev) csp += "; upgrade-insecure-requests";
  return csp;
}

export function securityHeaders(opts: { dev?: boolean } = {}): Record<string, string> {
  const h: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Chỉ chính trang web được dùng camera & vị trí; tắt micro và các API không cần
    "Permissions-Policy": "camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  if (!opts.dev) h["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload";
  return h;
}

/**
 * Chống CSRF (FR-087): với method thay đổi dữ liệu, Origin phải trùng origin của trang.
 * Thiếu Origin: chỉ chấp nhận khi request không mang cookie phiên (không thể bị lợi dụng phiên).
 */
export function isCsrfSafe(input: {
  method: string;
  origin: string | null;
  secFetchSite: string | null;
  expectedOrigin: string;
  hasSessionCookie: boolean;
}): boolean {
  const m = input.method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return true;
  if (input.origin) return input.origin === input.expectedOrigin;
  if (input.secFetchSite && input.secFetchSite !== "same-origin" && input.secFetchSite !== "none") return false;
  return !input.hasSessionCookie;
}
