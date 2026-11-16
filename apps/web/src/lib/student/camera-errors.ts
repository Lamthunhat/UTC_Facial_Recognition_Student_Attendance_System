/** Lỗi mở camera (getUserMedia) → loại + hướng dẫn tiếng Việt. */
export type CameraErrorKind = "denied" | "not-found" | "in-use" | "unsupported" | "unknown";

const MESSAGES: Record<CameraErrorKind, string> = {
  denied:
    "Bạn đã chặn quyền dùng camera. Bật lại: chạm biểu tượng ổ khoá cạnh địa chỉ trang → Quyền / Cài đặt trang web → Camera → Cho phép, rồi tải lại trang.",
  "not-found": "Không tìm thấy camera phù hợp trên thiết bị này.",
  "in-use": "Camera đang được ứng dụng khác sử dụng. Đóng ứng dụng đó rồi thử lại.",
  unsupported: "Trình duyệt này không mở được camera. Hãy dùng Chrome hoặc Safari bản mới và truy cập qua https.",
  unknown: "Không mở được camera. Vui lòng thử lại.",
};

export function classifyCameraError(e: unknown): { kind: CameraErrorKind; message: string } {
  let kind: CameraErrorKind = "unknown";
  if (e === "unsupported" || e === "insecure") kind = "unsupported";
  else {
    const name = (e as { name?: string } | null)?.name;
    if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") kind = "denied";
    else if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") kind = "not-found";
    else if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") kind = "in-use";
  }
  return { kind, message: MESSAGES[kind] };
}
