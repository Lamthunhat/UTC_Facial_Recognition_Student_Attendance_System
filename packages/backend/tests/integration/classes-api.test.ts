import { readFile } from "node:fs/promises";
import path from "node:path";
import { useTestAppDb } from "@utc/database/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getClassApi, PATCH as patchClass } from "../../src/api/classes/class";
import { GET as listClassesApi, POST as createClassApi } from "../../src/api/classes/classes";
import { POST as commitApi } from "../../src/api/classes/roster-commit";
import { POST as previewApi } from "../../src/api/classes/roster-preview";
import { DELETE as withdrawApi, POST as addStudentApi } from "../../src/api/classes/student";
import { createSession, SESSION_COOKIE } from "../../src/auth/session";
import { NO_PARAMS } from "../../src/http/handler";
import { readJson } from "../support/http";

/** T048/T049/T052 — API lớp học + nhập danh sách qua handler thật (route() + Request). */

const O = "http://localhost";
const FIX = path.resolve(__dirname, "../fixtures");

let ctx: Awaited<ReturnType<typeof useTestAppDb>>;
let gvId = "";
let gvCookie = "";
let gv2Cookie = "";
let adminCookie = "";

const jsonReq = (p: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request(`${O}${p}`, {
    ...init,
    headers: { origin: O, "content-type": "application/json", ...(init.cookie ? { cookie: init.cookie } : {}), ...init.headers },
  });
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });

const newClassBody = (code: string) => ({
  code,
  courseName: "Khai phá dữ liệu",
  semester: "1-2026-2027",
  startDate: "2026-09-07",
  endDate: "2026-12-20",
  defaultRoom: "301-A7-A7",
  schedules: [{ weekday: 2, shift: 1 }],
});

async function createVia(cookie: string, code: string): Promise<string> {
  const res = await createClassApi(jsonReq("/api/classes", { method: "POST", cookie, body: JSON.stringify(newClassBody(code)) }), NO_PARAMS);
  expect(res.status).toBe(201);
  return (await readJson(res)).class.id;
}

beforeAll(async () => {
  process.env.JWT_SECRET = "integration-secret-integration-secret-xx";
  ctx = await useTestAppDb();
  const mk = async (email: string, role: string) =>
    (await ctx.pg.query<{ id: string }>(`insert into users (email,password_hash,full_name,role) values ($1,'x',$1,$2) returning id`, [email, role])).rows[0].id;
  gvId = await mk("gv-a@utc.edu.vn", "instructor");
  const gv2 = await mk("gv-b@utc.edu.vn", "instructor");
  const admin = await mk("admin@utc.edu.vn", "admin");
  gvCookie = `${SESSION_COOKIE}=${(await createSession(gvId, "instructor")).token}`;
  gv2Cookie = `${SESSION_COOKIE}=${(await createSession(gv2, "instructor")).token}`;
  adminCookie = `${SESSION_COOKIE}=${(await createSession(admin, "admin")).token}`;
}, 120_000);
afterAll(() => ctx.close());

describe("GET/POST /api/classes (T048)", () => {
  it("tạo lớp → 201 kèm lịch đã quy đổi từ ca", async () => {
    const res = await createClassApi(jsonReq("/api/classes", { method: "POST", cookie: gvCookie, body: JSON.stringify(newClassBody("API-1")) }), NO_PARAMS);
    expect(res.status).toBe(201);
    const { class: c } = await readJson(res);
    expect(c).toMatchObject({ code: "API-1", instructorId: gvId, schedules: [{ weekday: 2, firstPeriod: 1, lastPeriod: 3, room: null }] });
  });

  it("16 tuần → 422 DURATION_EXCEEDED", async () => {
    const res = await createClassApi(
      jsonReq("/api/classes", { method: "POST", cookie: gvCookie, body: JSON.stringify({ ...newClassBody("API-16w"), endDate: "2026-12-28" }) }),
      NO_PARAMS,
    );
    expect(res.status).toBe(422);
    expect((await readJson(res)).error.code).toBe("DURATION_EXCEEDED");
  });

  it("trường lạ / sai kiểu → 422 VALIDATION_ERROR (Zod strict)", async () => {
    const extra = await createClassApi(
      jsonReq("/api/classes", { method: "POST", cookie: gvCookie, body: JSON.stringify({ ...newClassBody("API-x"), hack: 1 }) }),
      NO_PARAMS,
    );
    expect(extra.status).toBe(422);
    const radius = await createClassApi(
      jsonReq("/api/classes", { method: "POST", cookie: gvCookie, body: JSON.stringify({ ...newClassBody("API-r"), radiusM: 5 }) }),
      NO_PARAMS,
    );
    expect(radius.status).toBe(422);
    const [f] = (await readJson(radius)).error.fields;
    expect(f.path).toBe("radiusM");
    expect(f.message).toMatch(/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i); // thông báo tiếng Việt
  });

  it("GET chỉ trả lớp của chính giảng viên; admin thấy tất cả", async () => {
    await createVia(gv2Cookie, "CUA-B");
    const mine = (await readJson(await listClassesApi(jsonReq("/api/classes", { cookie: gvCookie }), NO_PARAMS))).classes;
    expect(mine.map((c: { code: string }) => c.code)).toContain("API-1");
    expect(mine.map((c: { code: string }) => c.code)).not.toContain("CUA-B");
    const all = (await readJson(await listClassesApi(jsonReq("/api/classes", { cookie: adminCookie }), NO_PARAMS))).classes;
    expect(all.map((c: { code: string }) => c.code)).toEqual(expect.arrayContaining(["API-1", "CUA-B"]));
  });
});

describe("GET/PATCH /api/classes/{id} (T048)", () => {
  let id = "";
  beforeAll(async () => {
    id = await createVia(gvCookie, "API-PATCH");
  });

  it("chủ lớp xem và sửa được", async () => {
    expect((await getClassApi(jsonReq(`/api/classes/${id}`, { cookie: gvCookie }), params({ id }))).status).toBe(200);
    const res = await patchClass(
      jsonReq(`/api/classes/${id}`, { method: "PATCH", cookie: gvCookie, body: JSON.stringify({ defaultRoom: "205-A2", radiusM: 100 }) }),
      params({ id }),
    );
    expect(res.status).toBe(200);
    expect((await readJson(res)).class).toMatchObject({ defaultRoom: "205-A2", radiusM: 100 });
  });

  it("giảng viên khác → 404 (không lộ lớp có tồn tại); id không phải UUID → 404", async () => {
    expect((await getClassApi(jsonReq(`/api/classes/${id}`, { cookie: gv2Cookie }), params({ id }))).status).toBe(404);
    const res = await patchClass(
      jsonReq(`/api/classes/${id}`, { method: "PATCH", cookie: gv2Cookie, body: JSON.stringify({ defaultRoom: "hack" }) }),
      params({ id }),
    );
    expect(res.status).toBe(404);
    expect((await getClassApi(jsonReq(`/api/classes/abc`, { cookie: gvCookie }), params({ id: "abc" }))).status).toBe(404);
  });

  it("admin sửa được lớp bất kỳ", async () => {
    const res = await patchClass(
      jsonReq(`/api/classes/${id}`, { method: "PATCH", cookie: adminCookie, body: JSON.stringify({ checkinMinutes: 20 }) }),
      params({ id }),
    );
    expect(res.status).toBe(200);
  });
});

// ---------------- T049: nhập danh sách (multipart) + thêm/rút từng SV ----------------

/** Dựng request multipart có content-length thật (trình duyệt luôn gửi header này). */
async function multipart(
  p: string,
  cookie: string,
  fields: Record<string, string | { buf: Buffer; name: string }>,
  extraHeaders: Record<string, string> = {},
) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "string") fd.append(k, v);
    else fd.append(k, new Blob([new Uint8Array(v.buf)]), v.name);
  }
  const tmp = new Request(`${O}${p}`, { method: "POST", body: fd });
  const body = Buffer.from(await tmp.arrayBuffer());
  return new Request(`${O}${p}`, {
    method: "POST",
    body,
    headers: {
      origin: O,
      cookie,
      "content-type": tmp.headers.get("content-type")!,
      "content-length": String(body.length),
      ...extraHeaders,
    },
  });
}
const fx = async (name: string) => ({ buf: await readFile(path.join(FIX, name)), name });
const csv = (lines: string[]) => ({ buf: Buffer.from(lines.join("\n")), name: "ds.csv" });
const activeCount = async (classId: string) =>
  (await ctx.pg.query<{ n: number }>(`select count(*)::int as n from enrollments where class_id=$1 and status='active'`, [classId])).rows[0].n;

describe("POST /api/classes/{id}/roster/preview|commit (T049)", () => {
  let id = "";
  beforeAll(async () => {
    id = await createVia(gvCookie, "API-ROSTER");
  });
  type Fields = Parameters<typeof multipart>[2];
  const preview = async (fields: Fields, cookie = gvCookie) =>
    previewApi(await multipart(`/api/classes/${id}/roster/preview`, cookie, fields), params({ id }));
  const commit = async (fields: Fields, cookie = gvCookie) =>
    commitApi(await multipart(`/api/classes/${id}/roster/commit`, cookie, fields), params({ id }));

  it("preview roster-40.xlsx: 38 hợp lệ, 2 lỗi, không cảnh báo, không ghi DB", async () => {
    const res = await preview({ file: await fx("roster-40.xlsx") });
    expect(res.status).toBe(200);
    const b = await readJson(res);
    expect(b.summary).toMatchObject({ valid: 38, invalid: 2, new: 38, toWithdraw: 0 });
    expect(b.rows).toHaveLength(40);
    expect(b.warnings).toEqual([]);
    expect(await activeCount(id)).toBe(0);
  });

  it("giảng viên khác → 404 cho cả preview và commit", async () => {
    expect((await preview({ file: await fx("roster-40.xlsx") }, gv2Cookie)).status).toBe(404);
    expect((await commit({ file: await fx("roster-40.xlsx") }, gv2Cookie)).status).toBe(404);
    expect(await activeCount(id)).toBe(0);
  });

  it("commit roster-40.xlsx → 38 SV active", async () => {
    const res = await commit({ file: await fx("roster-40.xlsx") });
    expect(res.status).toBe(200);
    expect((await readJson(res)).result).toMatchObject({ added: 38, withdrawn: 0 });
    expect(await activeCount(id)).toBe(38);
  });

  it("sẽ rút > 50% lớp: preview cảnh báo; commit thiếu xác nhận → 409, có xác nhận → rút", async () => {
    const lines = ["MSSV,Họ,Tên,Lớp"];
    for (let i = 1; i <= 10; i++) lines.push(`2312308${String(i).padStart(2, "0")},Họ,Tên,CNTT3`);
    const p = await readJson(await preview({ file: csv(lines) }));
    expect(p.warnings).toContainEqual({ code: "LARGE_WITHDRAWAL", toWithdraw: 28, active: 38 });

    const no = await commit({ file: csv(lines) });
    expect(no.status).toBe(409);
    expect((await readJson(no)).error.code).toBe("LARGE_WITHDRAWAL_CONFIRM_REQUIRED");
    expect(await activeCount(id)).toBe(38);

    const yes = await commit({ file: csv(lines), confirmLargeWithdrawal: "true" });
    expect(yes.status).toBe(200);
    expect((await readJson(yes)).result).toMatchObject({ withdrawn: 28 });
    expect(await activeCount(id)).toBe(10);
  });

  it("họ/tên bắt đầu bằng = + - @ → cảnh báo FORMULA_LIKE_NAMES kèm số dòng", async () => {
    const b = await readJson(await preview({ file: await fx("roster-formula.xlsx") }));
    expect(b.warnings).toContainEqual({ code: "FORMULA_LIKE_NAMES", rows: [2] });
  });

  it("ghép cột thủ công qua columnMapping (JSON) — dùng được ở preview", async () => {
    const lines = ["Số hiệu,Họ,Tên,Đơn vị", "231230801,Nguyễn Văn,An,CNTT3"];
    const auto = await readJson(await preview({ file: csv(lines) }));
    expect(auto.missing).toContain("code");
    const mapping = JSON.stringify({ code: 0, lastName: 1, firstName: 2, adminClass: 3 });
    const manual = await readJson(await preview({ file: csv(lines), columnMapping: mapping }));
    expect(manual.missing).toEqual([]);
    expect(manual.summary.valid).toBe(1);
  });

  it("commit file thiếu cột bắt buộc → 422 MISSING_COLUMNS", async () => {
    const res = await commit({ file: csv(["Họ,Tên,Lớp", "A,B,C"]) });
    expect(res.status).toBe(422);
    expect((await readJson(res)).error.code).toBe("MISSING_COLUMNS");
  });

  it("thiếu file / columnMapping sai → 422", async () => {
    const a = await preview({ note: "x" });
    expect(a.status).toBe(422);
    expect((await readJson(a)).error.code).toBe("FILE_REQUIRED");
    const b = await preview({ file: csv(["MSSV,Họ,Tên,Lớp"]), columnMapping: "{not json" });
    expect(b.status).toBe(422);
    const c = await preview({ file: csv(["MSSV,Họ,Tên,Lớp"]), columnMapping: JSON.stringify({ code: -1 }) });
    expect(c.status).toBe(422);
  });

  it("content-length > 5 MB → 413 trước khi đọc body; thiếu content-length → 411", async () => {
    const big = await multipart(`/api/classes/${id}/roster/preview`, gvCookie, { file: csv(["MSSV"]) }, { "content-length": String(6 * 1024 * 1024) });
    expect((await previewApi(big, params({ id }))).status).toBe(413);
    const noLen = new Request(`${O}/api/classes/${id}/roster/preview`, {
      method: "POST",
      headers: { origin: O, cookie: gvCookie, "content-type": "multipart/form-data; boundary=x" },
      body: "--x--",
    });
    noLen.headers.delete("content-length");
    expect((await previewApi(noLen, params({ id }))).status).toBe(411);
  });

  it("file .xls cũ → 422 UNSUPPORTED_TYPE", async () => {
    const res = await preview({ file: { buf: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), name: "a.xls" } });
    expect(res.status).toBe(422);
    expect((await readJson(res)).error.code).toBe("UNSUPPORTED_TYPE");
  });
});

describe("rate limit nhập file (T049, RULES.rosterImport 20/giờ)", () => {
  it("lần thứ 21 trong giờ → 429 + Retry-After, tính chung preview và commit", async () => {
    const gv3 = (
      await ctx.pg.query<{ id: string }>(`insert into users (email,password_hash,full_name,role) values ('gv-c@utc.edu.vn','x','C','instructor') returning id`)
    ).rows[0].id;
    const cookie = `${SESSION_COOKIE}=${(await createSession(gv3, "instructor")).token}`;
    const id = await createVia(cookie, "RL-1");
    const file = csv(["MSSV,Họ,Tên,Lớp", "231230801,A,B,C"]);
    for (let i = 0; i < 10; i++) {
      expect((await previewApi(await multipart(`/x`, cookie, { file }), params({ id }))).status).toBe(200);
      expect((await commitApi(await multipart(`/x`, cookie, { file }), params({ id }))).status).toBe(200);
    }
    const r = await previewApi(await multipart(`/x`, cookie, { file }), params({ id }));
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("POST/DELETE /api/classes/{id}/students/{code} (T049, FR-015)", () => {
  let id = "";
  beforeAll(async () => {
    id = await createVia(gvCookie, "API-STU");
  });
  const add = (code: string, body: object = {}, cookie = gvCookie) =>
    addStudentApi(jsonReq(`/api/classes/${id}/students/${code}`, { method: "POST", cookie, body: JSON.stringify(body) }), params({ id, code }));
  const del = (code: string, cookie = gvCookie) =>
    withdrawApi(jsonReq(`/api/classes/${id}/students/${code}`, { method: "DELETE", cookie }), params({ id, code }));

  it("thêm SV mới (kèm họ tên) → 201; thêm lại → 200 không đổi", async () => {
    const a = await add("231239999", { lastName: "Đỗ Thị", firstName: "Mới", adminClass: "CNTT3" });
    expect(a.status).toBe(201);
    expect(await readJson(a)).toMatchObject({ enrollment: { code: "231239999", status: "active" }, changed: true });
    const b = await add("231239999");
    expect(b.status).toBe(200);
    expect((await readJson(b)).changed).toBe(false);
  });

  it("SV mới mà thiếu họ tên → 422 STUDENT_INFO_REQUIRED; mã sai → 422 INVALID_CODE", async () => {
    expect((await readJson(await add("231238888"))).error.code).toBe("STUDENT_INFO_REQUIRED");
    const bad = await add("abc", { lastName: "A", firstName: "B" });
    expect(bad.status).toBe(422);
    expect((await readJson(bad)).error.code).toBe("INVALID_CODE");
  });

  it("SV đã có trong hệ thống: thêm chỉ cần mã", async () => {
    await ctx.pg.query(`insert into students (student_code,last_name,first_name) values ('231237777','Lê','Có Sẵn') on conflict do nothing`);
    expect((await add("231237777")).status).toBe(201);
  });

  it("rút → 200 withdrawn (giữ bản ghi); rút lại → không đổi; SV không thuộc lớp → 404; thêm lại → ghi danh lại", async () => {
    const r = await del("231239999");
    expect(r.status).toBe(200);
    expect(await readJson(r)).toMatchObject({ enrollment: { code: "231239999", status: "withdrawn" }, changed: true });
    expect((await readJson(await del("231239999"))).changed).toBe(false);
    expect((await del("231230000")).status).toBe(404);
    const again = await add("231239999");
    expect(again.status).toBe(200);
    expect(await readJson(again)).toMatchObject({ enrollment: { status: "active" }, changed: true });
  });

  it("giảng viên khác → 404", async () => {
    expect((await add("231239999", {}, gv2Cookie)).status).toBe(404);
    expect((await del("231239999", gv2Cookie)).status).toBe(404);
  });
});

// ---------------- T052: audit_logs ----------------

describe("audit_logs cho lớp học và danh sách (T052)", () => {
  type Log = { actor_type: string; actor_id: string; target_type: string; target_id: string; meta: Record<string, unknown> | null };
  const logs = async (action: string, targetId?: string) =>
    (
      await ctx.pg.query<Log>(
        `select actor_type, actor_id, target_type, target_id, meta from audit_logs where action = $1 ${targetId ? "and target_id = $2" : ""} order by created_at`,
        targetId ? [action, targetId] : [action],
      )
    ).rows;

  let id = "";
  beforeAll(async () => {
    id = await createVia(gvCookie, "AUDIT-1");
  });

  it("tạo lớp → class.create (ai, lớp nào, mã lớp)", async () => {
    const [l] = await logs("class.create", id);
    expect(l).toMatchObject({ actor_type: "instructor", actor_id: gvId, target_type: "class", meta: { code: "AUDIT-1" } });
  });

  it("tạo lớp thất bại không ghi nhật ký", async () => {
    const before = (await logs("class.create")).length;
    await createClassApi(
      jsonReq("/api/classes", { method: "POST", cookie: gvCookie, body: JSON.stringify({ ...newClassBody("AUDIT-16w"), endDate: "2026-12-28" }) }),
      NO_PARAMS,
    );
    expect((await logs("class.create")).length).toBe(before);
  });

  it("sửa lớp → class.update kèm danh sách trường đã đổi; admin sửa ghi actor admin", async () => {
    await patchClass(jsonReq(`/api/classes/${id}`, { method: "PATCH", cookie: gvCookie, body: JSON.stringify({ defaultRoom: "205-A2", radiusM: 70 }) }), params({ id }));
    await patchClass(jsonReq(`/api/classes/${id}`, { method: "PATCH", cookie: adminCookie, body: JSON.stringify({ checkinMinutes: 10 }) }), params({ id }));
    const ls = await logs("class.update", id);
    expect(ls).toHaveLength(2);
    expect(ls[0].meta).toEqual({ fields: ["defaultRoom", "radiusM"] });
    expect(ls[1]).toMatchObject({ actor_type: "admin", meta: { fields: ["checkinMinutes"] } });
  });

  it("preview không ghi; commit → roster.import với số thêm/rút/lỗi", async () => {
    await previewApi(await multipart(`/x`, gvCookie, { file: await fx("roster-40.xlsx") }), params({ id }));
    expect(await logs("roster.import", id)).toHaveLength(0);
    await commitApi(await multipart(`/x`, gvCookie, { file: await fx("roster-40.xlsx") }), params({ id }));
    const lines = ["MSSV,Họ,Tên,Lớp"];
    for (let i = 1; i <= 40; i++) if (i !== 3 && i !== 25 && i !== 32) lines.push(`2312308${String(i).padStart(2, "0")},H,T,L`);
    await commitApi(await multipart(`/x`, gvCookie, { file: csv(lines) }), params({ id }));
    const ls = await logs("roster.import", id);
    expect(ls.map((l) => l.meta)).toEqual([
      { added: 38, reactivated: 0, withdrawn: 0, existing: 0, invalidRows: 2 },
      { added: 0, reactivated: 0, withdrawn: 1, existing: 37, invalidRows: 0 },
    ]);
  });

  it("commit bị chặn (409 rút > 50%) không ghi nhật ký", async () => {
    const before = (await logs("roster.import", id)).length;
    const r = await commitApi(await multipart(`/x`, gvCookie, { file: csv(["MSSV,Họ,Tên,Lớp", "231230801,H,T,L"]) }), params({ id }));
    expect(r.status).toBe(409);
    expect((await logs("roster.import", id)).length).toBe(before);
  });

  it("thêm/rút từng SV → roster.student_add / roster.student_withdraw; gọi lại không đổi thì không ghi", async () => {
    const add = () =>
      addStudentApi(
        jsonReq(`/api/classes/${id}/students/231236666`, { method: "POST", cookie: gvCookie, body: JSON.stringify({ lastName: "Phan", firstName: "Văn" }) }),
        params({ id, code: "231236666" }),
      );
    const del = () => withdrawApi(jsonReq(`/api/classes/${id}/students/231236666`, { method: "DELETE", cookie: gvCookie }), params({ id, code: "231236666" }));
    await add();
    await add();
    await del();
    await del();
    const added = (await logs("roster.student_add")).filter((l) => l.meta?.classId === id);
    const withdrawn = (await logs("roster.student_withdraw")).filter((l) => l.meta?.classId === id);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ target_type: "student", meta: { classId: id, studentCode: "231236666" } });
    expect(withdrawn).toHaveLength(1);
  });
});

