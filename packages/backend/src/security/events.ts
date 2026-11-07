import "server-only";
import { getDb } from "@utc/database";
import { securityEvents } from "@utc/database/schema";
import { log } from "../log";
import { redact } from "../log";

/** T030 — Ghi sự kiện bảo mật vào bảng security_events (FR-095). Không làm hỏng request nếu ghi lỗi. */
export type SecurityEventType = (typeof securityEvents.$inferInsert)["type"];

export async function recordSecurityEvent(
  type: SecurityEventType,
  info: { ip?: string | null; actorId?: string | null; meta?: Record<string, unknown> } = {},
) {
  try {
    const db = await getDb();
    await db.insert(securityEvents).values({
      type,
      ip: info.ip ?? null,
      actorId: info.actorId ?? null,
      meta: info.meta ? (redact(info.meta) as Record<string, unknown>) : null,
    });
  } catch (err) {
    log.error("security_event_write_failed", { type, err: String(err) });
  }
}
