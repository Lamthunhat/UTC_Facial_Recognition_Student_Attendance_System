"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";

/** T038 — Admin xem dữ liệu điểm danh toàn trường (FR-002). */
interface Row {
  classId: string;
  classCode: string;
  courseName: string;
  semester: string | null;
  instructorName: string;
  sessions: number;
  valid: number;
  suspect: number;
  rejected: number;
  approvedLeaves: number;
  lastSessionDate: string | null;
}
interface Data {
  total: number;
  page: number;
  pageSize: number;
  rows: Row[];
}
interface Instructor {
  id: string;
  fullName: string;
}

export default function AdminAttendancePage() {
  const [filter, setFilter] = useState({ instructorId: "", semester: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Data | null>(null);
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const q = new URLSearchParams({ page: String(page), pageSize: "50" });
    for (const [k, v] of Object.entries(filter)) if (v) q.set(k, v);
    try {
      setData(await api<Data>(`/api/admin/attendance?${q}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không tải được dữ liệu.");
    }
  }, [filter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api<{ instructors: Instructor[] }>("/api/admin/instructors")
      .then((r) => setInstructors(r.instructors))
      .catch(() => undefined);
  }, []);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Điểm danh toàn trường</h1>

      <form
        className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setPage(1);
          setFilter({
            instructorId: String(f.get("instructorId") ?? ""),
            semester: String(f.get("semester") ?? "").trim(),
            from: String(f.get("from") ?? ""),
            to: String(f.get("to") ?? ""),
          });
        }}
      >
        <Field label="Giảng viên">
          <select name="instructorId" className="rounded-lg border border-border px-3 py-2 text-sm" defaultValue="">
            <option value="">Tất cả</option>
            {instructors.map((i) => (
              <option key={i.id} value={i.id}>
                {i.fullName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Học kỳ">
          <Input name="semester" placeholder="1-2026-2027" maxLength={40} />
        </Field>
        <Field label="Từ ngày">
          <Input name="from" type="date" />
        </Field>
        <Field label="Đến ngày">
          <Input name="to" type="date" />
        </Field>
        <div className="flex items-end">
          <Button type="submit" className="w-full">
            Lọc
          </Button>
        </div>
      </form>

      {error && <Alert>{error}</Alert>}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-3 py-2">Lớp học phần</th>
              <th className="px-3 py-2">Giảng viên</th>
              <th className="px-3 py-2">Học kỳ</th>
              <th className="px-3 py-2 text-right">Buổi</th>
              <th className="px-3 py-2 text-right text-cell-valid">Hợp lệ</th>
              <th className="px-3 py-2 text-right text-yellow-700">Nghi vấn</th>
              <th className="px-3 py-2 text-right text-cell-invalid">Từ chối</th>
              <th className="px-3 py-2 text-right text-cell-excused">Có phép</th>
              <th className="px-3 py-2">Buổi gần nhất</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.classId} className="border-t border-border">
                <td className="px-3 py-2">
                  <div className="font-semibold">{r.classCode}</div>
                  <div className="text-xs text-muted-foreground">{r.courseName}</div>
                </td>
                <td className="px-3 py-2">{r.instructorName}</td>
                <td className="px-3 py-2">{r.semester ?? "—"}</td>
                <td className="px-3 py-2 text-right">{r.sessions}</td>
                <td className="px-3 py-2 text-right">{r.valid}</td>
                <td className="px-3 py-2 text-right">{r.suspect}</td>
                <td className="px-3 py-2 text-right">{r.rejected}</td>
                <td className="px-3 py-2 text-right">{r.approvedLeaves}</td>
                <td className="px-3 py-2">{r.lastSessionDate ?? "—"}</td>
              </tr>
            ))}
            {data && data.rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                  Chưa có dữ liệu điểm danh phù hợp.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{data ? `${data.total} lớp` : "Đang tải…"}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Trước
          </Button>
          <span>
            Trang {page}/{pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Sau
          </Button>
        </div>
      </div>
    </section>
  );
}
