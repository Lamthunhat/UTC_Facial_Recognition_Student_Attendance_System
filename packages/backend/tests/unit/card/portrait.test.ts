import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { analyzePortraits } from "../../../src/card/portrait";
import { evaluateCard } from "../../../src/card/verify";

/**
 * T056 — Chạy model ONNX thật trên thẻ giả không có khuôn mặt (không dùng ảnh mặt thật).
 * Model bị gitignore (tải bằng scripts/download-models) → CI không có thì bỏ qua.
 */
const MODELS = path.resolve(__dirname, "../../../../../apps/web/models");
const hasModels = existsSync(path.join(MODELS, "det_500m.onnx")) && existsSync(path.join(MODELS, "w600k_mbf.onnx"));

describe.skipIf(!hasModels)("analyzePortraits (ONNX thật)", () => {
  it("thẻ không có chân dung → 0 khuôn mặt → NO_PORTRAIT", async () => {
    process.env.FACE_MODELS_DIR = MODELS;
    const card = await sharp({ create: { width: 1000, height: 630, channels: 3, background: "#f4f7fb" } })
      .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="80"><text x="0" y="50" font-size="40">MSSV: 231230801</text></svg>`), left: 320, top: 250 }])
      .jpeg()
      .toBuffer();
    const r = await analyzePortraits(card);
    expect(r.faces).toEqual([]);
    expect(evaluateCard({ sessionCode: "231230801", decoded: { code: "231230801", method: "barcode" }, faces: r.faces, nameMatched: true })).toEqual({
      ok: false,
      error: "NO_PORTRAIT",
    });
  }, 60_000);
});
