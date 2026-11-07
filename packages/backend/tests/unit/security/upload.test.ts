import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { UploadError, sanitizeImage } from "../../../src/security/upload";

async function jpegWithExif(width = 64, height = 48) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 100, b: 50 } } })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Copyright: "secret-gps-owner" } } })
    .toBuffer();
}

describe("sanitizeImage — kiểm tra & mã hoá lại ảnh tải lên (T018, FR-090)", () => {
  it("nhận JPEG hợp lệ, trả JPEG mới, bỏ EXIF, có sha256", async () => {
    const input = await jpegWithExif();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await sanitizeImage(input, { maxBytes: 2_000_000, allowed: ["image/jpeg", "image/png"] });
    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.width).toBe(64);
  });

  it("nhận PNG và chuyển thành JPEG", async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 4, background: "#ff0000" } }).png().toBuffer();
    const out = await sanitizeImage(png, { maxBytes: 2_000_000, allowed: ["image/jpeg", "image/png"] });
    expect((await sharp(out.buffer).metadata()).format).toBe("jpeg");
  });

  it("từ chối file vượt dung lượng", async () => {
    const input = await jpegWithExif();
    await expect(sanitizeImage(input, { maxBytes: 100, allowed: ["image/jpeg"] })).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
  });

  it("từ chối file giả ảnh (magic bytes không khớp)", async () => {
    const fakeExe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200)]);
    await expect(sanitizeImage(fakeExe, { maxBytes: 2_000_000, allowed: ["image/jpeg"] })).rejects.toBeInstanceOf(
      UploadError,
    );
  });

  it("từ chối kiểu không nằm trong danh sách cho phép", async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#00ff00" } }).png().toBuffer();
    await expect(sanitizeImage(png, { maxBytes: 2_000_000, allowed: ["image/jpeg"] })).rejects.toMatchObject({
      code: "UNSUPPORTED_TYPE",
    });
  });

  it("từ chối ảnh có số điểm ảnh quá lớn (bom giải nén)", async () => {
    const huge = await sharp({ create: { width: 9000, height: 9000, channels: 3, background: "#000" } })
      .jpeg({ quality: 10 })
      .toBuffer();
    await expect(
      sanitizeImage(huge, { maxBytes: 50_000_000, allowed: ["image/jpeg"], maxPixels: 40_000_000 }),
    ).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
  });
});
