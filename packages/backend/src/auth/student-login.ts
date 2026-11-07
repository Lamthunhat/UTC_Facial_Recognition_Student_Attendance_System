import "server-only";
import { createHmac } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@utc/database";
import { studentCards, students } from "@utc/database/schema";
import { CONSENT_VERSION } from "@utc/shared/consent";
import { vnDateOf } from "@utc/shared/periods";
import { HttpError } from "../http/errors";
import { recordSecurityEvent } from "../security/events";
import { assertNotLimited, enforce, hit, RULES } from "../security/rate-limit";

/**
 * T060 — Đăng nhập sinh viên chỉ bằng mã SV (FR-004, FR-081, FR-083, FR-095).
 * - Thành công khi mã có ghi danh active trong ≥ 1 lớp đang hoạt động (chưa qua ngày kết thúc; lớp sắp mở
 *   vẫn tính để SV đăng ký thẻ trước buổi đầu).
 * - Mọi lý do thất bại (không tồn tại, không thuộc lớp, đã rút, lớp kết thúc, sai định dạng) đi cùng một nhánh,
 *   trả cùng 401 LOGIN_FAILED và cùng thông báo; tra cứu bằng MỘT truy vấn nên thời gian phản hồi như nhau.
 * - Rate limit (R14): theo IP chỉ đếm lượt THẤT BẠI (20/5') + trần tổng mọi lượt (300/5') — cả lớp sau một NAT Wi-Fi
 *   đăng nhập được; theo mã chỉ đếm lượt THẤT BẠI (5/5') — người khác không khoá hộ được mã của SV thật.
 *   Khi bộ đếm thất bại đã đầy, chặn MỌI lượt trước khi tra cứu (không để lộ mã đúng qua khác biệt 200/429).
 *   Vượt → 429 (handler ghi security_events rate_limited).
 */
export const STUDENT_LOGIN_FAILED_MESSAGE = "Không đăng nhập được. Kiểm tra lại mã sinh viên hoặc liên hệ giảng viên.";
export const studentLoginFailed = () => new HttpError(401, "LOGIN_FAILED", STUDENT_LOGIN_FAILED_MESSAGE);

/** Băm có khoá mã SV để ghi nhật ký: nối được các lần dò cùng một mã mà không lưu mã (1e9 khả năng → băm thường dò ngược được). */
function codeFingerprint(code: string) {
  return createHmac("sha256", process.env.JWT_SECRET ?? "dev").update(`student-login:${code}`).digest("hex").slice(0, 16);
}

export interface StudentLoginResult {
  id: string;
  code: string;
  fullName: string;
  consentAt: Date | null;
  /** Đã đồng ý đúng phiên bản văn bản hiện hành (nếu false, UI hiện màn đồng ý trước khi chụp thẻ). */
  consentValid: boolean;
  hasActiveCard: boolean;
}

export async function loginStudent(input: { studentCode: unknown; ip: string | null; today?: string }): Promise<StudentLoginResult> {
  if (input.ip) {
    await enforce(`student-login:ip-all:${input.ip}`, RULES.studentLoginIpTotal);
    await assertNotLimited(`student-login-fail:ip:${input.ip}`, RULES.studentLoginIpFail);
  }
  const code = typeof input.studentCode === "string" ? input.studentCode.replace(/\s+/g, "").slice(0, 32) : "";
  if (code) await assertNotLimited(`student-login-fail:code:${code}`, RULES.studentLoginCode);

  const fail = async () => {
    await recordSecurityEvent("login_failed", {
      ip: input.ip,
      meta: { kind: "student", fp: code ? codeFingerprint(code) : null },
    });
    // Bộ đếm thất bại (IP + mã) chỉ tăng ở đây; lượt kế tiếp bị chặn ở assertNotLimited phía trên khi đã đầy.
    if (input.ip) await hit(`student-login-fail:ip:${input.ip}`, RULES.studentLoginIpFail);
    if (code) await hit(`student-login-fail:code:${code}`, RULES.studentLoginCode);
    return studentLoginFailed();
  };
  if (!/^\d{6,12}$/.test(code)) throw await fail();

  const today = input.today ?? vnDateOf(new Date());
  const db = await getDb();
  const [s] = await db
    .select({
      id: students.id,
      code: students.studentCode,
      lastName: students.lastName,
      firstName: students.firstName,
      consentAt: students.consentAt,
      consentVersion: students.consentVersion,
    })
    .from(students)
    .where(
      and(
        eq(students.studentCode, code),
        sql`exists (select 1 from enrollments e join classes c on c.id = e.class_id
                    where e.student_id = ${students.id} and e.status = 'active' and c.end_date >= ${today}::date)`,
      ),
    )
    .limit(1);
  if (!s) throw await fail();

  const [card] = await db
    .select({ id: studentCards.id })
    .from(studentCards)
    .where(and(eq(studentCards.studentId, s.id), eq(studentCards.status, "active")))
    .limit(1);
  return {
    id: s.id,
    code: s.code,
    fullName: `${s.lastName} ${s.firstName}`,
    consentAt: s.consentAt,
    consentValid: !!s.consentAt && s.consentVersion === CONSENT_VERSION,
    hasActiveCard: !!card,
  };
}
