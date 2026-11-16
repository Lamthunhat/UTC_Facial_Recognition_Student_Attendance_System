import { PatchSessionSchema, patchSession } from "../../attendance/windows";
import { assertOwnsSession } from "../../auth/guards";
import { json, route } from "../../http/handler";

/** PATCH /api/sessions/{id} — {room?, checkoutSkipped?}: đổi phòng (trước giờ kết thúc buổi), bỏ check-out (T076, FR-010d/067). */
export const PATCH = route<{ id: string }, typeof PatchSessionSchema>(
  { roles: ["instructor", "admin"], body: PatchSessionSchema },
  async ({ session, params, body }) => {
    await assertOwnsSession(session!, params.id);
    return json(await patchSession(session!, params.id, body));
  },
);
