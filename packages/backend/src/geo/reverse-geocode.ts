import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@utc/database";
import { log } from "../log";

/**
 * T072 — Đổi toạ độ của CHÍNH SV ra địa chỉ (FR-031, FR-039, research R8) bằng Goong Reverse Geocoding.
 * - Cache theo ô toạ độ làm tròn 4 chữ số (~11 m) trong bảng geocode_cache; CHỈ gửi toạ độ đã làm tròn ra ngoài.
 * - Không có GOONG_API_KEY / lỗi mạng / quá giờ / không có kết quả → null (ảnh in toạ độ thay địa chỉ), không ném lỗi:
 *   địa chỉ chỉ để hiển thị, không bao giờ chặn điểm danh.
 * - Không bao giờ nhận/trả vị trí giảng viên (tâm buổi học).
 */
export interface GeocodeCache {
  get(cell: string): Promise<string | null>;
  set(cell: string, address: string): Promise<void>;
}
type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export const cellOf = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`;
const CACHE_TTL_DAYS = 90;
const clean = (s: string) =>
  s
    .replace(/[\u0000-\u001f\u007f]+/g, (m) => (/[\n\r\t]/.test(m) ? " " : ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

export function createReverseGeocoder(opts: { apiKey: string | null; fetch: FetchFn; cache: GeocodeCache; timeoutMs?: number }) {
  return async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
    if (!opts.apiKey) return null;
    const cell = cellOf(lat, lng);
    try {
      const hit = await opts.cache.get(cell);
      if (hit) return hit;
    } catch (e) {
      log.error("geocode_cache_failed", { err: String(e) });
    }
    const url = new URL("https://rsapi.goong.io/Geocode");
    url.searchParams.set("latlng", cell);
    url.searchParams.set("api_key", opts.apiKey);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 1500);
    try {
      const res = await opts.fetch(url.toString(), { signal: ctrl.signal });
      if (!res.ok) {
        log.error("geocode_failed", { status: res.status });
        return null;
      }
      const body = (await res.json()) as { results?: { formatted_address?: unknown }[] };
      const raw = body.results?.[0]?.formatted_address;
      const address = typeof raw === "string" ? clean(raw) : "";
      if (!address) return null;
      await opts.cache.set(cell, address).catch((e) => log.error("geocode_cache_failed", { err: String(e) }));
      return address;
    } catch (e) {
      log.error("geocode_failed", { err: e instanceof Error ? e.name : "error" });
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}

const dbCache: GeocodeCache = {
  async get(cell) {
    const db = await getDb();
    const res = await db.execute<{ address: string }>(sql`
      select address from geocode_cache where cell = ${cell} and fetched_at > now() - ${`${CACHE_TTL_DAYS} days`}::interval`);
    const rows = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as { address: string }[];
    return rows[0]?.address ?? null;
  },
  async set(cell, address) {
    const db = await getDb();
    await db.execute(sql`
      insert into geocode_cache (cell, address, fetched_at) values (${cell}, ${address}, now())
      on conflict (cell) do update set address = excluded.address, fetched_at = now()`);
  },
};

/** Bản dùng thật: khoá đọc lúc gọi (thiếu → null), fetch toàn cục, cache Postgres. */
export const reverseGeocode = (lat: number, lng: number) =>
  createReverseGeocoder({ apiKey: process.env.GOONG_API_KEY?.trim() || null, fetch: (u, i) => fetch(u, i), cache: dbCache })(lat, lng);
