"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "./button";
import { Alert } from "./input";

/**
 * Hộp xác nhận dùng <dialog> gốc (showModal: khoá nền, Esc để đóng, focus trong hộp).
 * Tuỳ chọn ô nhập (lý do / ghi chú) — `textRequired` bắt buộc nhập trước khi xác nhận.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  tone = "primary",
  textLabel,
  textRequired = false,
  pending = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  textLabel?: string;
  textRequired?: boolean;
  pending?: boolean;
  error?: string | null;
  onConfirm: (text: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setText("");
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  // Bắt buộc: ≥ 3 ký tự (khớp schema server cho lý do đặt lại thẻ)
  const blocked = pending || (textRequired && text.trim().length < 3);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <form
        method="dialog"
        className="flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!blocked) onConfirm(text.trim());
        }}
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <div className="text-sm">{description}</div>
        {textLabel && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">
              {textLabel}
              {textRequired ? "" : " (tuỳ chọn)"}
            </span>
            <textarea
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              maxLength={500}
              rows={3}
              className="rounded-lg border border-border px-3 py-2 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
        )}
        {error && <Alert>{error}</Alert>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            Huỷ
          </Button>
          <Button type="submit" variant={tone === "danger" ? "danger" : "primary"} disabled={blocked}>
            {pending ? "Đang xử lý…" : confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
