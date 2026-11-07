/** Tên cookie phiên — tách riêng để middleware (Edge) dùng được mà không kéo theo mã DB. */
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-session" : "session";
