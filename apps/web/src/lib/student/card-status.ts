/**
 * Trạng thái thẻ hiển thị cho SV (GET /api/student/card). Không có lý do chờ duyệt — mọi trường hợp chờ duyệt
 * chỉ hiện "Đang chờ giảng viên duyệt" (Principle III).
 */
export type StudentCardStatus = "active" | "pending_review" | "rejected" | "reset";

export interface StudentCardView {
  label: string;
  description: string;
  tone: "neutral" | "warning" | "success" | "danger";
  canRegister: boolean;
}

const VIEWS: Record<StudentCardStatus, StudentCardView> = {
  active: { label: "Đã duyệt", description: "Thẻ của bạn đã được chấp nhận. Bạn có thể điểm danh.", tone: "success", canRegister: false },
  pending_review: {
    label: "Đang chờ giảng viên duyệt",
    description: "Đang chờ giảng viên duyệt. Bạn sẽ điểm danh được khi thẻ được duyệt.",
    tone: "warning",
    canRegister: false,
  },
  rejected: {
    label: "Bị từ chối",
    description: "Thẻ chưa được chấp nhận. Vui lòng đăng ký lại hoặc liên hệ giảng viên.",
    tone: "danger",
    canRegister: true,
  },
  reset: { label: "Cần đăng ký lại", description: "Giảng viên đã đặt lại thẻ của bạn. Vui lòng đăng ký lại.", tone: "warning", canRegister: true },
};

const NONE: StudentCardView = {
  label: "Chưa đăng ký thẻ",
  description: "Bạn cần đăng ký thẻ sinh viên trước lượt điểm danh đầu tiên.",
  tone: "neutral",
  canRegister: true,
};

export function studentCardView(card: { status: StudentCardStatus } | null): StudentCardView {
  return (card && VIEWS[card.status]) || NONE;
}
