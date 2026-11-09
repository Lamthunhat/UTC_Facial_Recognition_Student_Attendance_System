import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { vector } from "@electric-sql/pglite-pgvector";
import { afterAll, describe, expect, it } from "vitest";
import { loadMigrations, MIGRATIONS_TABLE, pgliteExecutor, runMigrations } from "../src/migrator";

/**
 * Runner migration dùng chung (pglite + Postgres): bảng theo dõi của Drizzle, mỗi file một transaction,
 * baseline cho DB tạo theo kiểu cũ (chạy thẳng mọi file .sql, không ghi nhận).
 */
const DIR = path.resolve(__dirname, "../migrations");
const ALL = ["0000_init", "0001_hardening", "0002_card_review", "0003_card_live_check"];
const opened: PGlite[] = [];
const temps: string[] = [];

async function emptyDb() {
  const pg = await PGlite.create({ extensions: { vector, unaccent, pg_trgm, btree_gist, pgcrypto } });
  opened.push(pg);
  return pg;
}
/** DB "kiểu cũ": chạy thẳng các file SQL, KHÔNG có bảng theo dõi migration. */
async function legacyDb(tags: string[]) {
  const pg = await emptyDb();
  for (const t of tags) {
    for (const stmt of (await readFile(path.join(DIR, `${t}.sql`), "utf8")).split("--> statement-breakpoint")) {
      if (stmt.trim()) await pg.exec(stmt);
    }
  }
  return pg;
}
const tracked = async (pg: PGlite) =>
  (await pg.query<{ hash: string; created_at: string }>(`select hash, created_at::text from ${MIGRATIONS_TABLE} order by created_at`)).rows;
const hasColumn = async (pg: PGlite, table: string, column: string) =>
  (await pg.query(`select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2`, [table, column])).rows.length === 1;
const journal = async () => JSON.parse(await readFile(path.join(DIR, "meta/_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };

afterAll(async () => {
  for (const pg of opened) await pg.close();
  for (const t of temps) await rm(t, { recursive: true, force: true });
});

describe("runMigrations", () => {
  it("DB trống → chạy đủ mọi migration theo thứ tự, ghi nhận vào bảng theo dõi của Drizzle (hash = SHA-256 file)", async () => {
    const pg = await emptyDb();
    const r = await runMigrations(pgliteExecutor(pg), { dir: DIR });
    expect(r).toEqual({ baselined: [], applied: ALL });
    const rows = await tracked(pg);
    const j = await journal();
    expect(rows.map((x) => Number(x.created_at))).toEqual(j.entries.map((e) => e.when));
    const sha = createHash("sha256").update(await readFile(path.join(DIR, "0002_card_review.sql"), "utf8")).digest("hex");
    expect(rows[2].hash).toBe(sha);
    for (const [t, c] of [["students", "consent_version"], ["student_cards", "review_reasons"], ["student_cards", "live_similarity"]]) {
      expect(await hasColumn(pg, t, c), `${t}.${c}`).toBe(true);
    }
  });

  it("chạy 2 lần → lần 2 không làm gì, không lỗi", async () => {
    const pg = await emptyDb();
    await runMigrations(pgliteExecutor(pg), { dir: DIR });
    expect(await runMigrations(pgliteExecutor(pg), { dir: DIR })).toEqual({ baselined: [], applied: [] });
    expect(await tracked(pg)).toHaveLength(ALL.length);
  });

  it("DB kiểu cũ (chỉ 0000 + 0001) có dữ liệu → baseline 0000, 0001 rồi chạy 0002+; dữ liệu giữ nguyên", async () => {
    const pg = await legacyDb(["0000_init", "0001_hardening"]);
    await pg.query(`insert into students (student_code, last_name, first_name) values ('231230801','Nguyễn Văn','An')`);
    const r = await runMigrations(pgliteExecutor(pg), { dir: DIR });
    expect(r).toEqual({ baselined: ["0000_init", "0001_hardening"], applied: ["0002_card_review", "0003_card_live_check"] });
    expect(await hasColumn(pg, "students", "consent_version")).toBe(true);
    expect(await hasColumn(pg, "student_cards", "review_reasons")).toBe(true);
    expect(await hasColumn(pg, "student_cards", "live_similarity")).toBe(true);
    expect((await pg.query(`select last_name from students where student_code='231230801'`)).rows).toEqual([{ last_name: "Nguyễn Văn" }]);
    expect(await tracked(pg)).toHaveLength(ALL.length);
    expect(await runMigrations(pgliteExecutor(pg), { dir: DIR })).toEqual({ baselined: [], applied: [] });
  });

  it("DB kiểu cũ đã có đủ 0000–0003 (tạo sau khi có 0003) → chỉ baseline, không chạy lại", async () => {
    const pg = await legacyDb(ALL);
    expect(await runMigrations(pgliteExecutor(pg), { dir: DIR })).toEqual({ baselined: ALL, applied: [] });
  });

  it("DB kiểu cũ có users nhưng THIẾU dấu hiệu của 0001 → chỉ baseline 0000, chạy 0001+", async () => {
    const pg = await legacyDb(["0000_init"]);
    const r = await runMigrations(pgliteExecutor(pg), { dir: DIR });
    expect(r).toEqual({ baselined: ["0000_init"], applied: ["0001_hardening", "0002_card_review", "0003_card_live_check"] });
    expect((await pg.query(`select public.f_unaccent('Nguyễn Đức') as v`)).rows).toEqual([{ v: "Nguyen Duc" }]);
  });

  it("migration lỗi giữa chừng → rollback cả file đó (không còn câu lệnh nào của nó), không ghi nhận; các file trước vẫn giữ", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mig-"));
    temps.push(dir);
    await mkdir(path.join(dir, "meta"));
    for (const t of ALL) await copyFile(path.join(DIR, `${t}.sql`), path.join(dir, `${t}.sql`));
    const j = await journal();
    j.entries.push({ ...j.entries[j.entries.length - 1], idx: 4, tag: "0004_bad", when: j.entries[j.entries.length - 1].when + 1 } as never);
    await writeFile(path.join(dir, "meta/_journal.json"), JSON.stringify(j));
    await writeFile(
      path.join(dir, "0004_bad.sql"),
      `CREATE TABLE "half_done" (id int);--> statement-breakpoint\nALTER TABLE "students" ADD COLUMN "x" int;--> statement-breakpoint\nSELECT * FROM "khong_ton_tai";`,
    );

    const pg = await emptyDb();
    await expect(runMigrations(pgliteExecutor(pg), { dir })).rejects.toThrow(/0004_bad/);
    expect((await pg.query(`select to_regclass('public.half_done') as t`)).rows[0]).toEqual({ t: null });
    expect(await hasColumn(pg, "students", "x")).toBe(false);
    expect(await tracked(pg)).toHaveLength(ALL.length); // 0000–0003 đã commit, 0004 không được ghi nhận
    // sửa file rồi chạy lại → chỉ chạy 0004
    await writeFile(path.join(dir, "0004_bad.sql"), `CREATE TABLE "half_done" (id int);`);
    expect(await runMigrations(pgliteExecutor(pg), { dir })).toEqual({ baselined: [], applied: ["0004_bad"] });
  });

  it("migrateLocal (openLocalDb): DB mới → seed 16 tiết; mở lại không ghi đè bảng tiết Admin đã sửa", async () => {
    const { migrateLocal } = await import("../src/local");
    const pg = await emptyDb();
    await migrateLocal(pg as never);
    expect((await pg.query<{ n: number }>(`select count(*)::int as n from periods`)).rows[0].n).toBe(16);
    await pg.query(`update periods set starts_at = '07:05' where number = 1`);
    await migrateLocal(pg as never);
    expect((await pg.query<{ s: string }>(`select starts_at::text as s from periods where number = 1`)).rows[0].s).toBe("07:05:00");
  });

  it("thiếu file .sql của một mục trong journal → lỗi rõ ràng trước khi chạy gì", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mig-"));
    temps.push(dir);
    await mkdir(path.join(dir, "meta"));
    await copyFile(path.join(DIR, "meta/_journal.json"), path.join(dir, "meta/_journal.json"));
    await copyFile(path.join(DIR, "0000_init.sql"), path.join(dir, "0000_init.sql"));
    const pg = await emptyDb();
    await expect(runMigrations(pgliteExecutor(pg), { dir })).rejects.toThrow(/0001_hardening/);
    expect((await pg.query(`select to_regclass('public.users') as t`)).rows[0]).toEqual({ t: null });
  });

  it("thiếu nhiều file → báo ĐỦ các file thiếu theo thứ tự journal, kết quả như nhau mọi lần (không phụ thuộc I/O nào xong trước)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mig-"));
    temps.push(dir);
    await mkdir(path.join(dir, "meta"));
    await copyFile(path.join(DIR, "meta/_journal.json"), path.join(dir, "meta/_journal.json"));
    await copyFile(path.join(DIR, "0000_init.sql"), path.join(dir, "0000_init.sql"));
    const journal = JSON.parse(await readFile(path.join(DIR, "meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
    const missing = journal.entries.sort((a, b) => a.idx - b.idx).map((e) => `${e.tag}.sql`).filter((f) => f !== "0000_init.sql");
    expect(missing.length).toBeGreaterThanOrEqual(2); // phép thử chỉ có nghĩa khi thiếu ≥ 2 file
    const messages = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const err = await loadMigrations(dir).then(
        () => null,
        (e: Error) => e.message,
      );
      expect(err).not.toBeNull();
      messages.add(err!);
    }
    expect(messages.size).toBe(1);
    const [msg] = messages;
    const positions = missing.map((f) => msg.indexOf(f));
    expect(positions.every((p) => p >= 0), msg).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});
