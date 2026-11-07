import { assertOwnsClass } from "../../auth/guards";
import { HttpError } from "../../http/errors";
import { json, route } from "../../http/handler";
import { commitRoster, previewRoster } from "../../roster/commit";
import { readRosterForm } from "../../roster/form";
import { enforce, RULES } from "../../security/rate-limit";

/**
 * POST /api/classes/{id}/roster/commit — multipart {file, columnMapping?, headerRowIndex?, confirmLargeWithdrawal?}.
 * Gửi lại chính file đã xem trước (không lưu file/previewId ở server); chỉ các dòng hợp lệ được lưu.
 * Rút > 50% lớp cần confirmLargeWithdrawal=true (409 LARGE_WITHDRAWAL_CONFIRM_REQUIRED).
 * Nhật ký roster.import được ghi trong transaction của commitRoster.
 */
export const POST = route<{ id: string }>({ roles: ["instructor", "admin"] }, async ({ req, session, params }) => {
  await assertOwnsClass(session!, params.id);
  await enforce(`roster:${session!.sub}`, RULES.rosterImport);
  const form = await readRosterForm(req);
  const p = await previewRoster(params.id, form.file, form.filename, form.columnMapping, form.headerRowIndex);
  if (p.missing.length) {
    throw new HttpError(422, "MISSING_COLUMNS", "File thiếu cột bắt buộc; hãy ghép cột trước khi lưu.");
  }
  const valid = p.rows.filter((r) => r.errors.length === 0).map((r) => r.data);
  const result = await commitRoster(session!, params.id, valid, {
    confirmLargeWithdrawal: form.confirmLargeWithdrawal,
    invalidRows: p.summary.invalid,
  });
  return json({ result, invalidRows: p.summary.invalid });
});
