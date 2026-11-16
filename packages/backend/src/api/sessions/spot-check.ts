import { SpotCheckSchema, openSpotCheck } from "../../attendance/windows";
import { assertOwnsSession } from "../../auth/guards";
import { json, route } from "../../http/handler";

/** POST /api/sessions/{id}/spot-check — {minutes? 3–5, mặc định 5} → 201 {window} (T100, FR-021/022). 409 SPOT_CHECK_OPEN / CHECKIN_NOT_OPENED / SESSION_ENDED. */
export const POST = route<{ id: string }, typeof SpotCheckSchema>(
  { roles: ["instructor", "admin"], body: SpotCheckSchema },
  async ({ session, params, body }) => {
    await assertOwnsSession(session!, params.id);
    return json(await openSpotCheck(session!, params.id, body), { status: 201 });
  },
);
