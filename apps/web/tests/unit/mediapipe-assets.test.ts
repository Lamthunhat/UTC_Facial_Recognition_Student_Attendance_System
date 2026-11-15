import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_ASSETS, PUBLIC_ASSETS_DIR } from "../../../../scripts/card-assets.mjs";
import {
  FACE_DETECTOR_MODEL_SHA256,
  FACE_DETECTOR_MODEL_URL,
  MEDIAPIPE_WASM_BASE,
  TASKS_VISION_VERSION,
} from "@/lib/student/mediapipe-assets";

/**
 * Đường dẫn tài nguyên MediaPipe tự host có PHIÊN BẢN / HASH trong tên → cache "immutable" an toàn (đổi file = đổi URL).
 * Một nguồn sự thật (mediapipe-assets.ts) — script chép/tải lúc build phải khớp.
 */
const APP = path.resolve(__dirname, "../..");

describe("tài nguyên MediaPipe", () => {
  it("thư mục wasm theo phiên bản tasks-vision ghim trong package.json", () => {
    const pkg = JSON.parse(readFileSync(path.join(APP, "package.json"), "utf8"));
    expect(pkg.dependencies["@mediapipe/tasks-vision"]).toBe(TASKS_VISION_VERSION);
    expect(MEDIAPIPE_WASM_BASE).toBe(`/mediapipe/tasks-vision-${TASKS_VISION_VERSION}`);
  });

  it("script chép wasm vào đúng thư mục mà client nạp", () => {
    expect(path.relative(path.join(APP, "public"), PUBLIC_ASSETS_DIR(APP)).split(path.sep).join("/")).toBe(MEDIAPIPE_WASM_BASE.slice(1));
    expect(PUBLIC_ASSETS.map((a: { name: string }) => a.name)).toContain("vision_wasm_internal.wasm");
  });

  it("model BlazeFace short-range: tên file chứa 12 ký tự đầu sha256", () => {
    expect(FACE_DETECTOR_MODEL_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(FACE_DETECTOR_MODEL_URL).toBe(`/mediapipe/blaze_face_short_range.${FACE_DETECTOR_MODEL_SHA256.slice(0, 12)}.tflite`);
  });

  it("models:download tải model về đúng URL client dùng (import cùng hằng số)", () => {
    const src = readFileSync(path.join(APP, "../../scripts/download-models.ts"), "utf8");
    expect(src).toMatch(/from "\.\.\/apps\/web\/src\/lib\/student\/mediapipe-assets"/);
    expect(src).not.toMatch(/face_landmarker/);
  });
});
