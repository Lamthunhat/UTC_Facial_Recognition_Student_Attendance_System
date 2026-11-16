"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { SUBMIT_STAGES, submitProgress } from "@/lib/student/submit-progress";

/** Màn chờ khi gửi đăng ký thẻ: tiến trình ước lượng + các bước; không có nút nào (không gửi lại được khi đang xử lý). */
export function SubmitProgress() {
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const { percent, stage } = submitProgress(now - started);

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-muted p-4" role="status" aria-live="polite" aria-busy="true">
      <p className="flex items-center gap-2 font-semibold">
        <Loader2 className="size-5 animate-spin" aria-hidden /> Đang xử lý… (có thể mất ~10 giây)
      </p>
      <div
        role="progressbar"
        aria-label="Tiến trình xử lý (ước tính)"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 w-full overflow-hidden rounded-full bg-background"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
      <ol className="flex flex-col gap-1 text-sm">
        {SUBMIT_STAGES.map((label, i) => (
          <li key={label} className={i < stage ? "text-green-700" : i === stage ? "font-semibold" : "text-muted-foreground"}>
            {i < stage ? "✓" : i === stage ? "•" : "○"} {label}
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">Vui lòng không đóng trang hay tắt màn hình.</p>
    </div>
  );
}
