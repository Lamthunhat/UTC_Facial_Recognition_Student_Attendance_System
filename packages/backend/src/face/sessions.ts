import "server-only";
import path from "node:path";
import * as ort from "onnxruntime-node";

/**
 * Nạp model ONNX một lần cho mỗi instance function (warm start tái sử dụng).
 * Giới hạn 1 luồng nội bộ vì Vercel Hobby chỉ có 1 vCPU.
 */
let detector: Promise<ort.InferenceSession> | undefined;
let recognizer: Promise<ort.InferenceSession> | undefined;

const opts: ort.InferenceSession.SessionOptions = {
  intraOpNumThreads: 1,
  interOpNumThreads: 1,
  graphOptimizationLevel: "all",
};

function modelPath(file: string) {
  // Mặc định: thư mục models/ của app đang chạy (apps/web khi chạy Next.js).
  return path.resolve(process.env.FACE_MODELS_DIR ?? path.join(process.cwd(), "models"), file);
}

export function getDetector() {
  detector ??= ort.InferenceSession.create(modelPath("det_500m.onnx"), opts);
  return detector;
}

export function getRecognizer() {
  recognizer ??= ort.InferenceSession.create(modelPath("w600k_mbf.onnx"), opts);
  return recognizer;
}

export const MODEL_VERSIONS = { detector: "scrfd-500m@buffalo_s-v0.7", faceModel: "w600k_mbf@buffalo_s-v0.7" };

export { ort };
