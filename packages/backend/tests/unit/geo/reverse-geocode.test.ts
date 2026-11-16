import { describe, expect, it, vi } from "vitest";
import { cellOf, createReverseGeocoder, type GeocodeCache } from "../../../src/geo/reverse-geocode";

/**
 * T072 — Đổi toạ độ của CHÍNH SV ra địa chỉ (FR-031, research R8): Goong, cache theo ô làm tròn 4 chữ số (~11 m),
 * chỉ gửi toạ độ đã làm tròn ra ngoài; thiếu khoá / lỗi / quá giờ → không có địa chỉ (in toạ độ), không lỗi.
 */
const memCache = (): GeocodeCache & { store: Map<string, string> } => {
  const store = new Map<string, string>();
  return { store, get: async (c) => store.get(c) ?? null, set: async (c, a) => void store.set(c, a) };
};
const goong = (address: string) =>
  vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ results: [{ formatted_address: address }], status: "OK" }), { status: 200 }));

describe("cellOf", () => {
  it("làm tròn 4 chữ số", () => {
    expect(cellOf(21.027412, 105.801236)).toBe("21.0274,105.8012");
    expect(cellOf(-0.00004, 0)).toBe("-0.0000,0.0000");
  });
});

describe("createReverseGeocoder", () => {
  it("thiếu khoá → null, không gọi mạng", async () => {
    const f = goong("x");
    const g = createReverseGeocoder({ apiKey: null, fetch: f, cache: memCache() });
    expect(await g(21.0274, 105.8012)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("có khoá → gọi Goong với toạ độ ĐÃ LÀM TRÒN, lưu cache; lần sau cùng ô không gọi lại", async () => {
    const f = goong("3 Cầu Giấy, Láng Thượng, Đống Đa, Hà Nội");
    const cache = memCache();
    const g = createReverseGeocoder({ apiKey: "k", fetch: f, cache });
    expect(await g(21.027412, 105.801236)).toBe("3 Cầu Giấy, Láng Thượng, Đống Đa, Hà Nội");
    const url = new URL(f.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://rsapi.goong.io/Geocode");
    expect(url.searchParams.get("latlng")).toBe("21.0274,105.8012");
    expect(url.searchParams.get("api_key")).toBe("k");
    expect(await g(21.02744, 105.80118)).toBe("3 Cầu Giấy, Láng Thượng, Đống Đa, Hà Nội");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["HTTP 500", vi.fn(async () => new Response("err", { status: 500 }))],
    ["không có kết quả", vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }))],
    ["mạng lỗi", vi.fn(async () => Promise.reject(new Error("ECONNRESET")))],
    ["JSON hỏng", vi.fn(async () => new Response("<html>", { status: 200 }))],
  ])("%s → null (không lỗi, không cache)", async (_n, f) => {
    const cache = memCache();
    const g = createReverseGeocoder({ apiKey: "k", fetch: f as never, cache });
    expect(await g(21.0274, 105.8012)).toBeNull();
    expect(cache.store.size).toBe(0);
  });

  it("quá giờ → null", async () => {
    const slow = vi.fn((_u: string, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted")))),
    );
    const g = createReverseGeocoder({ apiKey: "k", fetch: slow as never, cache: memCache(), timeoutMs: 20 });
    expect(await g(21.0274, 105.8012)).toBeNull();
  });

  it("địa chỉ được làm sạch (ký tự điều khiển, ≤ 200 ký tự)", async () => {
    const g = createReverseGeocoder({ apiKey: "k", fetch: goong(`A\u0000B\nC${"x".repeat(300)}`), cache: memCache() });
    const a = (await g(21.0274, 105.8012))!;
    expect(a.startsWith("AB C")).toBe(true);
    expect(a.length).toBeLessThanOrEqual(200);
  });
});
