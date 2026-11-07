/**
 * T043 — Sinh fixtures nhập danh sách lớp (dữ liệu giả, không phải SV thật).
 * Chạy lại: pnpm --filter @utc/backend exec tsx tests/fixtures/generate-roster-fixtures.ts
 *
 * - roster-40.xlsx: 3 dòng tiêu đề + 1 dòng trống trước bảng; 40 dòng dữ liệu, mã lưu dạng SỐ.
 *     dòng file 30 trùng mã với dòng 15 (231230810), dòng file 37 thiếu Tên → 38 SV hợp lệ (Q2).
 * - roster-ansi.csv: mã hoá Windows-1258 (dấu thanh tổ hợp), tiêu đề "MSSV" (Q3).
 * - roster-formula.xlsx: chuỗi '=HYPERLINK(…)', ô công thức HYPERLINK có kết quả, ô hyperlink (S6).
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import iconv from "iconv-lite";

const OUT = __dirname;

const LAST = ["Nguyễn Văn", "Trần Thị", "Lê Minh", "Phạm Quốc", "Hoàng Thị", "Vũ Đức", "Đặng Thu", "Bùi Thanh", "Đỗ Hữu", "Ngô Thị"];
const FIRST = ["An", "Bình", "Cường", "Dũng", "Giang", "Hà", "Hải", "Hương", "Khánh", "Linh", "Long", "Mai", "Nam", "Ngọc", "Phúc", "Quân", "Sơn", "Thảo", "Trang", "Tuấn"];

async function roster40() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("DSSV");
  ws.addRow(["TRƯỜNG ĐẠI HỌC GIAO THÔNG VẬN TẢI"]);
  ws.addRow(["DANH SÁCH SINH VIÊN LỚP HỌC PHẦN"]);
  ws.addRow(["Học phần: Khai phá dữ liệu-1-1-26(N03.BT1)"]);
  ws.addRow([]);
  ws.addRow(["STT", "Mã sinh viên", "Họ đệm", "Tên", "Lớp", "Khóa"]); // dòng 5
  for (let i = 0; i < 40; i++) {
    let code = 231230801 + i;
    let first = i === 0 ? "An" : FIRST[i % FIRST.length];
    const last = i === 0 ? "Nguyễn Văn" : LAST[i % LAST.length];
    if (i === 24) code = 231230810; // trùng mã với i = 9 (dòng file 15) → dòng file 30 lỗi
    if (i === 31) first = ""; // dòng file 37 thiếu tên
    ws.addRow([i + 1, code, last, first, i % 3 === 0 ? "CNTT3" : "CNTT4", "K64"]);
  }
  await wb.xlsx.writeFile(path.join(OUT, "roster-40.xlsx"));
}

/** Chuỗi NFC → dạng cp1258: nguyên âm có mũ/móc dựng sẵn + dấu thanh tổ hợp. */
function toCp1258Form(s: string): string {
  const TONES = new Set(["̀", "́", "̃", "̉", "̣"]);
  let out = "";
  for (const ch of s.normalize("NFC")) {
    const d = ch.normalize("NFD");
    const tones = [...d].filter((c) => TONES.has(c)).join("");
    const base = [...d].filter((c) => !TONES.has(c)).join("").normalize("NFC");
    out += base + tones;
  }
  return out;
}

async function rosterAnsi() {
  const rows = [
    ["MSSV", "Họ đệm", "Tên", "Lớp"],
    ["221230501", "Trần Đức", "Hải", "CNTT1"],
    ["221230502", "Lê Thị Ngọc", "Ánh", "CNTT1"],
    ["221230503", "Phạm Quốc", "Việt", "CNTT2"],
    ["221230504", "Hoàng Minh", "Đức", "CNTT2"],
    ["221230505", "Vũ Thị Thu", "Hường", "CNTT2"],
  ];
  const text = toCp1258Form(rows.map((r) => r.join(",")).join("\r\n") + "\r\n");
  const buf = iconv.encode(text, "windows-1258");
  if (iconv.decode(buf, "windows-1258").normalize("NFC") !== text.normalize("NFC")) {
    throw new Error("Không mã hoá được trọn vẹn sang Windows-1258");
  }
  await writeFile(path.join(OUT, "roster-ansi.csv"), buf);
}

async function rosterFormula() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["Mã SV", "Họ", "Tên", "Lớp"]);
  ws.addRow(["231230901", '=HYPERLINK("http://x","bấm")', "An", "CNTT3"]); // chuỗi văn bản, không phải công thức
  ws.addRow(["231230902", { formula: 'HYPERLINK("http://evil.example","Trần")', result: "Trần" }, "Bình", "CNTT3"]);
  ws.addRow(["231230903", "Lê", { text: "Cường", hyperlink: "http://evil.example" }, "CNTT3"]);
  await wb.xlsx.writeFile(path.join(OUT, "roster-formula.xlsx"));
}

async function main() {
  await roster40();
  await rosterAnsi();
  await rosterFormula();
  console.log("Đã sinh roster-40.xlsx, roster-ansi.csv, roster-formula.xlsx");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
