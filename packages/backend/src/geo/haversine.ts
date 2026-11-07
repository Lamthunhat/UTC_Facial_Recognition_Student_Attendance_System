/** T023 — Khoảng cách mặt cầu (mét) giữa hai toạ độ WGS84. */
export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_008.8; // bán kính trung bình IUGG

function assertValid(p: LatLng) {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) {
    throw new RangeError("Toạ độ không hợp lệ");
  }
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  assertValid(a);
  assertValid(b);
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Biên được tính là "trong phạm vi". */
export function isWithinRadius(center: LatLng, point: LatLng, radiusM: number): boolean {
  return haversineMeters(center, point) <= radiusM;
}
