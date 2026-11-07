import { describe, expect, it } from "vitest";
import { normalizeName, removeVietnameseTones, levenshtein, namesMatch } from "../src/vn-text";

describe("removeVietnameseTones (T015)", () => {
  it("bỏ dấu đầy đủ, kể cả đ/Đ", () => {
    expect(removeVietnameseTones("Nguyễn Văn Tú")).toBe("Nguyen Van Tu");
    expect(removeVietnameseTones("Đặng Thị Đào")).toBe("Dang Thi Dao");
    expect(removeVietnameseTones("Lưu Tùng Lâm")).toBe("Luu Tung Lam");
    expect(removeVietnameseTones("ỨNG DỤNG ĐIỂM DANH")).toBe("UNG DUNG DIEM DANH");
  });
  it("xử lý chuỗi tổ hợp (NFD) giống chuỗi dựng sẵn (NFC)", () => {
    const nfd = "Nguyễn".normalize("NFD");
    expect(removeVietnameseTones(nfd)).toBe("Nguyen");
  });
});

describe("normalizeName", () => {
  it("chữ thường, bỏ dấu, gộp khoảng trắng", () => {
    expect(normalizeName("  NGUYỄN   văn  Tú ")).toBe("nguyen van tu");
  });
  it("bỏ tiền tố danh xưng khi được yêu cầu (FR-103g)", () => {
    expect(normalizeName("Cô Nguyễn Kim Sao", { stripTitles: true })).toBe("nguyen kim sao");
    expect(normalizeName("TS. Nguyễn Kim Sao", { stripTitles: true })).toBe("nguyen kim sao");
    expect(normalizeName("Thầy ThS Trần An", { stripTitles: true })).toBe("tran an");
  });
});

describe("levenshtein & namesMatch", () => {
  it("khoảng cách chỉnh sửa", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "abc")).toBe(0);
  });
  it("khớp khi sai ≤ 2 ký tự sau chuẩn hoá", () => {
    expect(namesMatch("Nguyễn Văn Tú", "NGUYEN VAN TU")).toBe(true);
    expect(namesMatch("Nguyễn Văn Tú", "Nguyen Van Tuu")).toBe(true);
    expect(namesMatch("Nguyễn Văn Tú", "Nguyễn Văn Tuấn")).toBe(false);
    expect(namesMatch("Nguyễn Văn Tú", "Trần Văn Tú")).toBe(false);
  });
});
