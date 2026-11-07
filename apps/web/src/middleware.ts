import { SESSION_COOKIE } from "@utc/backend/auth/cookie";
import { verifySession, type Role } from "@utc/backend/auth/jwt";
import { buildCsp, isCsrfSafe, securityHeaders } from "@utc/backend/security/headers";
import { NextResponse, type NextRequest } from "next/server";

/**
 * T028 — Chạy trước mọi request:
 * 1. Header bảo mật + CSP có nonce (FR-086, FR-088).
 * 2. Chống CSRF cho API thay đổi dữ liệu (FR-087).
 * 3. Chặn truy cập khu /admin, /gv, /sv/* khi chưa đăng nhập đúng vai trò (chỉ kiểm chữ ký JWT;
 *    việc phiên đã bị thu hồi được kiểm ở từng API — middleware chạy Edge, không truy cập DB).
 */
const AREAS: { prefix: string; roles: Role[]; login: string; exact?: string }[] = [
  { prefix: "/admin", roles: ["admin"], login: "/login" },
  { prefix: "/gv", roles: ["instructor", "admin"], login: "/login" },
  { prefix: "/sv/", roles: ["student"], login: "/sv" },
];

// API tự bảo vệ bằng Bearer token, không dùng cookie phiên
const CSRF_EXEMPT = ["/api/cron/", "/api/spike/"];

export async function middleware(req: NextRequest) {
  const dev = process.env.NODE_ENV !== "production";
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;

  if (pathname.startsWith("/api/") && !CSRF_EXEMPT.some((p) => pathname.startsWith(p))) {
    const ok = isCsrfSafe({
      method: req.method,
      origin: req.headers.get("origin"),
      secFetchSite: req.headers.get("sec-fetch-site"),
      expectedOrigin: req.nextUrl.origin,
      hasSessionCookie: Boolean(token),
    });
    if (!ok) {
      return NextResponse.json(
        { error: { code: "CSRF_BLOCKED", message: "Yêu cầu bị chặn vì không đến từ trang hợp lệ." } },
        { status: 403, headers: securityHeaders({ dev }) },
      );
    }
  }

  const area = AREAS.find((a) => pathname === a.prefix || pathname.startsWith(a.prefix.endsWith("/") ? a.prefix : `${a.prefix}/`));
  if (area) {
    const session = token ? await verifySession(token) : null;
    if (!session || !area.roles.includes(session.role)) {
      const url = req.nextUrl.clone();
      url.pathname = area.login;
      url.search = `?next=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(url);
    }
  }

  const nonce = btoa(crypto.randomUUID());
  const storageOrigin = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).origin : undefined;
  const csp = buildCsp({ nonce, dev, storageOrigin });

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  for (const [k, v] of Object.entries(securityHeaders({ dev }))) res.headers.set(k, v);
  if (pathname.startsWith("/api/")) res.headers.set("Cache-Control", "no-store");
  return res;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|fonts/).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
