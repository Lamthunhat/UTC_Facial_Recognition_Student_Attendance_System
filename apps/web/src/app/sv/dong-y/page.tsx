"use client";

import { CONSENT_TEXT, CONSENT_VERSION } from "@utc/shared/consent";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";

/** T063 / FR-050 — Đồng ý thu thập & xử lý dữ liệu sinh trắc trước khi chụp thẻ. Văn bản + phiên bản từ @utc/shared/consent. */
function ConsentForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [agreed, setAgreed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Đồng ý điều khoản dữ liệu";
  }, []);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      await api("/api/student/consent", { method: "POST", json: { version: CONSENT_VERSION } });
      const next = params.get("next");
      router.replace(next && next.startsWith("/sv/") && !next.startsWith("//") ? next : "/sv/lop");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) router.replace("/sv?next=/sv/dong-y");
      setError(e instanceof ApiError && e.status !== 0 ? e.message : "Không kết nối được máy chủ. Vui lòng thử lại.");
      setPending(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Đồng ý xử lý dữ liệu khuôn mặt</h1>
      <div className="flex flex-col gap-2 rounded-lg border border-border p-4 text-sm leading-relaxed">
        {CONSENT_TEXT.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
        <p className="text-xs text-muted-foreground">Phiên bản văn bản: {CONSENT_VERSION}</p>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={agreed} onChange={(e) => setAgreed(e.currentTarget.checked)} />
        <span>Tôi đã đọc và đồng ý cho nhà trường thu thập, xử lý ảnh thẻ và ảnh khuôn mặt của tôi cho mục đích điểm danh như trên.</span>
      </label>
      {error && <Alert>{error}</Alert>}
      <Button onClick={() => void submit()} disabled={!agreed || pending} className="py-3 text-base">
        {pending ? "Đang lưu…" : "Đồng ý và tiếp tục"}
      </Button>
    </section>
  );
}

export default function ConsentPage() {
  return (
    <Suspense>
      <ConsentForm />
    </Suspense>
  );
}
