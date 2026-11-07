/**
 * T009 (phần cục bộ) — Đo thời gian phát hiện + trích vector trên CPU, 1 luồng.
 * Chạy: pnpm --filter @utc/backend spike:face <ảnh...> <ảnh1> [ảnh2 ...]
 * Không commit ảnh thật của sinh viên vào repo.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

process.env.FACE_MODELS_DIR ??= path.resolve(__dirname, "../../../apps/web/models");
import { decodeToRgb, imageQuality } from "../src/face/image";
import { detectFaces } from "../src/face/detect";
import { embedFace } from "../src/face/embed";
import { estimateYawDeg } from "../src/face/align";
import { cosine } from "../src/face/similarity";
import { getDetector, getRecognizer } from "../src/face/sessions";

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) throw new Error("Truyền ít nhất một đường dẫn ảnh");
  let t = performance.now();
  await Promise.all([getDetector(), getRecognizer()]);
  console.log(`Nạp model (cold): ${(performance.now() - t).toFixed(0)} ms`);

  const embs: { file: string; emb: Float32Array }[] = [];
  for (const file of files) {
    const buf = await readFile(file);
    t = performance.now();
    const img = await decodeToRgb(buf);
    const tDecode = performance.now() - t;
    t = performance.now();
    const faces = await detectFaces(img);
    const tDetect = performance.now() - t;
    console.log(`\n${file}: ${img.width}×${img.height}, ${faces.length} khuôn mặt (decode ${tDecode.toFixed(0)} ms, detect ${tDetect.toFixed(0)} ms)`);
    for (const f of faces) {
      t = performance.now();
      const emb = await embedFace(img, f.kps);
      const tEmb = performance.now() - t;
      const q = imageQuality(img, f.box);
      console.log(
        `  score ${f.score.toFixed(3)} box ${Math.round(f.box.x2 - f.box.x1)}px yaw ${estimateYawDeg(f.kps).toFixed(1)}° ` +
          `sáng ${q.brightness.toFixed(2)} nét ${q.sharpness.toFixed(2)} embed ${tEmb.toFixed(0)} ms`,
      );
      embs.push({ file, emb });
    }
  }
  // Đo lặp (warm) trên ảnh đầu tiên
  const img = await decodeToRgb(await readFile(files[0]));
  const N = 10;
  t = performance.now();
  for (let i = 0; i < N; i++) {
    const [f] = await detectFaces(img);
    if (f) await embedFace(img, f.kps);
  }
  console.log(`\nWarm detect+embed trung bình: ${((performance.now() - t) / N).toFixed(0)} ms/ảnh`);
  for (let i = 0; i < embs.length; i++)
    for (let j = i + 1; j < embs.length; j++)
      console.log(`cosine(${embs[i].file} , ${embs[j].file}) = ${cosine(embs[i].emb, embs[j].emb).toFixed(3)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
