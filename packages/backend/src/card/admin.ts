import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@utc/database";
import { classes, enrollments, studentCards, students } from "@utc/database/schema";
import { writeAudit } from "../audit";
import { isUuid } from "../auth/guards";
import type { SessionClaims } from "../auth/jwt";
import { HttpError, notFound } from "../http/errors";
import { log } from "../log";
import { recordSecurityEvent } from "../security/events";
import { cardDeps } from "./register";

/**
 * T061 — Giảng viên/Admin xem, duyệt (pending_review) và đặt lại thẻ SV (FR-049, US6-6/9, Principle III).
 * Giảng viên chỉ thao tác SV đang có trong lớp của mình (404 nếu không — chống IDOR, không lộ tồn tại).
 * Audit ghi trong cùng transaction. Thẻ bị thay/từ chối: giữ bản ghi lịch sử nhưng xoá ảnh + embedding
 * (Constitution IV — không giữ dữ liệu sinh trắc không còn dùng).
 */
export async function assertCanManageStudent(session: SessionClaims, studentId: string) {
  if (!isUuid(studentId)) throw notFound();
  const db = await getDb();
  const rows =
    session.role === "admin"
      ? await db.select({ id: students.id }).from(students).where(eq(students.id, studentId)).limit(1)
      : await db
          .select({ id: enrollments.studentId })
          .from(enrollments)
          .innerJoin(classes, eq(classes.id, enrollments.classId))
          .where(and(eq(enrollments.studentId, studentId), eq(classes.instructorId, session.sub), eq(enrollments.status, "active")))
          .limit(1);
  if (rows.length === 0) throw notFound();
}

const LIVE = ["active", "pending_review"] as const;

export async function getStudentCard(studentId: string) {
  const db = await getDb();
  const [c] = await db
    .select({
      id: studentCards.id,
      status: studentCards.status,
      decodedCode: studentCards.decodedCode,
      decodeMethod: studentCards.decodeMethod,
      reviewReasons: studentCards.reviewReasons,
      nameMatched: studentCards.nameMatched,
      duplicateStudentId: studentCards.duplicateStudentId,
      duplicateSimilarity: studentCards.duplicateSimilarity,
      registeredAt: studentCards.registeredAt,
      purgeAfter: studentCards.purgeAfter,
      cardImagePath: studentCards.cardImagePath,
      portraitImagePath: studentCards.portraitImagePath,
      liveSimilarity: studentCards.liveSimilarity,
      ocrName: studentCards.ocrName,
    })
    .from(studentCards)
    .where(eq(studentCards.studentId, studentId))
    .orderBy(sql`case when ${studentCards.status} in ('active','pending_review') then 0 else 1 end`, desc(studentCards.registeredAt))
    .limit(1);
  if (!c) return null;
  const [me] = await db.select({ lastName: students.lastName, firstName: students.firstName }).from(students).where(eq(students.id, studentId)).limit(1);

  let duplicateOf = null;
  if (c.duplicateStudentId) {
    const [d] = await db
      .select({ code: students.studentCode, lastName: students.lastName, firstName: students.firstName })
      .from(students)
      .where(eq(students.id, c.duplicateStudentId))
      .limit(1);
    if (d) duplicateOf = { studentId: c.duplicateStudentId, code: d.code, fullName: `${d.lastName} ${d.firstName}`, similarity: c.duplicateSimilarity };
  }
  const storage = cardDeps().storage;
  return {
    id: c.id,
    status: c.status,
    decodedCode: c.decodedCode,
    decodeMethod: c.decodeMethod,
    reviewReasons: c.reviewReasons,
    nameMatched: c.nameMatched,
    /** Họ tên trong danh sách lớp + dòng họ tên OCR (chỉ có khi NAME_MISMATCH) để đối chiếu. */
    rosterName: me ? `${me.lastName} ${me.firstName}` : null,
    ocrName: c.ocrName,
    /** Cosine mặt trực tiếp ↔ chân dung thẻ lúc đăng ký (LIVE_MISMATCH khi < CARD_ACCEPT_ABOVE). */
    liveSimilarity: c.liveSimilarity,
    duplicateOf,
    registeredAt: c.registeredAt,
    purgeAfter: c.purgeAfter,
    // Link đọc ảnh 5 phút (bucket private) — chỉ cấp khi còn ảnh
    cardUrl: c.cardImagePath ? await storage.signedUrl("cards", c.cardImagePath) : null,
    portraitUrl: c.portraitImagePath ? await storage.signedUrl("cards", c.portraitImagePath) : null,
  };
}

/** Xoá dữ liệu sinh trắc của thẻ (giữ bản ghi lịch sử) — chạy trong tx; trả đường dẫn ảnh để xoá file sau commit. */
const purgeBiometrics = { embedding: null, cardImagePath: null, portraitImagePath: null } as const;

async function removeFiles(paths: (string | null)[]) {
  const list = paths.filter((p): p is string => !!p);
  if (list.length === 0) return;
  // File xoá sau khi DB đã commit: lỗi kho ảnh không được làm hỏng thao tác; cron dọn lại (Polish).
  await cardDeps().storage.remove("cards", list).catch((err) => log.error("card_file_remove_failed", { err: String(err) }));
}

/** Đặt lại thẻ (US6-9): thẻ hiệu lực → replaced; SV đăng ký thẻ mới được ngay. */
export async function resetStudentCard(actor: SessionClaims, studentId: string, reason: string, ip: string | null) {
  const db = await getDb();
  const old = await db.transaction(async (tx) => {
    const [card] = await tx
      .select({ id: studentCards.id, status: studentCards.status, cardImagePath: studentCards.cardImagePath, portraitImagePath: studentCards.portraitImagePath })
      .from(studentCards)
      .where(and(eq(studentCards.studentId, studentId), inArray(studentCards.status, [...LIVE])))
      .for("update");
    if (!card) throw new HttpError(404, "NO_CARD", "Sinh viên chưa có thẻ hiệu lực để đặt lại.");
    await tx
      .update(studentCards)
      .set({ status: "replaced", reviewedBy: actor.sub, ...purgeBiometrics })
      .where(eq(studentCards.id, card.id));
    await writeAudit(actor, "card.reset", { type: "student", id: studentId }, { cardId: card.id, previousStatus: card.status, reason }, tx);
    return card;
  });
  await recordSecurityEvent("card_replaced", { ip, actorId: actor.sub, meta: { studentId, cardId: old.id } });
  await removeFiles([old.cardImagePath, old.portraitImagePath]);
  return { cardId: old.id, status: "replaced" as const };
}

/** Duyệt thẻ đang chờ: approve → active; reject → deleted (SV phải đăng ký lại). */
export async function reviewStudentCard(actor: SessionClaims, studentId: string, decision: "approve" | "reject", note?: string) {
  const db = await getDb();
  const card = await db.transaction(async (tx) => {
    const [c] = await tx
      .select({ id: studentCards.id, cardImagePath: studentCards.cardImagePath, portraitImagePath: studentCards.portraitImagePath })
      .from(studentCards)
      .where(and(eq(studentCards.studentId, studentId), eq(studentCards.status, "pending_review")))
      .for("update");
    if (!c) throw new HttpError(409, "NOT_PENDING", "Thẻ không ở trạng thái chờ duyệt.");
    await tx
      .update(studentCards)
      .set(decision === "approve" ? { status: "active", reviewedBy: actor.sub } : { status: "deleted", reviewedBy: actor.sub, ...purgeBiometrics })
      .where(eq(studentCards.id, c.id));
    await writeAudit(actor, "card.review", { type: "student", id: studentId }, { cardId: c.id, decision, note: note ?? null }, tx);
    return c;
  });
  if (decision === "reject") await removeFiles([card.cardImagePath, card.portraitImagePath]);
  return { cardId: card.id, status: decision === "approve" ? ("active" as const) : ("deleted" as const) };
}
