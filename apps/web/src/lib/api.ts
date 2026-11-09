/** Gọi API cùng origin từ client component; ném ApiError với thông báo tiếng Việt từ server. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: { path: string; message: string }[],
    /** Trường bổ sung trong `error` (vd. `remainingAttempts` của đăng ký thẻ). */
    public details: Record<string, unknown> = {},
    /** Giây chờ theo header Retry-After (429). */
    public retryAfterSec?: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      credentials: "same-origin",
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...rest.headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    // Mất mạng / bị chặn trước khi có phản hồi
    throw new ApiError(0, "NETWORK", "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const { code, message, fields, ...details } = (data?.error ?? {}) as Record<string, unknown>;
    const retry = Number(res.headers.get("Retry-After"));
    throw new ApiError(
      res.status,
      typeof code === "string" ? code : "ERROR",
      typeof message === "string" ? message : "Có lỗi xảy ra. Vui lòng thử lại.",
      fields as ApiError["fields"],
      details,
      Number.isFinite(retry) && retry > 0 ? retry : undefined,
    );
  }
  return data as T;
}
