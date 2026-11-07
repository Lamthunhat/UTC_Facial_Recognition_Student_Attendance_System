import { assertCanManageStudent, getStudentCard } from "../../card/admin";
import { json, route } from "../../http/handler";

/** GET /api/admin/students/{id}/card — thẻ của SV: trạng thái, lý do chờ duyệt, SV bị trùng mặt, link ảnh 5 phút. */
export const GET = route<{ id: string }>({ roles: ["instructor", "admin"] }, async ({ session, params }) => {
  await assertCanManageStudent(session!, params.id);
  return json({ card: await getStudentCard(params.id) });
});
