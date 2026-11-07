import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@utc/database";
import { students } from "@utc/database/schema";
import { CONSENT_VERSION } from "@utc/shared/consent";
import { writeAudit } from "../audit";
import type { SessionClaims } from "../auth/jwt";
import { HttpError } from "../http/errors";

/**
 * T060 — Đồng ý xử lý dữ liệu sinh trắc (FR-050, Constitution IV): lưu thời điểm + phiên bản văn bản.
 * Mọi API thẻ/khuôn mặt gọi requireConsent trước khi làm gì khác (403 CONSENT_REQUIRED).
 */
export async function giveConsent(actor: SessionClaims, version: string) {
  if (version !== CONSENT_VERSION) {
    throw new HttpError(422, "CONSENT_VERSION_MISMATCH", "Văn bản điều khoản đã được cập nhật. Vui lòng đọc lại và đồng ý.");
  }
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(students).set({ consentAt: sql`now()`, consentVersion: version }).where(eq(students.id, actor.sub));
    await writeAudit(actor, "consent.give", { type: "student", id: actor.sub }, { version }, tx);
  });
}

export const consentRequired = () =>
  new HttpError(403, "CONSENT_REQUIRED", "Bạn cần đồng ý điều khoản xử lý ảnh thẻ và ảnh khuôn mặt trước khi tiếp tục.");

/** Chưa đồng ý, hoặc đồng ý phiên bản cũ → 403 CONSENT_REQUIRED. */
export async function requireConsent(studentId: string) {
  const db = await getDb();
  const [s] = await db
    .select({ at: students.consentAt, version: students.consentVersion })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  if (!s?.at || s.version !== CONSENT_VERSION) throw consentRequired();
}
