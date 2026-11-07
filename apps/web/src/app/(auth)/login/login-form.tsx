"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";

type LoginResult = { user: { role: "admin" | "instructor"; fullName: string } };

/** Chỉ cho chuyển hướng tới đường dẫn nội bộ (chống open redirect). */
function safeNext(next: string | null, role: string) {
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    if (role === "admin" || !next.startsWith("/admin")) return next;
  }
  return role === "admin" ? "/admin" : "/gv";
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    try {
      const res = await api<LoginResult>("/api/auth/staff/login", {
        method: "POST",
        json: { email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") },
      });
      router.replace(safeNext(params.get("next"), res.user.role));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không kết nối được máy chủ.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="Email">
        <Input name="email" type="email" autoComplete="username" required maxLength={254} />
      </Field>
      <Field label="Mật khẩu">
        <Input name="password" type="password" autoComplete="current-password" required maxLength={256} />
      </Field>
      {error && <Alert>{error}</Alert>}
      <Button type="submit" disabled={pending}>
        {pending ? "Đang đăng nhập…" : "Đăng nhập"}
      </Button>
    </form>
  );
}
