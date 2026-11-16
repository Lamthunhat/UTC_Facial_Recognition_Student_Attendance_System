import { vnDateOf, vnDateTime } from "@utc/shared/periods";

/**
 * Tính giờ cho buổi/khung điểm danh — thuần, theo đồng hồ server (FR-038). Giờ VN = UTC+7 cố định.
 */
const MIN = 60_000;
const DAY = 86_400_000;

/** Khung check-out tự mở: [giờ kết thúc tiết cuối − before, + after] (FR-023, research R7). */
export function checkoutWindowTimes(endsAt: Date, beforeMin: number, afterMin: number) {
  return { opensAt: new Date(endsAt.getTime() - beforeMin * MIN), closesAt: new Date(endsAt.getTime() + afterMin * MIN) };
}

export interface WindowTimes {
  opensAt: Date;
  closesAt: Date;
  closedEarlyAt: Date | null;
}

/** Đang mở ⇔ opens_at ≤ now < coalesce(closed_early_at, closes_at) (data-model). */
export function isWindowOpen(w: WindowTimes, now: Date): boolean {
  const end = w.closedEarlyAt ?? w.closesAt;
  return w.opensAt.getTime() <= now.getTime() && now.getTime() < end.getTime();
}

/** Số phút muộn = thời điểm lượt − thời điểm GV mở khung check-in (FR-073), 2 chữ số, không âm. */
export function lateMinutes(serverTime: Date, checkinOpensAt: Date): number {
  return Math.max(0, Math.round(((serverTime.getTime() - checkinOpensAt.getTime()) / MIN) * 100) / 100);
}

/** Thứ theo quy ước class_schedules: Thứ 2 = 2 … Thứ 7 = 7, Chủ nhật = 8. */
export function vnWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = CN
  return d === 0 ? 8 : d + 1;
}

/** Hồ sơ điểm danh giữ tới hết ngày thứ 30 sau ngày kết thúc lớp: 00:00 giờ VN ngày (end_date + 31) — FR-114. */
export const RECORD_RETENTION_DAYS = 30;
export function recordPurgeAfter(classEndDate: string): Date {
  const next = vnDateOf(new Date(vnDateTime(classEndDate, "12:00").getTime() + (RECORD_RETENTION_DAYS + 1) * DAY));
  return vnDateTime(next, "00:00");
}

/** Ảnh bằng chứng + vector khuôn mặt của lượt: xoá sau 7 ngày kể từ lúc chụp (FR-052). */
export const EVIDENCE_RETENTION_DAYS = 7;
export const evidencePurgeAfter = (serverTime: Date) => new Date(serverTime.getTime() + EVIDENCE_RETENTION_DAYS * DAY);
