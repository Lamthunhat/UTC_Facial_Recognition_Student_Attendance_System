"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { type ClassSummary, scheduleLabel, vnDate } from "@/lib/classes";

/** T050 — Danh sách lớp học phần của giảng viên + lối vào tạo lớp / nhập danh sách. */
export default function ClassListPage() {
  const [classes, setClasses] = useState<ClassSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Lớp của tôi";
    api<{ classes: ClassSummary[] }>("/api/classes")
      .then((r) => setClasses(r.classes))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Không tải được danh sách lớp."));
  }, []);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Lớp của tôi</h1>
        <Link
          href="/gv/lop/tao"
          className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          Tạo lớp
        </Link>
      </div>

      {error && <Alert>{error}</Alert>}
      {!classes && !error && <p className="text-sm text-muted-foreground">Đang tải…</p>}

      {classes?.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="font-semibold">Bạn chưa có lớp học phần nào.</p>
          <p className="mt-1 text-sm text-muted-foreground">Tạo lớp, sau đó nhập danh sách sinh viên từ file Excel/CSV.</p>
        </div>
      )}

      {/* Điện thoại: dạng thẻ; từ sm trở lên: dạng bảng. */}
      {classes && classes.length > 0 && (
        <ul className="flex flex-col gap-3 sm:hidden">
          {classes.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 rounded-lg border border-border p-4 text-sm">
              <div>
                <div className="font-semibold">{c.code}</div>
                <div className="text-muted-foreground">
                  {c.courseName}
                  {c.semester ? ` · HK ${c.semester}` : ""}
                </div>
              </div>
              <div>
                {vnDate(c.startDate)} – {vnDate(c.endDate)} · <span className="tabular-nums">{c.activeStudents}</span> sinh viên
              </div>
              <ul className="text-muted-foreground">
                {c.schedules.map((s, i) => (
                  <li key={i}>{scheduleLabel(s, c.defaultRoom)}</li>
                ))}
              </ul>
              <Link href={`/gv/lop/${c.id}/danh-sach`} className="font-semibold text-primary hover:underline">
                Nhập danh sách →
              </Link>
            </li>
          ))}
        </ul>
      )}

      {classes && classes.length > 0 && (
        <div className="hidden overflow-x-auto rounded-lg border border-border sm:block">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-3 py-2">Lớp học phần</th>
                <th className="px-3 py-2">Thời gian</th>
                <th className="px-3 py-2">Lịch học</th>
                <th className="px-3 py-2 text-right">Sĩ số</th>
                <th className="px-3 py-2 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {classes.map((c) => (
                <tr key={c.id} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <div className="font-semibold">{c.code}</div>
                    <div className="text-muted-foreground">
                      {c.courseName}
                      {c.semester ? ` · HK ${c.semester}` : ""}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {vnDate(c.startDate)} – {vnDate(c.endDate)}
                  </td>
                  <td className="px-3 py-2">
                    <ul className="flex flex-col gap-0.5">
                      {c.schedules.map((s, i) => (
                        <li key={i} className="whitespace-nowrap">{scheduleLabel(s, c.defaultRoom)}</li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.activeStudents}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/gv/lop/${c.id}/danh-sach`} className="whitespace-nowrap font-semibold text-primary hover:underline">
                      Nhập danh sách
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
