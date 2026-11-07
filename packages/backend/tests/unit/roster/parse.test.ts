import { describe, expect, it } from "vitest";
import { detectColumns, extractRoster, findHeaderRow, normalizeHeader, validateRows } from "../../../src/roster/columns";
import { decodeCsvText, inspectZip, parseRosterFile, RosterFileError } from "../../../src/roster/parse";
import iconv from "iconv-lite";

/** T040 — Nhận diện cột, validate dòng, phát hiện trùng (FR-011, FR-012). */

describe("normalizeHeader", () => {
  it("bỏ dấu, hạ chữ, gộp khoảng trắng, bỏ ký tự lạ", () => {
    expect(normalizeHeader("  Mã   Sinh Viên ")).toBe("ma sinh vien");
    expect(normalizeHeader("Họ đệm")).toBe("ho dem");
    expect(normalizeHeader("Khoá (*)")).toBe("khoa");
    expect(normalizeHeader("Mã_SV")).toBe("ma sv");
  });
});

describe("detectColumns — nhận diện cột", () => {
  it.each([
    ["MSSV"],
    ["Mã SV"],
    ["Mã sinh viên"],
    ["ma sinh vien"],
    ["MÃ SỐ SINH VIÊN"],
    ["MaSV"],
    ["Mã HS/SV"],
  ])("nhận %j là cột mã SV", (h) => {
    const { mapping } = detectColumns(["STT", h, "Họ đệm", "Tên", "Lớp"]);
    expect(mapping.code).toBe(1);
  });

  it("nhận đủ cột Họ / Tên / Lớp / Khoá (có hoặc không dấu)", () => {
    const { mapping, missing } = detectColumns(["STT", "Ma SV", "Ho dem", "Ten", "Lop", "Khoa"]);
    expect(mapping).toEqual({ code: 1, lastName: 2, firstName: 3, adminClass: 4, cohort: 5 });
    expect(missing).toEqual([]);
  });

  it.each(["Họ", "Họ đệm", "Họ và đệm", "Họ lót"])("nhận %j là cột Họ", (h) => {
    expect(detectColumns(["Mã SV", h, "Tên", "Lớp"]).mapping.lastName).toBe(1);
  });

  it.each(["Lớp", "Lớp hành chính", "Lớp sinh hoạt", "Lớp HC"])("nhận %j là cột Lớp", (h) => {
    expect(detectColumns(["Mã SV", "Họ", "Tên", h]).mapping.adminClass).toBe(3);
  });

  it("cột Khoá là tuỳ chọn", () => {
    const { mapping, missing } = detectColumns(["Mã SV", "Họ", "Tên", "Lớp"]);
    expect(mapping.cohort).toBeUndefined();
    expect(missing).toEqual([]);
  });

  it("chấp nhận một cột 'Họ và tên' thay cho Họ + Tên", () => {
    const { mapping, missing } = detectColumns(["Mã SV", "Họ và tên", "Lớp"]);
    expect(mapping.fullName).toBe(1);
    expect(missing).toEqual([]);
  });

  it("báo thiếu cột bắt buộc", () => {
    expect(detectColumns(["STT", "Họ", "Tên", "Lớp"]).missing).toEqual(["code"]);
    expect(detectColumns(["Mã SV", "Họ", "Lớp"]).missing).toEqual(["firstName"]);
    expect(detectColumns(["Mã SV", "Họ", "Tên"]).missing).toEqual(["adminClass"]);
  });

  it("không nhầm 'Tên lớp' / 'Ghi chú' thành cột Tên", () => {
    const { mapping } = detectColumns(["Mã SV", "Họ", "Tên", "Tên lớp", "Ghi chú"]);
    expect(mapping.firstName).toBe(2);
    expect(mapping.adminClass).toBe(3);
  });

  it("lấy cột đầu tiên khi tiêu đề lặp lại", () => {
    expect(detectColumns(["Mã SV", "Mã SV", "Họ", "Tên", "Lớp"]).mapping.code).toBe(0);
  });
});

describe("findHeaderRow — bỏ qua các dòng tiêu đề của file trường", () => {
  it("tìm dòng tiêu đề nằm sau phần quốc hiệu", () => {
    const table = [
      ["TRƯỜNG ĐẠI HỌC GIAO THÔNG VẬN TẢI"],
      ["DANH SÁCH SINH VIÊN LỚP HỌC PHẦN"],
      [],
      ["STT", "Mã sinh viên", "Họ đệm", "Tên", "Lớp"],
      ["1", "231230821", "Nguyễn Văn", "An", "CNTT3"],
    ];
    expect(findHeaderRow(table)).toBe(3);
  });
  it("không có tiêu đề → -1", () => {
    expect(findHeaderRow([["a", "b"], ["1", "2"]])).toBe(-1);
  });
});

describe("validateRows — kiểm tra từng dòng", () => {
  const mapping = { code: 0, lastName: 1, firstName: 2, adminClass: 3, cohort: 4 };

  it("dòng hợp lệ: chuẩn hoá khoảng trắng, NFC, cohort null khi trống", () => {
    const [r] = validateRows([[" 231230821 ", "  Nguyễn   Văn ", "An", "CNTT3", ""]], mapping, { firstRowNo: 5 });
    expect(r).toEqual({
      rowNo: 5,
      data: { code: "231230821", lastName: "Nguyễn Văn", firstName: "An", adminClass: "CNTT3", cohort: null },
      errors: [],
    });
  });

  it("chuỗi tổ hợp (NFD) được chuẩn hoá về NFC", () => {
    const [r] = validateRows([["231230821", "Nguyễn".normalize("NFD"), "Ân".normalize("NFD"), "CNTT3", ""]], mapping);
    expect(r.data.lastName).toBe("Nguyễn");
    expect(r.data.firstName).toBe("Ân");
  });

  it.each([
    ["12345", "INVALID_CODE"],
    ["1234567890123", "INVALID_CODE"],
    ["23123A821", "INVALID_CODE"],
    ["", "MISSING_CODE"],
  ])("mã %j → %s", (code, err) => {
    const [r] = validateRows([[code, "Nguyễn", "An", "CNTT3"]], mapping);
    expect(r.errors).toContain(err);
  });

  it("mã 6 và 12 chữ số hợp lệ", () => {
    const rows = validateRows([["123456", "A", "B", "L"], ["123456789012", "A", "B", "L"]], mapping);
    expect(rows.map((r) => r.errors)).toEqual([[], []]);
  });

  it("thiếu họ / tên", () => {
    const [a, b] = validateRows([["231230821", "", "An", "CNTT3"], ["231230822", "Nguyễn", " ", "CNTT3"]], mapping);
    expect(a.errors).toEqual(["MISSING_LAST_NAME"]);
    expect(b.errors).toEqual(["MISSING_FIRST_NAME"]);
  });

  it("dòng trống ở giữa → EMPTY_ROW; dòng trống cuối file bị bỏ", () => {
    const rows = validateRows([["231230821", "A", "B", "L"], ["", "", "", ""], ["231230822", "C", "D", "L"], [], ["", " "]], mapping, {
      firstRowNo: 2,
    });
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ rowNo: 3, errors: ["EMPTY_ROW"] });
    expect(rows[2].rowNo).toBe(4);
  });

  it("trùng mã: dòng xuất hiện sau bị đánh dấu DUPLICATE_CODE, dòng đầu giữ hợp lệ", () => {
    const rows = validateRows(
      [["231230821", "A", "B", "L"], ["231230822", "C", "D", "L"], ["231230821", "E", "F", "L"]],
      mapping,
    );
    expect(rows.map((r) => r.errors)).toEqual([[], [], ["DUPLICATE_CODE"]]);
  });

  it("dòng lỗi không 'chiếm' mã: mã của dòng thiếu tên không làm dòng sau bị coi là trùng", () => {
    const rows = validateRows([["231230821", "A", "", "L"], ["231230821", "A", "B", "L"]], mapping);
    expect(rows[0].errors).toEqual(["MISSING_FIRST_NAME"]);
    expect(rows[1].errors).toEqual([]);
  });

  it("cột 'Họ và tên': từ cuối là Tên, phần trước là Họ", () => {
    const [r] = validateRows([["231230821", "Nguyễn Thị Minh Anh", "CNTT3"]], { code: 0, fullName: 1, adminClass: 2 });
    expect(r.data).toMatchObject({ lastName: "Nguyễn Thị Minh", firstName: "Anh" });
  });

  it("giữ nguyên chuỗi giống công thức (escape khi xuất, không phải khi nhập)", () => {
    const [r] = validateRows([["231230821", '=HYPERLINK("http://x")', "An", "CNTT3"]], mapping);
    expect(r.data.lastName).toBe('=HYPERLINK("http://x")');
    expect(r.errors).toEqual([]);
  });

  it("họ/tên chứa '?' (chữ có dấu bị mất khi lưu file) → LOST_CHARACTERS, không lưu được", () => {
    const rows = validateRows(
      [
        ["231230801", "Nguy?n V?n", "An", "CNTT3"],
        ["231230802", "Lê", "C??ng", "CNTT3"],
        ["231230803", "Lê Minh", "Bình", "CNTT3"],
      ],
      mapping,
    );
    expect(rows.map((r) => r.errors)).toEqual([["LOST_CHARACTERS"], ["LOST_CHARACTERS"], []]);
  });
});

describe("extractRoster — từ bảng thô tới bản xem trước", () => {
  it("trả cột nhận diện, số dòng theo file (1-based)", () => {
    const table = [
      ["DANH SÁCH LỚP"],
      ["STT", "MSSV", "Họ đệm", "Tên", "Lớp", "Khoá"],
      ["1", "231230821", "Nguyễn Văn", "An", "CNTT3", "K64"],
      ["2", "231230821", "Trần Thị", "Bình", "CNTT3", "K64"],
    ];
    const r = extractRoster(table);
    expect(r.headerRowIndex).toBe(1);
    expect(r.headerCells).toEqual(["STT", "MSSV", "Họ đệm", "Tên", "Lớp", "Khoá"]);
    expect(r.columnsDetected).toEqual({ code: 1, lastName: 2, firstName: 3, adminClass: 4, cohort: 5 });
    expect(r.rows.map((x) => [x.rowNo, x.errors])).toEqual([
      [3, []],
      [4, ["DUPLICATE_CODE"]],
    ]);
  });

  it("ghép cột thủ công (columnMapping) ghi đè nhận diện tự động", () => {
    const table = [
      ["Số hiệu", "Họ", "Tên", "Đơn vị"],
      ["231230821", "Nguyễn", "An", "CNTT3"],
    ];
    const auto = extractRoster(table);
    expect(auto.missing).toContain("code");
    expect(auto.headerCells).toEqual(["Số hiệu", "Họ", "Tên", "Đơn vị"]); // dòng đầu, để UI ghép cột
    expect(auto.columnsDetected).toEqual({ lastName: 1, firstName: 2 }); // gợi ý cột nhận ra được
    expect(auto.missing).toEqual(["code", "adminClass"]);
    const r = extractRoster(table, { code: 0, lastName: 1, firstName: 2, adminClass: 3 }, 0);
    expect(r.missing).toEqual([]);
    expect(r.rows[0]).toMatchObject({ rowNo: 2, errors: [], data: { code: "231230821", adminClass: "CNTT3" } });
  });

  it("không tìm thấy tiêu đề → missing đủ cột, không có dòng", () => {
    const r = extractRoster([["x"], ["y"]]);
    expect(r.headerRowIndex).toBe(-1);
    expect(r.headerCells).toEqual(["x"]);
    expect(r.rows).toEqual([]);
    expect(r.missing).toEqual(["code", "firstName", "adminClass"]);
  });
});

describe("decodeCsvText — nhận UTF-8 / BOM / Windows-1258", () => {
  const sample = "MSSV,Họ đệm,Tên\n231230821,Nguyễn Văn,Đức\n";
  it("UTF-8 có BOM", () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(sample, "utf8")]);
    expect(decodeCsvText(buf)).toBe(sample);
  });
  it("UTF-8 không BOM", () => {
    expect(decodeCsvText(Buffer.from(sample, "utf8"))).toBe(sample);
  });
  it("UTF-16 LE có BOM (Excel 'Unicode Text')", () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(sample, "utf16le")]);
    expect(decodeCsvText(buf)).toBe(sample);
  });
  it("Windows-1258 (dấu tổ hợp) → NFC đúng dấu", () => {
    // cp1258 lưu nguyên âm có mũ/móc (ê, ă, ư…) + dấu thanh tổ hợp: "ễ" = "ê" + U+0303
    const cp = "MSSV,Họ đệm,Tên\n231230821,Nguyễn Văn,Đức\n";
    const buf = iconv.encode(cp, "windows-1258");
    expect(buf.includes(0x3f)).toBe(false); // không có ký tự nào bị thay bằng '?'
    expect(decodeCsvText(buf)).toBe(sample);
  });

  // Excel "CSV (Comma delimited)" trên Windows tiếng Anh lưu bằng Windows-1252: chữ không có trong 1252 thành '?'
  // (iconv.encode cũng thay bằng '?', mô phỏng đúng hành vi đó). Phần còn lại phải được giải mã đúng, không coi là 1258.
  it("Windows-1252 từ Excel tiếng Anh: giữ đúng chữ có trong 1252 (Mã, Bình, Hòa), chữ đã mất là '?'", () => {
    const buf = iconv.encode("Mã SV;Họ đệm;Tên;Lớp\r\n231230801;Lê Minh;Bình;CNTT3\r\n231230802;Nguyễn Văn;Hòa;CNTT3\r\n", "windows-1252");
    expect(decodeCsvText(buf)).toBe("Mã SV;H? ??m;Tên;L?p\r\n231230801;Lê Minh;Bình;CNTT3\r\n231230802;Nguy?n V?n;Hòa;CNTT3\r\n");
  });

  it("Windows-1252 không có '?' nhưng có ì/ò sau phụ âm → vẫn nhận là 1252 (không biến 'Bình' thành dấu tổ hợp)", () => {
    const buf = iconv.encode("MSSV,Ho,Ten,Lop\n231230801,Le,Bình,CNTT3\n231230802,Le,Hòa,CNTT3\n", "windows-1252");
    expect(buf.includes(0x3f)).toBe(false);
    expect(decodeCsvText(buf)).toBe("MSSV,Ho,Ten,Lop\n231230801,Le,Bình,CNTT3\n231230802,Le,Hòa,CNTT3\n");
  });

  it("Windows-1258 có chữ ì/ò (dấu thanh sau nguyên âm) vẫn nhận là 1258", () => {
    // "Bình" trong cp1258 = B i + dấu huyền tổ hợp; "Hòa" = H o + dấu huyền tổ hợp + a
    const buf = iconv.encode("MSSV,Ten\n231230801,Bình\n231230802,Hòa\n", "windows-1258");
    expect(decodeCsvText(buf)).toBe("MSSV,Ten\n231230801,Bình\n231230802,Hòa\n");
  });
});

describe("parseRosterFile — CSV", () => {
  it("dấu phân cách ; và dòng trống cuối", async () => {
    const t = await parseRosterFile(Buffer.from("MSSV;Họ;Tên;Lớp\n231230821;Nguyễn;An;CNTT3\n\n"), "a.csv");
    expect(t[0]).toEqual(["MSSV", "Họ", "Tên", "Lớp"]);
    expect(t[1]).toEqual(["231230821", "Nguyễn", "An", "CNTT3"]);
  });

  it("từ chối file quá 2.000 dòng dữ liệu", async () => {
    const lines = ["MSSV,Họ,Tên,Lớp"];
    for (let i = 0; i < 2_100; i++) lines.push(`${200000000 + i},A,B,L`);
    await expect(parseRosterFile(Buffer.from(lines.join("\n")), "big.csv")).rejects.toMatchObject({ code: "TOO_MANY_ROWS" });
  });

  it("từ chối file vượt dung lượng", async () => {
    await expect(parseRosterFile(Buffer.alloc(10), "a.csv", { maxBytes: 5 })).rejects.toBeInstanceOf(RosterFileError);
  });

  it("từ chối file rỗng và định dạng .xls cũ (OLE)", async () => {
    await expect(parseRosterFile(Buffer.alloc(0), "a.csv")).rejects.toMatchObject({ code: "EMPTY" });
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    await expect(parseRosterFile(ole, "a.xls")).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
  });

  it("không tin đuôi file: file nhị phân đặt tên .csv bị từ chối", async () => {
    const bin = Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00, 0x00, 0x7f, 0x45, 0x4c, 0x46]);
    await expect(parseRosterFile(bin, "a.csv")).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
  });
});

describe("inspectZip — chống zip bomb", () => {
  /** Dựng một file zip tối thiểu chỉ gồm central directory với kích thước khai báo tuỳ ý. */
  function fakeZip(entries: { name: string; compressed: number; uncompressed: number }[]): Buffer {
    const cds: Buffer[] = [];
    for (const e of entries) {
      const name = Buffer.from(e.name);
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt32LE(e.compressed, 20);
      h.writeUInt32LE(e.uncompressed, 24);
      h.writeUInt16LE(name.length, 28);
      cds.push(h, name);
    }
    const cd = Buffer.concat(cds);
    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200)]);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(local.length, 16);
    return Buffer.concat([local, cd, eocd]);
  }

  it("đọc tổng kích thước giải nén", () => {
    const r = inspectZip(fakeZip([{ name: "a.xml", compressed: 100, uncompressed: 300 }, { name: "b.xml", compressed: 50, uncompressed: 200 }]));
    expect(r).toEqual({ entries: 2, totalUncompressed: 500 });
  });

  it("tỉ lệ nén bất thường → SUSPICIOUS_ARCHIVE", async () => {
    const z = fakeZip([{ name: "xl/worksheets/sheet1.xml", compressed: 100, uncompressed: 900_000_000 }]);
    await expect(parseRosterFile(z, "bomb.xlsx")).rejects.toMatchObject({ code: "SUSPICIOUS_ARCHIVE" });
  });

  it("zip hỏng (không có EOCD) → CORRUPT_FILE", async () => {
    const z = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)]);
    await expect(parseRosterFile(z, "x.xlsx")).rejects.toMatchObject({ code: "CORRUPT_FILE" });
  });
});
