import { assertOwnsClass } from "../../auth/guards";
import { listClassCards } from "../../card/class-cards";
import { json, route } from "../../http/handler";

/** GET /api/classes/{id}/cards — SV đang học + trạng thái thẻ (lý do chờ duyệt chỉ cho giảng viên/Admin). Lớp người khác → 404. */
export const GET = route<{ id: string }>({ roles: ["instructor", "admin"] }, async ({ session, params }) => {
  await assertOwnsClass(session!, params.id);
  return json({ students: await listClassCards(params.id) });
});
