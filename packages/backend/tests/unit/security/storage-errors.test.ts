import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { removeObjects, signedUrl, uploadObject } from "../../../src/evidence/storage";

/**
 * Lỗi Supabase Storage: log body lỗi (statusCode, error, message) + bucket + host — KHÔNG log key.
 * "Bucket not found" → lỗi cấu hình rõ ràng (503 STORAGE_BUCKET_MISSING) + log storage_bucket_missing.
 */
const KEY = "service-role-key-bi-mat-khong-duoc-log-xxxxxxxx";
const saved = { ...process.env };
let errors: string[] = [];

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } })),
  );
}

beforeEach(() => {
  process.env = { ...saved, DATABASE_URL: "postgresql://u:p@db.example.com:5432/x", SUPABASE_URL: "https://abcd1234.supabase.co", SUPABASE_SERVICE_ROLE_KEY: KEY };
  errors = [];
  vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(String(line)));
});
afterEach(() => {
  process.env = { ...saved };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("lỗi Supabase Storage", () => {
  it("Bucket not found → 503 STORAGE_BUCKET_MISSING + log storage_bucket_missing (bucket, host), không lộ key", async () => {
    respond(400, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
    await expect(uploadObject("cards", "sv/1/card.jpg", Buffer.from("x"), "image/jpeg")).rejects.toMatchObject({
      status: 503,
      code: "STORAGE_BUCKET_MISSING",
    });
    const logs = errors.map((l) => JSON.parse(l));
    expect(logs.find((l) => l.msg === "storage_bucket_missing")).toMatchObject({ bucket: "cards", host: "abcd1234.supabase.co", op: "upload" });
    expect(errors.join("\n")).not.toContain(KEY);
  });

  it("lỗi khác → log storage_request_failed với status, statusCode, error, message, bucket, host; ném lỗi máy chủ", async () => {
    respond(413, { statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size" });
    await expect(uploadObject("cards", "sv/1/card.jpg", Buffer.from("x"), "image/jpeg")).rejects.toThrow(/413/);
    const log = errors.map((l) => JSON.parse(l)).find((l) => l.msg === "storage_request_failed");
    expect(log).toMatchObject({
      op: "upload",
      bucket: "cards",
      host: "abcd1234.supabase.co",
      status: 413,
      statusCode: "413",
      error: "Payload too large",
      message: "The object exceeded the maximum allowed size",
    });
    expect(errors.join("\n")).not.toContain(KEY);
  });

  it("body lỗi không phải JSON → vẫn log status + đoạn đầu body (cắt ngắn)", async () => {
    respond(502, `<html>${"x".repeat(1000)}</html>`);
    await expect(uploadObject("evidence", "a/b.jpg", Buffer.from("x"), "image/jpeg")).rejects.toThrow();
    const log = errors.map((l) => JSON.parse(l)).find((l) => l.msg === "storage_request_failed");
    expect(log.status).toBe(502);
    expect(String(log.message).length).toBeLessThanOrEqual(300);
  });

  it("signedUrl / removeObjects dùng cùng cách báo lỗi (bucket thiếu → STORAGE_BUCKET_MISSING)", async () => {
    respond(400, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
    await expect(signedUrl("cards", "a/b.jpg")).rejects.toMatchObject({ code: "STORAGE_BUCKET_MISSING" });
    await expect(removeObjects("cards", ["a/b.jpg"])).rejects.toMatchObject({ code: "STORAGE_BUCKET_MISSING" });
    expect(errors.map((l) => JSON.parse(l)).filter((l) => l.msg === "storage_bucket_missing").map((l) => l.op)).toEqual(["sign", "remove"]);
  });
});
