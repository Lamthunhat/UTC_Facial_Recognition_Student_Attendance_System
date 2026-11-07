import "server-only";
import { getDb, type AppDb } from "@utc/database";
import { auditLogs } from "@utc/database/schema";
import type { SessionClaims } from "./auth/jwt";
import { redact } from "./log";

/**
 * Ghi nhật ký thao tác (Constitution III): ai, làm gì, trên đối tượng nào, lúc nào.
 * Truyền `tx` khi đang ở trong transaction để nhật ký và thay đổi cùng commit/rollback:
 * ghi nhật ký lỗi thì thay đổi bị huỷ, không có thay đổi nào "lọt" mà thiếu dấu vết.
 */
export async function writeAudit(
  actor: SessionClaims | null,
  action: string,
  target?: { type: string; id: string },
  meta?: Record<string, unknown>,
  tx?: AppDb,
) {
  const db = tx ?? (await getDb());
  await db.insert(auditLogs).values({
    actorType: actor?.role ?? "system",
    actorId: actor?.sub ?? null,
    action,
    targetType: target?.type ?? null,
    targetId: target?.id ?? null,
    meta: meta ? (redact(meta) as Record<string, unknown>) : null,
  });
}
