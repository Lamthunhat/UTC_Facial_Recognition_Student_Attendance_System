"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * T051 — Nhập danh sách lớp (FR-011…FR-014): chọn file → xem trước (dòng lỗi tô đỏ, cảnh báo) →
 * ghép cột thủ công khi cần → Lưu (gửi lại chính file + cách ghép cột; xác nhận khi rút > 50% lớp).
 */
const MAX_BYTES = 4 * 1024 * 1024; // khớp ROSTER_LIMITS.maxBytes ở server

type RosterField = "code" | "lastName" | "firstName" | "fullName" | "adminClass" | "cohort";
type Mapping = Partial<Record<RosterField, number>>;
type RowError = "EMPTY_ROW" | "MISSING_CODE" | "INVALID_CODE" | "MISSING_LAST_NAME" | "MISSING_FIRST_NAME" | "DUPLICATE_CODE" | "LOST_CHARACTERS";

interface PreviewRow {
  rowNo: number;
  data: { code: string; lastName: string; firstName: string; adminClass: string | null; cohort: string | null };
  errors: RowError[];
}
interface Preview {
  headerRowIndex: number;
  headerCells: string[];
  columnsDetected: Mapping;
  missing: RosterField[];
  rows: PreviewRow[];
  summary: { valid: number; invalid: number; new: number; reactivated: number; existing: number; toWithdraw: number };
  warnings: ({ code: "LARGE_WITHDRAWAL"; toWithdraw: number; active: number } | { code: "FORMULA_LIKE_NAMES"; rows: number[] } | { code: "ENCODING_LOSS"; rows: number[] })[];
}
interface ClassInfo {
  id: string;
  code: string;
  courseName: string;
  activeStudents: number;
}

const ERROR_LABEL: Record<RowError, string> = {
  EMPTY_ROW: "Dòng trống",
  MISSING_CODE: "Thiếu mã SV",
  INVALID_CODE: "Mã SV phải gồm 6–12 chữ số",
  MISSING_LAST_NAME: "Thiếu họ",
  MISSING_FIRST_NAME: "Thiếu tên",
  DUPLICATE_CODE: "Trùng mã với dòng phía trên",
  LOST_CHARACTERS: "Tên bị mất dấu (có ký tự ?)",
};

const MAPPING_FIELDS: { key: RosterField; label: string; required?: boolean }[] = [
  { key: "code", label: "Mã sinh viên", required: true },
  { key: "lastName", label: "Họ (họ + đệm)" },
  { key: "firstName", label: "Tên" },
  { key: "fullName", label: "Họ và tên (nếu file gộp một cột)" },
  { key: "adminClass", label: "Lớp hành chính", required: true },
  { key: "cohort", label: "Khoá (tuỳ chọn)" },
];
const FIELD_LABEL: Record<RosterField, string> = {
  code: "Mã SV",
  lastName: "Họ",
  firstName: "Tên",
  fullName: "Họ và tên",
  adminClass: "Lớp",
  cohort: "Khoá",
};

const colLetter = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const selectCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

export default function RosterImportPage() {
  const { classId } = useParams<{ classId: string }>();
  const fileInput = useRef<HTMLInputElement>(null);
  const [cls, setCls] = useState<ClassInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  /** Cách ghép cột đang soạn trên giao diện. */
  const [mapping, setMapping] = useState<Mapping>({});
  const [headerRow, setHeaderRow] = useState(1);
  /** Cách ghép cột đã áp dụng cho bản xem trước hiện tại — gửi kèm khi Lưu. */
  const [applied, setApplied] = useState<{ mapping: Mapping; headerRowIndex: number } | null>(null);
  const [showMapping, setShowMapping] = useState(false);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const loadClass = useCallback(async () => {
    const r = await api<{ class: ClassInfo }>(`/api/classes/${classId}`);
    setCls(r.class);
    document.title = `Danh sách · ${r.class.code}`;
  }, [classId]);

  useEffect(() => {
    loadClass().catch((e) => setMsg({ tone: "error", text: e instanceof ApiError ? e.message : "Không tải được thông tin lớp." }));
  }, [loadClass]);

  function formFor(f: File, extra: Record<string, string> = {}, use = applied) {
    const fd = new FormData();
    fd.append("file", f);
    if (use) {
      fd.append("columnMapping", JSON.stringify(use.mapping));
      fd.append("headerRowIndex", String(use.headerRowIndex));
    }
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    return fd;
  }

  async function runPreview(f: File, use: typeof applied) {
    setBusy(true);
    setMsg(null);
    setConfirmWithdraw(false);
    try {
      const p = await api<Preview>(`/api/classes/${classId}/roster/preview`, { method: "POST", body: formFor(f, {}, use) });
      setPreview(p);
      setApplied(use);
      setMapping(use?.mapping ?? p.columnsDetected);
      setHeaderRow((p.headerRowIndex >= 0 ? p.headerRowIndex : 0) + 1);
      setShowMapping(p.missing.length > 0);
      setOnlyErrors(false);
    } catch (e) {
      setPreview(null);
      setMsg({ tone: "error", text: e instanceof ApiError ? e.message : "Không đọc được file. Vui lòng thử lại." });
    } finally {
      setBusy(false);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setPreview(null);
    setApplied(null);
    setMsg(null);
    if (!f) return setFile(null);
    if (!/\.(xlsx|csv)$/i.test(f.name)) {
      e.target.value = "";
      setFile(null);
      return setMsg({ tone: "error", text: "Chỉ hỗ trợ file .xlsx hoặc .csv (file .xls cũ: mở bằng Excel rồi lưu lại dạng .xlsx)." });
    }
    if (f.size > MAX_BYTES) {
      e.target.value = "";
      setFile(null);
      return setMsg({ tone: "error", text: `File nặng ${(f.size / 1024 / 1024).toFixed(1)} MB, vượt giới hạn 4 MB.` });
    }
    setFile(f);
    void runPreview(f, null);
  }

  async function save() {
    if (!file || !preview) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ result: { added: number; reactivated: number; existing: number; withdrawn: number }; invalidRows: number }>(
        `/api/classes/${classId}/roster/commit`,
        { method: "POST", body: formFor(file, confirmWithdraw ? { confirmLargeWithdrawal: "true" } : {}) },
      );
      const { added, reactivated, existing, withdrawn } = r.result;
      setMsg({
        tone: "success",
        text:
          `Đã lưu danh sách: thêm ${added}${reactivated ? `, ghi danh lại ${reactivated}` : ""}, giữ nguyên ${existing}, rút ${withdrawn} sinh viên.` +
          (r.invalidRows ? ` Bỏ qua ${r.invalidRows} dòng lỗi.` : ""),
      });
      setPreview(null);
      setApplied(null);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      await loadClass();
    } catch (e) {
      if (e instanceof ApiError && e.code === "LARGE_WITHDRAWAL_CONFIRM_REQUIRED") {
        // Danh sách lớp thay đổi kể từ lúc xem trước: xem lại để có số liệu mới nhất và cảnh báo.
        setMsg({ tone: "error", text: e.message });
        void runPreview(file, applied);
      } else {
        setMsg({ tone: "error", text: e instanceof ApiError ? e.message : "Không lưu được. Vui lòng thử lại." });
      }
    } finally {
      setBusy(false);
    }
  }

  const large = preview?.warnings.find((w) => w.code === "LARGE_WITHDRAWAL");
  const formula = preview?.warnings.find((w) => w.code === "FORMULA_LIKE_NAMES");
  const encodingLoss = preview?.warnings.some((w) => w.code === "ENCODING_LOSS");
  const canSave = !!preview && preview.missing.length === 0 && preview.summary.valid > 0 && (!large || confirmWithdraw) && !busy;
  const rows = preview ? (onlyErrors ? preview.rows.filter((r) => r.errors.length) : preview.rows) : [];

  return (
    <section className="flex flex-col gap-5">
      <div>
        <Link href="/gv/lop" className="text-sm text-primary hover:underline">
          ← Lớp của tôi
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Nhập danh sách sinh viên</h1>
        <Link href={`/gv/lop/${classId}/the`} className="text-sm text-primary hover:underline">
          Thẻ sinh viên của lớp →
        </Link>
        {cls && (
          <p className="text-sm text-muted-foreground">
            {cls.code} · {cls.courseName} · đang có <strong className="text-foreground">{cls.activeStudents}</strong> sinh viên
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
        <Field label="File danh sách (.xlsx hoặc .csv, tối đa 4 MB)" hint="Cần các cột Mã SV, Họ, Tên, Lớp; cột Khoá tuỳ chọn. Hệ thống tự nhận tiêu đề có hoặc không dấu. Nếu dùng CSV, hãy lưu bằng “CSV UTF-8” để giữ dấu tiếng Việt.">
          <Input ref={fileInput} type="file" accept=".xlsx,.csv" onChange={onPick} disabled={busy} />
        </Field>
        {busy && <p className="text-sm text-muted-foreground">Đang xử lý…</p>}
      </div>

      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {preview && file && (
        <>
          {encodingLoss && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-destructive">
              <p className="font-semibold">File bị mất dấu tiếng Việt: các chữ có dấu đã bị thay bằng “?” khi lưu file.</p>
              <p className="mt-1">
                Thường do lưu bằng “CSV (Comma delimited)” trên Windows tiếng Anh. Hãy mở file gốc trong Excel → <strong>Lưu thành</strong> → chọn{" "}
                <strong>CSV UTF-8 (Comma delimited)</strong>, hoặc tải lên file <strong>.xlsx</strong>. Các dòng có tên bị mất dấu sẽ không được lưu.
              </p>
            </div>
          )}

          {preview.missing.length > 0 && (
            <Alert>
              Không nhận ra cột: {preview.missing.map((m) => FIELD_LABEL[m]).join(", ")}. Hãy ghép cột thủ công bên dưới rồi xem lại.
            </Alert>
          )}

          <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Ghép cột</h2>
              <Button variant="ghost" size="sm" onClick={() => setShowMapping((v) => !v)}>
                {showMapping ? "Ẩn" : "Ghép cột thủ công"}
              </Button>
            </div>
            {showMapping && (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Dòng tiêu đề (số dòng trong file)">
                    <Input type="number" min={1} max={1001} value={headerRow} onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value) || 1))} />
                  </Field>
                  {MAPPING_FIELDS.map((f) => (
                    <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`}>
                      <select
                        aria-label={`Cột cho ${f.label}${f.required ? " (bắt buộc)" : ""}`}
                        className={selectCls}
                        value={mapping[f.key] ?? ""}
                        onChange={(e) =>
                          setMapping((m) => {
                            const next = { ...m };
                            if (e.target.value === "") delete next[f.key];
                            else next[f.key] = Number(e.target.value);
                            return next;
                          })
                        }
                      >
                        <option value="">— Không có —</option>
                        {preview.headerCells.map((h, i) => (
                          <option key={i} value={i}>
                            Cột {colLetter(i)} · {h || "(trống)"}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Tên cột lấy từ dòng tiêu đề đang chọn. Nếu đổi dòng tiêu đề, bấm “Xem lại” để cập nhật danh sách cột. Cần Họ + Tên, hoặc một cột Họ và tên.
                </p>
                <div>
                  <Button variant="outline" disabled={busy} onClick={() => void runPreview(file, { mapping, headerRowIndex: headerRow - 1 })}>
                    Xem lại với cách ghép này
                  </Button>
                </div>
              </>
            )}
          </div>

          {preview.missing.length === 0 && (
            <>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[
                  ["Hợp lệ", preview.summary.valid, ""],
                  ["Dòng lỗi", preview.summary.invalid, preview.summary.invalid ? "text-destructive" : ""],
                  ["Sẽ thêm", preview.summary.new, ""],
                  ["Đã có trong lớp", preview.summary.existing, ""],
                  ["Sẽ rút", preview.summary.toWithdraw, preview.summary.toWithdraw ? "text-destructive" : ""],
                ].map(([label, n, cls]) => (
                  <div key={label as string} className="rounded-lg border border-border px-3 py-2">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className={cn("text-lg font-semibold tabular-nums", cls as string)}>{n}</dd>
                  </div>
                ))}
              </dl>

              {formula && formula.code === "FORMULA_LIKE_NAMES" && (
                <div role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Họ/tên ở dòng {formula.rows.join(", ")} bắt đầu bằng ký tự = + - @. Hệ thống lưu dưới dạng văn bản (không chạy công thức), nhưng hãy
                  kiểm tra lại tên có đúng không.
                </div>
              )}

              {large && large.code === "LARGE_WITHDRAWAL" && (
                <div role="alert" className="flex flex-col gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-destructive">
                  <p>
                    Lần nhập này sẽ rút <strong>{large.toWithdraw}</strong> trên {large.active} sinh viên đang học (hơn một nửa lớp). Có thể bạn đã chọn
                    nhầm file. Lịch sử điểm danh của sinh viên bị rút vẫn được giữ.
                  </p>
                  <label className="flex items-center gap-2 font-semibold">
                    <input type="checkbox" checked={confirmWithdraw} onChange={(e) => setConfirmWithdraw(e.target.checked)} />
                    Tôi đã kiểm tra và đồng ý rút {large.toWithdraw} sinh viên
                  </label>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => void save()} disabled={!canSave}>
                  {busy ? "Đang lưu…" : `Lưu ${preview.summary.valid} sinh viên hợp lệ`}
                </Button>
                {preview.summary.invalid > 0 && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
                    Chỉ hiện dòng lỗi
                  </label>
                )}
                {preview.summary.invalid > 0 && <span className="text-sm text-muted-foreground">Dòng lỗi sẽ bị bỏ qua khi lưu.</span>}
              </div>

              <div className="max-h-[60vh] overflow-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted text-left">
                    <tr>
                      <th className="px-3 py-2 text-right">Dòng</th>
                      <th className="px-3 py-2">Mã SV</th>
                      <th className="px-3 py-2">Họ</th>
                      <th className="px-3 py-2">Tên</th>
                      <th className="px-3 py-2">Lớp</th>
                      <th className="px-3 py-2">Khoá</th>
                      <th className="px-3 py-2">Lỗi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const bad = r.errors.length > 0;
                      return (
                        <tr key={r.rowNo} className={cn("border-t border-border", bad && "bg-red-50 text-destructive")} aria-invalid={bad || undefined}>
                          <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{r.rowNo}</td>
                          <td className="px-3 py-1.5 tabular-nums">{r.data.code}</td>
                          <td className="px-3 py-1.5">{r.data.lastName}</td>
                          <td className="px-3 py-1.5">{r.data.firstName}</td>
                          <td className="px-3 py-1.5">{r.data.adminClass}</td>
                          <td className="px-3 py-1.5">{r.data.cohort}</td>
                          <td className="px-3 py-1.5 font-semibold">{r.errors.map((e) => ERROR_LABEL[e]).join("; ")}</td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                          Không có dòng nào.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
