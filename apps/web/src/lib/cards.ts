/**
 * Hiển thị thẻ SV cho KHU GIẢNG VIÊN (T063): lý do chờ duyệt kèm chi tiết. Không dùng ở khu sinh viên.
 */
export type StaffCardStatus = "active" | "pending_review" | "rejected" | "reset";
export type ReviewReason = "DUPLICATE_FACE" | "LIVE_MISMATCH" | "NAME_MISMATCH";

export interface StaffCardDetail {
  reviewReasons: string[];
  duplicateOf: { studentId: string; code: string; fullName: string; similarity: number | null } | null;
  liveSimilarity: number | null;
  ocrName: string | null;
  rosterName: string | null;
}

const sim = (n: number | null | undefined) => (typeof n === "number" ? n.toFixed(2).replace(".", ",") : "?");

export function reviewReasonLines(card: StaffCardDetail): { reason: string; title: string; detail: string }[] {
  return card.reviewReasons.map((reason) => {
    switch (reason) {
      case "DUPLICATE_FACE":
        return {
          reason,
          title: "Trùng khuôn mặt với SV khác trong lớp",
          detail: card.duplicateOf
            ? `${card.duplicateOf.fullName} (${card.duplicateOf.code}) · độ tương đồng ${sim(card.duplicateOf.similarity)}`
            : "Không còn thông tin SV bị trùng",
        };
      case "LIVE_MISMATCH":
        return { reason, title: "Mặt chụp trực tiếp khác ảnh chân dung trên thẻ", detail: `Độ tương đồng ${sim(card.liveSimilarity)}` };
      case "NAME_MISMATCH":
        return {
          reason,
          title: "Họ tên trên thẻ không khớp danh sách",
          detail: `Trên thẻ (OCR): ${card.ocrName ?? "không đọc được"} · Danh sách: ${card.rosterName ?? "?"}`,
        };
      default:
        return { reason, title: reason, detail: "" };
    }
  });
}

const STATUS_LABEL: Record<StaffCardStatus, string> = {
  active: "Đã duyệt",
  pending_review: "Chờ duyệt",
  rejected: "Đã từ chối",
  reset: "Đã đặt lại",
};

export function staffCardStatusLabel(status: StaffCardStatus | null): string {
  return status ? STATUS_LABEL[status] : "Chưa đăng ký";
}
