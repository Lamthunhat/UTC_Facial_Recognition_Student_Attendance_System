import "server-only";
import { z, ZodError } from "zod";
import { assertStaffActive, requireRole } from "../auth/guards";
import type { Role, SessionClaims } from "../auth/jwt";
import { getSession } from "../auth/session";
import { log } from "../log";
import { recordSecurityEvent } from "../security/events";
import { clientIp } from "../security/request";
import { HttpError } from "./errors";

// Thông báo lỗi kiểm tra đầu vào (error.fields[].message) bằng tiếng Việt cho mọi API.
z.config(z.locales.vi());

/**
 * T033 — Bọc route handler: xác thực + vai trò, đọc body JSON theo schema Zod strict (FR-085),
 * giới hạn kích thước body, chuyển lỗi thành {error:{code,message}} và không lộ chi tiết nội bộ.
 */
export interface Ctx<P> {
  req: Request;
  params: P;
  session: SessionClaims | null;
  ip: string | null;
}

export type RouteCtx = { params: Promise<Record<string, string>> };

/** Dùng khi gọi handler không có tham số đường dẫn (test, route tĩnh). */
export const NO_PARAMS: RouteCtx = { params: Promise.resolve({}) };

interface Options<B extends z.ZodType | undefined> {
  /** Vai trò được phép; bỏ trống = công khai. */
  roles?: readonly Role[];
  body?: B;
  maxBodyBytes?: number;
}

/** Handler đã bọc; `roles` được giữ lại để test ma trận phân quyền (T039) kiểm tra tự động. */
export type RouteHandler = ((req: Request, rc: RouteCtx) => Promise<Response>) & { roles: readonly Role[] | null };

export function route<P extends Record<string, string>, B extends z.ZodType | undefined = undefined>(
  opts: Options<B>,
  fn: (ctx: Ctx<P> & { body: B extends z.ZodType ? z.infer<B> : undefined }) => Promise<Response>,
): RouteHandler {
  const handler = async (req: Request, rc: RouteCtx): Promise<Response> => {
    const ip = clientIp(req);
    try {
      const session = await getSession(req);
      if (opts.roles) {
        requireRole(session, opts.roles);
        await assertStaffActive(session as SessionClaims);
      }
      let body: unknown = undefined;
      // Thứ tự có chủ đích: body JSON được kiểm schema TRƯỚC khi fn gọi assertOwns*(id). Người không sở hữu
      // tài nguyên gửi body sai sẽ nhận 422 thay vì 404 — chấp nhận được vì kết quả kiểm schema không phụ thuộc
      // id, nên không lộ tài nguyên có tồn tại hay không. Body đã giới hạn kích thước (maxBodyBytes) nên không
      // tốn tài nguyên đáng kể. API cần kiểm quyền trước khi đọc body (multipart, file lớn) thì KHÔNG khai báo
      // `body` ở đây mà tự đọc req trong fn sau assertOwns* — xem api/classes/roster-preview.ts.
      if (opts.body) {
        const raw = await readLimited(req, opts.maxBodyBytes ?? 64_000);
        let json: unknown;
        try {
          json = raw.length ? JSON.parse(raw) : {};
        } catch {
          throw new HttpError(400, "BAD_JSON", "Dữ liệu gửi lên không hợp lệ.");
        }
        body = opts.body.parse(json);
      }
      const params = ((await rc.params) ?? {}) as P;
      return await fn({ req, params, session, ip, body: body as never });
    } catch (err) {
      return toResponse(err, ip);
    }
  };
  return Object.assign(handler, { roles: opts.roles ?? null });
}

async function readLimited(req: Request, max: number): Promise<string> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > max) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Dữ liệu gửi lên quá lớn.");
  const text = await req.text();
  if (Buffer.byteLength(text) > max) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Dữ liệu gửi lên quá lớn.");
  return text;
}

export function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, { ...init, headers: { "Cache-Control": "no-store", ...init.headers } });
}

export function toResponse(err: unknown, ip: string | null = null): Response {
  if (err instanceof HttpError) {
    if (err.status === 401 || err.status === 403) {
      void recordSecurityEvent("forbidden", { ip, meta: { code: err.code } });
    }
    if (err.status === 429) void recordSecurityEvent("rate_limited", { ip });
    return json({ error: { ...err.extra, code: err.code, message: err.message } }, { status: err.status, headers: err.headers });
  }
  if (err instanceof ZodError) {
    return json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Dữ liệu không hợp lệ.",
          fields: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      { status: 422 },
    );
  }
  log.error("unhandled_route_error", { err: err instanceof Error ? err.stack : String(err) });
  return json({ error: { code: "INTERNAL", message: "Có lỗi xảy ra. Vui lòng thử lại." } }, { status: 500 });
}
