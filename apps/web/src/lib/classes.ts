import { DEFAULT_PERIODS, SHIFTS } from "@utc/shared/periods";

/** Kiểu dữ liệu & định dạng hiển thị dùng chung cho các trang lớp học (khu giảng viên). */

export interface Schedule {
  weekday: number;
  firstPeriod: number;
  lastPeriod: number;
  room: string | null;
}

export interface ClassSummary {
  id: string;
  code: string;
  courseName: string;
  semester: string | null;
  startDate: string;
  endDate: string;
  defaultRoom: string | null;
  activeStudents: number;
  schedules: Schedule[];
}

export const WEEKDAYS = [2, 3, 4, 5, 6, 7, 8] as const;

export function weekdayLabel(d: number) {
  return d === 8 ? "Chủ nhật" : `Thứ ${d}`;
}

/** Giờ theo bảng tiết mặc định (FR-010a) — chỉ để gợi ý trên giao diện; server dùng bảng tiết trong DB. */
export function periodRangeTime(first: number, last: number) {
  const a = DEFAULT_PERIODS.find((p) => p.number === first);
  const b = DEFAULT_PERIODS.find((p) => p.number === last);
  return a && b ? `${a.startsAt}–${b.endsAt}` : "";
}

export function shiftLabel(n: number) {
  const s = SHIFTS.find((x) => x.number === n);
  return s ? `Ca ${n} · tiết ${s.firstPeriod}–${s.lastPeriod} (${periodRangeTime(s.firstPeriod, s.lastPeriod)})` : `Ca ${n}`;
}

export function scheduleLabel(s: Schedule, defaultRoom?: string | null) {
  const room = s.room ?? defaultRoom;
  return `${weekdayLabel(s.weekday)} · T${s.firstPeriod}–${s.lastPeriod}${room ? ` · ${room}` : ""}`;
}

/** "2026-09-07" → "07/09/2026". */
export function vnDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

/** Số ngày giữa hai ngày YYYY-MM-DD (end − start); NaN nếu thiếu. */
export function daysBetween(start: string, end: string) {
  if (!start || !end) return NaN;
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
}

export const MAX_CLASS_DAYS = 105;
