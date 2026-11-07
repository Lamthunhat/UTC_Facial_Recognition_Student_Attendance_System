import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Đăng nhập giảng viên / quản trị" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Đăng nhập</h1>
        <p className="mt-1 text-sm text-muted-foreground">Dành cho giảng viên và quản trị viên.</p>
      </div>
      <Suspense>
        <LoginForm />
      </Suspense>
      <Link href="/sv" className="text-center text-sm text-primary underline-offset-4 hover:underline">
        Bạn là sinh viên? Đăng nhập tại đây
      </Link>
    </main>
  );
}
