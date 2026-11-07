import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enforce, hit, reset } from "../../../src/security/rate-limit";
import { useTestAppDb } from "@utc/database/testing";

let ctx: Awaited<ReturnType<typeof useTestAppDb>>;
beforeAll(async () => {
  ctx = await useTestAppDb();
}, 60_000);
afterAll(() => ctx.close());

describe("rate limit cửa sổ cố định (T029, FR-081)", () => {
  it("cho phép đến đúng giới hạn rồi chặn", async () => {
    const rule = { limit: 3, windowSec: 60 };
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await hit("t:a", rule));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
    expect(results[4].retryAfterSec).toBeGreaterThan(0);
    expect(results[4].retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("các khoá độc lập với nhau", async () => {
    const rule = { limit: 1, windowSec: 60 };
    expect((await hit("t:b", rule)).allowed).toBe(true);
    expect((await hit("t:c", rule)).allowed).toBe(true);
    expect((await hit("t:b", rule)).allowed).toBe(false);
  });

  it("cửa sổ hết hạn thì đếm lại từ đầu", async () => {
    const rule = { limit: 1, windowSec: 60 };
    await hit("t:d", rule);
    await ctx.pg.query(`update rate_limits set window_start = now() - interval '61 seconds' where key='t:d'`);
    expect((await hit("t:d", rule)).allowed).toBe(true);
  });

  it("enforce ném 429 có Retry-After; reset xoá bộ đếm", async () => {
    const rule = { limit: 1, windowSec: 60 };
    await enforce("t:e", rule);
    await expect(enforce("t:e", rule)).rejects.toMatchObject({ status: 429, headers: { "Retry-After": expect.any(String) } });
    await reset("t:e");
    await expect(enforce("t:e", rule)).resolves.toBeUndefined();
  });

  it("đếm đúng khi nhiều yêu cầu đồng thời", async () => {
    const rule = { limit: 5, windowSec: 60 };
    const rs = await Promise.all(Array.from({ length: 8 }, () => hit("t:f", rule)));
    expect(rs.filter((r) => r.allowed)).toHaveLength(5);
  });
});
