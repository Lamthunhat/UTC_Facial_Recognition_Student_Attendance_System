import { describe, expect, it } from "vitest";
import { cardGuideRect, CARD_ASPECT, CARD_MIN_LONG_EDGE, compressImage, cropLongEdgeOk, fitWithin, guideCrop, requestFits, CARD_IMAGE, FACE_FRAME, REQUEST_MAX_BYTES } from "@/lib/student/image";

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

describe("cardGuideRect — khung hướng dẫn thẻ DỌC (CR80 54 × 85,6), căn giữa, cao ~80 % vùng xem trước", () => {
  const ratio = (r: { width: number; height: number }) => r.width / r.height;

  it("tỉ lệ khung = 54 : 85,6", () => {
    expect(CARD_ASPECT).toBeCloseTo(54 / 85.6, 6);
  });

  it("điện thoại cầm dọc (vùng xem 3:4): cao 80 %, đúng tỉ lệ, căn giữa", () => {
    const r = cardGuideRect(358, 477);
    expect(r.height).toBeCloseTo(477 * 0.8, 6);
    expect(ratio(r)).toBeCloseTo(CARD_ASPECT, 6);
    expect(r.x + r.width / 2).toBeCloseTo(358 / 2, 6);
    expect(r.y + r.height / 2).toBeCloseTo(477 / 2, 6);
  });

  it("máy tính (vùng xem 16:9, webcam ngang): vẫn là khung DỌC, cao 80 %, không méo", () => {
    const r = cardGuideRect(960, 540);
    expect(r.height).toBeCloseTo(432, 6);
    expect(r.height).toBeGreaterThan(r.width);
    expect(ratio(r)).toBeCloseTo(CARD_ASPECT, 6);
  });

  it("vùng xem quá hẹp: thu theo chiều ngang (≤ 92 %), vẫn giữ tỉ lệ", () => {
    const r = cardGuideRect(200, 900);
    expect(r.width).toBeCloseTo(184, 6);
    expect(ratio(r)).toBeCloseTo(CARD_ASPECT, 6);
  });
});

describe("vùng cắt theo khung dọc → ảnh gửi đi đúng tỉ lệ thẻ, cạnh dài ≥ 1000 px", () => {
  const ar = (c: { width: number; height: number }) => c.width / c.height;

  it("điện thoại dọc, luồng camera dọc 1440×2560: cắt ra ảnh dọc đúng tỉ lệ, cạnh dài ≥ 1000 px", () => {
    const view = { viewW: 358, viewH: 477 };
    const crop = guideCrop({ videoW: 1440, videoH: 2560, ...view }, cardGuideRect(view.viewW, view.viewH));
    expect(ar(crop)).toBeCloseTo(CARD_ASPECT, 2);
    expect(Math.max(crop.width, crop.height)).toBeGreaterThanOrEqual(CARD_MIN_LONG_EDGE);
    expect(cropLongEdgeOk(crop)).toBe(true);
  });

  it("webcam ngang 1920×1080 trong vùng xem 16:9: cắt ra ảnh DỌC đúng tỉ lệ (không phải cả khung hình)", () => {
    const view = { viewW: 960, viewH: 540 };
    const crop = guideCrop({ videoW: 1920, videoH: 1080, ...view }, cardGuideRect(view.viewW, view.viewH));
    expect(crop.height).toBeGreaterThan(crop.width);
    expect(ar(crop)).toBeCloseTo(CARD_ASPECT, 2);
    expect(crop.width).toBeLessThan(1920 / 2);
  });

  it("webcam 1280×720: cạnh dài sau cắt < 1000 px → nhắc (cropLongEdgeOk = false)", () => {
    const view = { viewW: 960, viewH: 540 };
    const crop = guideCrop({ videoW: 1280, videoH: 720, ...view }, cardGuideRect(view.viewW, view.viewH));
    expect(Math.max(crop.width, crop.height)).toBeLessThan(CARD_MIN_LONG_EDGE);
    expect(cropLongEdgeOk(crop)).toBe(false);
  });
});
