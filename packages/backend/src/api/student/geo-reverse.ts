import { z } from "zod";
import { reverseGeocodeFor } from "../../geo/reverse-api";
import { json, route } from "../../http/handler";
import { requireConsent } from "../../student/consent";

/**
 * GET /api/geo/reverse?lat=&lng= — địa chỉ cho lớp phủ camera từ toạ độ của CHÍNH SV (T072, FR-031). Không liên quan
 * vị trí GV. Rate limit 6/phút/SV (đếm trước khi kiểm toạ độ). Không có địa chỉ (thiếu khoá/lỗi) → {address: null}.
 */
const Query = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });

export const GET = route({ roles: ["student"] }, async ({ req, session }) => {
  await requireConsent(session!.sub);
  const u = new URL(req.url);
  return json(await reverseGeocodeFor(session!, () => Query.parse({ lat: u.searchParams.get("lat") ?? "", lng: u.searchParams.get("lng") ?? "" })));
});
