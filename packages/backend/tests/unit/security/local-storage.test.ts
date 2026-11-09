import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeObjects, signedUrl, storageMode, uploadObject } from "../../../src/evidence/storage";

/**
 * Kho ảnh cục bộ cho dev (DATABASE_URL=pglite:, không có Supabase): file nằm trong thư mục gitignore,
 * "signed URL" là data: URL (CSP img-src đã cho data:). KHÔNG BAO GIỜ dùng trên Vercel / khi có SUPABASE_URL.
 */
const saved = { ...process.env };
let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "local-storage-"));
  process.env = { ...saved, DATABASE_URL: "pglite:./.pglite", LOCAL_STORAGE_DIR: dir };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.VERCEL;
});
afterEach(async () => {
  process.env = { ...saved };
  await rm(dir, { recursive: true, force: true });
});

describe("storageMode", () => {
  it("pglite + không có Supabase + không phải Vercel → local", () => {
    expect(storageMode({ DATABASE_URL: "pglite:./.pglite" })).toBe("local");
  });
  it("có SUPABASE_URL → supabase (kể cả pglite)", () => {
    expect(storageMode({ DATABASE_URL: "pglite:./.pglite", SUPABASE_URL: "https://x.supabase.co" })).toBe("supabase");
  });
  it("NODE_ENV=production + pglite → supabase (chặn kho cục bộ) — trừ khi ALLOW_LOCAL_PGLITE=1 (next start cục bộ)", () => {
    expect(storageMode({ DATABASE_URL: "pglite:./.pglite", NODE_ENV: "production" })).toBe("supabase");
    expect(storageMode({ DATABASE_URL: "pglite:./.pglite", NODE_ENV: "production", ALLOW_LOCAL_PGLITE: "true" })).toBe("supabase");
    expect(storageMode({ DATABASE_URL: "pglite:./.pglite", NODE_ENV: "production", ALLOW_LOCAL_PGLITE: "1" })).toBe("local");
    expect(storageMode({ DATABASE_URL: "pglite:./.pglite", NODE_ENV: "production", ALLOW_LOCAL_PGLITE: "1", VERCEL: "1" })).toBe("supabase");
  });

  it("trên Vercel hoặc Postgres → supabase (không bao giờ ghi đĩa cục bộ)", () => {
    expect(storageMode({ DATABASE_URL: "pglite:./.pglite", VERCEL: "1" })).toBe("supabase");
    expect(storageMode({ DATABASE_URL: "postgresql://u:p@h/db" })).toBe("supabase");
  });
});

describe("kho ảnh cục bộ (dev)", () => {
  it("upload → signedUrl là data: URL đúng nội dung → remove xoá file", async () => {
    const body = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    await uploadObject("cards", "sv-1/card.jpg", body, "image/jpeg");
    const url = await signedUrl("cards", "sv-1/card.jpg");
    expect(url).toBe(`data:image/jpeg;base64,${body.toString("base64")}`);
    await removeObjects("cards", ["sv-1/card.jpg"]);
    expect(await readdir(path.join(dir, "cards", "sv-1"))).toEqual([]);
  });

  it("không ghi đè file đã có (giống x-upsert: false)", async () => {
    await uploadObject("cards", "a/x.jpg", Buffer.from("1"), "image/jpeg");
    await expect(uploadObject("cards", "a/x.jpg", Buffer.from("2"), "image/jpeg")).rejects.toThrow();
  });

  it("đường dẫn không an toàn → lỗi trước khi chạm đĩa", async () => {
    await expect(uploadObject("cards", "../thoat.jpg", Buffer.from("1"), "image/jpeg")).rejects.toThrow(/không hợp lệ/);
    await expect(signedUrl("cards", "a/../../x")).rejects.toThrow(/không hợp lệ/);
  });
});
