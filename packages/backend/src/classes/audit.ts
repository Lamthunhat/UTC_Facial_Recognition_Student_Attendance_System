import "server-only";
import type { AppDb } from "@utc/database";
import { writeAudit } from "../audit";
import type { SessionClaims } from "../auth/jwt";
import type { CommitResult, EnrollmentChange } from "../roster/commit";

/**
 * T052 — Nhật ký thao tác lớp học & danh sách (Constitution III). Mọi hàm nhận `tx` và được gọi BÊN TRONG
 * transaction của thao tác: ghi nhật ký lỗi → cả thao tác bị huỷ. Chỉ ghi khi có thay đổi.
 * Không ghi họ tên SV vào meta; mã SV đủ để truy vết.
 */
export function auditClassCreated(tx: AppDb, actor: SessionClaims, c: { id: string; code: string }) {
  return writeAudit(actor, "class.create", { type: "class", id: c.id }, { code: c.code }, tx);
}

export function auditClassUpdated(tx: AppDb, actor: SessionClaims, classId: string, fields: string[]) {
  return writeAudit(actor, "class.update", { type: "class", id: classId }, { fields }, tx);
}

export function auditRosterImported(tx: AppDb, actor: SessionClaims, classId: string, r: CommitResult & { invalidRows: number }) {
  return writeAudit(
    actor,
    "roster.import",
    { type: "class", id: classId },
    { added: r.added, reactivated: r.reactivated, withdrawn: r.withdrawn, existing: r.existing, invalidRows: r.invalidRows },
    tx,
  );
}

export async function auditEnrollmentChange(
  tx: AppDb,
  actor: SessionClaims,
  classId: string,
  kind: "add" | "withdraw",
  r: EnrollmentChange,
) {
  if (!r.changed) return;
  await writeAudit(
    actor,
    kind === "add" ? "roster.student_add" : "roster.student_withdraw",
    { type: "student", id: r.enrollment.studentId },
    { classId, studentCode: r.enrollment.code },
    tx,
  );
}
