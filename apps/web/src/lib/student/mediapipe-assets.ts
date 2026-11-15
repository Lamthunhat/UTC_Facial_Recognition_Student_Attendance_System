/**
 * Tài nguyên MediaPipe tự host trong apps/web/public/mediapipe — MỘT nguồn sự thật cho client và script build
 * (scripts/download-models.ts import trực tiếp; scripts/card-assets.mjs được test đối chiếu).
 * Tên có PHIÊN BẢN (thư mục wasm) / HASH (model) → cache "public, max-age=31536000, immutable" an toàn (next.config.ts).
 */
export const TASKS_VISION_VERSION = "1.2.0";
export const MEDIAPIPE_WASM_BASE = `/mediapipe/tasks-vision-${TASKS_VISION_VERSION}`;

/** MediaPipe Face Detector — BlazeFace short-range (float16), Apache-2.0. */
export const FACE_DETECTOR_MODEL_SOURCE =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
export const FACE_DETECTOR_MODEL_SHA256 = "b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f";
export const FACE_DETECTOR_MODEL_URL = `/mediapipe/blaze_face_short_range.${FACE_DETECTOR_MODEL_SHA256.slice(0, 12)}.tflite`;
