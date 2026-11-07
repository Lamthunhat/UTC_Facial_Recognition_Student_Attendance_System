import { describe, expect, it } from "vitest";
import {
  duplicateDecision,
  evaluateCard,
  extractStudentCode,
  nameAppearsIn,
  pickBarcodeCode,
  PORTRAIT_RULES,
  type PortraitFace,
} from "../../../src/card/verify";

/** T053 — Luật xác thực thẻ sinh viên (FR-045…FR-048, US6-2/3/6). Hàm thuần, không I/O. */

const face = (over: Partial<PortraitFace> = {}): PortraitFace => ({
  score: 0.9,
  box: { x1: 40, y1: 150, x2: 280, y2: 450 },
  sharpness: 0.5,
  ...over,
});
const base = {
  sessionCode: "231230801",
  decoded: { code: "231230801", method: "barcode" as const },
  faces: [face()],
  nameMatched: true as boolean | null,
};

describe("evaluateCard", () => {
  it("thẻ hợp lệ (mã vạch khớp, đúng 1 chân dung nét) → chấp nhận, không cần duyệt", () => {
    expect(evaluateCard(base)).toEqual({ ok: true, faceIndex: 0, reviewReasons: [] });
  });

  it("mã đọc được khác mã đang đăng nhập → CODE_MISMATCH (US6-2)", () => {
    expect(evaluateCard({ ...base, decoded: { code: "231230899", method: "barcode" } })).toEqual({ ok: false, error: "CODE_MISMATCH" });
  });

  it("không đọc được mã (cả mã vạch lẫn OCR) → UNREADABLE (US6-3)", () => {
    expect(evaluateCard({ ...base, decoded: null })).toEqual({ ok: false, error: "UNREADABLE" });
  });

  it("không thấy chân dung → NO_PORTRAIT", () => {
    expect(evaluateCard({ ...base, faces: [] })).toEqual({ ok: false, error: "NO_PORTRAIT" });
  });

  it("khuôn mặt quá nhỏ không tính là chân dung", () => {
    const tiny = face({ box: { x1: 10, y1: 10, x2: 10 + PORTRAIT_RULES.minFaceSide - 1, y2: 60 } });
    expect(evaluateCard({ ...base, faces: [tiny] })).toEqual({ ok: false, error: "NO_PORTRAIT" });
  });

  it("thấy hơn một khuôn mặt (ảnh có người khác, thẻ chồng thẻ) → MULTIPLE_FACES", () => {
    const other = face({ box: { x1: 600, y1: 150, x2: 800, y2: 400 } });
    expect(evaluateCard({ ...base, faces: [face(), other] })).toEqual({ ok: false, error: "MULTIPLE_FACES" });
  });

  it("chân dung mờ → UNREADABLE (yêu cầu chụp lại)", () => {
    expect(evaluateCard({ ...base, faces: [face({ sharpness: PORTRAIT_RULES.minSharpness / 2 })] })).toEqual({
      ok: false,
      error: "UNREADABLE",
    });
  });

  it("thứ tự kiểm: mã trước chân dung (thẻ người khác báo CODE_MISMATCH dù ảnh mờ)", () => {
    expect(evaluateCard({ ...base, decoded: { code: "999999999", method: "ocr" }, faces: [] })).toEqual({
      ok: false,
      error: "CODE_MISMATCH",
    });
  });

  it("mã đọc bằng OCR (kém tin cậy) mà họ tên không khớp → chấp nhận nhưng chờ duyệt NAME_MISMATCH", () => {
    const r = evaluateCard({ ...base, decoded: { code: "231230801", method: "ocr" }, nameMatched: false });
    expect(r).toEqual({ ok: true, faceIndex: 0, reviewReasons: ["NAME_MISMATCH"] });
  });

  it("mã đọc bằng OCR, không đọc được họ tên (null) → cũng chờ duyệt", () => {
    const r = evaluateCard({ ...base, decoded: { code: "231230801", method: "ocr" }, nameMatched: null });
    expect(r).toMatchObject({ ok: true, reviewReasons: ["NAME_MISMATCH"] });
  });

  it("mã vạch khớp thì họ tên OCR lệch không bắt duyệt (mã vạch là bằng chứng mạnh)", () => {
    expect(evaluateCard({ ...base, nameMatched: false })).toEqual({ ok: true, faceIndex: 0, reviewReasons: [] });
  });

  it("chọn đúng chỉ số khuôn mặt hợp lệ khi có khuôn mặt quá nhỏ bị loại", () => {
    const tiny = face({ box: { x1: 0, y1: 0, x2: 12, y2: 12 } });
    expect(evaluateCard({ ...base, faces: [tiny, face()] })).toMatchObject({ ok: true, faceIndex: 1 });
  });
});

describe("pickBarcodeCode — nội dung mã vạch", () => {
  it.each([
    [["231230801"], "231230801"],
    [[" 231230801 "], "231230801"],
    [["https://utc.edu.vn", "231230801"], "231230801"],
    [["SV231230801"], null], // không đoán: chỉ nhận chuỗi toàn chữ số
    [["12345"], null],
    [[], null],
  ])("%j → %s", (texts, expected) => {
    expect(pickBarcodeCode(texts)).toBe(expected);
  });

  it("hai mã vạch khác nhau đều là mã SV → không đoán (null)", () => {
    expect(pickBarcodeCode(["231230801", "231230802"])).toBeNull();
  });
});

describe("extractStudentCode — mã SV từ chữ OCR", () => {
  it.each([
    ["Họ tên: NGUYỄN VĂN AN\nMSSV: 231230801\nNgày sinh: 12/05/2005", "231230801"],
    ["Mã sinh viên 231230801", "231230801"],
    ["Mã SV : 2312 30801", "231230801"], // OCR tách khoảng trắng giữa các chữ số
    ["MSSV:231230801 Khoá K64", "231230801"],
    ["Student ID: 231230801", "231230801"],
  ])("có nhãn: %j", (text, code) => {
    expect(extractStudentCode(text)).toBe(code);
  });

  it("không có nhãn: chỉ một dãy 6–12 chữ số (bỏ qua ngày sinh) → lấy", () => {
    expect(extractStudentCode("NGUYỄN VĂN AN\n231230801\n12/05/2005")).toBe("231230801");
  });

  it("không có nhãn và nhiều dãy số ứng viên → không đoán (null)", () => {
    expect(extractStudentCode("231230801\n0912345678")).toBeNull();
  });

  it("không có dãy số hợp lệ → null", () => {
    expect(extractStudentCode("TRƯỜNG ĐẠI HỌC GIAO THÔNG VẬN TẢI\nNgày sinh: 12/05/2005")).toBeNull();
  });
});

describe("nameAppearsIn — họ tên trên thẻ so bằng namesMatch", () => {
  const ocr = "TRƯỜNG ĐẠI HỌC GIAO THÔNG VẬN TẢI\nHọ tên: NGUYẾN VĂN AN\nMSSV: 231230801";

  it("OCR sai dấu (NGUYẾN ↔ Nguyễn) vẫn khớp", () => {
    expect(nameAppearsIn(ocr, "Nguyễn Văn An")).toBe(true);
  });

  it("họ tên nằm giữa dòng không có nhãn", () => {
    expect(nameAppearsIn("SINH VIÊN NGUYEN VAN AN K64", "Nguyễn Văn An")).toBe(true);
  });

  it("'Tú' ≠ 'Tuấn' (namesMatch giới hạn lệch mỗi từ)", () => {
    expect(nameAppearsIn("Họ tên: NGUYỄN VĂN TUẤN", "Nguyễn Văn Tú")).toBe(false);
  });

  it("tên người khác → không khớp", () => {
    expect(nameAppearsIn(ocr, "Trần Thị Bình")).toBe(false);
  });

  it("chữ rỗng → không khớp", () => {
    expect(nameAppearsIn("", "Nguyễn Văn An")).toBe(false);
  });
});

describe("duplicateDecision — trùng mặt 1:N", () => {
  it("lấy mã có độ tương đồng cao nhất vượt ngưỡng", () => {
    expect(
      duplicateDecision(
        [
          { studentId: "a", similarity: 0.62 },
          { studentId: "b", similarity: 0.81 },
          { studentId: "c", similarity: 0.3 },
        ],
        0.6,
      ),
    ).toEqual({ studentId: "b", similarity: 0.81 });
  });

  it("không ai vượt ngưỡng → null", () => {
    expect(duplicateDecision([{ studentId: "a", similarity: 0.59 }], 0.6)).toBeNull();
    expect(duplicateDecision([], 0.6)).toBeNull();
  });
});
