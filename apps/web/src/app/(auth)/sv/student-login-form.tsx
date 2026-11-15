"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/input";
import { useAppNavigate } from "@/components/app-link";
import { api, ApiError } from "@/lib/api";

type LoginResult = { student: { consentValid: boolean; hasActiveCard: boolean } };

/** Chỉ chuyển hướng tới trang trong khu SV (chống open redirect). */
function safeNext(next: string | null) {
  return next && next.startsWith("/sv/") && !next.startsWith("//") ? next : "/sv/lop";
}

/**
 * T062 — Mọi lý do thất bại đều cùng một thông báo của server ("Không đăng nhập được…", FR-083).
 * Chưa đồng ý điều khoản (đúng phiên bản hiện hành) → màn đồng ý trước.
 */
export function StudentLoginForm() {
  const router = useRouter();
  const navigate = useAppNavigate();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const code = String(new FormData(e.currentTarget).get("studentCode") ?? "").replace(/\s+/g, "");
    try {
      const res = await api<LoginResult>("/api/auth/student/login", { method: "POST", json: { studentCode: code } });
      const next = safeNext(params.get("next"));
      navigate(res.student.consentValid ? next : `/sv/dong-y?next=${encodeURIComponent(next)}`, { replace: true });
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        const min = err.retryAfterSec ? Math.max(1, Math.ceil(err.retryAfterSec / 60)) : null;
        setError(`Bạn đã thử quá nhiều lần. Vui lòng thử lại sau ${min ? `${min} phút` : "ít phút"}.`);
      } else if (err instanceof ApiError && err.status !== 0) {
        setError(err.message); // thông báo chung của server
      } else {
        setError("Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.");
      }
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Field label="Mã sinh viên">
        <Input
          name="studentCode"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={12}
          required
          className="py-3 text-lg tracking-wider"
          placeholder="VD: 231230801"
        />
      </Field>
      {error && <Alert>{error}</Alert>}
      <Button type="submit" disabled={pending} className="py-3 text-base">
        {pending ? "Đang đăng nhập…" : "Đăng nhập"}
      </Button>
    </form>
  );
}
