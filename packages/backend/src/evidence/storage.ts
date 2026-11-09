import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import nodePath from "node:path";

/**
 * T034 — Supabase Storage qua REST, chỉ ở server với service-role key (Constitution IV/IX).
 * Bucket đều private; client chỉ nhận signed URL ngắn hạn (5 phút).
 */
export type Bucket = "evidence" | "cards" | "leave" | "disputes";

const SIGNED_URL_TTL_SEC = 300;

/**
 * Chế độ kho: "local" CHỈ khi dev cục bộ — DATABASE_URL=pglite:, không có SUPABASE_URL, không chạy trên Vercel, và
 * không phải production (trừ next start cục bộ có ALLOW_LOCAL_PGLITE=1).
 * Khi đó file nằm trong LOCAL_STORAGE_DIR (mặc định `<cwd>/.local-storage`, gitignore) và "signed URL" là data: URL
 * (CSP img-src có data:). Mọi trường hợp khác dùng Supabase (thiếu cấu hình → lỗi như trước).
 */
export function storageMode(source: Record<string, string | undefined> = process.env): "local" | "supabase" {
  if (!source.DATABASE_URL?.startsWith("pglite:") || source.SUPABASE_URL || source.VERCEL === "1") return "supabase";
  // production (next start) chỉ dùng kho cục bộ khi được bật rõ ràng cho máy cục bộ — cùng cờ với pglite production
  if (source.NODE_ENV === "production" && source.ALLOW_LOCAL_PGLITE !== "1") return "supabase";
  return "local";
}

const localRoot = () => nodePath.resolve(process.env.LOCAL_STORAGE_DIR || nodePath.join(process.cwd(), ".local-storage"));
const localFile = (bucket: Bucket, p: string) => nodePath.join(localRoot(), bucket, ...p.split("/"));
const dirnameOf = (file: string) => nodePath.dirname(file);
const MIME_BY_EXT: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

function cfg() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return { base: `${url.replace(/\/$/, "")}/storage/v1`, headers: { Authorization: `Bearer ${key}`, apikey: key } };
}

/** Đường dẫn chỉ gồm ký tự an toàn — chống path traversal. */
export function assertSafePath(path: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,250}$/.test(path) || path.includes("..") || path.includes("//")) {
    throw new Error("Đường dẫn lưu trữ không hợp lệ");
  }
}

const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

export async function uploadObject(bucket: Bucket, path: string, body: Buffer, contentType: string) {
  assertSafePath(path);
  if (storageMode() === "local") {
    const file = localFile(bucket, path);
    await mkdir(dirnameOf(file), { recursive: true });
    await writeFile(file, body, { flag: "wx" }); // wx: không ghi đè (giống x-upsert: false)
    return path;
  }
  const { base, headers } = cfg();
  const res = await fetch(`${base}/object/${bucket}/${encodePath(path)}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": contentType, "x-upsert": "false", "Cache-Control": "no-store" },
    body: new Uint8Array(body),
  });
  if (!res.ok) throw new Error(`Upload thất bại (${res.status})`);
  return path;
}

export async function signedUrl(bucket: Bucket, path: string, ttlSec = SIGNED_URL_TTL_SEC): Promise<string> {
  assertSafePath(path);
  if (storageMode() === "local") {
    const mime = MIME_BY_EXT[path.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";
    return `data:${mime};base64,${(await readFile(localFile(bucket, path))).toString("base64")}`;
  }
  const { base, headers } = cfg();
  const res = await fetch(`${base}/object/sign/${bucket}/${encodePath(path)}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: ttlSec }),
  });
  if (!res.ok) throw new Error(`Tạo signed URL thất bại (${res.status})`);
  const data = (await res.json()) as { signedURL?: string };
  if (!data.signedURL) throw new Error("Phản hồi signed URL không hợp lệ");
  return `${process.env.SUPABASE_URL!.replace(/\/$/, "")}/storage/v1${data.signedURL}`;
}

export async function removeObjects(bucket: Bucket, paths: string[]) {
  if (paths.length === 0) return;
  paths.forEach(assertSafePath);
  if (storageMode() === "local") {
    await Promise.all(paths.map((p) => rm(localFile(bucket, p), { force: true })));
    return;
  }
  const { base, headers } = cfg();
  const res = await fetch(`${base}/object/${bucket}`, {
    method: "DELETE",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!res.ok) throw new Error(`Xoá file thất bại (${res.status})`);
}
