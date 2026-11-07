import "server-only";
import { ARCFACE_TEMPLATE, estimateSimilarity, invertSimilarity, type Point } from "./align";
import { sampleBilinear, type RgbImage } from "./image";
import { getRecognizer, ort } from "./sessions";
import { l2normalize } from "./similarity";

const SIZE = 112;

/** Cắt + căn chỉnh khuôn mặt về 112×112 theo 5 điểm mốc, trả tensor NCHW chuẩn hoá (x-127.5)/127.5. */
export function alignedTensor(img: RgbImage, kps: Point[]): Float32Array {
  const toTemplate = estimateSimilarity(kps, ARCFACE_TEMPLATE);
  const back = invertSimilarity(toTemplate);
  const plane = SIZE * SIZE;
  const tensor = new Float32Array(3 * plane);
  const px = new Float32Array(3);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const sx = back.a * x - back.b * y + back.tx;
      const sy = back.b * x + back.a * y + back.ty;
      sampleBilinear(img, sx, sy, px, 0);
      const i = y * SIZE + x;
      tensor[i] = (px[0] - 127.5) / 127.5;
      tensor[plane + i] = (px[1] - 127.5) / 127.5;
      tensor[2 * plane + i] = (px[2] - 127.5) / 127.5;
    }
  }
  return tensor;
}

/** Vector đặc trưng 512 chiều đã chuẩn hoá L2 (MobileFaceNet ArcFace). */
export async function embedFace(img: RgbImage, kps: Point[]): Promise<Float32Array> {
  const session = await getRecognizer();
  const input = new ort.Tensor("float32", alignedTensor(img, kps), [1, 3, SIZE, SIZE]);
  const out = await session.run({ [session.inputNames[0]]: input });
  return l2normalize(out[session.outputNames[0]].data as Float32Array);
}
