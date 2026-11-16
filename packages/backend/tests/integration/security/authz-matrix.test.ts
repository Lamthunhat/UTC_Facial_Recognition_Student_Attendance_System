import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { useTestAppDb } from "@utc/database/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Role } from "../../../src/auth/jwt";
import { createSession, SESSION_COOKIE } from "../../../src/auth/session";
import type { RouteHandler } from "../../../src/http/handler";

/**
 * T039 / SC-014 — Ma trận phân quyền tự sinh:
 * 1. Mọi handler trong packages/backend/src/api có khai báo roles → chưa đăng nhập phải 401,
 *    vai trò không nằm trong roles phải 403.
 * 2. Mọi route trong apps/web/src/app/api chỉ được re-export handler từ @utc/backend/api (không có logic riêng),
 *    trừ route spike có bảo vệ riêng.
 * Thêm API mới → tự động được kiểm tra, không cần sửa test.
 */
const API_DIR = path.resolve(__dirname, "../../../src/api");
const WEB_API_DIR = path.resolve(__dirname, "../../../../../apps/web/src/app/api");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const ROLES: Role[] = ["admin", "instructor", "student"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

let ctx: Awaited<ReturnType<typeof useTestAppDb>>;
const cookies: Partial<Record<Role, string>> = {};
const FAKE_ID = "00000000-0000-4000-8000-000000000000";

beforeAll(async () => {
  process.env.JWT_SECRET = "integration-secret-integration-secret-xx";
  // Bật công cụ chỉ-preview (liveness-probe…) để chúng cũng được kiểm phân quyền + đồng ý; production trả 404 (test riêng)
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_ENV", "preview");
  ctx = await useTestAppDb();
  const admin = (await ctx.pg.query<{ id: string }>(`insert into users (email,password_hash,full_name,role) values ('a@x','x','A','admin') returning id`)).rows[0].id;
  const gv = (await ctx.pg.query<{ id: string }>(`insert into users (email,password_hash,full_name,role) values ('g@x','x','G','instructor') returning id`)).rows[0].id;
  const sv = (await ctx.pg.query<{ id: string }>(`insert into students (student_code,last_name,first_name) values ('231230001','L','A') returning id`)).rows[0].id;
  cookies.admin = `${SESSION_COOKIE}=${(await createSession(admin, "admin")).token}`;
  cookies.instructor = `${SESSION_COOKIE}=${(await createSession(gv, "instructor")).token}`;
  cookies.student = `${SESSION_COOKIE}=${(await createSession(sv, "student")).token}`;
}, 120_000);
afterAll(() => {
  vi.unstubAllEnvs();
  return ctx.close();
});

const files = walk(API_DIR);

describe("ma trận phân quyền API backend (T039)", () => {
  it("có ít nhất một API để kiểm tra", () => expect(files.length).toBeGreaterThan(0));

  for (const file of files) {
    const rel = path.relative(API_DIR, file);
    it(`${rel}: chặn đúng khi chưa đăng nhập / sai vai trò`, async () => {
      const mod = (await import(file)) as Record<string, RouteHandler | undefined>;
      const handlers = METHODS.filter((m) => typeof mod[m] === "function");
      expect(handlers.length, `${rel} không export handler nào`).toBeGreaterThan(0);
      for (const m of handlers) {
        const h = mod[m]!;
        expect(h.roles, `${rel} ${m} phải được tạo bằng route()`).not.toBeUndefined();
        if (h.roles === null) continue; // API công khai (đăng nhập, đăng xuất)
        const call = (cookie?: string) =>
          h(
            new Request(`http://localhost/api/x/${FAKE_ID}`, {
              method: m,
              headers: { origin: "http://localhost", "content-type": "application/json", ...(cookie ? { cookie } : {}) },
              body: m === "GET" ? undefined : "{}",
            }),
            { params: Promise.resolve({ id: FAKE_ID, classId: FAKE_ID, sessionId: FAKE_ID }) },
          );
        expect((await call()).status, `${rel} ${m} chưa đăng nhập`).toBe(401);
        for (const role of ROLES.filter((r) => !h.roles!.includes(r))) {
          expect((await call(cookies[role])).status, `${rel} ${m} với vai trò ${role}`).toBe(403);
        }
      }
    }, 120_000); // lần import đầu của API nặng (exceljs, onnx…) có thể chậm khi các worker khác đang chạy tải
  }
});

describe("tách vai trò sinh viên (US6) — tự áp dụng cho route mới", () => {
  const inDir = (dir: string) => files.filter((f) => path.relative(API_DIR, f).split(path.sep)[0] === dir);
  const studentFiles = inDir("student");
  const adminFiles = inDir("admin");
  const handlersOf = async (file: string) => {
    const mod = (await import(file)) as Record<string, RouteHandler | undefined>;
    return METHODS.filter((m) => typeof mod[m] === "function").map((m) => [m, mod[m]!] as const);
  };

  it("có API sinh viên để kiểm tra", () => expect(studentFiles.length).toBeGreaterThan(0));

  for (const file of studentFiles) {
    const rel = path.relative(API_DIR, file);
    it(`${rel}: chỉ vai trò student`, async () => {
      for (const [m, h] of await handlersOf(file)) expect(h.roles, `${rel} ${m}`).toEqual(["student"]);
    });
  }

  for (const file of adminFiles) {
    const rel = path.relative(API_DIR, file);
    it(`${rel}: không bao giờ cho vai trò student`, async () => {
      for (const [m, h] of await handlersOf(file)) expect(h.roles ?? [], `${rel} ${m}`).not.toContain("student");
    });
  }

  // Constitution IV / FR-050: SV chưa đồng ý → mọi API thẻ/khuôn mặt trả 403 trước khi làm gì khác.
  for (const file of studentFiles.filter((f) => path.basename(f) !== "consent.ts")) {
    const rel = path.relative(API_DIR, file);
    it(`${rel}: SV chưa đồng ý điều khoản → 403 CONSENT_REQUIRED`, async () => {
      for (const [m, h] of await handlersOf(file)) {
        const res = await h(
          new Request(`http://localhost/api/x`, {
            method: m,
            headers: { origin: "http://localhost", "content-type": "application/json", cookie: cookies.student! },
            body: m === "GET" ? undefined : "{}",
          }),
          { params: Promise.resolve({ id: FAKE_ID }) },
        );
        expect(res.status, `${rel} ${m}`).toBe(403);
        expect(((await res.json()) as { error: { code: string } }).error.code, `${rel} ${m}`).toBe("CONSENT_REQUIRED");
      }
    });
  }
});

describe("route Next.js chỉ là lớp mỏng (Constitution, plan.md Structure)", () => {
  const webRoutes = walk(WEB_API_DIR).filter((f) => f.endsWith("route.ts"));
  for (const f of webRoutes) {
    const rel = path.relative(WEB_API_DIR, f);
    if (rel.startsWith("spike")) continue; // route đo hiệu năng tạm thời, có bảo vệ Bearer riêng
    it(`${rel} chỉ re-export từ @utc/backend/api`, () => {
      const code = readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
        .trim();
      const lines = code.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const l of lines) {
        expect(l, `${rel}: chỉ được có dòng export … from "@utc/backend/api/…" hoặc cấu hình runtime`).toMatch(
          /^(export \{[^}]+\} from "@utc\/backend\/api\/[\w/-]+";|export const (runtime|dynamic|maxDuration) = .+;)$/,
        );
      }
    });
  }
});
