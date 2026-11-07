import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Sinh viên đăng nhập" };

/** Trang đăng nhập sinh viên bằng mã SV — triển khai ở Phase 4 (US6, T061). */
export default function StudentLoginPlaceholder() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">Sinh viên đăng nhập</h1>
      <p className="text-muted-foreground">Chức năng đang được xây dựng.</p>
      <Link href="/" className="text-sm text-primary hover:underline">
        Về trang chủ
      </Link>
    </main>
  );
}
