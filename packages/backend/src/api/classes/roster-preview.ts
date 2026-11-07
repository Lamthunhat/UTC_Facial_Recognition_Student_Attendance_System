import { assertOwnsClass } from "../../auth/guards";
import { json, route } from "../../http/handler";
import { previewRoster, rosterWarnings } from "../../roster/commit";
import { readRosterForm } from "../../roster/form";
import { enforce, RULES } from "../../security/rate-limit";

/**
 * POST /api/classes/{id}/roster/preview — multipart {file, columnMapping?, headerRowIndex?}.
 * Không khai báo body trong route(): form được đọc sau khi kiểm quyền + rate limit. Không ghi DB.
 */
export const POST = route<{ id: string }>({ roles: ["instructor", "admin"] }, async ({ req, session, params }) => {
  await assertOwnsClass(session!, params.id);
  await enforce(`roster:${session!.sub}`, RULES.rosterImport);
  const form = await readRosterForm(req);
  const p = await previewRoster(params.id, form.file, form.filename, form.columnMapping, form.headerRowIndex);
  return json({ ...p, warnings: rosterWarnings(p.rows, p.summary, p.headerCells) });
});
