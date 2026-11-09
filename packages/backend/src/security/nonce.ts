import "server-only";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from "@utc/database";
import { scanNonces } from "@utc/database/schema";
import { isUuid } from "../auth/guards";
import { HttpError } from "../http/errors";
import { recordSecurityEvent } from "./events";

/**
 * T059 — Nonce dùng một lần cho thao tác nặng (đọc thẻ, quét mặt) — FR-082, Principle I.
 * Cấp bởi server, gắn với SV + mục đích (+ khung giờ), hạn 2 phút; tiêu thụ nguyên tử bằng một câu UPDATE
 * nên hai request dùng cùng nonce song song chỉ một cái thành công.
 */
export const NONCE_TTL_SEC = 120;

export type NoncePurpose = "card" | "checkin";

export async function issueNonce(
  studentId: string,
  purpose: NoncePurpose,
  opts: { windowId?: string; challenge?: unknown; ttlSec?: number } = {},
) {
  const db = await getDb();
  const [row] = await db
    .insert(scanNonces)
    .values({
      studentId,
      purpose,
      windowId: opts.windowId ?? null,
      challenge: opts.challenge ?? null,
      expiresAt: sql`now() + ${`${opts.ttlSec ?? NONCE_TTL_SEC} seconds`}::interval`,
    })
    .returning({ nonce: scanNonces.nonce, expiresAt: scanNonces.expiresAt, challenge: scanNonces.challenge });
  return row;
}

export const badNonce = () =>
  new HttpError(403, "BAD_NONCE", "Phiên chụp đã hết hạn hoặc không hợp lệ. Vui lòng chụp lại.");

/** Tiêu thụ nonce; sai/hết hạn/đã dùng/của người khác → ghi security_events bad_nonce và ném 403 BAD_NONCE. */
export async function consumeNonce(input: {
  nonce: string;
  studentId: string;
  purpose: NoncePurpose;
  windowId?: string;
  ip?: string | null;
}) {
  const fail = async (why: string) => {
    await recordSecurityEvent("bad_nonce", { ip: input.ip, actorId: input.studentId, meta: { purpose: input.purpose, why } });
    return badNonce();
  };
  if (!isUuid(input.nonce)) throw await fail("format");
  const db = await getDb();
  const conds = [
    eq(scanNonces.nonce, input.nonce),
    eq(scanNonces.studentId, input.studentId),
    eq(scanNonces.purpose, input.purpose),
    isNull(scanNonces.usedAt),
    gt(scanNonces.expiresAt, sql`now()`),
  ];
  if (input.windowId) conds.push(eq(scanNonces.windowId, input.windowId));
  const [row] = await db
    .update(scanNonces)
    .set({ usedAt: sql`now()` })
    .where(and(...conds))
    .returning({ nonce: scanNonces.nonce, challenge: scanNonces.challenge });
  if (!row) throw await fail("invalid_or_used");
  return row;
}
