/**
 * Phân loại DATABASE_URL và chặn script ghi dữ liệu nhầm DB (dùng chung cho seed-demo, migrate, admin:create).
 * Hàm thuần, không I/O, không "server-only" — script gọi rồi tự in lỗi + process.exit(1).
 *
 * Quy tắc:
 * - seed-demo: CHỈ chạy trên DB cục bộ (pglite: hoặc localhost/127.0.0.1/::1); cấm NODE_ENV=production và mọi URL
 *   chứa supabase.co(m) — không có cờ nào mở được (dữ liệu demo với mật khẩu biết trước không bao giờ lên remote).
 * - migrate / admin:create: được ghi lên DB remote nhưng phải có CONFIRM_REMOTE_DB=true cho đúng lần chạy đó.
 * Mặc định an toàn: URL không phân tích được, không phải postgres(ql)://, hoặc không có host → coi là remote.
 * Thông báo chỉ in host — KHÔNG BAO GIỜ in nguyên URL (chứa mật khẩu).
 */
export type DbTargetKind = "pglite" | "local" | "remote";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function classifyDatabaseUrl(raw: string | undefined): { kind: DbTargetKind; display: string } {
  const url = (raw ?? "").trim();
  if (url.startsWith("pglite:")) return { kind: "pglite", display: url };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: "remote", display: "(DATABASE_URL không hợp lệ)" };
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return { kind: "remote", display: `(giao thức ${u.protocol} không hỗ trợ)` };
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return { kind: "remote", display: "(không có host)" };
  return { kind: LOCAL_HOSTS.has(host) ? "local" : "remote", display: host };
}

type Env = Record<string, string | undefined>;

/** Lý do cấm chạy seed demo, hoặc null nếu được phép. */
export function seedGuardError(env: Env): string | null {
  if (env.NODE_ENV === "production") {
    return "⛔ seed-demo không được chạy khi NODE_ENV=production.";
  }
  const url = env.DATABASE_URL?.trim();
  if (!url) return "⛔ Thiếu DATABASE_URL — seed-demo không biết ghi vào đâu.";
  const target = classifyDatabaseUrl(url);
  const onlyLocal = "Seed demo (tài khoản với mật khẩu biết trước) chỉ dành cho DB cục bộ: `pglite:<thư mục>` hoặc Postgres ở localhost/127.0.0.1.";
  if (url.toLowerCase().includes("supabase.co")) {
    return `⛔ seed-demo không được chạy trên Supabase (host: ${target.display}). ${onlyLocal}`;
  }
  if (target.kind === "remote") {
    return `⛔ seed-demo không được chạy trên DB remote (host: ${target.display}). ${onlyLocal}`;
  }
  return null;
}

/** Lý do dừng script ghi dữ liệu lên DB remote khi chưa xác nhận, hoặc null nếu được phép. */
export function remoteWriteGuardError(env: Env, script: string): string | null {
  const url = env.DATABASE_URL?.trim();
  if (!url) return "⛔ Thiếu DATABASE_URL (hoặc DIRECT_DATABASE_URL).";
  const target = classifyDatabaseUrl(url);
  if (target.kind !== "remote" || env.CONFIRM_REMOTE_DB === "true") return null;
  return [
    `⛔ ${script} sắp GHI vào database REMOTE: ${target.display}`,
    "Kiểm tra lại đây đúng là DB bạn muốn thay đổi, rồi đặt cờ xác nhận CONFIRM_REMOTE_DB=true cho RIÊNG lần chạy này:",
    `  PowerShell: $env:CONFIRM_REMOTE_DB="true"; pnpm ${script}; Remove-Item Env:CONFIRM_REMOTE_DB`,
    `  bash:       CONFIRM_REMOTE_DB=true pnpm ${script}`,
    "Không đặt CONFIRM_REMOTE_DB trong file .env / .env.local.",
  ].join("\n");
}
