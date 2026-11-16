import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type AppDb } from "@utc/database";
import { attendanceWindows, classes, classSchedules, periods, sessions } from "@utc/database/schema";
import { sessionTimes, vnDateOf, type Period } from "@utc/shared/periods";
import { writeAudit } from "../audit";
import { isUuid } from "../auth/guards";
import type { SessionClaims } from "../auth/jwt";
import { now } from "../clock";
import { HttpError, notFound } from "../http/errors";
import { checkoutWindowTimes, isWindowOpen, vnWeekday } from "./window-times";

/**
 * T074 — Buổi học & khung điểm danh (FR-020…FR-025, FR-010c/d, research R7). Mọi mốc giờ theo đồng hồ server (clock.ts).
 * - Mở check-in: buổi theo lịch HÔM NAY (hoặc học bù khai báo tiết + phòng); lưu vị trí GV làm tâm cả buổi + sai số;
 *   khung check-in [now, now + thời lượng); tạo luôn khung check-out [kết thúc tiết cuối − trước, + sau] (tự mở theo
 *   giờ — "đang mở" tính theo now(), không cần cron). "Muộn" tính từ thời điểm mở check-in (FR-073).
 * - Đổi phòng / bỏ check-out (trước giờ kết thúc buổi), đóng sớm, kiểm tra đột xuất 3–5 phút.
 * - Mỗi thay đổi ghi audit_logs trong CÙNG transaction (Constitution III).
 * Vị trí GV chỉ trả cho GV; API SV không bao giờ trả tâm buổi (Constitution I).
 */
export const LOW_GPS_ACCURACY_WARN_M = 50;
export const SPOT_CHECK = { defaultMin: 5, min: 3, max: 5 } as const;

export const OpenCheckinSchema = z
  .object({
    kind: z.enum(["scheduled", "makeup"]).default("scheduled"),
    date: z.iso.date().optional(),
    firstPeriod: z.number().int().min(1).max(16).optional(),
    lastPeriod: z.number().int().min(1).max(16).optional(),
    room: z.string().trim().min(1).max(50).optional(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracyM: z.number().positive().max(100_000),
    checkinMinutes: z.number().int().min(1).max(60).optional(),
    radiusM: z.number().int().min(10).max(500).optional(),
  })
  .strict();
export type OpenCheckinInput = z.infer<typeof OpenCheckinSchema>;

export const PatchSessionSchema = z
  .object({ room: z.string().trim().min(1).max(50).optional(), checkoutSkipped: z.boolean().optional() })
  .strict()
  .refine((b) => b.room !== undefined || b.checkoutSkipped !== undefined, { message: "Cần ít nhất một thay đổi." });

export const SpotCheckSchema = z.object({ minutes: z.number().int().min(SPOT_CHECK.min).max(SPOT_CHECK.max).optional() }).strict();

const MIN = 60_000;

type WindowRow = typeof attendanceWindows.$inferSelect;
export function windowView(w: WindowRow, at: Date = now()) {
  return {
    id: w.id,
    type: w.type,
    opensAt: w.opensAt.toISOString(),
    closesAt: w.closesAt.toISOString(),
    closedEarlyAt: w.closedEarlyAt?.toISOString() ?? null,
    radiusM: w.radiusM,
    open: isWindowOpen(w, at),
  };
}
type SessionRow = typeof sessions.$inferSelect;
const sessionView = (s: SessionRow) => ({
  id: s.id,
  date: s.date,
  firstPeriod: s.firstPeriod,
  lastPeriod: s.lastPeriod,
  startsAt: s.startsAt.toISOString(),
  endsAt: s.endsAt.toISOString(),
  room: s.room,
  kind: s.kind,
  checkoutSkipped: s.checkoutSkipped,
  center: s.centerLat === null ? null : { lat: s.centerLat, lng: s.centerLng, accuracyM: s.centerAccuracyM },
});

async function loadPeriods(db: AppDb): Promise<Period[]> {
  const rows = await db.select().from(periods).orderBy(asc(periods.number));
  return rows.map((p) => ({ number: p.number, partOfDay: p.partOfDay, startsAt: p.startsAt, endsAt: p.endsAt }));
}

async function loadClass(db: AppDb, classId: string) {
  const [c] = await db.select().from(classes).where(eq(classes.id, classId)).limit(1);
  if (!c) throw notFound();
  return c;
}

/** GET /api/classes/{id}/sessions/today — lịch hôm nay (+ buổi học bù đã mở) kèm khung. */
export async function todaySessions(classId: string) {
  const db = await getDb();
  const at = now();
  const today = vnDateOf(at);
  const cls = await loadClass(db, classId);
  const pers = await loadPeriods(db);
  const inRange = cls.startDate <= today && today <= cls.endDate;
  const planned = inRange
    ? await db
        .select()
        .from(classSchedules)
        .where(and(eq(classSchedules.classId, classId), eq(classSchedules.weekday, vnWeekday(today))))
        .orderBy(asc(classSchedules.firstPeriod))
    : [];
  const existing = await db.select().from(sessions).where(and(eq(sessions.classId, classId), eq(sessions.date, today)));
  const wins = existing.length
    ? await db
        .select()
        .from(attendanceWindows)
        .where(sql`${attendanceWindows.sessionId} in (${sql.join(existing.map((s) => sql`${s.id}::uuid`), sql`, `)})`)
        .orderBy(asc(attendanceWindows.opensAt))
    : [];
  const out = planned.map((p) => {
    const s = existing.find((e) => e.firstPeriod === p.firstPeriod);
    const t = sessionTimes(today, p.firstPeriod, p.lastPeriod, pers);
    return {
      sessionId: s?.id ?? null,
      kind: s?.kind ?? ("scheduled" as const),
      firstPeriod: p.firstPeriod,
      lastPeriod: p.lastPeriod,
      startsAt: (s?.startsAt ?? t.startsAt).toISOString(),
      endsAt: (s?.endsAt ?? t.endsAt).toISOString(),
      room: s?.room ?? p.room ?? cls.defaultRoom ?? "",
      checkoutSkipped: s?.checkoutSkipped ?? false,
      windows: s ? wins.filter((w) => w.sessionId === s.id).map((w) => windowView(w, at)) : [],
    };
  });
  for (const s of existing.filter((e) => !planned.some((p) => p.firstPeriod === e.firstPeriod))) {
    out.push({
      sessionId: s.id,
      kind: s.kind,
      firstPeriod: s.firstPeriod,
      lastPeriod: s.lastPeriod,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      room: s.room,
      checkoutSkipped: s.checkoutSkipped,
      windows: wins.filter((w) => w.sessionId === s.id).map((w) => windowView(w, at)),
    });
  }
  return out.sort((a, b) => a.firstPeriod - b.firstPeriod);
}

const unprocessable = (code: string, message: string) => new HttpError(422, code, message);

/** POST /api/classes/{id}/sessions/open-checkin */
export async function openCheckin(actor: SessionClaims, classId: string, input: OpenCheckinInput) {
  const db = await getDb();
  const at = now();
  const today = vnDateOf(at);
  if (input.date !== undefined && input.date !== today) {
    throw unprocessable("DATE_NOT_TODAY", "Chỉ mở điểm danh được cho buổi học hôm nay.");
  }
  const cls = await loadClass(db, classId);
  if (today < cls.startDate || today > cls.endDate) {
    throw unprocessable("OUTSIDE_CLASS_DATES", "Hôm nay nằm ngoài thời gian học của lớp.");
  }
  const pers = await loadPeriods(db);

  let firstPeriod: number;
  let lastPeriod: number;
  let room: string | null;
  if (input.kind === "makeup") {
    if (input.firstPeriod === undefined || input.lastPeriod === undefined || input.lastPeriod < input.firstPeriod) {
      throw unprocessable("VALIDATION_ERROR", "Buổi học bù cần tiết bắt đầu và tiết kết thúc hợp lệ.");
    }
    firstPeriod = input.firstPeriod;
    lastPeriod = input.lastPeriod;
    room = input.room ?? cls.defaultRoom;
  } else {
    const todays = await db
      .select()
      .from(classSchedules)
      .where(and(eq(classSchedules.classId, classId), eq(classSchedules.weekday, vnWeekday(today))))
      .orderBy(asc(classSchedules.firstPeriod));
    const pick =
      input.firstPeriod !== undefined
        ? todays.find((s) => s.firstPeriod === input.firstPeriod && (input.lastPeriod === undefined || s.lastPeriod === input.lastPeriod))
        : todays.find((s) => sessionTimes(today, s.firstPeriod, s.lastPeriod, pers).endsAt > at);
    if (!pick) {
      throw unprocessable(
        "NO_SCHEDULE",
        todays.length ? "Không có buổi học tương ứng trong lịch hôm nay." : "Lớp không có lịch học hôm nay — chọn \"Học bù\" để mở.",
      );
    }
    firstPeriod = pick.firstPeriod;
    lastPeriod = pick.lastPeriod;
    room = input.room ?? pick.room ?? cls.defaultRoom;
  }
  if (!room) throw unprocessable("VALIDATION_ERROR", "Cần nhập phòng học.");
  const { startsAt, endsAt } = sessionTimes(today, firstPeriod, lastPeriod, pers);
  if (at >= endsAt) throw new HttpError(409, "SESSION_ENDED", "Buổi học đã kết thúc.");

  const minutes = input.checkinMinutes ?? cls.checkinMinutes;
  const radiusM = input.radiusM ?? cls.radiusM;
  const out = await db.transaction(async (tx) => {
    const [found] = await tx
      .select()
      .from(sessions)
      .where(and(eq(sessions.classId, classId), eq(sessions.date, today), eq(sessions.firstPeriod, firstPeriod)))
      .for("update")
      .limit(1);
    if (found) {
      const [hasCheckin] = await tx
        .select({ id: attendanceWindows.id })
        .from(attendanceWindows)
        .where(and(eq(attendanceWindows.sessionId, found.id), eq(attendanceWindows.type, "check_in")))
        .limit(1);
      if (hasCheckin) throw new HttpError(409, "CHECKIN_EXISTS", "Buổi học này đã mở điểm danh.");
    }
    const values = { room, centerLat: input.lat, centerLng: input.lng, centerAccuracyM: input.accuracyM };
    const [session] = found
      ? await tx.update(sessions).set(values).where(eq(sessions.id, found.id)).returning()
      : await tx
          .insert(sessions)
          .values({ classId, date: today, firstPeriod, lastPeriod, startsAt, endsAt, kind: input.kind, ...values })
          .returning();
    const [checkin] = await tx
      .insert(attendanceWindows)
      .values({ sessionId: session.id, type: "check_in", opensAt: at, closesAt: new Date(at.getTime() + minutes * MIN), radiusM })
      .returning();
    const co = checkoutWindowTimes(session.endsAt, cls.checkoutOffsetBeforeMin, cls.checkoutOffsetAfterMin);
    const [checkout] = await tx
      .insert(attendanceWindows)
      .values({ sessionId: session.id, type: "check_out", opensAt: co.opensAt, closesAt: co.closesAt, radiusM })
      .returning();
    await writeAudit(
      actor,
      "session.open_checkin",
      { type: "session", id: session.id },
      { classId, kind: input.kind, firstPeriod, lastPeriod, room, minutes, radiusM, accuracyM: input.accuracyM },
      tx,
    );
    return { session, checkin, checkout };
  });
  return {
    session: sessionView(out.session),
    checkinWindow: windowView(out.checkin, at),
    checkoutWindow: windowView(out.checkout, at),
    warnings: input.accuracyM > LOW_GPS_ACCURACY_WARN_M ? ["LOW_GPS_ACCURACY"] : [],
  };
}

/** PATCH /api/sessions/{id} — đổi phòng (trước giờ kết thúc buổi), bỏ / bật lại check-out. */
export async function patchSession(actor: SessionClaims, sessionId: string, input: z.infer<typeof PatchSessionSchema>) {
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for("update").limit(1);
    if (!s) throw notFound();
    if (at >= s.endsAt) throw new HttpError(409, "SESSION_ENDED", "Buổi học đã kết thúc, không sửa được.");
    const [u] = await tx
      .update(sessions)
      .set({ ...(input.room !== undefined ? { room: input.room } : {}), ...(input.checkoutSkipped !== undefined ? { checkoutSkipped: input.checkoutSkipped } : {}) })
      .where(eq(sessions.id, sessionId))
      .returning();
    await writeAudit(
      actor,
      "session.update",
      { type: "session", id: sessionId },
      { before: { room: s.room, checkoutSkipped: s.checkoutSkipped }, after: { room: u.room, checkoutSkipped: u.checkoutSkipped } },
      tx,
    );
    return { session: sessionView(u) };
  });
}

/** Khung + quyền: GV sở hữu lớp của khung (admin mọi lớp). Không thuộc quyền → 404. */
export async function assertOwnsWindow(actor: SessionClaims, windowId: string) {
  if (!isUuid(windowId)) throw notFound();
  const db = await getDb();
  const [r] = await db
    .select({ instructorId: classes.instructorId })
    .from(attendanceWindows)
    .innerJoin(sessions, eq(sessions.id, attendanceWindows.sessionId))
    .innerJoin(classes, eq(classes.id, sessions.classId))
    .where(eq(attendanceWindows.id, windowId))
    .limit(1);
  if (!r || (actor.role !== "admin" && r.instructorId !== actor.sub)) throw notFound();
}

/** POST /api/windows/{id}/close — đóng sớm khung đang mở. */
export async function closeWindow(actor: SessionClaims, windowId: string) {
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const [w] = await tx.select().from(attendanceWindows).where(eq(attendanceWindows.id, windowId)).for("update").limit(1);
    if (!w) throw notFound();
    if (!isWindowOpen(w, at)) throw new HttpError(409, "WINDOW_NOT_OPEN", "Khung điểm danh không đang mở.");
    const [u] = await tx.update(attendanceWindows).set({ closedEarlyAt: at }).where(eq(attendanceWindows.id, windowId)).returning();
    await writeAudit(actor, "window.close", { type: "attendance_window", id: windowId }, { type: w.type }, tx);
    return { window: windowView(u, at) };
  });
}

/** POST /api/sessions/{id}/spot-check — kiểm tra đột xuất (FR-021/022), tâm + bán kính như check-in. */
export async function openSpotCheck(actor: SessionClaims, sessionId: string, input: z.infer<typeof SpotCheckSchema>) {
  const db = await getDb();
  const at = now();
  const minutes = input.minutes ?? SPOT_CHECK.defaultMin;
  try {
    return await db.transaction(async (tx) => {
      const [s] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for("update").limit(1);
      if (!s) throw notFound();
      const [ci] = await tx
        .select()
        .from(attendanceWindows)
        .where(and(eq(attendanceWindows.sessionId, sessionId), eq(attendanceWindows.type, "check_in")))
        .limit(1);
      if (!ci || s.centerLat === null) throw new HttpError(409, "CHECKIN_NOT_OPENED", "Buổi học chưa mở check-in.");
      if (at >= s.endsAt) throw new HttpError(409, "SESSION_ENDED", "Buổi học đã kết thúc.");
      const [w] = await tx
        .insert(attendanceWindows)
        .values({ sessionId, type: "spot_check", opensAt: at, closesAt: new Date(at.getTime() + minutes * MIN), radiusM: ci.radiusM })
        .returning();
      await writeAudit(actor, "session.spot_check", { type: "session", id: sessionId }, { windowId: w.id, minutes }, tx);
      return { window: windowView(w, at) };
    });
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    // exclusion constraint no_overlapping_windows (FR-025): đang có khung đột xuất chồng giờ
    if (err?.code === "23P01" || err?.cause?.code === "23P01") {
      throw new HttpError(409, "SPOT_CHECK_OPEN", "Đang có một lượt kiểm tra đột xuất chưa kết thúc.");
    }
    throw e;
  }
}
