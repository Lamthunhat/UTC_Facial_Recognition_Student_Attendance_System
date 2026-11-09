/**
 * Mã lỗi API đăng ký thẻ → lời hướng dẫn tiếng Việt + bước làm tiếp (T063).
 * Chỉ ánh xạ các mã dành cho SV; mã lạ → thông báo chung. TUYỆT ĐỐI không nhắc tới trùng mặt, độ tương đồng hay SV khác
 * (lý do chờ duyệt chỉ giảng viên thấy — Principle III, FR-048).
 */
export type AdviceAction = "retake-card" | "retake-face" | "stop" | "consent" | "login" | "refresh";

export interface CardAdvice {
  action: AdviceAction;
  message: string;
  attemptsNote?: string;
}

const KNOWN: Record<string, { action: AdviceAction; message: string }> = {
  UNREADABLE: {
    action: "retake-card",
    message: "Không đọc được thẻ. Chụp lại ở nơi đủ sáng, giữ máy chắc tay, để thẻ nằm gọn trong khung và không bị loá.",
  },
  CODE_MISMATCH: { action: "retake-card", message: "Thẻ không khớp mã sinh viên đang đăng nhập. Hãy chụp đúng thẻ của bạn." },
  NO_PORTRAIT: {
    action: "retake-card",
    message: "Không thấy rõ ảnh chân dung trên thẻ. Chụp mặt trước của thẻ, đủ sáng, không để ngón tay che ảnh.",
  },
  MULTIPLE_FACES: { action: "retake-card", message: "Ảnh có nhiều khuôn mặt. Chỉ để riêng thẻ của bạn trong khung." },
  UNSUPPORTED_TYPE: { action: "retake-card", message: "Ảnh không hợp lệ. Vui lòng chụp lại thẻ." },
  PAYLOAD_TOO_LARGE: { action: "retake-card", message: "Ảnh quá lớn. Vui lòng chụp lại thẻ." },
  IMAGE_TOO_LARGE: { action: "retake-card", message: "Ảnh quá lớn. Vui lòng chụp lại thẻ." },
  LIVENESS_FAILED: {
    action: "retake-face",
    message: "Chưa đúng thử thách quay đầu. Làm lại: quay mặt rõ ràng theo mũi tên, rồi nhìn thẳng vào camera.",
  },
  LIVE_NO_FACE: { action: "retake-face", message: "Không thấy khuôn mặt của bạn. Đưa mặt vào giữa khung, đủ sáng, không đeo khẩu trang." },
  LIVE_MULTIPLE_FACES: { action: "retake-face", message: "Có nhiều người trong khung. Chỉ một mình bạn trước camera khi chụp." },
  VALIDATION_ERROR: { action: "retake-face", message: "Thiếu ảnh khuôn mặt. Vui lòng làm lại thử thách." },
  BAD_NONCE: { action: "retake-face", message: "Phiên chụp đã hết hạn. Vui lòng làm lại bước chụp khuôn mặt." },
  NETWORK: { action: "retake-face", message: "Mất kết nối mạng. Kiểm tra mạng rồi làm lại bước chụp khuôn mặt." },
  CONSENT_REQUIRED: { action: "consent", message: "Bạn cần đồng ý điều khoản dữ liệu trước khi đăng ký thẻ." },
  UNAUTHORIZED: { action: "login", message: "Phiên đăng nhập đã hết. Vui lòng đăng nhập lại." },
  CARD_ALREADY_REGISTERED: { action: "refresh", message: "Bạn đã có thẻ. Đang cập nhật trạng thái…" },
  CARD_PENDING_REVIEW: { action: "refresh", message: "Thẻ của bạn đang chờ giảng viên duyệt." },
  NOT_ENROLLED: { action: "stop", message: "Mã sinh viên của bạn chưa có trong lớp đang học nào. Vui lòng liên hệ giảng viên." },
};

/** Các mã có thông báo riêng (dùng trong test kiểm nội dung). */
export const ADVICE_CODES = [...Object.keys(KNOWN), "RATE_LIMITED"];

const GENERIC = "Không đăng ký được thẻ. Vui lòng thử lại.";

function waitText(sec?: number) {
  if (!sec || sec <= 0) return "ít phút";
  if (sec >= 3600) return `${Math.ceil(sec / 3600)} giờ`;
  return `${Math.max(1, Math.ceil(sec / 60))} phút`;
}

export function cardErrorAdvice(e: { status: number; code: string; remainingAttempts?: number; retryAfterSec?: number }): CardAdvice {
  if (e.status === 429 || e.code === "RATE_LIMITED") {
    return { action: "stop", message: `Bạn đã thử quá nhiều lần. Vui lòng thử lại sau ${waitText(e.retryAfterSec)}.` };
  }
  let base: { action: AdviceAction; message: string };
  if (e.status === 0) base = KNOWN.NETWORK;
  else if (e.status >= 500) base = { action: "retake-face", message: "Máy chủ đang bận. Vui lòng thử lại sau ít phút." };
  else base = KNOWN[e.code] ?? { action: "retake-face", message: GENERIC };

  if (e.remainingAttempts === 0) {
    return { action: "stop", message: `${base.message} Bạn đã hết lượt thử trong giờ này, vui lòng thử lại sau.` };
  }
  return typeof e.remainingAttempts === "number"
    ? { ...base, attemptsNote: `Bạn còn ${e.remainingAttempts} lượt thử trong giờ này.` }
    : { ...base };
}
