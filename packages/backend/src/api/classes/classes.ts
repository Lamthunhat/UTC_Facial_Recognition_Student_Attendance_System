import { createClass, listClasses } from "../../classes/service";
import { json, route } from "../../http/handler";
import { CreateClassSchema } from "../../classes/schemas";

/** GET /api/classes — lớp của tôi (admin: mọi lớp). POST /api/classes — tạo lớp học phần (FR-010). */
export const GET = route({ roles: ["instructor", "admin"] }, async ({ session }) => {
  return json({ classes: await listClasses(session!) });
});

export const POST = route({ roles: ["instructor", "admin"], body: CreateClassSchema }, async ({ session, body }) => {
  return json({ class: await createClass(session!, body) }, { status: 201 });
});
