"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";

/** T037 — Admin quản lý giảng viên: tạo, khoá/mở khoá, đặt lại mật khẩu. */
interface Instructor {
  id: string;
  email: string;
  fullName: string;
  isLocked: boolean;
  classCount: number;
}

export default function InstructorsPage() {
  const [list, setList] = useState<Instructor[]>([]);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ instructors: Instructor[] }>("/api/admin/instructors");
    setList(r.instructors);
  }, []);

  useEffect(() => {
    load().catch((e) => setMsg({ tone: "error", text: e instanceof ApiError ? e.message : "Không tải được danh sách." }));
  }, [load]);

  async function run(action: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await action();
      setMsg({ tone: "success", text: ok });
      await load();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof ApiError ? e.message : "Có lỗi xảy ra." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Giảng viên</h1>

      <form
        className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          void run(
            () =>
              api("/api/admin/instructors", {
                method: "POST",
                json: { email: f.get("email"), fullName: f.get("fullName"), password: f.get("password") },
              }).then(() => form.reset()),
            "Đã tạo tài khoản giảng viên.",
          );
        }}
      >
        <Field label="Họ và tên">
          <Input name="fullName" required minLength={2} maxLength={120} />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" required maxLength={254} />
        </Field>
        <Field label="Mật khẩu ban đầu" hint="Ít nhất 10 ký tự">
          <Input name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={256} />
        </Field>
        <div className="flex items-end">
          <Button type="submit" disabled={busy} className="w-full">
            Tạo giảng viên
          </Button>
        </div>
      </form>

      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-3 py-2">Họ và tên</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2 text-right">Số lớp</th>
              <th className="px-3 py-2">Trạng thái</th>
              <th className="px-3 py-2 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {list.map((i) => (
              <tr key={i.id} className="border-t border-border">
                <td className="px-3 py-2 font-semibold">{i.fullName}</td>
                <td className="px-3 py-2">{i.email}</td>
                <td className="px-3 py-2 text-right">{i.classCount}</td>
                <td className="px-3 py-2">
                  {i.isLocked ? (
                    <span className="text-destructive">Đã khoá</span>
                  ) : (
                    <span className="text-cell-valid">Hoạt động</span>
                  )}
                </td>
                <td className="flex justify-end gap-2 px-3 py-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      const pw = window.prompt(`Mật khẩu mới cho ${i.fullName} (ít nhất 10 ký tự):`);
                      if (pw)
                        void run(
                          () => api(`/api/admin/instructors/${i.id}`, { method: "PATCH", json: { password: pw } }),
                          "Đã đặt lại mật khẩu và đăng xuất giảng viên khỏi mọi thiết bị.",
                        );
                    }}
                  >
                    Đặt lại mật khẩu
                  </Button>
                  <Button
                    size="sm"
                    variant={i.isLocked ? "outline" : "danger"}
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => api(`/api/admin/instructors/${i.id}`, { method: "PATCH", json: { isLocked: !i.isLocked } }),
                        i.isLocked ? "Đã mở khoá tài khoản." : "Đã khoá tài khoản và đăng xuất khỏi mọi thiết bị.",
                      )
                    }
                  >
                    {i.isLocked ? "Mở khoá" : "Khoá"}
                  </Button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  Chưa có giảng viên nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
