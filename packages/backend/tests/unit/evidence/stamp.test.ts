import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { escapePango, evidenceFontPath, stampEvidence, stampLines } from "../../../src/evidence/stamp";

/**
 * T073 — Đóng dấu ảnh bằng chứng (FR-039, FR-010d): giờ SERVER (giờ VN), địa chỉ (Goong) hoặc toạ độ, lớp, phòng.
 * Chữ do server vẽ (Constitution I) bằng sharp + font Be Vietnam Pro đóng gói kèm (không phụ thuộc font hệ thống).
 */
const info = {
  serverTime: new Date("2026-11-14T00:05:40Z"),
  address: "3 Cầu Giấy, Láng Thượng, Đống Đa, Hà Nội",
  lat: 21.027412,
  lng: 105.801234,
  classCode: "Khai phá dữ liệu-1-1-26(N03.BT1)",
  room: "301-A7-A7",
  windowLabel: "Check-in",
};

describe("stampLines", () => {
  it("giờ VN theo đồng hồ server, địa chỉ, lớp + phòng", () => {
    expect(stampLines(info)).toEqual([
      "14/11/2026 07:05:40 · Check-in",
      "3 Cầu Giấy, Láng Thượng, Đống Đa, Hà Nội",
      "Khai phá dữ liệu-1-1-26(N03.BT1) · Phòng 301-A7-A7",
    ]);
  });
  it("không có địa chỉ (thiếu GOONG_API_KEY / lỗi) → toạ độ 5 chữ số", () => {
    expect(stampLines({ ...info, address: null })[1]).toBe("21.02741, 105.80123");
  });
  it("cắt dòng quá dài", () => {
    expect(stampLines({ ...info, address: "x".repeat(300) })[1].length).toBeLessThanOrEqual(90);
  });
});

describe("escapePango — dữ liệu người dùng (tên lớp, phòng) không được thành markup", () => {
  it("& < > ' \" được thoát", () => {
    expect(escapePango(`<b>A&B</b> "x" 'y'`)).toBe("&lt;b&gt;A&amp;B&lt;/b&gt; &quot;x&quot; &apos;y&apos;");
  });
});

describe("stampEvidence", () => {
  it("font Be Vietnam Pro có mặt", () => {
    expect(evidenceFontPath()).toMatch(/BeVietnamPro-SemiBold\.ttf$/);
  });

  it("giữ kích thước, JPEG, dải chữ ở đáy tối hơn ảnh gốc; phần trên không đổi", async () => {
    const W = 720;
    const H = 960;
    const src = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 200, g: 200, b: 200 } } }).jpeg().toBuffer();
    const out = await stampEvidence(src, { ...info, classCode: `<script>&"` });
    const meta = await sharp(out).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", W, H]);
    // stats() đo ảnh ĐẦU VÀO của pipeline (bỏ qua extract) → cắt ra buffer trước rồi mới đo
    const stats = async (top: number, height: number) =>
      (await sharp(await sharp(out).extract({ left: 0, top, width: W, height }).toBuffer()).stats()).channels[0];
    const topBand = await stats(0, 100);
    const bottomBand = await stats(H - 60, 60);
    expect(topBand.mean).toBeGreaterThan(190);
    expect(bottomBand.mean).toBeLessThan(150); // nền tối của dải chữ
    expect(bottomBand.max).toBeGreaterThan(220); // có chữ sáng
  });

  it("ảnh nhỏ vẫn đóng dấu được", async () => {
    const src = await sharp({ create: { width: 240, height: 320, channels: 3, background: "#888" } }).jpeg().toBuffer();
    const meta = await sharp(await stampEvidence(src, info)).metadata();
    expect([meta.width, meta.height]).toEqual([240, 320]);
  });
});
