import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyDatabaseUrl, remoteWriteGuardError, seedGuardError } from "../src/db-target";

/** Gia cố an toàn dữ liệu cho script ghi DB: seed chỉ chạy trên DB cục bộ; migrate/admin:create cần xác nhận khi remote. */
const SUPABASE_POOLER = "postgresql://postgres.abcd:mat-khau-bi-mat@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres";
const SUPABASE_DIRECT = "postgresql://postgres:mat-khau-bi-mat@db.abcd.supabase.co:5432/postgres";

describe("classifyDatabaseUrl", () => {
  it.each([
    ["pglite:./.pglite", "pglite"],
    ["pglite:C:\\data\\db", "pglite"],
    ["postgresql://postgres:postgres@localhost:54322/postgres", "local"],
    ["postgresql://postgres:postgres@127.0.0.1:54322/postgres", "local"],
    ["postgres://u:p@[::1]:5432/db", "local"],
    [SUPABASE_POOLER, "remote"],
    [SUPABASE_DIRECT, "remote"],
    ["postgresql://u:p@db.example.com:5432/x", "remote"],
    ["postgresql://u:p@localhost.attacker.com/x", "remote"], // không bị lừa bởi tiền tố "localhost"
    ["postgresql:///db?host=/var/run/postgresql", "remote"], // không có host → mặc định an toàn
    ["khong-phai-url", "remote"],
    ["", "remote"],
  ])("%s → %s", (url, kind) => {
    expect(classifyDatabaseUrl(url).kind).toBe(kind);
  });

  it("chỉ trả host để in ra — không bao giờ có mật khẩu", () => {
    const t = classifyDatabaseUrl(SUPABASE_POOLER);
    expect(t.display).toBe("aws-0-ap-southeast-1.pooler.supabase.com");
    expect(JSON.stringify(t)).not.toContain("mat-khau-bi-mat");
  });
});

describe("seedGuardError — seed demo chỉ cho DB cục bộ", () => {
  it("cho phép pglite và localhost/127.0.0.1", () => {
    expect(seedGuardError({ DATABASE_URL: "pglite:./.pglite" })).toBeNull();
    expect(seedGuardError({ DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" })).toBeNull();
  });

  it("chặn NODE_ENV=production dù DB là pglite", () => {
    expect(seedGuardError({ NODE_ENV: "production", DATABASE_URL: "pglite:./.pglite" })).toMatch(/production/);
  });

  it("chặn Supabase và mọi DB remote — kể cả khi có CONFIRM_REMOTE_DB=true", () => {
    for (const url of [SUPABASE_POOLER, SUPABASE_DIRECT, "postgresql://u:p@db.example.com/x"]) {
      const err = seedGuardError({ DATABASE_URL: url, CONFIRM_REMOTE_DB: "true" });
      expect(err, url).toMatch(/không được chạy/);
      expect(err).not.toContain("mat-khau-bi-mat");
    }
  });

  it("chặn URL localhost nhưng trỏ vào supabase.com (ví dụ tham số host)", () => {
    expect(seedGuardError({ DATABASE_URL: "postgresql://u:p@localhost:6543/postgres?options=x.pooler.supabase.com" })).toMatch(/Supabase/);
  });

  it("thiếu DATABASE_URL → báo lỗi", () => {
    expect(seedGuardError({})).toMatch(/DATABASE_URL/);
  });
});

describe("remoteWriteGuardError — migrate / admin:create lên DB remote cần xác nhận", () => {
  it("pglite / localhost: không cần xác nhận", () => {
    expect(remoteWriteGuardError({ DATABASE_URL: "pglite:./.pglite" }, "db:migrate")).toBeNull();
    expect(remoteWriteGuardError({ DATABASE_URL: "postgresql://u:p@localhost:54322/postgres" }, "db:migrate")).toBeNull();
  });

  it("remote thiếu CONFIRM_REMOTE_DB=true → lỗi kèm hướng dẫn bật cờ (PowerShell + bash), chỉ in host", () => {
    for (const v of [undefined, "", "1", "yes", "TRUE "]) {
      const err = remoteWriteGuardError({ DATABASE_URL: SUPABASE_POOLER, CONFIRM_REMOTE_DB: v }, "admin:create");
      expect(err, String(v)).toMatch(/CONFIRM_REMOTE_DB/);
      expect(err).toContain("aws-0-ap-southeast-1.pooler.supabase.com");
      expect(err).toContain('$env:CONFIRM_REMOTE_DB="true"');
      expect(err).toContain("CONFIRM_REMOTE_DB=true pnpm admin:create");
      expect(err).not.toContain("mat-khau-bi-mat");
    }
  });

  it("remote có CONFIRM_REMOTE_DB=true → cho phép", () => {
    expect(remoteWriteGuardError({ DATABASE_URL: SUPABASE_POOLER, CONFIRM_REMOTE_DB: "true" }, "db:migrate")).toBeNull();
  });
});

/**
 * Chạy thật các script: phải dừng (exit 1) TRƯỚC khi kết nối — host remote trong test không tồn tại, nếu script
 * cố kết nối thì sẽ treo/timeout chứ không thoát ngay với thông báo chặn.
 */
describe("script thật dừng trước khi kết nối", () => {
  const req = createRequire(import.meta.url);
  const tsxCli = req.resolve("tsx/cli");
  const run = (cwd: string, script: string, env: Record<string, string>) =>
    spawnSync(process.execPath, [tsxCli, "--conditions=react-server", script], {
      cwd,
      env: { ...process.env, NODE_ENV: "development", CONFIRM_REMOTE_DB: "", ...env },
      encoding: "utf8",
      timeout: 60_000,
    });
  const DB = path.resolve(__dirname, "..");
  const BACKEND = path.resolve(__dirname, "../../backend");
  const FAKE_REMOTE = "postgresql://postgres.x:mat-khau-bi-mat@khong-ton-tai.pooler.supabase.com:6543/postgres";

  it("seed-demo với DB Supabase → exit 1, không lộ mật khẩu", () => {
    const r = run(DB, "scripts/seed-demo.ts", { DATABASE_URL: FAKE_REMOTE, SEED_ADMIN_PASSWORD: "x", SEED_INSTRUCTOR_PASSWORD: "y" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/không được chạy/);
    expect(r.stderr + r.stdout).not.toContain("mat-khau-bi-mat");
  }, 70_000);

  it("seed-demo với NODE_ENV=production → exit 1", () => {
    const r = run(DB, "scripts/seed-demo.ts", { NODE_ENV: "production", DATABASE_URL: "pglite:./khong-dung-toi" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/production/);
  }, 70_000);

  it("migrate lên remote thiếu CONFIRM_REMOTE_DB → exit 1 kèm hướng dẫn", () => {
    const r = run(DB, "scripts/migrate.ts", { DATABASE_URL: FAKE_REMOTE, DIRECT_DATABASE_URL: "" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/CONFIRM_REMOTE_DB/);
  }, 70_000);

  it("admin:create lên remote thiếu CONFIRM_REMOTE_DB → exit 1 kèm hướng dẫn", () => {
    const r = run(BACKEND, "scripts/create-admin.ts", { DATABASE_URL: FAKE_REMOTE, ADMIN_EMAIL: "a@b.c", ADMIN_PASSWORD: "mat-khau-dai-du-10" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/CONFIRM_REMOTE_DB/);
  }, 70_000);
});
