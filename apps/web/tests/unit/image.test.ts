import { describe, expect, it } from "vitest";
import { compressImage, fitWithin, guideCrop, requestFits, CARD_IMAGE, FACE_FRAME, REQUEST_MAX_BYTES } from "@/lib/student/image";

/** Nén ảnh ở trình duyệt: thuật toán thuần, bộ mã hoá JPEG được truyền vào (trình duyệt dùng canvas). */
describe("fitWithin — cạnh dài tối đa, giữ tỉ lệ, không phóng to", () => {
  it("ảnh lớn thu về cạnh dài = maxEdge", () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
  });
  it("ảnh nhỏ giữ nguyên", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});

/** Bộ mã hoá giả: kích thước ~ số điểm ảnh × chất lượng × hệ số. */
const fakeEncoder = (bytesPerPixelAtQ1: number) => {
  const calls: { width: number; height: number; quality: number }[] = [];
  const encode = async (width: number, height: number, quality: number) => {
    calls.push({ width, height, quality });
    // chỉ cần kích thước — không cấp phát bộ đệm thật
    return { size: Math.round(width * height * quality * bytesPerPixelAtQ1), type: "image/jpeg" } as unknown as Blob;
  };
  return { encode, calls };
};

describe("compressImage — ≤ maxBytes", () => {
  it("lần đầu đã vừa → một lần mã hoá, đúng kích thước sau thu nhỏ", async () => {
    const { encode, calls } = fakeEncoder(0.2);
    const r = await compressImage({ width: 4032, height: 3024 }, CARD_IMAGE, encode);
    expect(r.blob.size).toBeLessThanOrEqual(CARD_IMAGE.maxBytes);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ width: 1600, height: 1200 });
  });

  it("quá lớn → giảm chất lượng, rồi giảm kích thước, tới khi ≤ maxBytes", async () => {
    const { encode, calls } = fakeEncoder(1.2);
    const r = await compressImage({ width: 4032, height: 3024 }, CARD_IMAGE, encode);
    expect(r.blob.size).toBeLessThanOrEqual(CARD_IMAGE.maxBytes);
    expect(calls.length).toBeGreaterThan(1);
    const qualities = calls.map((c) => c.quality);
    expect(Math.min(...qualities)).toBeGreaterThanOrEqual(CARD_IMAGE.minQuality);
    expect(r.width).toBeLessThan(1600);
  });

  it("không thể nén đủ nhỏ → lỗi IMAGE_TOO_LARGE (không gửi ảnh vượt giới hạn)", async () => {
    const { encode } = fakeEncoder(1e6);
    await expect(compressImage({ width: 1000, height: 1000 }, CARD_IMAGE, encode)).rejects.toThrow("IMAGE_TOO_LARGE");
  });

  it("khung mặt: cạnh dài ~720p, mỗi khung ≤ ngân sách", async () => {
    const { encode, calls } = fakeEncoder(0.3);
    const r = await compressImage({ width: 1920, height: 1080 }, FACE_FRAME, encode);
    expect(calls[0]).toMatchObject({ width: 1280, height: 720 });
    expect(r.blob.size).toBeLessThanOrEqual(FACE_FRAME.maxBytes);
  });
});

describe("requestFits — tổng request ≤ 4 MB (giới hạn server, đã chừa phần multipart)", () => {
  it("1 MB thẻ + 3 × 0,9 MB khung → vừa", () => {
    expect(requestFits([1_000_000, 900_000, 900_000, 900_000])).toBe(true);
  });
  it("vượt 4 MB trừ phần dư multipart → không vừa", () => {
    expect(requestFits([1_048_576, 1_048_576, 1_048_576, 1_048_576])).toBe(false);
    expect(REQUEST_MAX_BYTES).toBe(4 * 1024 * 1024);
  });
  it("ngân sách mặc định: thẻ + 3 khung luôn vừa", () => {
    expect(requestFits([CARD_IMAGE.maxBytes, FACE_FRAME.maxBytes, FACE_FRAME.maxBytes, FACE_FRAME.maxBytes])).toBe(true);
  });
});

describe("guideCrop — vùng khung hướng dẫn (toạ độ màn hình, video object-cover) → toạ độ điểm ảnh video", () => {
  it("video cùng tỉ lệ khung xem: chỉ nhân hệ số", () => {
    const r = guideCrop({ videoW: 1920, videoH: 1080, viewW: 960, viewH: 540 }, { x: 100, y: 50, width: 400, height: 252 }, 0);
    expect(r).toEqual({ x: 200, y: 100, width: 800, height: 504 });
  });

  it("video ngang trong khung dọc (object-cover cắt hai bên): cộng phần bị cắt", () => {
    // khung 390×520, video 1280×720 → scale = 520/720; video hiển thị rộng 924.4 px, lệch trái (924.4-390)/2
    const r = guideCrop({ videoW: 1280, videoH: 720, viewW: 390, viewH: 520 }, { x: 20, y: 150, width: 350, height: 221 }, 0);
    const scale = 520 / 720;
    const off = (1280 * scale - 390) / 2;
    expect(r.x).toBe(Math.round((20 + off) / scale));
    expect(r.width).toBe(Math.round(350 / scale));
  });

  it("có lề + kẹp trong ảnh video", () => {
    const r = guideCrop({ videoW: 1000, videoH: 600, viewW: 1000, viewH: 600 }, { x: 0, y: 0, width: 1000, height: 600 }, 0.1);
    expect(r).toEqual({ x: 0, y: 0, width: 1000, height: 600 });
  });
});
