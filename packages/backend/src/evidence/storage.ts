import "server-only";

/**
 * T034 — Supabase Storage qua REST, chỉ ở server với service-role key (Constitution IV/IX).
 * Bucket đều private; client chỉ nhận signed URL ngắn hạn (5 phút).
 */
export type Bucket = "evidence" | "cards" | "leave" | "disputes";

const SIGNED_URL_TTL_SEC = 300;

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
  const { base, headers } = cfg();
  const res = await fetch(`${base}/object/${bucket}`, {
    method: "DELETE",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!res.ok) throw new Error(`Xoá file thất bại (${res.status})`);
}
