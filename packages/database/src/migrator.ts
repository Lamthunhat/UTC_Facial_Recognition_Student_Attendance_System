import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Runner migration dùng chung cho PGlite (chạy thử cục bộ, test) và Postgres/Supabase (scripts/migrate.ts).
 *
 * - Ghi nhận vào bảng theo dõi của Drizzle migrator ("drizzle"."__drizzle_migrations": hash = SHA-256 nội dung file,
 *   created_at = mốc `when` trong meta/_journal.json) → drizzle-kit / migrator của Drizzle vẫn hiểu đúng trạng thái.
 * - Chạy mọi migration còn thiếu theo thứ tự journal; MỖI FILE MỘT TRANSACTION (câu lệnh + bản ghi theo dõi cùng
 *   commit hoặc cùng rollback) — file lỗi giữa chừng không để lại nửa vời.
 * - Baseline cho DB tạo theo cơ chế cũ (chạy thẳng mọi file .sql, không ghi nhận): kiểm dấu hiệu từng migration theo
 *   thứ tự và đánh dấu đoạn đầu liên tiếp đã có đủ dấu hiệu, rồi chạy phần còn lại.
 * Không phụ thuộc "server-only": dùng được trong script và test.
 */
export const MIGRATIONS_TABLE = `"drizzle"."__drizzle_migrations"`;

export interface MigrationTx {
  exec(sql: string): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}
export interface MigrationExecutor extends MigrationTx {
  transaction<T>(fn: (tx: MigrationTx) => Promise<T>): Promise<T>;
}

/** Adapter PGlite (đối tượng có exec/query/transaction). */
export function pgliteExecutor(pg: {
  exec(sql: string): Promise<unknown>;
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  transaction<T>(fn: (tx: { exec(sql: string): Promise<unknown>; query<R>(sql: string, params?: unknown[]): Promise<{ rows: R[] }> }) => Promise<T>): Promise<T>;
}): MigrationExecutor {
  const wrap = (c: { exec(sql: string): Promise<unknown>; query<R>(sql: string, params?: unknown[]): Promise<{ rows: R[] }> }): MigrationTx => ({
    exec: async (sql) => void (await c.exec(sql)),
    query: async <T>(sql: string, params?: unknown[]) => (await c.query<T>(sql, params)).rows,
  });
  return { ...wrap(pg), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))) };
}

/** Adapter postgres-js (`postgres()`): `unsafe` cho câu lệnh thô, `begin` cho transaction. */
export function postgresJsExecutor(sql: {
  unsafe(query: string, params?: never[]): PromiseLike<unknown>;
  begin<T>(fn: (tx: { unsafe(query: string, params?: never[]): PromiseLike<unknown> }) => Promise<T>): PromiseLike<unknown>;
}): MigrationExecutor {
  const wrap = (c: { unsafe(query: string, params?: never[]): PromiseLike<unknown> }): MigrationTx => ({
    exec: async (q) => void (await c.unsafe(q)),
    query: async <T>(q: string, params?: unknown[]) => (await c.unsafe(q, params as never[])) as T[],
  });
  return { ...wrap(sql), transaction: async <T>(fn: (tx: MigrationTx) => Promise<T>) => (await sql.begin((tx) => fn(wrap(tx)))) as T };
}

interface Migration {
  tag: string;
  when: number;
  hash: string;
  statements: string[];
}

/** Đọc journal + toàn bộ file trước khi chạy gì: thiếu file → lỗi ngay, DB không bị đụng tới. */
export async function loadMigrations(dir: string): Promise<Migration[]> {
  const journal = JSON.parse(await readFile(path.join(dir, "meta/_journal.json"), "utf8")) as {
    entries: { idx: number; tag: string; when: number }[];
  };
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);
  return Promise.all(
    entries.map(async (e) => {
      let content: string;
      try {
        content = await readFile(path.join(dir, `${e.tag}.sql`), "utf8");
      } catch {
        throw new Error(`Thiếu file migration ${e.tag}.sql trong ${dir}`);
      }
      return {
        tag: e.tag,
        when: e.when,
        hash: createHash("sha256").update(content).digest("hex"),
        statements: content.split("--> statement-breakpoint").filter((s) => s.trim()),
      };
    }),
  );
}

/**
 * Dấu hiệu nhận biết migration đã được chạy trên DB kiểu cũ (chưa có bảng theo dõi). Chỉ cần cho các migration có từ
 * trước khi đổi sang runner này; DB tạo mới từ nay luôn có bảng theo dõi nên migration mới không cần dấu hiệu.
 */
const col = (table: string, column: string) =>
  `exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = '${table}' and column_name = '${column}')`;
const LEGACY_MARKERS: Record<string, string> = {
  "0000_init": `to_regclass('public.users') is not null`,
  "0001_hardening": `exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                             where n.nspname = 'public' and p.proname = 'f_unaccent') and ${col("students", "search_text")}`,
  "0002_card_review": `${col("students", "consent_version")} and ${col("student_cards", "review_reasons")}`,
  "0003_card_live_check": col("student_cards", "live_similarity"),
};

/** Khoá tư vấn (advisory lock) để hai tiến trình không migrate cùng lúc. */
const LOCK_KEY = 72_031_101;

export async function runMigrations(db: MigrationExecutor, opts: { dir: string }): Promise<{ baselined: string[]; applied: string[] }> {
  const migrations = await loadMigrations(opts.dir);
  await db.query(`select pg_advisory_lock(${LOCK_KEY})`);
  try {
    await db.exec(`
      create schema if not exists "drizzle";
      create table if not exists ${MIGRATIONS_TABLE} (id serial primary key, hash text not null, created_at bigint)`);

    const baselined: string[] = [];
    const [{ n }] = await db.query<{ n: number }>(`select count(*)::int as n from ${MIGRATIONS_TABLE}`);
    const [{ legacy }] = await db.query<{ legacy: boolean }>(`select to_regclass('public.users') is not null as legacy`);
    if (n === 0 && legacy) {
      for (const m of migrations) {
        const marker = LEGACY_MARKERS[m.tag];
        if (!marker) break;
        const [{ ok }] = await db.query<{ ok: boolean }>(`select (${marker}) as ok`);
        if (!ok) break;
        baselined.push(m.tag);
      }
      if (baselined.length) {
        await db.transaction(async (tx) => {
          for (const m of migrations.filter((x) => baselined.includes(x.tag))) {
            await tx.query(`insert into ${MIGRATIONS_TABLE} (hash, created_at) values ($1, $2)`, [m.hash, m.when]);
          }
        });
      }
    }

    // Ngữ nghĩa giống migrator của Drizzle: chạy các migration có mốc `when` lớn hơn bản ghi mới nhất.
    const [{ last }] = await db.query<{ last: string | null }>(`select max(created_at)::text as last from ${MIGRATIONS_TABLE}`);
    const lastWhen = last === null ? -1 : Number(last);
    const applied: string[] = [];
    for (const m of migrations.filter((x) => x.when > lastWhen)) {
      try {
        await db.transaction(async (tx) => {
          for (const stmt of m.statements) await tx.exec(stmt);
          await tx.query(`insert into ${MIGRATIONS_TABLE} (hash, created_at) values ($1, $2)`, [m.hash, m.when]);
        });
      } catch (e) {
        throw new Error(`Migration ${m.tag} lỗi, đã rollback toàn bộ file: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
      applied.push(m.tag);
    }
    return { baselined, applied };
  } finally {
    await db.query(`select pg_advisory_unlock(${LOCK_KEY})`);
  }
}
