import { DEFAULT_PERIODS, SHIFTS } from "@utc/shared/periods";

/**
 * T021 — Seed 16 tiết (FR-010a) + 5 ca (FR-010b). Idempotent: chạy lại chỉ cập nhật giờ.
 * Trả về SQL thuần (không có tham số người dùng) để chạy được cả trên Postgres lẫn PGlite.
 */
export function seedPeriodsSql(): string {
  const periods = DEFAULT_PERIODS.map(
    (p) => `(${p.number}, '${p.partOfDay}', '${p.startsAt}', '${p.endsAt}')`,
  ).join(",\n  ");
  const shifts = SHIFTS.map((s) => `(${s.number}, ${s.firstPeriod}, ${s.lastPeriod})`).join(",\n  ");
  return `
insert into periods (number, part_of_day, starts_at, ends_at) values
  ${periods}
on conflict (number) do update set part_of_day = excluded.part_of_day, starts_at = excluded.starts_at, ends_at = excluded.ends_at;
insert into shifts (number, first_period, last_period) values
  ${shifts}
on conflict (number) do update set first_period = excluded.first_period, last_period = excluded.last_period;
`;
}
