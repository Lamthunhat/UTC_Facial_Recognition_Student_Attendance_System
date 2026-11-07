import { z } from "zod";
import { listPeriods, replacePeriods } from "../../admin/periods";
import { json, route } from "../../http/handler";
import { enforce, RULES } from "../../security/rate-limit";

/** GET/PUT /api/admin/periods — bảng 16 tiết (FR-010a). */
export const GET = route({ roles: ["admin", "instructor"] }, async () => json({ periods: await listPeriods() }));

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Giờ dạng HH:MM");
const Body = z
  .object({
    periods: z
      .array(z.object({ number: z.number().int().min(1).max(16), startsAt: Time, endsAt: Time }).strict())
      .length(16),
  })
  .strict();

export const PUT = route({ roles: ["admin"], body: Body }, async ({ session, body }) => {
  await enforce(`admin-write:${session!.sub}`, RULES.adminWrite);
  return json({ periods: await replacePeriods(session!, body.periods) });
});
