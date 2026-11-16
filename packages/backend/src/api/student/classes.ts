import { json, route } from "../../http/handler";
import { requireConsent } from "../../student/consent";
import { listStudentClasses } from "../../student/classes";

/** GET /api/student/classes — {classes:[{classId, code, courseName, room, openWindow}]} của chính SV. Cần đã đồng ý (FR-050). */
export const GET = route({ roles: ["student"] }, async ({ session }) => {
  await requireConsent(session!.sub);
  return json({ classes: await listStudentClasses(session!.sub) });
});
