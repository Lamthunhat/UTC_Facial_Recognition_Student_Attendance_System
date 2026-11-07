import { removeVietnameseTones } from "@utc/shared/vn-text";
import type { Table } from "./parse";

/**
 * T045 — Nhận diện cột danh sách lớp (có/không dấu, nhiều cách gọi) và validate từng dòng (FR-011, FR-012).
 * Hàm thuần, không I/O.
 */

export type RosterField = "code" | "lastName" | "firstName" | "fullName" | "adminClass" | "cohort";
export type ColumnMapping = Partial<Record<RosterField, number>>;

export type RowError =
  | "EMPTY_ROW"
  | "MISSING_CODE"
  | "INVALID_CODE"
  | "MISSING_LAST_NAME"
  | "MISSING_FIRST_NAME"
  | "DUPLICATE_CODE"
  /** Họ/tên chứa "?" — chữ có dấu đã bị thay khi lưu file bằng bảng mã không hỗ trợ tiếng Việt. */
  | "LOST_CHARACTERS";

export interface RosterStudent {
  code: string;
  lastName: string;
  firstName: string;
  adminClass: string | null;
  cohort: string | null;
}

export interface PreviewRow {
  /** Số dòng trong file (1-based) để giảng viên dò lại. */
  rowNo: number;
  data: RosterStudent;
  errors: RowError[];
}

export const STUDENT_CODE_RE = /^[0-9]{6,12}$/;
export const HEADER_SCAN_ROWS = 20;

/** Tên cột đã chuẩn hoá và bỏ khoảng trắng → trường. So khớp nguyên văn (không chứa-chuỗi) để "Tên lớp" ≠ "Tên". */
const SYNONYMS: Record<RosterField, string[]> = {
  code: ["masv", "masinhvien", "mssv", "msv", "masosinhvien", "masosv", "mahssv", "studentid", "studentcode"],
  lastName: ["ho", "hodem", "hovadem", "holot", "hovatendem", "lastname"],
  firstName: ["ten", "firstname"],
  fullName: ["hovaten", "hoten", "hotensinhvien", "hovatensinhvien", "fullname"],
  adminClass: ["lop", "lophanhchinh", "lopsinhhoat", "lophc", "lopsh", "lopquanly", "tenlop", "class"],
  cohort: ["khoa", "khoahoc", "nienkhoa", "cohort"],
};
const LOOKUP = new Map<string, RosterField>(
  (Object.entries(SYNONYMS) as [RosterField, string[]][]).flatMap(([f, names]) => names.map((n) => [n, f] as const)),
);

export function normalizeHeader(h: string): string {
  return removeVietnameseTones(h ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function detectColumns(headers: string[]): { mapping: ColumnMapping; missing: RosterField[] } {
  const mapping: ColumnMapping = {};
  headers.forEach((h, i) => {
    const f = LOOKUP.get(normalizeHeader(h).replace(/ /g, ""));
    if (f && mapping[f] === undefined) mapping[f] = i;
  });
  return { mapping, missing: missingFields(mapping) };
}

/** Cột bắt buộc: Mã SV, Họ + Tên (hoặc một cột Họ và tên), Lớp. Khoá tuỳ chọn. */
export function missingFields(m: ColumnMapping): RosterField[] {
  const missing: RosterField[] = [];
  const hasFull = m.fullName !== undefined;
  if (m.code === undefined) missing.push("code");
  if (!hasFull && m.firstName !== undefined && m.lastName === undefined) missing.push("lastName");
  if (!hasFull && m.firstName === undefined) missing.push("firstName");
  if (m.adminClass === undefined) missing.push("adminClass");
  return missing;
}

/** Dòng tiêu đề = dòng đầu tiên (trong 20 dòng đầu) có cột mã SV và ít nhất một cột tên. */
export function findHeaderRow(table: Table, maxScan = HEADER_SCAN_ROWS): number {
  for (let i = 0; i < Math.min(table.length, maxScan); i++) {
    const { mapping: m } = detectColumns(table[i] ?? []);
    if (m.code !== undefined && (m.firstName !== undefined || m.lastName !== undefined || m.fullName !== undefined)) return i;
  }
  return -1;
}

/** NFC + gộp khoảng trắng + trim — dùng chung cho ô file và dữ liệu nhập tay. */
export const cleanCell = (v: string | null | undefined) => (v ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const clean = cleanCell;
const cleanCode = (v: string | undefined) => clean(v).replace(/^'/, "").replace(/\s/g, "");

export function validateRows(rows: Table, mapping: ColumnMapping, opts: { firstRowNo?: number } = {}): PreviewRow[] {
  const firstRowNo = opts.firstRowNo ?? 1;
  const isEmpty = (r: string[] | undefined) => !r || r.every((c) => !clean(c));
  let end = rows.length;
  while (end > 0 && isEmpty(rows[end - 1])) end--;

  const seen = new Set<string>();
  const out: PreviewRow[] = [];
  for (let i = 0; i < end; i++) {
    const r = rows[i] ?? [];
    const at = (f: RosterField) => (mapping[f] === undefined ? "" : r[mapping[f]!]);

    let lastName = clean(at("lastName"));
    let firstName = clean(at("firstName"));
    if (mapping.fullName !== undefined && mapping.firstName === undefined) {
      const full = clean(at("fullName"));
      const cut = full.lastIndexOf(" ");
      firstName = cut < 0 ? full : full.slice(cut + 1);
      lastName = cut < 0 ? "" : full.slice(0, cut);
    }
    const data: RosterStudent = {
      code: cleanCode(at("code")),
      lastName,
      firstName,
      adminClass: clean(at("adminClass")) || null,
      cohort: clean(at("cohort")) || null,
    };

    const errors: RowError[] = [];
    if (isEmpty(r)) errors.push("EMPTY_ROW");
    else {
      if (!data.code) errors.push("MISSING_CODE");
      else if (!STUDENT_CODE_RE.test(data.code)) errors.push("INVALID_CODE");
      if (!data.lastName) errors.push("MISSING_LAST_NAME");
      if (!data.firstName) errors.push("MISSING_FIRST_NAME");
      if (data.lastName.includes("?") || data.firstName.includes("?")) errors.push("LOST_CHARACTERS");
      // Chỉ dòng hợp lệ mới "giữ" mã; dòng sau trùng mã bị đánh dấu.
      if (!errors.length) {
        if (seen.has(data.code)) errors.push("DUPLICATE_CODE");
        else seen.add(data.code);
      }
    }
    out.push({ rowNo: firstRowNo + i, data, errors });
  }
  return out;
}

export interface ExtractedRoster {
  /** Chỉ số (0-based) dòng tiêu đề trong bảng; -1 nếu không tìm thấy. */
  headerRowIndex: number;
  /** Ô của dòng tiêu đề (hoặc dòng đầu tiên khi không tìm thấy) — để UI ghép cột thủ công. */
  headerCells: string[];
  columnsDetected: ColumnMapping;
  missing: RosterField[];
  rows: PreviewRow[];
}

/**
 * Bảng thô → bản xem trước. `columnMapping` (ghép cột thủ công trên UI) ghi đè nhận diện tự động;
 * khi đó có thể chỉ định `headerRowIndex` (mặc định: dòng tiêu đề tìm được, hoặc 0).
 */
export function extractRoster(table: Table, columnMapping?: ColumnMapping, headerRowIndex?: number): ExtractedRoster {
  let header = headerRowIndex ?? findHeaderRow(table);
  let mapping: ColumnMapping;
  if (columnMapping) {
    if (header < 0) header = 0;
    mapping = { ...columnMapping };
  } else {
    if (header < 0) {
      // Không xác định được dòng tiêu đề: vẫn gợi ý các cột nhận ra ở dòng đầu để giảng viên chỉ ghép phần còn thiếu.
      const guess = detectColumns(table[0] ?? []).mapping;
      return { headerRowIndex: -1, headerCells: headerCellsOf(table, 0), columnsDetected: guess, missing: missingFields(guess), rows: [] };
    }
    mapping = detectColumns(table[header]).mapping;
  }
  const missing = missingFields(mapping);
  const rows = missing.length ? [] : validateRows(table.slice(header + 1), mapping, { firstRowNo: header + 2 });
  return { headerRowIndex: header, headerCells: headerCellsOf(table, header), columnsDetected: mapping, missing, rows };
}

function headerCellsOf(table: Table, index: number): string[] {
  return Array.from(table[index] ?? [], (c) => cleanCell(c)).slice(0, 256);
}
