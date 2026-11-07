import "server-only";
import { z } from "zod";
import { HttpError } from "../http/errors";
import type { ColumnMapping } from "./columns";
import { ROSTER_LIMITS } from "./parse";

/**
 * Đọc form multipart của API nhập danh sách (preview/commit). route() chỉ đọc JSON nên handler gọi hàm này
 * SAU khi đã kiểm quyền + rate limit. Chặn theo content-length trước khi đọc body, rồi kiểm lại file.size.
 */
export interface RosterForm {
  file: Buffer;
  filename: string;
  columnMapping?: ColumnMapping;
  headerRowIndex?: number;
  confirmLargeWithdrawal: boolean;
}

const col = z.number().int().min(0).max(255).optional();
const ColumnMappingSchema = z
  .object({ code: col, lastName: col, firstName: col, fullName: col, adminClass: col, cohort: col })
  .strict();

const tooLarge = () => new HttpError(413, "PAYLOAD_TOO_LARGE", "File vượt dung lượng cho phép (4 MB).");

export async function readRosterForm(req: Request, maxBytes = ROSTER_LIMITS.maxBytes): Promise<RosterForm> {
  const lenHeader = req.headers.get("content-length");
  if (lenHeader === null) throw new HttpError(411, "LENGTH_REQUIRED", "Thiếu độ dài dữ liệu gửi lên.");
  const len = Number(lenHeader);
  if (!Number.isFinite(len) || len < 0 || len > maxBytes) throw tooLarge();

  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    throw new HttpError(400, "BAD_FORM", "Dữ liệu gửi lên không hợp lệ.");
  }

  const file = fd.get("file");
  if (!file || typeof file === "string") throw new HttpError(422, "FILE_REQUIRED", "Cần chọn file danh sách (.xlsx hoặc .csv).");
  if (file.size > maxBytes) throw tooLarge();

  let columnMapping: ColumnMapping | undefined;
  const rawMapping = fd.get("columnMapping");
  if (typeof rawMapping === "string" && rawMapping.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawMapping);
    } catch {
      parsed = undefined;
    }
    const r = ColumnMappingSchema.safeParse(parsed);
    if (!r.success) throw new HttpError(422, "INVALID_COLUMN_MAPPING", "Cách ghép cột không hợp lệ.");
    columnMapping = r.data;
  }

  let headerRowIndex: number | undefined;
  const rawHeader = fd.get("headerRowIndex");
  if (typeof rawHeader === "string" && rawHeader.trim()) {
    headerRowIndex = Number(rawHeader);
    if (!Number.isInteger(headerRowIndex) || headerRowIndex < 0 || headerRowIndex > 1_000) {
      throw new HttpError(422, "INVALID_HEADER_ROW", "Dòng tiêu đề không hợp lệ.");
    }
  }

  return {
    file: Buffer.from(await file.arrayBuffer()),
    filename: (file as File).name ?? "",
    columnMapping,
    headerRowIndex,
    confirmLargeWithdrawal: fd.get("confirmLargeWithdrawal") === "true",
  };
}
