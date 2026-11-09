/**
 * Hiệu chỉnh đọc thẻ trên ẢNH THẺ THẬT — chạy hoàn toàn cục bộ (research R3, PORTRAIT_RULES).
 *   pnpm --filter @utc/backend calibrate:card <thư mục ảnh>
 * Đặt tên file theo mã SV đúng, ví dụ 231230801.jpg, để script đối chiếu mã đọc được.
 *
 * QUY TẮC DỮ LIỆU (Constitution IV): chỉ dùng ảnh của người đã đồng ý bằng văn bản; script KHÔNG upload,
 * KHÔNG ghi file, KHÔNG gửi dữ liệu đi đâu — chỉ in số đo ra màn hình. Xoá ảnh ngay sau khi đo; không commit.
 *
 * In ra cho mỗi ảnh: mã vạch đọc được (định dạng + nội dung), mã từ OCR, số khuôn mặt, cạnh ngắn khung mặt (px trên
 * ảnh đã thu về ≤ 1280 px như pipeline thật), độ nét chân dung, và độ nét của chính ảnh đó khi làm mờ giả lập
 * (Gauss σ=2, σ=4) — để chọn ngưỡng nằm giữa "ảnh rõ thật" và "ảnh mờ".
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { closeOcr, ocrText, readBarcodeTexts } from "../src/card/decode";
import { extractStudentCode, pickBarcodeCode, PORTRAIT_RULES } from "../src/card/verify";
import { detectFaces } from "../src/face/detect";
import { decodeToRgb, imageQuality } from "../src/face/image";

process.env.FACE_MODELS_DIR ??= path.resolve(__dirname, "../../../apps/web/models");

const fmt = (n: number, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : "-");

async function portraitStats(buf: Buffer) {
  const rgb = await decodeToRgb(buf, 1280);
  const faces = await detectFaces(rgb, { scoreThreshold: 0.5 });
  return faces.map((f) => ({
    side: Math.min(f.box.x2 - f.box.x1, f.box.y2 - f.box.y1),
    score: f.score,
    sharpness: imageQuality(rgb, f.box).sharpness,
  }));
}

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("Cần thư mục ảnh: pnpm --filter @utc/backend calibrate:card <thư mục>");
  const files = (await readdir(dir)).filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(f)).sort();
  if (!files.length) throw new Error(`Không có ảnh trong ${dir}`);

  const rows: { file: string; barcodeOk: boolean; ocrOk: boolean; sides: number[]; sharp: number[]; blur2: number[]; blur4: number[] }[] = [];
  for (const file of files) {
    const expected = path.parse(file).name.match(/\d{6,12}/)?.[0] ?? null;
    const buf = await readFile(path.join(dir, file));
    const t0 = performance.now();
    const barcodes = await readBarcodeTexts(buf);
    const t1 = performance.now();
    const text = await ocrText(buf);
    const t2 = performance.now();
    const faces = await portraitStats(buf);
    const t3 = performance.now();
    const blur2 = await portraitStats(await sharp(buf).blur(2).jpeg().toBuffer());
    const blur4 = await portraitStats(await sharp(buf).blur(4).jpeg().toBuffer());

    const fromBarcode = pickBarcodeCode(barcodes);
    const fromOcr = extractStudentCode(text);
    const barcodeOk = !!expected && fromBarcode === expected;
    const ocrOk = !!expected && fromOcr === expected;
    rows.push({ file, barcodeOk, ocrOk, sides: faces.map((f) => f.side), sharp: faces.map((f) => f.sharpness), blur2: blur2.map((f) => f.sharpness), blur4: blur4.map((f) => f.sharpness) });

    console.log(`\n■ ${file}${expected ? ` (mã đúng: ${expected})` : " (tên file không có mã — không đối chiếu được)"}`);
    console.log(`  mã vạch: ${barcodes.length ? barcodes.join(" | ") : "không đọc được"} → ${fromBarcode ?? "-"} ${expected ? (barcodeOk ? "✓" : "✗") : ""}  (${fmt(t1 - t0, 0)} ms)`);
    console.log(`  OCR mã:  ${fromOcr ?? "không tìm thấy"} ${expected ? (ocrOk ? "✓" : "✗") : ""}  (${fmt(t2 - t1, 0)} ms)`);
    console.log(`  khuôn mặt: ${faces.length}  (${fmt(t3 - t2, 0)} ms)`);
    faces.forEach((f, i) =>
      console.log(`    #${i + 1}: cạnh ${fmt(f.side, 0)} px, score ${fmt(f.score, 2)}, nét ${fmt(f.sharpness)} | mờ σ2: ${fmt(blur2[i]?.sharpness ?? NaN)} | mờ σ4: ${fmt(blur4[i]?.sharpness ?? NaN)}`),
    );
  }

  const withFace = rows.filter((r) => r.sides.length === 1);
  const minSide = Math.min(...withFace.map((r) => r.sides[0]));
  const minSharp = Math.min(...withFace.map((r) => r.sharp[0]));
  const maxBlur4 = Math.max(...withFace.map((r) => r.blur4[0] ?? 0));
  console.log("\n════════ TỔNG KẾT ════════");
  console.log(`ảnh: ${rows.length} | mã vạch đúng: ${rows.filter((r) => r.barcodeOk).length} | OCR đúng: ${rows.filter((r) => r.ocrOk).length} | đúng 1 khuôn mặt: ${withFace.length}`);
  console.log(`R3 — mã vạch thẻ UTC mã hoá mã SV? ${rows.some((r) => r.barcodeOk) ? "CÓ (ít nhất một thẻ)" : "CHƯA thấy — OCR là đường chính"}`);
  console.log(`cạnh mặt nhỏ nhất (ảnh thật): ${fmt(minSide, 0)} px   → ngưỡng hiện tại ${PORTRAIT_RULES.minFaceSide} px`);
  console.log(`độ nét nhỏ nhất (ảnh thật):  ${fmt(minSharp)}        → ngưỡng hiện tại ${PORTRAIT_RULES.minSharpness}`);
  console.log(`độ nét lớn nhất khi mờ σ4:    ${fmt(maxBlur4)}`);
  console.log("Gợi ý: chọn minSharpness nằm giữa 'mờ σ4 lớn nhất' và 'ảnh thật nhỏ nhất'; minFaceSide ≈ 60–70% cạnh nhỏ nhất.");
  console.log("\nNHỚ: xoá toàn bộ ảnh thẻ ngay bây giờ (Constitution IV).");
  await closeOcr();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await closeOcr();
  process.exit(1);
});
