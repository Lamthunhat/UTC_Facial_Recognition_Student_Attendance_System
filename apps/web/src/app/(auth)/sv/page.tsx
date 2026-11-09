import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { StudentLoginForm } from "./student-login-form";

export const metadata: Metadata = { title: "Sinh viên đăng nhập" };

/** T062 — Đăng nhập sinh viên bằng mã SV (FR-004). */
export default function StudentLoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Sinh viên đăng nhập</h1>
        <p className="mt-1 text-sm text-muted-foreground">Nhập mã sinh viên có trong danh sách lớp học phần của bạn.</p>
      </div>
      <Suspense>
        <StudentLoginForm />
      </Suspense>
      <Link href="/login" className="text-center text-sm text-primary underline-offset-4 hover:underline">
        Giảng viên / quản trị viên đăng nhập tại đây
      </Link>
    </main>
  );
}
