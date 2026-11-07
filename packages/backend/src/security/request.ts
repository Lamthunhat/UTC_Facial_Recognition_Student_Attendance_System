/** IP client: Vercel đặt x-real-ip / x-forwarded-for (phần tử đầu tiên là client). */
export function clientIp(req: Request): string | null {
  const real = req.headers.get("x-real-ip");
  if (real && isIp(real)) return real;
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (fwd && isIp(fwd)) return fwd;
  return null;
}

function isIp(s: string) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(s) || /^[0-9a-f:]+$/i.test(s);
}

/** Đọc một cookie từ header Cookie của Request (dùng được cả trong route handler lẫn test). */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}
