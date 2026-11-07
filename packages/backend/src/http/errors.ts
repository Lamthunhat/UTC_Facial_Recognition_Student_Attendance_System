/** Lỗi HTTP có mã ổn định để client xử lý; message hiển thị được cho người dùng (tiếng Việt). */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly headers: Record<string, string> = {},
    /** Trường bổ sung đưa vào phần `error` của phản hồi (ví dụ remainingAttempts). */
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "HttpError";
  }

  /** Bản sao có thêm trường bổ sung — giữ nguyên mã, thông báo, header. */
  withExtra(extra: Record<string, unknown>): HttpError {
    return new HttpError(this.status, this.code, this.message, this.headers, { ...this.extra, ...extra });
  }
}

export const unauthorized = () => new HttpError(401, "UNAUTHORIZED", "Bạn cần đăng nhập.");
export const forbidden = () => new HttpError(403, "FORBIDDEN", "Bạn không có quyền thực hiện thao tác này.");
/** Dùng 404 thay vì 403 khi không muốn lộ tài nguyên có tồn tại hay không. */
export const notFound = (what = "Không tìm thấy dữ liệu.") => new HttpError(404, "NOT_FOUND", what);
export const tooManyRequests = (retryAfterSec: number, extra: Record<string, unknown> = {}) =>
  new HttpError(
    429,
    "RATE_LIMITED",
    `Bạn thao tác quá nhanh. Thử lại sau ${retryAfterSec} giây.`,
    { "Retry-After": String(retryAfterSec) },
    extra,
  );
