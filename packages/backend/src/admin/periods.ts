import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "@utc/database";
import { periods } from "@utc/database/schema";
import { writeAudit } from "../audit";
import type { SessionClaims } from "../auth/jwt";
import { HttpError } from "../http/errors";

/** T037 — Bảng 16 tiết học do Admin quản lý (FR-010a). */
const hhmm = (t: string) => t.slice(0, 5);
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export async function listPeriods() {
  const db = await getDb();
  const rows = await db.select().from(periods).orderBy(asc(periods.number));
  return rows.map((p) => ({ number: p.number, partOfDay: p.partOfDay, startsAt: hhmm(p.startsAt), endsAt: hhmm(p.endsAt) }));
}

export async function replacePeriods(actor: SessionClaims, input: { number: number; startsAt: string; endsAt: string }[]) {
  const sorted = [...input].sort((a, b) => a.number - b.number);
  const numbers = sorted.map((p) => p.number).join(",");
  if (numbers !== Array.from({ length: 16 }, (_, i) => i + 1).join(","))
    throw new HttpError(422, "INVALID_PERIODS", "Cần đủ 16 tiết, đánh số 1–16.");
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    if (minutes(p.endsAt) <= minutes(p.startsAt))
      throw new HttpError(422, "INVALID_PERIODS", `Tiết ${p.number}: giờ kết thúc phải sau giờ bắt đầu.`);
    if (i > 0 && minutes(p.startsAt) < minutes(sorted[i - 1].endsAt))
      throw new HttpError(422, "INVALID_PERIODS", `Tiết ${p.number} bắt đầu trước khi tiết ${sorted[i - 1].number} kết thúc.`);
  }
  const db = await getDb();
  const before = await listPeriods();
  await db.transaction(async (tx) => {
    for (const p of sorted) {
      await tx
        .update(periods)
        .set({ startsAt: sql`${p.startsAt}::time`, endsAt: sql`${p.endsAt}::time` })
        .where(eq(periods.number, p.number));
    }
  });
  const changed = sorted.filter((p, i) => p.startsAt !== before[i].startsAt || p.endsAt !== before[i].endsAt);
  if (changed.length) await writeAudit(actor, "periods.update", { type: "periods", id: "all" }, { changed });
  return listPeriods();
}
