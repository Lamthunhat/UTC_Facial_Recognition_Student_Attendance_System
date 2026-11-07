import "server-only";
import { and, asc, count, eq, inArray, max, min, ne } from "drizzle-orm";
import { getDb } from "@utc/database";
import { classes, classSchedules, enrollments, sessions, users } from "@utc/database/schema";
import { shiftToPeriods, SHIFTS } from "@utc/shared/periods";
import type { SessionClaims } from "../auth/jwt";
import { forbidden, HttpError, notFound } from "../http/errors";
import { auditClassCreated, auditClassUpdated } from "./audit";

/**
 * T047 — Lớp học phần (FR-010…FR-010d): tạo/sửa, ≤ 15 tuần (105 ngày), lịch nhiều buổi/tuần theo tiết hoặc ca,
 * phòng mặc định + phòng riêng từng buổi, cấu hình bán kính/thời lượng.
 * Kiểm tra nghiệp vụ ở đây (trả 422 có mã ổn định) — ràng buộc CHECK trong DB chỉ là lớp bảo vệ cuối.
 * Kiểm quyền sở hữu lớp (assertOwnsClass) do tầng API gọi trước.
 */

export const MAX_CLASS_DAYS = 105;
const PERIOD_MIN = 1;
const PERIOD_MAX = 16;

export interface ScheduleInput {
  weekday: number;
  /** Chọn nhanh theo ca 1–5 (FR-010b); loại trừ với firstPeriod/lastPeriod. */
  shift?: number;
  firstPeriod?: number;
  lastPeriod?: number;
  room?: string | null;
}

export interface Schedule {
  weekday: number;
  firstPeriod: number;
  lastPeriod: number;
  room: string | null;
}

interface ClassSettings {
  defaultRoom?: string | null;
  semester?: string | null;
  radiusM?: number;
  checkinMinutes?: number;
  checkoutOffsetBeforeMin?: number;
  checkoutOffsetAfterMin?: number;
  leaveAutoApprove?: boolean;
}

export interface CreateClassInput extends ClassSettings {
  code: string;
  courseName: string;
  startDate: string;
  endDate: string;
  schedules: ScheduleInput[];
  /** Chỉ admin dùng: tạo lớp cho giảng viên này. */
  instructorId?: string;
}

export interface UpdateClassInput extends ClassSettings {
  code?: string;
  courseName?: string;
  startDate?: string;
  endDate?: string;
  schedules?: ScheduleInput[];
}

export type ClassView = Awaited<ReturnType<typeof getClass>>;

const invalidSchedule = (msg: string) => new HttpError(422, "INVALID_SCHEDULE", msg);

/** Chuẩn hoá + kiểm lịch học: thứ 2–8, tiết 1–16, tiết đầu ≤ tiết cuối, ca hợp lệ, không chồng tiết cùng thứ. */
export function normalizeSchedules(input: ScheduleInput[]): Schedule[] {
  if (!Array.isArray(input) || input.length === 0) throw invalidSchedule("Lớp cần ít nhất một buổi học trong tuần.");
  if (input.length > 14) throw invalidSchedule("Quá nhiều buổi học trong tuần.");
  const out: Schedule[] = input.map((s) => {
    if (!Number.isInteger(s.weekday) || s.weekday < 2 || s.weekday > 8) throw invalidSchedule("Thứ phải từ Thứ 2 đến Chủ nhật.");
    let first: number;
    let last: number;
    if (s.shift !== undefined) {
      if (s.firstPeriod !== undefined || s.lastPeriod !== undefined) throw invalidSchedule("Chọn theo ca hoặc theo tiết, không chọn cả hai.");
      if (!SHIFTS.some((x) => x.number === s.shift)) throw invalidSchedule(`Ca ${s.shift} không tồn tại.`);
      ({ firstPeriod: first, lastPeriod: last } = shiftToPeriods(s.shift));
    } else {
      if (s.firstPeriod === undefined || s.lastPeriod === undefined) throw invalidSchedule("Cần chọn tiết bắt đầu và tiết kết thúc.");
      first = s.firstPeriod;
      last = s.lastPeriod;
    }
    for (const p of [first, last]) {
      if (!Number.isInteger(p) || p < PERIOD_MIN || p > PERIOD_MAX) throw invalidSchedule("Tiết phải từ 1 đến 16.");
    }
    if (first > last) throw invalidSchedule("Tiết bắt đầu phải trước hoặc bằng tiết kết thúc.");
    const room = s.room?.trim() || null;
    return { weekday: s.weekday, firstPeriod: first, lastPeriod: last, room };
  });
  out.sort((a, b) => a.weekday - b.weekday || a.firstPeriod - b.firstPeriod);
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1];
    const b = out[i];
    if (a.weekday === b.weekday && b.firstPeriod <= a.lastPeriod) throw invalidSchedule("Hai buổi học cùng thứ bị trùng tiết.");
  }
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function dayNumber(d: string): number {
  const t = DATE_RE.test(d) ? Date.parse(`${d}T00:00:00Z`) : NaN;
  if (Number.isNaN(t)) throw new HttpError(422, "INVALID_DATE", `Ngày không hợp lệ: ${d}`);
  return t / 86_400_000;
}

/** Ngày kết thúc ≥ ngày bắt đầu và không quá 15 tuần (FR-010). */
export function assertClassDuration(startDate: string, endDate: string) {
  const days = dayNumber(endDate) - dayNumber(startDate);
  if (days < 0) throw new HttpError(422, "INVALID_DATE_RANGE", "Ngày kết thúc phải sau ngày bắt đầu.");
  if (days > MAX_CLASS_DAYS) throw new HttpError(422, "DURATION_EXCEEDED", "Lớp học phần không được kéo dài quá 15 tuần.");
}

function settingsToRow(s: ClassSettings) {
  const row: Partial<typeof classes.$inferInsert> = {};
  if (s.defaultRoom !== undefined) row.defaultRoom = s.defaultRoom?.trim() || null;
  if (s.semester !== undefined) row.semester = s.semester?.trim() || null;
  if (s.radiusM !== undefined) row.radiusM = s.radiusM;
  if (s.checkinMinutes !== undefined) row.checkinMinutes = s.checkinMinutes;
  if (s.checkoutOffsetBeforeMin !== undefined) row.checkoutOffsetBeforeMin = s.checkoutOffsetBeforeMin;
  if (s.checkoutOffsetAfterMin !== undefined) row.checkoutOffsetAfterMin = s.checkoutOffsetAfterMin;
  if (s.leaveAutoApprove !== undefined) row.leaveAutoApprove = s.leaveAutoApprove;
  return row;
}

type Db = Awaited<ReturnType<typeof getDb>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function assertCodeFree(db: Db | Tx, instructorId: string, code: string, exceptId?: string) {
  const conds = [eq(classes.instructorId, instructorId), eq(classes.code, code)];
  if (exceptId) conds.push(ne(classes.id, exceptId));
  const dup = await db.select({ id: classes.id }).from(classes).where(and(...conds)).limit(1);
  if (dup.length) throw new HttpError(409, "CLASS_CODE_EXISTS", "Bạn đã có lớp học phần với mã này.");
}

const isUniqueViolation = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
};

async function resolveInstructor(db: Db, actor: SessionClaims, requested?: string): Promise<string> {
  if (actor.role === "instructor") {
    if (requested && requested !== actor.sub) throw forbidden();
    return actor.sub;
  }
  if (actor.role !== "admin") throw forbidden();
  if (!requested) throw new HttpError(422, "INSTRUCTOR_REQUIRED", "Cần chọn giảng viên phụ trách lớp.");
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, requested), eq(users.role, "instructor")))
    .limit(1);
  if (!u) throw notFound("Không tìm thấy giảng viên.");
  return u.id;
}

export async function createClass(actor: SessionClaims, input: CreateClassInput): Promise<ClassView> {
  const code = input.code.trim();
  const courseName = input.courseName.trim();
  if (!code || !courseName) throw new HttpError(422, "VALIDATION_ERROR", "Cần nhập mã lớp và tên học phần.");
  assertClassDuration(input.startDate, input.endDate);
  const schedules = normalizeSchedules(input.schedules);

  const db = await getDb();
  const instructorId = await resolveInstructor(db, actor, input.instructorId);
  await assertCodeFree(db, instructorId, code);
  let id: string;
  try {
    id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(classes)
        .values({ instructorId, code, courseName, startDate: input.startDate, endDate: input.endDate, ...settingsToRow(input) })
        .returning({ id: classes.id });
      await tx.insert(classSchedules).values(schedules.map((s) => ({ classId: row.id, ...s })));
      await auditClassCreated(tx, actor, { id: row.id, code });
      return row.id;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, "CLASS_CODE_EXISTS", "Bạn đã có lớp học phần với mã này.");
    throw e;
  }
  return getClass(id);
}

export async function updateClass(actor: SessionClaims, id: string, patch: UpdateClassInput): Promise<ClassView> {
  // Quyền đã kiểm ở tầng API (assertOwnsClass); actor dùng để ghi nhật ký.
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(classes).where(eq(classes.id, id)).for("update");
    if (!cur) throw notFound();

    const set: Partial<typeof classes.$inferInsert> = settingsToRow(patch);
    if (patch.courseName !== undefined) {
      if (!patch.courseName.trim()) throw new HttpError(422, "VALIDATION_ERROR", "Tên học phần không được trống.");
      set.courseName = patch.courseName.trim();
    }
    if (patch.code !== undefined) {
      const code = patch.code.trim();
      if (!code) throw new HttpError(422, "VALIDATION_ERROR", "Mã lớp không được trống.");
      await assertCodeFree(tx, cur.instructorId, code, id);
      set.code = code;
    }
    if (patch.startDate !== undefined || patch.endDate !== undefined) {
      const start = patch.startDate ?? cur.startDate;
      const end = patch.endDate ?? cur.endDate;
      assertClassDuration(start, end);
      const [range] = await tx
        .select({ first: min(sessions.date), last: max(sessions.date) })
        .from(sessions)
        .where(eq(sessions.classId, id));
      if (range?.last && end < range.last) {
        throw new HttpError(422, "END_BEFORE_LAST_SESSION", `Ngày kết thúc không được trước buổi học đã có (${range.last}).`);
      }
      if (range?.first && start > range.first) {
        throw new HttpError(422, "START_AFTER_FIRST_SESSION", `Ngày bắt đầu không được sau buổi học đã có (${range.first}).`);
      }
      set.startDate = start;
      set.endDate = end;
    }
    const schedules = patch.schedules !== undefined ? normalizeSchedules(patch.schedules) : undefined;
    if (Object.keys(set).length === 0 && !schedules) throw new HttpError(422, "NOTHING_TO_UPDATE", "Không có thay đổi nào.");

    if (Object.keys(set).length) await tx.update(classes).set(set).where(eq(classes.id, id));
    if (schedules) {
      // Thay lịch hằng tuần; các buổi (sessions) đã tạo giữ nguyên.
      await tx.delete(classSchedules).where(eq(classSchedules.classId, id));
      await tx.insert(classSchedules).values(schedules.map((s) => ({ classId: id, ...s })));
    }
    const fields = (Object.keys(patch) as (keyof UpdateClassInput)[]).filter((k) => patch[k] !== undefined);
    await auditClassUpdated(tx, actor, id, fields);
  });
  return getClass(id);
}

export async function getClass(id: string) {
  const db = await getDb();
  const [c] = await db.select().from(classes).where(eq(classes.id, id)).limit(1);
  if (!c) throw notFound();
  const schedules = await db
    .select({ weekday: classSchedules.weekday, firstPeriod: classSchedules.firstPeriod, lastPeriod: classSchedules.lastPeriod, room: classSchedules.room })
    .from(classSchedules)
    .where(eq(classSchedules.classId, id))
    .orderBy(asc(classSchedules.weekday), asc(classSchedules.firstPeriod));
  const [{ n }] = await db
    .select({ n: count() })
    .from(enrollments)
    .where(and(eq(enrollments.classId, id), eq(enrollments.status, "active")));
  return { ...c, schedules, activeStudents: Number(n) };
}

/** Giảng viên: lớp của mình; admin: mọi lớp. */
export async function listClasses(actor: SessionClaims) {
  const db = await getDb();
  const rows = await db
    .select({
      id: classes.id,
      code: classes.code,
      courseName: classes.courseName,
      semester: classes.semester,
      startDate: classes.startDate,
      endDate: classes.endDate,
      defaultRoom: classes.defaultRoom,
      instructorId: classes.instructorId,
    })
    .from(classes)
    .where(actor.role === "admin" ? undefined : eq(classes.instructorId, actor.sub))
    .orderBy(asc(classes.startDate), asc(classes.code));
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id);
  const sched = await db.select().from(classSchedules).where(inArray(classSchedules.classId, ids));
  const counts = await db
    .select({ classId: enrollments.classId, n: count() })
    .from(enrollments)
    .where(and(inArray(enrollments.classId, ids), eq(enrollments.status, "active")))
    .groupBy(enrollments.classId);
  const countOf = new Map(counts.map((c) => [c.classId, Number(c.n)]));
  return rows.map((r) => ({
    ...r,
    activeStudents: countOf.get(r.id) ?? 0,
    schedules: sched
      .filter((s) => s.classId === r.id)
      .sort((a, b) => a.weekday - b.weekday || a.firstPeriod - b.firstPeriod)
      .map(({ weekday, firstPeriod, lastPeriod, room }) => ({ weekday, firstPeriod, lastPeriod, room })),
  }));
}
