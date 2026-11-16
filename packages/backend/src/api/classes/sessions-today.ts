import { todaySessions } from "../../attendance/windows";
import { assertOwnsClass } from "../../auth/guards";
import { json, route } from "../../http/handler";

/** GET /api/classes/{id}/sessions/today — buổi theo lịch hôm nay (tiết, giờ, phòng) + khung đã mở (T076). */
export const GET = route<{ id: string }>({ roles: ["instructor", "admin"] }, async ({ session, params }) => {
  await assertOwnsClass(session!, params.id);
  return json({ sessions: await todaySessions(params.id) });
});
