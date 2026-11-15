"use client";

import type { FaceLandmarker } from "@mediapipe/tasks-vision";

/**
 * MediaPipe Face Landmarker ở trình duyệt — tự host trong /mediapipe (wasm + model, không CDN; CSP cần
 * 'wasm-unsafe-eval'). Nạp lười, một lần cho cả trang (promise cache) — gọi preload sớm (màn giới thiệu khuôn mặt)
 * để lúc bấm "Bắt đầu" đã sẵn. Lỗi → null (FaceChallenge quay về đếm ngược).
 * Thời gian khởi tạo ghi bằng performance.measure("face-landmarker-init") (trang chẩn đoán / test đọc lại).
 */
let loading: Promise<FaceLandmarker | null> | null = null;

export function loadFaceLandmarker(): Promise<FaceLandmarker | null> {
  loading ??= (async () => {
    const t0 = performance.now();
    try {
      const { FilesetResolver, FaceLandmarker } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      const lm = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: "/mediapipe/face_landmarker.task", delegate: "CPU" },
        runningMode: "VIDEO",
        numFaces: 2, // để phát hiện "nhiều người trong khung"
      });
      performance.measure("face-landmarker-init", { start: t0, end: performance.now() });
      return lm;
    } catch (e) {
      console.warn("face_landmarker_unavailable", e instanceof Error ? e.message : e);
      loading = null; // lần sau thử lại
      return null;
    }
  })();
  return loading;
}

/** Thời gian khởi tạo (ms) của lần nạp gần nhất, nếu có. */
export function faceLandmarkerInitMs(): number | null {
  const m = performance.getEntriesByName("face-landmarker-init", "measure").at(-1);
  return m ? Math.round(m.duration) : null;
}
