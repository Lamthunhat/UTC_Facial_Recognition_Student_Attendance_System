import { assertOwnsWindow, closeWindow } from "../../attendance/windows";
import { json, route } from "../../http/handler";

/** POST /api/windows/{id}/close — đóng sớm khung đang mở (T076, FR-022). 409 WINDOW_NOT_OPEN. */
export const POST = route<{ id: string }>({ roles: ["instructor", "admin"] }, async ({ session, params }) => {
  await assertOwnsWindow(session!, params.id);
  return json(await closeWindow(session!, params.id));
});
