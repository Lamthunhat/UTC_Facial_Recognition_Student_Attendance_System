/**
 * T008 — Tải model khuôn mặt (InsightFace buffalo_s) vào thư mục models/.
 * Chỉ giữ 2 file cần dùng: SCRFD-500M (phát hiện mặt) và MobileFaceNet w600k_mbf (embedding 512-d).
 * Lưu ý giấy phép: model pretrained InsightFace chỉ dùng phi thương mại / nghiên cứu (xem research.md R1).
 *
 * Chạy: pnpm models:download
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { FACE_DETECTOR_MODEL_SHA256, FACE_DETECTOR_MODEL_SOURCE, FACE_DETECTOR_MODEL_URL } from "../apps/web/src/lib/student/mediapipe-assets";

const ZIP_URL = "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_s.zip";
const ZIP_SHA256 = "d85a87f503f691807cd8bb97128bdf7a0660326cd9cd02657127fa978bab8b5e";

const WANTED: Record<string, string> = {
  "det_500m.onnx": "5e4447f50245bbd7966bd6c0fa52938c61474a04ec7def48753668a9d8b4ea3a",
  "w600k_mbf.onnx": "9cc6e4a75f0e2bf0b1aed94578f144d15175f357bdc05e815e5c4a02b319eb4f",
};

// Model nằm cạnh app Next.js để được đóng gói vào function khi deploy.
const OUT_DIR = path.resolve(process.env.FACE_MODELS_DIR ?? path.join(__dirname, "../apps/web/models"));

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

async function alreadyPresent(): Promise<boolean> {
  for (const [name, hash] of Object.entries(WANTED)) {
    try {
      await stat(path.join(OUT_DIR, name));
      if (sha256(await readFile(path.join(OUT_DIR, name))) !== hash) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Đọc các entry của file zip (đủ cho zip chuẩn, không mã hoá, không zip64). */
function extractEntries(zip: Buffer, names: string[]): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // End of central directory
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Không tìm thấy central directory của zip");
  const count = zip.readUInt16LE(eocd + 10);
  let ptr = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(ptr) !== 0x02014b50) throw new Error("Zip hỏng (central header)");
    const method = zip.readUInt16LE(ptr + 10);
    const compSize = zip.readUInt32LE(ptr + 20);
    const nameLen = zip.readUInt16LE(ptr + 28);
    const extraLen = zip.readUInt16LE(ptr + 30);
    const commentLen = zip.readUInt16LE(ptr + 32);
    const localOffset = zip.readUInt32LE(ptr + 42);
    const name = zip.toString("utf8", ptr + 46, ptr + 46 + nameLen);
    if (names.includes(name)) {
      const lNameLen = zip.readUInt16LE(localOffset + 26);
      const lExtraLen = zip.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = zip.subarray(start, start + compSize);
      if (method === 0) out.set(name, Buffer.from(data));
      else if (method === 8) out.set(name, inflateRawSync(data));
      else throw new Error(`Phương thức nén ${method} không hỗ trợ cho ${name}`);
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/**
 * MediaPipe Face Detector (BlazeFace short-range, float16) cho hướng dẫn quay đầu ở TRÌNH DUYỆT (chỉ hướng dẫn — server
 * vẫn quyết định). Tự host trong apps/web/public (không CDN, CSP connect-src 'self'); tên file có hash → cache immutable.
 * Đường dẫn + sha256 dùng chung với client (apps/web/src/lib/student/mediapipe-assets.ts). Giấy phép Apache-2.0.
 */
async function downloadFaceDetector() {
  const dest = path.resolve(__dirname, "../apps/web/public", FACE_DETECTOR_MODEL_URL.slice(1));
  const name = path.basename(dest);
  if ((await readFile(dest).then(sha256, () => null)) === FACE_DETECTOR_MODEL_SHA256) {
    console.log(`✔ ${name} đã có`);
    return;
  }
  const res = await fetch(FACE_DETECTOR_MODEL_SOURCE);
  if (!res.ok) throw new Error(`Tải ${name} thất bại: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256(buf) !== FACE_DETECTOR_MODEL_SHA256) throw new Error(`Mã băm ${name} không khớp — dừng lại`);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  console.log(`✔ ${name} (${(buf.length / 1e3).toFixed(0)} KB)`);
}

async function main() {
  await downloadFaceDetector();
  if (await alreadyPresent()) {
    console.log(`✔ Model đã có trong ${OUT_DIR}`);
    return;
  }
  console.log(`Đang tải ${ZIP_URL} (~128 MB)…`);
  const res = await fetch(ZIP_URL);
  if (!res.ok) throw new Error(`Tải thất bại: HTTP ${res.status}`);
  const zip = Buffer.from(await res.arrayBuffer());
  if (sha256(zip) !== ZIP_SHA256) throw new Error("Mã băm file zip không khớp — dừng lại");

  const entries = extractEntries(zip, Object.keys(WANTED));
  await mkdir(OUT_DIR, { recursive: true });
  for (const [name, hash] of Object.entries(WANTED)) {
    const buf = entries.get(name);
    if (!buf) throw new Error(`Không thấy ${name} trong zip`);
    if (sha256(buf) !== hash) throw new Error(`Mã băm ${name} không khớp — dừng lại`);
    await writeFile(path.join(OUT_DIR, name), buf);
    console.log(`✔ ${name} (${(buf.length / 1e6).toFixed(1)} MB)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
