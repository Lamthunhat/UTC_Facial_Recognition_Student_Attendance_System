"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SHIFTS } from "@utc/shared/periods";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { daysBetween, MAX_CLASS_DAYS, periodRangeTime, shiftLabel, weekdayLabel, WEEKDAYS } from "@/lib/classes";
import { cn } from "@/lib/utils";

/**
 * T050 — Tạo lớp học phần (FR-010…FR-010d): mã lớp, học phần, học kỳ, ngày bắt đầu/kết thúc (≤ 15 tuần),
 * một hoặc nhiều buổi/tuần chọn theo ca 1–5 hoặc khoảng tiết tuỳ chỉnh, phòng mặc định + phòng riêng từng buổi.
 * Lỗi 422 hiển thị ngay dưới trường tương ứng (error.fields hoặc mã lỗi nghiệp vụ).
 */
interface ScheduleRow {
  key: number;
  weekday: number;
  mode: "shift" | "custom";
  shift: number;
  firstPeriod: number;
  lastPeriod: number;
  room: string;
}

const PERIODS = Array.from({ length: 16 }, (_, i) => i + 1);
const selectCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

/** Mã lỗi nghiệp vụ của API → trường hiển thị lỗi. */
const CODE_TO_FIELD: Record<string, string> = {
  DURATION_EXCEEDED: "endDate",
  INVALID_DATE_RANGE: "endDate",
  INVALID_DATE: "startDate",
  INVALID_SCHEDULE: "schedules",
  CLASS_CODE_EXISTS: "code",
};

let nextKey = 1;
const newRow = (weekday = 2): ScheduleRow => ({ key: nextKey++, weekday, mode: "shift", shift: 1, firstPeriod: 1, lastPeriod: 3, room: "" });

export default function CreateClassPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    code: "",
    courseName: "",
    semester: "",
    startDate: "",
    endDate: "",
    defaultRoom: "",
    radiusM: "50",
    checkinMinutes: "15",
  });
  const [rows, setRows] = useState<ScheduleRow[]>(() => [newRow()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Tạo lớp học phần";
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((es) => {
      const next = { ...es };
      delete next[k];
      return next;
    });
  };
  const setRow = (key: number, patch: Partial<ScheduleRow>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setErrors((es) => Object.fromEntries(Object.entries(es).filter(([p]) => !p.startsWith("schedules"))));
  };

  const days = daysBetween(form.startDate, form.endDate);
  const durationError =
    days < 0 ? "Ngày kết thúc phải sau ngày bắt đầu." : days > MAX_CLASS_DAYS ? "Lớp học phần không được kéo dài quá 15 tuần." : undefined;
  const rowError = (r: ScheduleRow) =>
    r.mode === "custom" && r.firstPeriod > r.lastPeriod ? "Tiết bắt đầu phải trước hoặc bằng tiết kết thúc." : undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (durationError || rows.some(rowError)) return;
    setBusy(true);
    try {
      const body = {
        code: form.code,
        courseName: form.courseName,
        semester: form.semester || undefined,
        startDate: form.startDate,
        endDate: form.endDate,
        defaultRoom: form.defaultRoom || undefined,
        radiusM: Number(form.radiusM),
        checkinMinutes: Number(form.checkinMinutes),
        schedules: rows.map((r) => ({
          weekday: r.weekday,
          ...(r.mode === "shift" ? { shift: r.shift } : { firstPeriod: r.firstPeriod, lastPeriod: r.lastPeriod }),
          ...(r.room.trim() ? { room: r.room.trim() } : {}),
        })),
      };
      const res = await api<{ class: { id: string } }>("/api/classes", { method: "POST", json: body });
      router.push(`/gv/lop/${res.class.id}/danh-sach`);
    } catch (err) {
      if (err instanceof ApiError) {
        const next: Record<string, string> = {};
        for (const f of err.fields ?? []) next[f.path] ??= f.message;
        const field = CODE_TO_FIELD[err.code];
        if (field) next[field] = err.message;
        setErrors(next);
        if (!err.fields?.length && !field) setFormError(err.message);
        else if (err.fields?.length) setFormError("Vui lòng kiểm tra lại các trường được đánh dấu.");
      } else {
        setFormError("Không kết nối được máy chủ. Vui lòng thử lại.");
      }
      setBusy(false);
    }
  }

  const scheduleErrorFor = (i: number) =>
    Object.entries(errors).find(([p]) => p === `schedules.${i}` || p.startsWith(`schedules.${i}.`))?.[1];

  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href="/gv/lop" className="text-sm text-primary hover:underline">
          ← Lớp của tôi
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Tạo lớp học phần</h1>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-6">
        <fieldset className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold">Thông tin lớp</legend>
          <Field label="Mã lớp học phần" hint="Ví dụ: Khai phá dữ liệu-1-1-26(N03.BT1)" error={errors.code}>
            <Input value={form.code} onChange={set("code")} required maxLength={120} aria-invalid={!!errors.code} />
          </Field>
          <Field label="Tên học phần" error={errors.courseName}>
            <Input value={form.courseName} onChange={set("courseName")} required maxLength={200} aria-invalid={!!errors.courseName} />
          </Field>
          <Field label="Học kỳ" hint="Ví dụ: 1-2026-2027" error={errors.semester}>
            <Input value={form.semester} onChange={set("semester")} maxLength={40} />
          </Field>
          <Field label="Phòng học mặc định" hint="Ví dụ: 301-A7-A7" error={errors.defaultRoom}>
            <Input value={form.defaultRoom} onChange={set("defaultRoom")} maxLength={60} />
          </Field>
          <Field label="Ngày bắt đầu" error={errors.startDate}>
            <Input type="date" value={form.startDate} onChange={set("startDate")} required aria-invalid={!!errors.startDate} />
          </Field>
          <Field
            label="Ngày kết thúc"
            hint={Number.isFinite(days) && days >= 0 ? `${Math.ceil((days + 1) / 7)} tuần (tối đa 15 tuần)` : "Tối đa 15 tuần"}
            error={errors.endDate ?? durationError}
          >
            <Input
              type="date"
              value={form.endDate}
              min={form.startDate || undefined}
              onChange={set("endDate")}
              required
              aria-invalid={!!(errors.endDate ?? durationError)}
            />
          </Field>
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-semibold">Lịch học hằng tuần</legend>
          {errors.schedules && <Alert>{errors.schedules}</Alert>}
          {rows.map((r, i) => {
            const err = rowError(r) ?? scheduleErrorFor(i);
            return (
              <div key={r.key} className={cn("grid gap-3 rounded-lg bg-muted/50 p-3 sm:grid-cols-12", err && "ring-1 ring-destructive")}>
                <div className="sm:col-span-3">
                  <Field label={`Buổi ${i + 1}`}>
                    <select aria-label={`Thứ trong tuần, buổi ${i + 1}`} className={selectCls} value={r.weekday} onChange={(e) => setRow(r.key, { weekday: Number(e.target.value) })}>
                      {WEEKDAYS.map((d) => (
                        <option key={d} value={d}>
                          {weekdayLabel(d)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="sm:col-span-5">
                  <div className="flex flex-col gap-1 text-sm">
                    <div className="flex gap-3">
                      <label className="flex items-center gap-1 font-semibold">
                        <input type="radio" name={`mode-${r.key}`} checked={r.mode === "shift"} onChange={() => setRow(r.key, { mode: "shift" })} />
                        Theo ca
                      </label>
                      <label className="flex items-center gap-1 font-semibold">
                        <input type="radio" name={`mode-${r.key}`} checked={r.mode === "custom"} onChange={() => setRow(r.key, { mode: "custom" })} />
                        Khoảng tiết
                      </label>
                    </div>
                    {r.mode === "shift" ? (
                      <select
                        aria-label={`Ca học buổi ${i + 1}`}
                        className={selectCls}
                        value={r.shift}
                        onChange={(e) => setRow(r.key, { shift: Number(e.target.value) })}
                      >
                        {SHIFTS.map((s) => (
                          <option key={s.number} value={s.number}>
                            {shiftLabel(s.number)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="flex items-center gap-2">
                        <select
                          aria-label={`Tiết bắt đầu buổi ${i + 1}`}
                          className={selectCls}
                          value={r.firstPeriod}
                          onChange={(e) => setRow(r.key, { firstPeriod: Number(e.target.value) })}
                        >
                          {PERIODS.map((p) => (
                            <option key={p} value={p}>
                              Tiết {p}
                            </option>
                          ))}
                        </select>
                        <span aria-hidden>–</span>
                        <select
                          aria-label={`Tiết kết thúc buổi ${i + 1}`}
                          className={selectCls}
                          value={r.lastPeriod}
                          onChange={(e) => setRow(r.key, { lastPeriod: Number(e.target.value) })}
                        >
                          {PERIODS.map((p) => (
                            <option key={p} value={p}>
                              Tiết {p}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {r.mode === "custom" && r.firstPeriod <= r.lastPeriod && (
                      <span className="text-xs text-muted-foreground">{periodRangeTime(r.firstPeriod, r.lastPeriod)}</span>
                    )}
                  </div>
                </div>
                <div className="sm:col-span-3">
                  <Field label="Phòng (nếu khác)">
                    <Input value={r.room} onChange={(e) => setRow(r.key, { room: e.target.value })} maxLength={60} placeholder={form.defaultRoom || "Phòng mặc định"} />
                  </Field>
                </div>
                <div className="flex items-end sm:col-span-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Xoá buổi ${i + 1}`}
                    disabled={rows.length === 1}
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  >
                    Xoá
                  </Button>
                </div>
                {err && <p className="text-xs text-destructive sm:col-span-12">{err}</p>}
              </div>
            );
          })}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={rows.length >= 14}
              onClick={() => setRows((rs) => [...rs, newRow(Math.min(8, (rs.at(-1)?.weekday ?? 1) + 1))])}
            >
              + Thêm buổi trong tuần
            </Button>
          </div>
        </fieldset>

        <fieldset className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold">Cấu hình điểm danh</legend>
          <Field label="Bán kính hợp lệ (m)" hint="10–500 m quanh vị trí giảng viên" error={errors.radiusM}>
            <Input type="number" min={10} max={500} value={form.radiusM} onChange={set("radiusM")} required />
          </Field>
          <Field label="Thời gian mở check-in (phút)" hint="5–60 phút" error={errors.checkinMinutes}>
            <Input type="number" min={5} max={60} value={form.checkinMinutes} onChange={set("checkinMinutes")} required />
          </Field>
        </fieldset>

        {formError && <Alert>{formError}</Alert>}

        <div className="flex gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? "Đang tạo…" : "Tạo lớp"}
          </Button>
          <Link href="/gv/lop" className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted">
            Huỷ
          </Link>
        </div>
      </form>
    </section>
  );
}
