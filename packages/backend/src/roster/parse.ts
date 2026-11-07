import ExcelJS from "exceljs";
import iconv from "iconv-lite";
import Papa from "papaparse";

/**
 * T044 — Đọc file danh sách lớp (.xlsx / .csv) thành bảng ô chuỗi thô (FR-011, FR-090).
 * Không tin đuôi file: loại file xác định bằng magic bytes. Việc nhận cột/validate nằm ở columns.ts.
 */

export type RosterFileErrorCode =
  | "EMPTY"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_TYPE"
  | "TOO_MANY_ROWS"
  | "SUSPICIOUS_ARCHIVE"
  | "CORRUPT_FILE";

export class RosterFileError extends Error {
  constructor(
    public readonly code: RosterFileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RosterFileError";
  }
}

export interface RosterLimits {
  maxBytes: number;
  /** Số dòng dữ liệu tối đa (chưa tính phần tiêu đề). */
  maxRows: number;
  maxUncompressedBytes: number;
  maxCompressionRatio: number;
  maxZipEntries: number;
}

export const ROSTER_LIMITS: RosterLimits = {
  maxBytes: 4 * 1024 * 1024, // dưới giới hạn body 4,5 MB của Vercel Functions (research.md R14)
  maxRows: 2_000,
  maxUncompressedBytes: 50 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxZipEntries: 1_000,
};

/** Số dòng đầu file được phép là quốc hiệu/tiêu đề trước bảng (khớp HEADER_SCAN_ROWS trong columns.ts). */
const HEADER_ALLOWANCE = 20;

export type Table = string[][];

export async function parseRosterFile(buf: Buffer, _filename: string, limits: Partial<RosterLimits> = {}): Promise<Table> {
  const lim = { ...ROSTER_LIMITS, ...limits };
  if (buf.length === 0) throw new RosterFileError("EMPTY", "File rỗng.");
  if (buf.length > lim.maxBytes) throw new RosterFileError("FILE_TOO_LARGE", "File vượt dung lượng cho phép (4 MB).");

  const kind = sniff(buf);
  if (kind === "zip") return parseXlsx(buf, lim);
  if (kind === "text") return parseCsv(buf, lim);
  throw new RosterFileError("UNSUPPORTED_TYPE", "Chỉ hỗ trợ file .xlsx hoặc .csv.");
}

function sniff(buf: Buffer): "zip" | "text" | "other" {
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) return "zip";
  // UTF-16 có BOM là văn bản hợp lệ dù chứa byte 0
  if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) return "text";
  const head = buf.subarray(0, 4096);
  for (const b of head) {
    // byte điều khiển ngoài \t \n \r → nhị phân (exe, .xls OLE, ảnh…)
    if (b === 0 || (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d)) return "other";
  }
  return "text";
}

// ---------------- CSV ----------------

/**
 * Giải mã CSV: BOM UTF-8/UTF-16, UTF-8 không BOM; nếu không phải UTF-8 thì là bảng mã ANSI của máy lưu file —
 * Windows-1258 (Windows tiếng Việt) hoặc Windows-1252 (Windows tiếng Anh, Excel đã thay chữ không có trong 1252
 * bằng '?'). Hai bảng mã trùng byte ở nhiều chỗ nên phải đoán (xem looksLikeCp1258).
 */
export function decodeCsvText(buf: Buffer): string {
  let text: string;
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) text = buf.subarray(3).toString("utf8");
  else if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.subarray(2).toString("utf16le");
  else if (buf[0] === 0xfe && buf[1] === 0xff) text = iconv.decode(buf.subarray(2), "utf16-be");
  else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
      text = iconv.decode(buf, looksLikeCp1258(buf) ? "windows-1258" : "windows-1252");
    }
  }
  // cp1258 dùng dấu thanh tổ hợp → đưa về dạng dựng sẵn để so khớp/lưu nhất quán
  return text.normalize("NFC");
}

/** Byte dấu thanh tổ hợp của cp1258 (huyền, hỏi, ngã, sắc, nặng) — trong cp1252 lại là Ì Ò Þ ì ò. */
const CP1258_TONES = new Set([0xcc, 0xd2, 0xde, 0xec, 0xf2]);
/** Nguyên âm trong cp1258 mà dấu thanh có thể đứng sau: a e i o u y (hoa/thường) + â ê ô ơ ư ă. */
const CP1258_VOWELS = new Set([
  ..."aeiouyAEIOUY".split("").map((c) => c.charCodeAt(0)),
  0xe2, 0xc2, 0xea, 0xca, 0xf4, 0xd4, 0xf5, 0xd5, 0xfd, 0xdd, 0xe3, 0xc3,
]);
const isLetterByte = (b: number | undefined) =>
  b !== undefined && ((b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b >= 0xc0);

/**
 * Đoán file ANSI là cp1258 hay cp1252:
 * 1. Có byte dấu thanh đứng sau phụ âm (vd. "Bình" của 1252: B + 0xEC) → không thể là 1258 → 1252.
 * 2. Có byte dấu thanh, tất cả đều sau nguyên âm → 1258 (dấu hiệu mạnh).
 * 3. Không có byte dấu thanh: có '?' dính vào chữ (Excel 1252 thay chữ không mã hoá được) → 1252; ngược lại → 1258.
 */
export function looksLikeCp1258(buf: Buffer): boolean {
  let tones = 0;
  for (let i = 0; i < buf.length; i++) {
    if (CP1258_TONES.has(buf[i])) {
      if (!CP1258_VOWELS.has(buf[i - 1])) return false;
      tones++;
    }
  }
  if (tones > 0) return true;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x3f && (isLetterByte(buf[i - 1]) || isLetterByte(buf[i + 1]))) return false;
  }
  return true;
}

function parseCsv(buf: Buffer, lim: RosterLimits): Table {
  const text = decodeCsvText(buf);
  const maxLines = lim.maxRows + HEADER_ALLOWANCE;
  const res = Papa.parse<string[]>(text, { skipEmptyLines: false, preview: maxLines + 1 });
  const rows = trimTrailingEmpty(res.data.map((r) => r.map((c) => (c ?? "").toString())));
  if (rows.length > maxLines) throw tooManyRows(lim);
  return rows;
}

// ---------------- XLSX ----------------

/**
 * Đọc central directory của file zip (không giải nén) để biết tổng kích thước sau giải nén.
 * Dùng để từ chối zip bomb trước khi đưa cho exceljs.
 */
export function inspectZip(buf: Buffer): { entries: number; totalUncompressed: number } {
  const EOCD = 0x06054b50;
  const CDH = 0x02014b50;
  const minPos = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new RosterFileError("CORRUPT_FILE", "File .xlsx bị hỏng.");

  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new RosterFileError("SUSPICIOUS_ARCHIVE", "File .xlsx có cấu trúc bất thường.");
  }
  if (cdOffset + cdSize > eocd) throw new RosterFileError("CORRUPT_FILE", "File .xlsx bị hỏng.");

  let p = cdOffset;
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== CDH) throw new RosterFileError("CORRUPT_FILE", "File .xlsx bị hỏng.");
    const uncompressed = buf.readUInt32LE(p + 24);
    if (uncompressed === 0xffffffff) throw new RosterFileError("SUSPICIOUS_ARCHIVE", "File .xlsx có cấu trúc bất thường.");
    total += uncompressed;
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return { entries: count, totalUncompressed: total };
}

async function parseXlsx(buf: Buffer, lim: RosterLimits): Promise<Table> {
  const { entries, totalUncompressed } = inspectZip(buf);
  if (
    entries > lim.maxZipEntries ||
    totalUncompressed > lim.maxUncompressedBytes ||
    totalUncompressed / buf.length > lim.maxCompressionRatio
  ) {
    throw new RosterFileError("SUSPICIOUS_ARCHIVE", "File .xlsx có tỉ lệ nén bất thường, hệ thống từ chối xử lý.");
  }

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new RosterFileError("CORRUPT_FILE", "Không đọc được file .xlsx.");
  }
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!ws) return [];
  const maxLines = lim.maxRows + HEADER_ALLOWANCE;
  if (ws.actualRowCount > maxLines) throw tooManyRows(lim);

  const table: Table = [];
  ws.eachRow({ includeEmpty: true }, (row, rowNo) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNo) => {
      cells[colNo - 1] = cellText(cell.value);
    });
    table[rowNo - 1] = Array.from(cells, (c) => c ?? "");
  });
  return trimTrailingEmpty(Array.from(table, (r) => r ?? []));
}

/**
 * Giá trị hiển thị của ô. Ô công thức → kết quả đã tính (không bao giờ lấy chuỗi công thức);
 * ô hyperlink → chữ hiển thị; rich text → nối các đoạn.
 */
export function cellText(v: ExcelJS.CellValue | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if ("formula" in v || "sharedFormula" in v) {
      const r = (v as { result?: unknown }).result;
      if (r && typeof r === "object" && "error" in r) return "";
      return cellText(r as ExcelJS.CellValue);
    }
    if ("hyperlink" in v && "text" in v) return cellText((v as { text: ExcelJS.CellValue }).text);
    if ("error" in v) return "";
  }
  return "";
}

function trimTrailingEmpty(rows: Table): Table {
  let end = rows.length;
  while (end > 0 && rows[end - 1].every((c) => !c || !c.trim())) end--;
  return rows.slice(0, end);
}

const tooManyRows = (lim: RosterLimits) =>
  new RosterFileError("TOO_MANY_ROWS", `File vượt quá ${lim.maxRows.toLocaleString("vi-VN")} dòng.`);
