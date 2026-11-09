/**
 * Văn bản đồng ý thu thập & xử lý dữ liệu sinh trắc (FR-050, Constitution IV).
 * Server chỉ chấp nhận đồng ý đúng CONSENT_VERSION; đổi nội dung → tăng phiên bản → SV phải đồng ý lại
 * trước khi dùng API thẻ/khuôn mặt. Dùng chung cho UI (hiển thị) và server (kiểm phiên bản).
 */
export const CONSENT_VERSION = "2026-11-07";

export const CONSENT_TEXT: readonly string[] = [
  "Để điểm danh bằng khuôn mặt, hệ thống cần thu thập và xử lý dữ liệu sinh trắc của bạn:",
  "• Ảnh chụp mặt trước thẻ sinh viên và ảnh chân dung cắt từ thẻ — dùng làm mẫu tham chiếu duy nhất. Hệ thống không lưu ảnh tham chiếu nào khác.",
  "• Ảnh khuôn mặt và vị trí GPS ở mỗi lượt điểm danh — chỉ dùng để xác nhận chính bạn có mặt trong lớp; tự động xoá sau 7 ngày.",
  "• Ảnh thẻ và đặc trưng khuôn mặt từ thẻ được giữ đến 30 ngày sau ngày kết thúc lớp cuối cùng bạn học, rồi tự động xoá.",
  "• Chỉ giảng viên của lớp và quản trị viên được xem; dữ liệu không được gửi cho bên thứ ba và không dùng cho mục đích khác.",
  "• Bạn có thể yêu cầu xoá sớm; khi đó bạn không điểm danh được cho tới khi đăng ký lại thẻ.",
];
