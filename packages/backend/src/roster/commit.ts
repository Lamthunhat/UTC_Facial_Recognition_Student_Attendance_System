import "server-only";
import { getDb } from "@utc/database";
import { classes, enrollments, students } from "@utc/database/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { SessionClaims } from "../auth/jwt";
import { auditEnrollmentChange, auditRosterImported } from "../classes/audit";
import { refreshCardRetention } from "../card/retention";
import { HttpError } from "../http/errors";
import { cleanCell, extractRoster, STUDENT_CODE_RE, type ColumnMapping, type ExtractedRoster, type PreviewRow, type RosterStudent } from "./columns";
import { parseRosterFile, RosterFileError } from "./parse";

/**
 * T046 — Diff + lưu danh sách lớp (FR-013, FR-014): upsert students theo mã (một bản ghi toàn hệ thống),
 * enrollments active/withdrawn; không xoá ghi danh nào để giữ lịch sử điểm danh.
 * Kiểm quyền sở hữu lớp do tầng API (T049) đảm nhiệm trước khi gọi các hàm này.
 */

export type EnrollmentStatus = "active" | "withdrawn";

export interface RosterDiff {
  /** Chưa từng ghi danh lớp này. */
  added: string[];
  /** Đã rút, nay có lại trong file. */
  reactivated: string[];
  /** Đang học và vẫn có trong file. */
  existing: string[];
  /** Đang học nhưng không còn trong file → đánh dấu rút. */
  toWithdraw: string[];
}

export function diffRoster(fileCodes: string[], current: { code: string; status: EnrollmentStatus }[]): RosterDiff {
  const status = new Map(current.map((c) => [c.code, c.status]));
  const inFile = new Set<string>();
  const d: RosterDiff = { added: [], reactivated: [], existing: [], toWithdraw: [] };
  for (const code of fileCodes) {
    if (inFile.has(code)) continue;
    inFile.add(code);
    const s = status.get(code);
    if (s === undefined) d.added.push(code);
    else if (s === "withdrawn") d.reactivated.push(code);
    else d.existing.push(code);
  }
  for (const c of current) if (c.status === "active" && !inFile.has(c.code)) d.toWithdraw.push(c.code);
  return d;
}

export interface RosterSummary {
  valid: number;
  invalid: number;
  /** Số SV sẽ trở thành active do lần nhập này (mới + ghi danh lại). */
  new: number;
  reactivated: number;
  existing: number;
  toWithdraw: number;
}

export function summarizeRoster(rows: PreviewRow[], diff: RosterDiff): RosterSummary {
  const invalid = rows.filter((r) => r.errors.length).length;
  return {
    valid: rows.length - invalid,
    invalid,
    new: diff.added.length + diff.reactivated.length,
    reactivated: diff.reactivated.length,
    existing: diff.existing.length,
    toWithdraw: diff.toWithdraw.length,
  };
}

export type RosterWarning =
  | { code: "LARGE_WITHDRAWAL"; toWithdraw: number; active: number }
  | { code: "FORMULA_LIKE_NAMES"; rows: number[] }
  /** File lưu bằng bảng mã không hỗ trợ tiếng Việt (vd. Excel "CSV (Comma delimited)" trên Windows tiếng Anh). */
  | { code: "ENCODING_LOSS"; rows: number[] };

/** Rút quá nửa số SV đang học → cần giảng viên xác nhận (thường là nhầm file). */
export function isLargeWithdrawal(toWithdraw: number, active: number): boolean {
  return active > 0 && toWithdraw * 2 > active;
}

const FORMULA_PREFIX = /^[=+\-@]/;
/** "?" thay cho chữ có dấu trong tiêu đề ("H? ??m", "L?p") — nhưng không bắt "Ghi chú?" (dấu hỏi cuối từ). */
const HEADER_LOSS = /\?\p{L}|\p{L}\?(?=\p{L})|\?\?/u;

/** Cảnh báo hiển thị ở bản xem trước (không chặn lưu, trừ LARGE_WITHDRAWAL cần xác nhận ở commit). */
export function rosterWarnings(rows: PreviewRow[], summary: RosterSummary, headerCells: string[] = []): RosterWarning[] {
  const out: RosterWarning[] = [];
  const active = summary.existing + summary.toWithdraw;
  if (isLargeWithdrawal(summary.toWithdraw, active)) out.push({ code: "LARGE_WITHDRAWAL", toWithdraw: summary.toWithdraw, active });
  const formula = rows.filter((r) => FORMULA_PREFIX.test(r.data.lastName) || FORMULA_PREFIX.test(r.data.firstName)).map((r) => r.rowNo);
  if (formula.length) out.push({ code: "FORMULA_LIKE_NAMES", rows: formula });
  const lost = rows.filter((r) => r.errors.includes("LOST_CHARACTERS")).map((r) => r.rowNo);
  if (lost.length || headerCells.some((c) => HEADER_LOSS.test(c))) out.push({ code: "ENCODING_LOSS", rows: lost });
  return out;
}

type Db = Awaited<ReturnType<typeof getDb>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function enrollmentState(db: Db | Tx, classId: string) {
  return db
    .select({ studentId: enrollments.studentId, code: students.studentCode, status: enrollments.status })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .where(eq(enrollments.classId, classId));
}

export interface RosterPreview extends ExtractedRoster {
  summary: RosterSummary;
}

/** Đọc file + so với ghi danh hiện tại; KHÔNG ghi DB. Lỗi file → HttpError 413/422 có mã ổn định. */
export async function previewRoster(
  classId: string,
  file: Buffer,
  filename: string,
  columnMapping?: ColumnMapping,
  headerRowIndex?: number,
): Promise<RosterPreview> {
  let table;
  try {
    table = await parseRosterFile(file, filename);
  } catch (e) {
    if (e instanceof RosterFileError) throw new HttpError(e.code === "FILE_TOO_LARGE" ? 413 : 422, e.code, e.message);
    throw e;
  }
  const extracted = extractRoster(table, columnMapping, headerRowIndex);
  const codes = extracted.rows.filter((r) => !r.errors.length).map((r) => r.data.code);
  const current = await enrollmentState(await getDb(), classId);
  return { ...extracted, summary: summarizeRoster(extracted.rows, diffRoster(codes, current)) };
}

export interface CommitResult {
  added: number;
  reactivated: number;
  existing: number;
  withdrawn: number;
}

/**
 * Lưu danh sách đã xem trước (chỉ các dòng hợp lệ). Chạy trong một transaction, khoá dòng lớp
 * để hai lần nhập đồng thời của cùng lớp không xen nhau. Nhật ký `roster.import` ghi trong cùng transaction.
 */
export async function commitRoster(
  actor: SessionClaims,
  classId: string,
  list: RosterStudent[],
  opts: { confirmLargeWithdrawal?: boolean; invalidRows?: number } = {},
): Promise<CommitResult> {
  // Mã trùng trong danh sách gửi lên: giữ dòng đầu (khớp quy tắc của bản xem trước)
  const byCode = new Map<string, RosterStudent>();
  for (const s of list) if (!byCode.has(s.code)) byCode.set(s.code, s);
  if (byCode.size === 0) {
    throw new HttpError(422, "EMPTY_ROSTER", "Danh sách không có sinh viên hợp lệ nào; không lưu để tránh rút cả lớp.");
  }

  const db = await getDb();
  return db.transaction(async (tx) => {
    await lockClass(tx, classId);

    // Diff trên trạng thái đã khoá; kiểm rút hàng loạt trước mọi thao tác ghi.
    const current = await enrollmentState(tx, classId);
    const diff = diffRoster([...byCode.keys()], current);
    const currentId = new Map(current.map((c) => [c.code, c.studentId]));
    if (!opts.confirmLargeWithdrawal && isLargeWithdrawal(diff.toWithdraw.length, diff.existing.length + diff.toWithdraw.length)) {
      throw new HttpError(
        409,
        "LARGE_WITHDRAWAL_CONFIRM_REQUIRED",
        `Lần nhập này sẽ rút ${diff.toWithdraw.length} sinh viên (hơn một nửa lớp). Hãy kiểm tra lại file và xác nhận.`,
      );
    }

    // Không ghi đè họ tên của SV đã có (có thể do lớp khác nhập); chỉ bổ sung Lớp/Khoá còn trống.
    const upserted = await tx
      .insert(students)
      .values(
        [...byCode.values()].map((s) => ({
          studentCode: s.code,
          lastName: s.lastName,
          firstName: s.firstName,
          adminClass: s.adminClass,
          cohort: s.cohort,
        })),
      )
      .onConflictDoUpdate({
        target: students.studentCode,
        set: {
          adminClass: sql`coalesce(${students.adminClass}, excluded.admin_class)`,
          cohort: sql`coalesce(${students.cohort}, excluded.cohort)`,
        },
      })
      .returning({ id: students.id, code: students.studentCode });
    const idOf = new Map(upserted.map((r) => [r.code, r.id]));

    if (diff.added.length) {
      await tx
        .insert(enrollments)
        .values(diff.added.map((code) => ({ classId, studentId: idOf.get(code)! })))
        .onConflictDoNothing();
    }
    if (diff.reactivated.length) {
      await tx
        .update(enrollments)
        .set({ status: "active", withdrawnAt: null })
        .where(and(eq(enrollments.classId, classId), inArray(enrollments.studentId, diff.reactivated.map((c) => currentId.get(c)!))));
    }
    if (diff.toWithdraw.length) {
      await tx
        .update(enrollments)
        .set({ status: "withdrawn", withdrawnAt: sql`now()` })
        .where(and(eq(enrollments.classId, classId), inArray(enrollments.studentId, diff.toWithdraw.map((c) => currentId.get(c)!))));
    }

    const result: CommitResult = {
      added: diff.added.length,
      reactivated: diff.reactivated.length,
      existing: diff.existing.length,
      withdrawn: diff.toWithdraw.length,
    };
    await refreshCardRetention(tx, { classId }); // T064: ghi danh đổi → hạn giữ ảnh thẻ đổi
    await auditRosterImported(tx, actor, classId, { ...result, invalidRows: opts.invalidRows ?? 0 });
    return result;
  });
}

async function lockClass(tx: Tx, classId: string) {
  const locked = await tx.select({ id: classes.id }).from(classes).where(eq(classes.id, classId)).for("update");
  if (!locked.length) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy lớp học phần.");
}

export interface EnrollmentChange {
  enrollment: { studentId: string; code: string; status: EnrollmentStatus };
  /** Trạng thái ghi danh có thay đổi không (false = gọi lại, không làm gì). */
  changed: boolean;
  /** Vừa tạo ghi danh mới (API trả 201). */
  created: boolean;
}

/**
 * FR-015 — Thêm một SV vào lớp. SV chưa có trong hệ thống cần họ + tên; SV đã có chỉ cần mã
 * (không ghi đè họ tên đã lưu). SV đã rút → ghi danh lại.
 */
export async function addStudent(
  actor: SessionClaims,
  classId: string,
  rawCode: string,
  info: { lastName?: string; firstName?: string; adminClass?: string | null; cohort?: string | null } = {},
): Promise<EnrollmentChange> {
  const code = rawCode.trim();
  if (!STUDENT_CODE_RE.test(code)) throw new HttpError(422, "INVALID_CODE", "Mã sinh viên phải gồm 6–12 chữ số.");
  const db = await getDb();
  return db.transaction(async (tx) => {
    await lockClass(tx, classId);
    let [s] = await tx.select({ id: students.id }).from(students).where(eq(students.studentCode, code)).limit(1);
    if (!s) {
      const lastName = cleanCell(info.lastName);
      const firstName = cleanCell(info.firstName);
      if (!lastName || !firstName) {
        throw new HttpError(422, "STUDENT_INFO_REQUIRED", "Sinh viên chưa có trong hệ thống — cần nhập họ và tên.");
      }
      [s] = await tx
        .insert(students)
        .values({ studentCode: code, lastName, firstName, adminClass: cleanCell(info.adminClass) || null, cohort: cleanCell(info.cohort) || null })
        .onConflictDoUpdate({ target: students.studentCode, set: { studentCode: sql`excluded.student_code` } })
        .returning({ id: students.id });
    }
    const [e] = await tx
      .select({ status: enrollments.status })
      .from(enrollments)
      .where(and(eq(enrollments.classId, classId), eq(enrollments.studentId, s.id)))
      .limit(1);
    const enrollment = { studentId: s.id, code, status: "active" as const };
    let r: EnrollmentChange;
    if (!e) {
      await tx.insert(enrollments).values({ classId, studentId: s.id });
      r = { enrollment, changed: true, created: true };
    } else if (e.status === "withdrawn") {
      await tx
        .update(enrollments)
        .set({ status: "active", withdrawnAt: null })
        .where(and(eq(enrollments.classId, classId), eq(enrollments.studentId, s.id)));
      r = { enrollment, changed: true, created: false };
    } else {
      r = { enrollment, changed: false, created: false };
    }
    if (r.changed) await refreshCardRetention(tx, { studentIds: [s.id] });
    await auditEnrollmentChange(tx, actor, classId, "add", r);
    return r;
  });
}

/** FR-014/FR-015 — Rút một SV: chỉ đổi trạng thái, giữ bản ghi và lịch sử điểm danh. */
export async function withdrawStudent(actor: SessionClaims, classId: string, rawCode: string): Promise<EnrollmentChange> {
  const code = rawCode.trim();
  const notEnrolled = new HttpError(404, "NOT_ENROLLED", "Sinh viên không thuộc lớp này.");
  if (!STUDENT_CODE_RE.test(code)) throw notEnrolled;
  const db = await getDb();
  return db.transaction(async (tx) => {
    await lockClass(tx, classId);
    const [row] = await tx
      .select({ studentId: enrollments.studentId, status: enrollments.status })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(and(eq(enrollments.classId, classId), eq(students.studentCode, code)))
      .limit(1);
    if (!row) throw notEnrolled;
    const enrollment = { studentId: row.studentId, code, status: "withdrawn" as const };
    if (row.status === "withdrawn") return { enrollment, changed: false, created: false };
    await tx
      .update(enrollments)
      .set({ status: "withdrawn", withdrawnAt: sql`now()` })
      .where(and(eq(enrollments.classId, classId), eq(enrollments.studentId, row.studentId)));
    const r: EnrollmentChange = { enrollment, changed: true, created: false };
    await refreshCardRetention(tx, { studentIds: [row.studentId] });
    await auditEnrollmentChange(tx, actor, classId, "withdraw", r);
    return r;
  });
}
