import "server-only";
import type { SessionClaims } from "../auth/jwt";
import { checkinGeocoder } from "../attendance/checkin";
import { enforce, RULES } from "../security/rate-limit";

/** GET /api/geo/reverse: rate limit theo SV TRƯỚC khi kiểm toạ độ (lượt sai cũng tính), rồi đổi ra địa chỉ. */
export async function reverseGeocodeFor(session: SessionClaims, parse: () => { lat: number; lng: number }) {
  await enforce(`geo-reverse:${session.sub}`, RULES.geoReverse);
  const { lat, lng } = parse();
  return { address: await checkinGeocoder()(lat, lng) };
}
