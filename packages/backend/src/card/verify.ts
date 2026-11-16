import { namesMatch } from "@utc/shared/vn-text";

/**
 * T053/T058 — Luật xác thực thẻ sinh viên (FR-045…FR-048). Hàm thuần: không I/O, test được đầy đủ.
 * Thứ tự kiểm: đọc được mã → mã khớp mã đăng nhập → đúng một chân dung đủ lớn → chân dung đủ nét.
 */

export type CardRejectCode = "UNREADABLE" | "CODE_MISMATCH" | "NO_PORTRAIT" | "MULTIPLE_FACES";
export type CardReviewReason = "DUPLICATE_FACE" | "LIVE_MISMATCH" | "NAME_MISMATCH";

export interface DecodedCode {
  code: string;
  method: "barcode" | "ocr";
}

export interface PortraitFace {
  score: number;
  box: { x1: number; y1: number; x2: number; y2: number };
  /** 0..1 — phương sai Laplacian chuẩn hoá trên vùng mặt (imageQuality). */
  sharpness: number;
  /** 5 điểm mốc SCRFD — cần cho ước lượng góc quay đầu (liveness). */
  kps?: [number, number][];
}

/** Ngưỡng sơ bộ — hiệu chỉnh bằng ảnh thẻ thật trong scripts/calibrate (Nguyên tắc VI). */
export const PORTRAIT_RULES = {
  /** Cạnh ngắn của khung mặt (px trên ảnh đã thu về ≤ 1280 px). Nhỏ hơn: coi như không có chân dung. */
  minFaceSide: 40,
  minSharpness: 0.02,
} as const;

const CODE_RE = /^\d{6,12}$/;

export type CardEvaluation =
  | { ok: false; error: CardRejectCode }
  | { ok: true; faceIndex: number; reviewReasons: CardReviewReason[] };

export function evaluateCard(input: {
  sessionCode: string;
  decoded: DecodedCode | null;
  faces: PortraitFace[];
  /** Họ tên OCR có khớp hồ sơ không; null = không đọc được chữ nào để so. */
  nameMatched: boolean | null;
}): CardEvaluation {
  if (!input.decoded) return { ok: false, error: "UNREADABLE" };
  if (input.decoded.code !== input.sessionCode) return { ok: false, error: "CODE_MISMATCH" };

  const portraits = input.faces
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => Math.min(f.box.x2 - f.box.x1, f.box.y2 - f.box.y1) >= PORTRAIT_RULES.minFaceSide);
  if (portraits.length === 0) return { ok: false, error: "NO_PORTRAIT" };
  if (portraits.length > 1) return { ok: false, error: "MULTIPLE_FACES" };
  const [{ f, i }] = portraits;
  if (f.sharpness < PORTRAIT_RULES.minSharpness) return { ok: false, error: "UNREADABLE" };

  // Mã vạch là bằng chứng mạnh; mã đọc bằng OCR thì đòi thêm họ tên trên thẻ khớp hồ sơ, nếu không → giảng viên duyệt.
  const reviewReasons: CardReviewReason[] = [];
  if (input.decoded.method === "ocr" && input.nameMatched !== true) reviewReasons.push("NAME_MISMATCH");
  return { ok: true, faceIndex: i, reviewReasons };
}

/** Nội dung mã vạch → mã SV: chỉ nhận chuỗi toàn chữ số 6–12; nhiều mã khác nhau → không đoán. */
export function pickBarcodeCode(texts: string[]): string | null {
  const codes = new Set(texts.map((t) => t.trim()).filter((t) => CODE_RE.test(t)));
  return codes.size === 1 ? [...codes][0] : null;
}

const LABEL_RE = /(?:m[ãa]\s*(?:s[ốo]\s*)?(?:sinh\s*vi[êe]n|sv)|mssv|msv|student\s*(?:id|code|no\.?))\s*[:.\-]?\s*((?:\d[\s.]?){6,12})/iu;

/**
 * Mã SV từ chữ OCR: ưu tiên số sau nhãn "MSSV / Mã SV / Mã sinh viên / Student ID" (cho phép OCR chèn khoảng trắng);
 * nếu không có nhãn, chỉ nhận khi có đúng MỘT dãy 6–12 chữ số đứng riêng (ngày dd/mm/yyyy không tính).
 */
export function extractStudentCode(text: string): string | null {
  const t = text.normalize("NFC");
  const m = t.match(LABEL_RE);
  if (m) {
    const digits = m[1].replace(/\D/g, "");
    if (CODE_RE.test(digits)) return digits;
  }
  const runs = new Set(
    [...t.matchAll(/(?<![\d/.\-])\d{6,12}(?![\d/.\-])/g)].map((x) => x[0]),
  );
  return runs.size === 1 ? [...runs][0] : null;
}

/**
 * Họ tên hồ sơ có xuất hiện trên thẻ không (FR-103a dùng chung namesMatch: bỏ dấu, lệch ≤ 1 ký tự/từ).
 * Duyệt từng dòng OCR, thử mọi cửa sổ liên tiếp có cùng số từ với họ tên (bỏ nhãn "Họ tên:" ...).
 */
export function nameAppearsIn(text: string, fullName: string): boolean {
  const want = fullName.trim().split(/\s+/).filter(Boolean);
  if (!text.trim() || want.length === 0) return false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.includes(":") ? raw.slice(raw.lastIndexOf(":") + 1) : raw;
    const words = line.split(/[^\p{L}]+/u).filter(Boolean);
    for (let i = 0; i + want.length <= words.length; i++) {
      if (namesMatch(words.slice(i, i + want.length).join(" "), fullName)) return true;
    }
  }
  return false;
}

/** Trùng mặt 1:N: thẻ đã đăng ký có độ tương đồng cao nhất vượt ngưỡng (DUPLICATE_ABOVE). */
export function duplicateDecision(
  matches: { studentId: string; similarity: number }[],
  threshold: number,
): { studentId: string; similarity: number } | null {
  const best = matches.reduce<{ studentId: string; similarity: number } | null>(
    (a, m) => (!a || m.similarity > a.similarity ? m : a),
    null,
  );
  return best && best.similarity >= threshold ? best : null;
}

/**
 * Dòng họ tên đọc bằng OCR (phần sau nhãn "Họ tên" / "Họ và tên") — lưu kèm thẻ để giảng viên đối chiếu khi
 * NAME_MISMATCH. Không phải dữ liệu sinh trắc; tối đa 80 ký tự; không có nhãn → null.
 */
export function ocrNameLine(text: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*h[oọ]\s*(?:v[aà]\s*)?t[eê]n\s*:?\s*(.*)$/iu.exec(raw.normalize("NFC"));
    if (!m) continue;
    const name = m[1].replace(/\s+/g, " ").trim();
    if (name) return name.slice(0, 80);
  }
  return null;
}
