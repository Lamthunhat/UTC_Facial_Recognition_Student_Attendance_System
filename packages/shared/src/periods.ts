/**
 * T024 — Tiết học, ca học và quy đổi sang thời điểm tuyệt đối theo giờ Việt Nam (UTC+7, không đổi giờ mùa hè).
 * Bảng tiết mặc định theo thông báo của trường (FR-010a); Admin có thể sửa trong DB — các hàm nhận bảng tuỳ chọn.
 */
export interface Period {
  number: number;
  partOfDay: "sang" | "chieu" | "toi";
  startsAt: string; // "HH:MM" giờ VN
  endsAt: string;
}

export const DEFAULT_PERIODS: readonly Period[] = [
  { number: 1, partOfDay: "sang", startsAt: "07:00", endsAt: "07:45" },
  { number: 2, partOfDay: "sang", startsAt: "07:50", endsAt: "08:35" },
  { number: 3, partOfDay: "sang", startsAt: "08:40", endsAt: "09:25" },
  { number: 4, partOfDay: "sang", startsAt: "09:35", endsAt: "10:20" },
  { number: 5, partOfDay: "sang", startsAt: "10:25", endsAt: "11:10" },
  { number: 6, partOfDay: "sang", startsAt: "11:15", endsAt: "12:00" },
  { number: 7, partOfDay: "chieu", startsAt: "13:00", endsAt: "13:45" },
  { number: 8, partOfDay: "chieu", startsAt: "13:50", endsAt: "14:35" },
  { number: 9, partOfDay: "chieu", startsAt: "14:40", endsAt: "15:25" },
  { number: 10, partOfDay: "chieu", startsAt: "15:35", endsAt: "16:20" },
  { number: 11, partOfDay: "chieu", startsAt: "16:25", endsAt: "17:10" },
  { number: 12, partOfDay: "chieu", startsAt: "17:15", endsAt: "18:00" },
  { number: 13, partOfDay: "toi", startsAt: "18:15", endsAt: "19:00" },
  { number: 14, partOfDay: "toi", startsAt: "19:05", endsAt: "19:50" },
  { number: 15, partOfDay: "toi", startsAt: "19:55", endsAt: "20:40" },
  { number: 16, partOfDay: "toi", startsAt: "20:45", endsAt: "21:30" },
];

export const SHIFTS = [
  { number: 1, firstPeriod: 1, lastPeriod: 3 },
  { number: 2, firstPeriod: 4, lastPeriod: 6 },
  { number: 3, firstPeriod: 7, lastPeriod: 9 },
  { number: 4, firstPeriod: 10, lastPeriod: 12 },
  { number: 5, firstPeriod: 13, lastPeriod: 16 },
] as const;

export function shiftToPeriods(shift: number) {
  const s = SHIFTS.find((x) => x.number === shift);
  if (!s) throw new RangeError(`Ca ${shift} không tồn tại`);
  return { firstPeriod: s.firstPeriod, lastPeriod: s.lastPeriod };
}

const VN_OFFSET_MIN = 7 * 60;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-11-14" + "07:00" (giờ VN) → Date (UTC). */
export function vnDateTime(date: string, hhmm: string): Date {
  if (!DATE_RE.test(date)) throw new RangeError(`Ngày không hợp lệ: ${date}`);
  const [h, m] = hhmm.split(":").map(Number);
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m) - VN_OFFSET_MIN * 60_000);
}

export function sessionTimes(
  date: string,
  firstPeriod: number,
  lastPeriod: number,
  periods: readonly Period[] = DEFAULT_PERIODS,
) {
  const first = periods.find((p) => p.number === firstPeriod);
  const last = periods.find((p) => p.number === lastPeriod);
  if (!first || !last) throw new RangeError("Tiết không tồn tại");
  if (firstPeriod > lastPeriod) throw new RangeError("Tiết đầu phải ≤ tiết cuối");
  return { startsAt: vnDateTime(date, first.startsAt), endsAt: vnDateTime(date, last.endsAt) };
}

/** Ngày (YYYY-MM-DD) theo giờ Việt Nam của một thời điểm. */
export function vnDateOf(instant: Date): string {
  return new Date(instant.getTime() + VN_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

export function isSameVnDay(date: string, instant: Date): boolean {
  return vnDateOf(instant) === date;
}
