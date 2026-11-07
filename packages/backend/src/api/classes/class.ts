import { assertOwnsClass } from "../../auth/guards";
import { getClass, updateClass } from "../../classes/service";
import { json, route } from "../../http/handler";
import { UpdateClassSchema } from "../../classes/schemas";

/** GET/PATCH /api/classes/{id} — xem / sửa thông tin, lịch, phòng mặc định, cấu hình. */
export const GET = route<{ id: string }>({ roles: ["instructor", "admin"] }, async ({ session, params }) => {
  await assertOwnsClass(session!, params.id);
  return json({ class: await getClass(params.id) });
});

export const PATCH = route<{ id: string }, typeof UpdateClassSchema>(
  { roles: ["instructor", "admin"], body: UpdateClassSchema },
  async ({ session, params, body }) => {
    await assertOwnsClass(session!, params.id);
    return json({ class: await updateClass(session!, params.id, body) });
  },
);
