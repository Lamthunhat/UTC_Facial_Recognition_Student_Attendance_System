import { OpenCheckinSchema, openCheckin } from "../../attendance/windows";
import { assertOwnsClass } from "../../auth/guards";
import { json, route } from "../../http/handler";

/**
 * POST /api/classes/{id}/sessions/open-checkin — {kind?, date?, firstPeriod?, lastPeriod?, room?, lat, lng, accuracyM,
 * checkinMinutes?, radiusM?} → 201 {session, checkinWindow, checkoutWindow, warnings} (T076, FR-020…023).
 * Cảnh báo LOW_GPS_ACCURACY khi sai số vị trí GV > 50 m (vẫn mở). 409 CHECKIN_EXISTS / SESSION_ENDED; 422 NO_SCHEDULE…
 */
export const POST = route<{ id: string }, typeof OpenCheckinSchema>(
  { roles: ["instructor", "admin"], body: OpenCheckinSchema },
  async ({ session, params, body }) => {
    await assertOwnsClass(session!, params.id);
    return json(await openCheckin(session!, params.id, body), { status: 201 });
  },
);
