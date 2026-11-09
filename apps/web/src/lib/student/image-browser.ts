"use client";

import { compressImage, type CompressSpec, type Encoder } from "./image";

/**
 * Phần chạy trên trình duyệt của nén ảnh: vẽ (một vùng của) nguồn ảnh lên canvas rồi mã hoá JPEG.
 * Canvas chỉ sống trong hàm — không giữ bản sao ảnh nào ngoài Blob trả về.
 */
type Region = { x: number; y: number; width: number; height: number };

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

/** Nén ảnh từ file (fallback camera hệ điều hành): xoay theo EXIF; ảnh gửi đi không còn EXIF (canvas). */
export async function compressFile(file: Blob, spec: CompressSpec): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    return (await compressImage({ width: bmp.width, height: bmp.height }, spec, canvasEncoder(bmp, { x: 0, y: 0, width: bmp.width, height: bmp.height }))).blob;
  } finally {
    bmp.close();
  }
}
