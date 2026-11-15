"use client";

import type { FaceDetector } from "@mediapipe/tasks-vision";
import { yawFromKeypoints } from "./face-pose";
import { FACE_DETECTOR_MODEL_URL, MEDIAPIPE_WASM_BASE } from "./mediapipe-assets";

/**
 * MediaPipe Face Detector (BlazeFace short-range) ở trình duyệt — tự host (wasm + model trong /mediapipe, không CDN;
 * CSP 'wasm-unsafe-eval' chỉ ở route nhận diện mặt). Nạp lười, một lần cho cả trang (promise cache) — gọi sớm (màn giới
 * thiệu khuôn mặt) để lúc bấm "Bắt đầu" đã sẵn. Lỗi → null (FaceChallenge quay về đếm ngược).
 * Thời gian khởi tạo ghi bằng performance.measure("face-detector-init") (trang chẩn đoán / test đọc lại).
 */
let loading: Promise<FaceDetector | null> | null = null;

export function loadFaceDetector(): Promise<FaceDetector | null> {
  loading ??= (async () => {
    const t0 = performance.now();
    try {
      const { FilesetResolver, FaceDetector } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE);
      const detector = await FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_DETECTOR_MODEL_URL, delegate: "CPU" },
        runningMode: "VIDEO",
        minDetectionConfidence: 0.5,
      });
      performance.measure("face-detector-init", { start: t0, end: performance.now() });
      return detector;
    } catch (e) {
      console.warn("face_detector_unavailable", e instanceof Error ? e.message : e);
      loading = null; // lần sau thử lại
      return null;
    }
  })();
  return loading;
}

/** Thời gian khởi tạo (ms) của lần nạp gần nhất, nếu có. */
export function faceDetectorInitMs(): number | null {
  const m = performance.getEntriesByName("face-detector-init", "measure").at(-1);
  return m ? Math.round(m.duration) : null;
}

/**
 * Một lần nhận diện trên khung video hiện tại (ảnh gốc, không lật): số mặt + yaw (chỉ khi đúng 1 mặt; nhiều mặt → 0
 * để tracker báo "Chỉ một người"). Khung lỗi → coi như không thấy mặt.
 */
export function detectPose(detector: FaceDetector, video: HTMLVideoElement, now: number): { faces: number; yaw: number | null } {
  try {
    const { detections } = detector.detectForVideo(video, now);
    const faces = detections.length;
    if (faces !== 1) return { faces, yaw: faces > 1 ? 0 : null };
    return { faces, yaw: yawFromKeypoints(detections[0].keypoints ?? [], video.videoWidth, video.videoHeight) };
  } catch {
    return { faces: 0, yaw: null };
  }
}
