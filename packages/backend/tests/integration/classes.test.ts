import { readFile } from "node:fs/promises";
import path from "node:path";
import { useTestAppDb } from "@utc/database/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClass, listClasses, updateClass } from "../../src/classes/service";
import { addStudent, commitRoster, previewRoster, withdrawStudent } from "../../src/roster/commit";
import type { RosterStudent } from "../../src/roster/columns";

/**
 * T042 — Lớp học + nhập danh sách (US1, quickstart Q1–Q3, FR-011…FR-014).
 * Gọi thẳng service của @utc/backend trên Postgres nhúng (PGlite) chạy migration thật.
 */

const FIX = path.resolve(__dirname, "../fixtures");
const fixture = (f: string) => readFile(path.join(FIX, f));

let ctx: Awaited<ReturnType<typeof useTestAppDb>>;
let instructorId = "";
const gvActor = () => ({ sub: instructorId, role: "instructor" as const, sid: "test" });

async function insertClass(code: string): Promise<string> {
  const r = await ctx.pg.query<{ id: string }>(
    `insert into classes (instructor_id, code, course_name, start_date, end_date)
     values ($1, $2, 'Khai phá dữ liệu', '2026-09-07', '2026-12-20') returning id`,
    [instructorId, code],
  );
  return r.rows[0].id;
}

const enrollmentOf = async (classId: string) =>
  (
    await ctx.pg.query<{ code: string; status: string; withdrawn_at: Date | null }>(
      `select s.student_code as code, e.status, e.withdrawn_at from enrollments e
       join students s on s.id = e.student_id where e.class_id = $1 order by s.student_code`,
      [classId],
    )
  ).rows;

const validStudents = (rows: { data: RosterStudent; errors: string[] }[]) => rows.filter((r) => !r.errors.length).map((r) => r.data);

beforeAll(async () => {
  ctx = await useTestAppDb();
  instructorId = (
    await ctx.pg.query<{ id: string }>(
      `insert into users (email,password_hash,full_name,role) values ('gv1@utc.edu.vn','x','GV1','instructor') returning id`,
    )
  ).rows[0].id;
}, 120_000);
afterAll(() => ctx.close());

describe("tạo lớp (Q1, T047)", () => {
  const gv = () => ({ sub: instructorId, role: "instructor" as const, sid: "test" });
  const base = {
    courseName: "Khai phá dữ liệu",
    semester: "1-2026-2027",
    startDate: "2026-09-07",
    endDate: "2026-12-20",
    defaultRoom: "301-A7-A7",
  };

  it("lớp kéo dài 16 tuần → 422 DURATION_EXCEEDED", async () => {
    await expect(
      createClass(gv(), {
        ...base,
        code: "KPDL-16w",
        endDate: "2026-12-28", // 112 ngày = 16 tuần
        schedules: [{ weekday: 2, firstPeriod: 1, lastPeriod: 3 }],
      }),
    ).rejects.toMatchObject({ status: 422, code: "DURATION_EXCEEDED" });
  });

  it("đúng 105 ngày (15 tuần) được chấp nhận", async () => {
    const c = await createClass(gv(), { ...base, code: "KPDL-15w", endDate: "2026-12-21", schedules: [{ weekday: 2, shift: 1 }] });
    expect(c.endDate).toBe("2026-12-21");
  });

  it("ngày kết thúc trước ngày bắt đầu → 422 INVALID_DATE_RANGE", async () => {
    await expect(
      createClass(gv(), { ...base, code: "KPDL-neg", startDate: "2026-09-07", endDate: "2026-09-01", schedules: [{ weekday: 2, shift: 1 }] }),
    ).rejects.toMatchObject({ status: 422, code: "INVALID_DATE_RANGE" });
  });

  it("tạo lớp nhiều buổi/tuần: chọn theo ca hoặc khoảng tiết, phòng riêng từng buổi; mặc định cấu hình", async () => {
    const c = await createClass(gv(), {
      ...base,
      code: "KPDL-ok",
      schedules: [
        { weekday: 2, shift: 1 },
        { weekday: 5, firstPeriod: 2, lastPeriod: 4, room: "205-A2" },
      ],
    });
    expect(c).toMatchObject({ code: "KPDL-ok", instructorId, defaultRoom: "301-A7-A7", radiusM: 50, checkinMinutes: 15 });
    expect(c.schedules).toEqual([
      { weekday: 2, firstPeriod: 1, lastPeriod: 3, room: null },
      { weekday: 5, firstPeriod: 2, lastPeriod: 4, room: "205-A2" },
    ]);
  });

  it.each([
    ["thứ ngoài 2–8", [{ weekday: 9, firstPeriod: 1, lastPeriod: 3 }]],
    ["tiết ngoài 1–16", [{ weekday: 2, firstPeriod: 15, lastPeriod: 17 }]],
    ["tiết đầu > tiết cuối", [{ weekday: 2, firstPeriod: 5, lastPeriod: 4 }]],
    ["ca không tồn tại", [{ weekday: 2, shift: 6 }]],
    ["vừa ca vừa tiết", [{ weekday: 2, shift: 1, firstPeriod: 1, lastPeriod: 3 }]],
    ["thiếu tiết", [{ weekday: 2, firstPeriod: 1 }]],
    ["hai buổi chồng tiết cùng thứ", [{ weekday: 3, firstPeriod: 1, lastPeriod: 3 }, { weekday: 3, shift: 1 }]],
    ["không có buổi nào", []],
  ])("lịch sai (%s) → 422 INVALID_SCHEDULE", async (_n, schedules) => {
    await expect(createClass(gv(), { ...base, code: `bad-${_n}`, schedules: schedules as never })).rejects.toMatchObject({
      status: 422,
      code: "INVALID_SCHEDULE",
    });
  });

  it("trùng mã lớp của cùng giảng viên → 409 CLASS_CODE_EXISTS", async () => {
    await expect(createClass(gv(), { ...base, code: "KPDL-ok", schedules: [{ weekday: 2, shift: 2 }] })).rejects.toMatchObject({
      status: 409,
      code: "CLASS_CODE_EXISTS",
    });
  });

  it("admin tạo lớp phải chỉ định giảng viên", async () => {
    const admin = { sub: instructorId, role: "admin" as const, sid: "test" };
    await expect(createClass(admin, { ...base, code: "ADM-1", schedules: [{ weekday: 2, shift: 1 }] })).rejects.toMatchObject({
      status: 422,
      code: "INSTRUCTOR_REQUIRED",
    });
    const c = await createClass(admin, { ...base, code: "ADM-1", instructorId, schedules: [{ weekday: 2, shift: 1 }] });
    expect(c.instructorId).toBe(instructorId);
  });

  it("giảng viên không được tạo lớp cho người khác → 403", async () => {
    await expect(
      createClass(gv(), { ...base, code: "X-other", instructorId: "00000000-0000-4000-8000-000000000000", schedules: [{ weekday: 2, shift: 1 }] }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("listClasses: giảng viên chỉ thấy lớp của mình", async () => {
    const other = (
      await ctx.pg.query<{ id: string }>(`insert into users (email,password_hash,full_name,role) values ('gv-khac@utc.edu.vn','x','GV khác','instructor') returning id`)
    ).rows[0].id;
    await createClass({ sub: other, role: "instructor" as const, sid: "test" }, { ...base, code: "CUA-GV-KHAC", schedules: [{ weekday: 2, shift: 1 }] });
    const mine = await listClasses(gv());
    expect(mine.map((c) => c.code)).toContain("KPDL-ok");
    expect(mine.map((c) => c.code)).not.toContain("CUA-GV-KHAC");
    const all = await listClasses({ sub: instructorId, role: "admin" as const, sid: "test" });
    expect(all.map((c) => c.code)).toContain("CUA-GV-KHAC");
  });
});

describe("sửa lớp (T047)", () => {
  const gv = () => ({ sub: instructorId, role: "instructor" as const, sid: "test" });
  let id = "";
  beforeAll(async () => {
    id = (
      await createClass(gv(), {
        code: "SUA-1",
        courseName: "Cơ sở dữ liệu",
        startDate: "2026-09-07",
        endDate: "2026-12-20",
        schedules: [{ weekday: 3, shift: 2 }],
      })
    ).id;
    await ctx.pg.query(
      `insert into sessions (class_id, date, first_period, last_period, starts_at, ends_at, room, kind)
       values ($1, '2026-11-10', 4, 6, '2026-11-10T02:35:00Z', '2026-11-10T05:00:00Z', '301-A7', 'scheduled')`,
      [id],
    );
  });

  it("đổi tên, phòng, cấu hình, thay lịch", async () => {
    const c = await updateClass(gv(), id, {
      courseName: "Cơ sở dữ liệu nâng cao",
      defaultRoom: "205-A2",
      radiusM: 80,
      leaveAutoApprove: true,
      schedules: [{ weekday: 4, shift: 3 }],
    });
    expect(c).toMatchObject({ courseName: "Cơ sở dữ liệu nâng cao", defaultRoom: "205-A2", radiusM: 80, leaveAutoApprove: true });
    expect(c.schedules).toEqual([{ weekday: 4, firstPeriod: 7, lastPeriod: 9, room: null }]);
  });

  it("end_date sớm hơn buổi học cuối đã có → 422 END_BEFORE_LAST_SESSION", async () => {
    await expect(updateClass(gv(), id, { endDate: "2026-11-09" })).rejects.toMatchObject({ status: 422, code: "END_BEFORE_LAST_SESSION" });
    const c = await updateClass(gv(), id, { endDate: "2026-11-10" });
    expect(c.endDate).toBe("2026-11-10");
  });

  it("start_date muộn hơn buổi học đầu đã có → 422 START_AFTER_FIRST_SESSION", async () => {
    await expect(updateClass(gv(), id, { startDate: "2026-11-11", endDate: "2026-12-20" })).rejects.toMatchObject({ status: 422, code: "START_AFTER_FIRST_SESSION" });
  });

  it("kéo dài quá 15 tuần → 422 DURATION_EXCEEDED", async () => {
    await expect(updateClass(gv(), id, { endDate: "2027-01-31" })).rejects.toMatchObject({ status: 422, code: "DURATION_EXCEEDED" });
  });

  it("không có thay đổi → 422 NOTHING_TO_UPDATE", async () => {
    await expect(updateClass(gv(), id, {})).rejects.toMatchObject({ status: 422, code: "NOTHING_TO_UPDATE" });
  });
});

describe("nhập danh sách roster-40.xlsx (Q2)", () => {
  let classId = "";
  beforeAll(async () => {
    classId = await insertClass("Khai phá dữ liệu-1-1-26(N03.BT1)");
  });

  it("xem trước: nhận cột tự động, báo đúng 2 dòng lỗi, 38 SV mới", async () => {
    const p = await previewRoster(classId, await fixture("roster-40.xlsx"), "roster-40.xlsx");
    expect(p.missing).toEqual([]);
    expect(p.columnsDetected).toMatchObject({ code: 1, lastName: 2, firstName: 3, adminClass: 4, cohort: 5 });
    expect(p.rows).toHaveLength(40);
    const bad = p.rows.filter((r) => r.errors.length).map((r) => [r.rowNo, r.errors]);
    expect(bad).toEqual([
      [30, ["DUPLICATE_CODE"]],
      [37, ["MISSING_FIRST_NAME"]],
    ]);
    expect(p.summary).toEqual({ valid: 38, invalid: 2, new: 38, reactivated: 0, existing: 0, toWithdraw: 0 });
    // mã lưu dạng số trong Excel vẫn đọc thành chuỗi đúng
    expect(p.rows[0].data).toEqual({ code: "231230801", lastName: "Nguyễn Văn", firstName: "An", adminClass: "CNTT3", cohort: "K64" });
  });

  it("xem trước không ghi gì vào DB", async () => {
    expect(await enrollmentOf(classId)).toEqual([]);
  });

  it("lưu: 38 SV active, bảng students có 38 bản ghi", async () => {
    const p = await previewRoster(classId, await fixture("roster-40.xlsx"), "roster-40.xlsx");
    const r = await commitRoster(gvActor(), classId, validStudents(p.rows));
    expect(r).toMatchObject({ added: 38, reactivated: 0, existing: 0, withdrawn: 0 });
    const e = await enrollmentOf(classId);
    expect(e).toHaveLength(38);
    expect(e.every((x) => x.status === "active")).toBe(true);
    const n = await ctx.pg.query<{ n: number }>(`select count(*)::int as n from students`);
    expect(n.rows[0].n).toBe(38);
  });

  it("nhập lại cùng file: không thêm, không rút (idempotent)", async () => {
    const p = await previewRoster(classId, await fixture("roster-40.xlsx"), "roster-40.xlsx");
    expect(p.summary).toMatchObject({ new: 0, existing: 38, toWithdraw: 0 });
    const r = await commitRoster(gvActor(), classId, validStudents(p.rows));
    expect(r).toMatchObject({ added: 0, existing: 38, withdrawn: 0 });
  });

  it("nhập lại file thiếu 1 SV + thêm 1 SV: SV thiếu → withdrawn (giữ bản ghi), SV mới → active", async () => {
    const csv = ["Mã SV,Họ,Tên,Lớp"];
    for (let i = 1; i <= 40; i++) {
      if (i === 25 || i === 32) continue; // hai dòng lỗi trong file gốc
      if (i === 2) continue; // 231230802 rời lớp
      csv.push(`2312308${String(i).padStart(2, "0")},Họ ${i},Tên ${i},CNTT3`);
    }
    csv.push("231230899,Đỗ Thị,Mới,CNTT3");
    const p = await previewRoster(classId, Buffer.from(csv.join("\n")), "lan2.csv");
    expect(p.summary).toMatchObject({ valid: 38, new: 1, existing: 37, toWithdraw: 1 });

    await commitRoster(gvActor(), classId, validStudents(p.rows));
    const e = await enrollmentOf(classId);
    expect(e).toHaveLength(39);
    const left = e.find((x) => x.code === "231230802")!;
    expect(left.status).toBe("withdrawn");
    expect(left.withdrawn_at).not.toBeNull();
    expect(e.find((x) => x.code === "231230899")!.status).toBe("active");
    // không ghi đè tên đã có của SV từ file của lớp khác/lần trước
    const s = await ctx.pg.query<{ last_name: string }>(`select last_name from students where student_code = '231230801'`);
    expect(s.rows[0].last_name).toBe("Nguyễn Văn");
  });

  it("SV đã rút có lại trong file → ghi danh lại, xoá withdrawn_at", async () => {
    const r = await commitRoster(gvActor(), classId, [{ code: "231230802", lastName: "X", firstName: "Y", adminClass: "CNTT3", cohort: null }, { code: "231230899", lastName: "Đỗ Thị", firstName: "Mới", adminClass: "CNTT3", cohort: null }], { confirmLargeWithdrawal: true });
    expect(r.reactivated).toBe(1);
    const back = (await enrollmentOf(classId)).find((x) => x.code === "231230802")!;
    expect(back).toMatchObject({ status: "active", withdrawn_at: null });
  });

  it("danh sách rỗng → 422 EMPTY_ROSTER (không rút cả lớp)", async () => {
    await expect(commitRoster(gvActor(), classId, [])).rejects.toMatchObject({ status: 422, code: "EMPTY_ROSTER" });
  });

  it("một SV thuộc nhiều lớp: dùng chung bản ghi students (FR-013)", async () => {
    const other = await insertClass("Khai phá dữ liệu-1-1-26(N04)");
    const before = (await ctx.pg.query<{ n: number }>(`select count(*)::int as n from students`)).rows[0].n;
    await commitRoster(gvActor(), other, [{ code: "231230801", lastName: "Nguyễn Văn", firstName: "An", adminClass: "CNTT3", cohort: "K64" }]);
    const after = (await ctx.pg.query<{ n: number }>(`select count(*)::int as n from students`)).rows[0].n;
    expect(after).toBe(before);
    expect(await enrollmentOf(other)).toHaveLength(1);
  });
});

describe("roster-ansi.csv — Windows-1258, tiêu đề MSSV (Q3)", () => {
  it("đúng dấu tiếng Việt, cột tự nhận", async () => {
    const classId = await insertClass("CSDL-ansi");
    const p = await previewRoster(classId, await fixture("roster-ansi.csv"), "roster-ansi.csv");
    expect(p.missing).toEqual([]);
    expect(p.columnsDetected.code).toBe(0);
    expect(p.rows.every((r) => r.errors.length === 0)).toBe(true);
    expect(p.rows.map((r) => `${r.data.lastName} ${r.data.firstName}`)).toEqual([
      "Trần Đức Hải",
      "Lê Thị Ngọc Ánh",
      "Phạm Quốc Việt",
      "Hoàng Minh Đức",
      "Vũ Thị Thu Hường",
    ]);
  });
});

describe("roster-formula.xlsx — ô công thức / hyperlink (S6, FR-091)", () => {
  it("ô công thức lấy giá trị đã tính, ô hyperlink lấy chữ hiển thị, chuỗi '=…' giữ nguyên làm dữ liệu", async () => {
    const classId = await insertClass("CSDL-formula");
    const p = await previewRoster(classId, await fixture("roster-formula.xlsx"), "roster-formula.xlsx");
    expect(p.rows.map((r) => r.errors)).toEqual([[], [], []]);
    expect(p.rows[0].data.lastName).toBe('=HYPERLINK("http://x","bấm")');
    expect(p.rows[1].data.lastName).toBe("Trần");
    expect(p.rows[2].data.firstName).toBe("Cường");
  });
});

describe("file không đúng định dạng", () => {
  it("lỗi file → 422 có mã ổn định", async () => {
    const classId = await insertClass("CSDL-bad");
    await expect(previewRoster(classId, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]), "old.xls")).rejects.toMatchObject({
      status: 422,
      code: "UNSUPPORTED_TYPE",
    });
  });
});

describe("nhật ký nằm trong transaction: ghi audit lỗi thì thay đổi bị huỷ", () => {
  // Trigger làm mọi lệnh insert vào audit_logs thất bại, mô phỏng sự cố khi ghi nhật ký.
  beforeAll(async () => {
    await ctx.pg.exec(`
      create function fail_audit() returns trigger language plpgsql as $f$ begin raise exception 'audit down'; end $f$;
      create trigger audit_down before insert on audit_logs for each row execute function fail_audit();`);
  });
  afterAll(async () => {
    await ctx.pg.exec(`drop trigger audit_down on audit_logs; drop function fail_audit();`);
  });

  const auditDown = (e: unknown) => {
    const err = e as { message?: string; cause?: { message?: string } };
    return /audit down/.test(`${err?.message} ${err?.cause?.message}`);
  };
  const countOf = async (sql: string, args: unknown[] = []) => (await ctx.pg.query<{ n: number }>(sql, args)).rows[0].n;
  const base = { courseName: "Rollback", startDate: "2026-09-07", endDate: "2026-12-20", schedules: [{ weekday: 2, shift: 1 }] };
  let classId = "";
  beforeAll(async () => {
    classId = await insertClass("ROLLBACK-1");
    await ctx.pg.query(
      `insert into students (student_code,last_name,first_name) values ('231235551','A','B') on conflict do nothing`,
    );
    await ctx.pg.query(
      `insert into enrollments (class_id, student_id) select $1, id from students where student_code = '231235551'`,
      [classId],
    );
  });

  it("createClass: không còn lớp nào được tạo", async () => {
    await expect(createClass(gvActor(), { ...base, code: "ROLLBACK-NEW" })).rejects.toSatisfy(auditDown);
    expect(await countOf(`select count(*)::int as n from classes where code = 'ROLLBACK-NEW'`)).toBe(0);
    expect(await countOf(`select count(*)::int as n from class_schedules s join classes c on c.id = s.class_id where c.code = 'ROLLBACK-NEW'`)).toBe(0);
  });

  it("updateClass: dữ liệu lớp giữ nguyên", async () => {
    await expect(updateClass(gvActor(), classId, { defaultRoom: "999-X" })).rejects.toSatisfy(auditDown);
    const r = await ctx.pg.query<{ default_room: string | null }>(`select default_room from classes where id = $1`, [classId]);
    expect(r.rows[0].default_room).toBeNull();
  });

  it("commitRoster: không thêm SV, không thêm/rút ghi danh", async () => {
    await expect(
      commitRoster(gvActor(), classId, [
        { code: "231235551", lastName: "A", firstName: "B", adminClass: null, cohort: null },
        { code: "231235552", lastName: "C", firstName: "D", adminClass: null, cohort: null },
      ]),
    ).rejects.toSatisfy(auditDown);
    expect(await countOf(`select count(*)::int as n from students where student_code = '231235552'`)).toBe(0);
    expect(await countOf(`select count(*)::int as n from enrollments where class_id = $1`, [classId])).toBe(1);
  });

  it("addStudent / withdrawStudent: ghi danh không đổi", async () => {
    await expect(addStudent(gvActor(), classId, "231235553", { lastName: "E", firstName: "F" })).rejects.toSatisfy(auditDown);
    expect(await countOf(`select count(*)::int as n from students where student_code = '231235553'`)).toBe(0);
    await expect(withdrawStudent(gvActor(), classId, "231235551")).rejects.toSatisfy(auditDown);
    const r = await ctx.pg.query<{ status: string }>(
      `select e.status from enrollments e join students s on s.id = e.student_id where e.class_id = $1 and s.student_code = '231235551'`,
      [classId],
    );
    expect(r.rows[0].status).toBe("active");
  });
});
