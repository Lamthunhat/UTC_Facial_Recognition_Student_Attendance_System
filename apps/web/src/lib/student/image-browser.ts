"use client";

import { aspectsMatch, compressImage, scaleRegion, type CompressSpec, type Encoder } from "./image";

/**
 * Phần chạy trên trình duyệt của nén/chụp ảnh: vẽ (một vùng của) nguồn ảnh lên canvas rồi mã hoá JPEG.
 * Canvas/bitmap chỉ sống trong hàm — không giữ bản sao ảnh nào ngoài Blob trả về.
 */
type Region = { x: number; y: number; width: number; height: number };

/** ImageCapture (Chrome Android/desktop) — chưa có trong lib.dom của TypeScript mọi phiên bản. */
interface ImageCaptureLike {
  takePhoto(): Promise<Blob>;
}
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

export function imageCaptureSupported(): boolean {
  return typeof window !== "undefined" && "ImageCapture" in window;
}

function canvasEncoder(source: CanvasImageSource, region: Region): Encoder {
  return (width, height, quality) =>
    new Promise<Blob>((resolve, reject) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("CANVAS_UNAVAILABLE"));
      ctx.drawImage(source, region.x, region.y, region.width, region.height, 0, 0, width, height);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("ENCODE_FAILED"))), "image/jpeg", quality);
    });
}

/** Chụp một khung từ <video> (tuỳ chọn chỉ một vùng) và nén theo spec. */
export async function captureVideo(video: HTMLVideoElement, spec: CompressSpec, region?: Region): Promise<Blob> {
  const r = region ?? { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight };
  if (!r.width || !r.height) throw new Error("VIDEO_NOT_READY");
  return (await compressImage({ width: r.width, height: r.height }, spec, canvasEncoder(video, r))).blob;
}

/** Ảnh tĩnh độ phân giải cao bằng ImageCapture.takePhoto (nếu có), xoay theo EXIF; lỗi/không hỗ trợ → null. */
export async function takePhotoBitmap(track: MediaStreamTrack | null): Promise<ImageBitmap | null> {
  if (!track || !imageCaptureSupported()) return null;
  try {
    const Ctor = (window as unknown as { ImageCapture: ImageCaptureCtor }).ImageCapture;
    const blob = await new Ctor(track).takePhoto();
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
}

/**
 * Chụp ảnh thẻ: thử ImageCapture.takePhoto (độ phân giải cảm biến, thường cao hơn khung video) — chỉ dùng khi ảnh
 * cùng tỉ lệ với video (cùng góc nhìn, vùng cắt ánh xạ được); ngược lại lấy khung video.
 * Trả kèm cạnh dài vùng thẻ (điểm ảnh gốc) để quyết định chặn/cảnh báo, và nguồn ảnh đã dùng.
 */
export async function captureCard(
  video: HTMLVideoElement,
  track: MediaStreamTrack | null,
  region: Region,
  spec: CompressSpec,
): Promise<{ blob: Blob; longEdge: number; source: "photo" | "video" }> {
  const vSize = { width: video.videoWidth, height: video.videoHeight };
  const bmp = await takePhotoBitmap(track);
  if (bmp) {
    try {
      if (aspectsMatch(vSize, bmp)) {
        const r = scaleRegion(region, vSize, bmp);
        const { blob } = await compressImage({ width: r.width, height: r.height }, spec, canvasEncoder(bmp, r));
        return { blob, longEdge: Math.max(r.width, r.height), source: "photo" };
      }
    } finally {
      bmp.close();
    }
  }
  return { blob: await captureVideo(video, spec, region), longEdge: Math.max(region.width, region.height), source: "video" };
}
