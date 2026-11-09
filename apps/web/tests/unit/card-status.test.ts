import { describe, expect, it } from "vitest";
import { classifyCameraError } from "@/lib/student/camera-errors";
import { studentCardView } from "@/lib/student/card-status";
import { reviewReasonLines, staffCardStatusLabel } from "@/lib/cards";

describe("studentCardView — trạng thái thẻ hiển thị cho SV", () => {
  it("bốn trạng thái + chưa đăng ký; mọi lý do chờ duyệt chỉ hiện 'Đang chờ giảng viên duyệt'", () => {
    expect(studentCardView(null)).toMatchObject({ label: "Chưa đăng ký thẻ", canRegister: true });
    expect(studentCardView({ status: "pending_review" })).toMatchObject({ label: "Đang chờ giảng viên duyệt", canRegister: false });
    expect(studentCardView({ status: "active" })).toMatchObject({ label: "Đã duyệt", canRegister: false });
    expect(studentCardView({ status: "rejected" })).toMatchObject({ label: "Bị từ chối", canRegister: true });
    expect(studentCardView({ status: "reset" })).toMatchObject({ label: "Cần đăng ký lại", canRegister: true });
  });
  it("trạng thái lạ → coi như chưa đăng ký (không hiện mã)", () => {
    expect(studentCardView({ status: "deleted" as never })).toMatchObject({ label: "Chưa đăng ký thẻ" });
  });
});

describe("classifyCameraError — lỗi getUserMedia → hướng dẫn", () => {
  const err = (name: string) => Object.assign(new Error(name), { name });
  it("từ chối quyền → hướng dẫn bật lại trong cài đặt trình duyệt", () => {
    expect(classifyCameraError(err("NotAllowedError"))).toMatchObject({ kind: "denied" });
    expect(classifyCameraError(err("NotAllowedError")).message).toMatch(/cho phép|Cài đặt/);
    expect(classifyCameraError(err("SecurityError")).kind).toBe("denied");
  });
  it("không có camera / đang bị app khác dùng / không hỗ trợ", () => {
    expect(classifyCameraError(err("NotFoundError")).kind).toBe("not-found");
    expect(classifyCameraError(err("OverconstrainedError")).kind).toBe("not-found");
    expect(classifyCameraError(err("NotReadableError")).kind).toBe("in-use");
    expect(classifyCameraError("unsupported").kind).toBe("unsupported");
    expect(classifyCameraError("insecure").kind).toBe("unsupported");
    expect(classifyCameraError(err("Weird")).kind).toBe("unknown");
  });
});

describe("giảng viên: lý do chờ duyệt (chỉ khu giảng viên)", () => {
  it("DUPLICATE_FACE kèm SV bị trùng + độ tương đồng; LIVE_MISMATCH kèm độ tương đồng; NAME_MISMATCH kèm tên OCR vs danh sách", () => {
    const lines = reviewReasonLines({
      reviewReasons: ["DUPLICATE_FACE", "LIVE_MISMATCH", "NAME_MISMATCH"],
      duplicateOf: { studentId: "x", code: "231230802", fullName: "Trần Thị Bình", similarity: 0.712 },
      liveSimilarity: 0.31,
      ocrName: "NGUYỄN VĂN TÈO",
      rosterName: "Bùi Thanh Hương",
    });
    expect(lines).toEqual([
      { reason: "DUPLICATE_FACE", title: "Trùng khuôn mặt với SV khác trong lớp", detail: "Trần Thị Bình (231230802) · độ tương đồng 0,71" },
      { reason: "LIVE_MISMATCH", title: "Mặt chụp trực tiếp khác ảnh chân dung trên thẻ", detail: "Độ tương đồng 0,31" },
      { reason: "NAME_MISMATCH", title: "Họ tên trên thẻ không khớp danh sách", detail: "Trên thẻ (OCR): NGUYỄN VĂN TÈO · Danh sách: Bùi Thanh Hương" },
    ]);
  });
  it("thiếu dữ liệu chi tiết vẫn hiện tiêu đề", () => {
    expect(reviewReasonLines({ reviewReasons: ["NAME_MISMATCH"], duplicateOf: null, liveSimilarity: null, ocrName: null, rosterName: "A B" })[0].detail).toBe(
      "Trên thẻ (OCR): không đọc được · Danh sách: A B",
    );
  });
  it("nhãn trạng thái", () => {
    expect(staffCardStatusLabel(null)).toBe("Chưa đăng ký");
    expect(staffCardStatusLabel("pending_review")).toBe("Chờ duyệt");
    expect(staffCardStatusLabel("active")).toBe("Đã duyệt");
    expect(staffCardStatusLabel("rejected")).toBe("Đã từ chối");
    expect(staffCardStatusLabel("reset")).toBe("Đã đặt lại");
  });
});
