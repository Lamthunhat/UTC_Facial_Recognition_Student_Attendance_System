"use client";

import { Camera, ImageUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/input";
import { CARD_IMAGE, guideCrop } from "@/lib/student/image";
import { captureVideo, compressFile } from "@/lib/student/image-browser";
import { useCamera } from "./use-camera";

/**
 * T063 — Chụp mặt trước thẻ SV bằng camera sau (FR-045: chụp trực tiếp). Khung hướng dẫn theo tỉ lệ thẻ ISO ID-1
 * (85,6 × 54 mm); chỉ phần trong khung (+ lề) được cắt và nén ≤ 1 MB, cạnh dài ~1600 px.
 * Fallback `<input capture=environment>` CHỈ trên thiết bị cảm ứng khi không mở được camera trong trang — trên
 * điện thoại thuộc tính capture mở thẳng ứng dụng camera; trên máy tính sẽ thành hộp chọn file nên không hiện (FR-045).
 */
const CARD_RATIO = 85.6 / 54;

export function CardCapture({ onCaptured }: { onCaptured: (card: Blob) => void }) {
  const { videoRef, state, start, stop } = useCamera("environment", { width: 1920, height: 1080 });
  const viewRef = useRef<HTMLDivElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    setCoarse(window.matchMedia("(pointer: coarse)").matches);
    void start();
  }, [start]);

  async function capture() {
    const video = videoRef.current;
    const view = viewRef.current?.getBoundingClientRect();
    const guide = guideRef.current?.getBoundingClientRect();
    if (!video || !view || !guide) return;
    setBusy(true);
    setError(null);
    try {
      const region = guideCrop(
        { videoW: video.videoWidth, videoH: video.videoHeight, viewW: view.width, viewH: view.height },
        { x: guide.left - view.left, y: guide.top - view.top, width: guide.width, height: guide.height },
      );
      const blob = await captureVideo(video, CARD_IMAGE, region);
      stop();
      onCaptured(blob);
    } catch {
      setError("Không chụp được ảnh. Vui lòng thử lại.");
      setBusy(false);
    }
  }

  async function fromFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onCaptured(await compressFile(file, CARD_IMAGE));
    } catch {
      setError("Không đọc được ảnh vừa chụp. Vui lòng chụp lại.");
      setBusy(false);
    }
  }

  const failed = state.status === "error";
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">Đặt <strong>mặt trước thẻ sinh viên</strong> nằm gọn trong khung, nơi đủ sáng, không bị loá, rồi bấm Chụp.</p>
      {!failed && (
        <div ref={viewRef} className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-black sm:aspect-video">
          <video ref={videoRef} className="absolute inset-0 size-full object-cover" playsInline muted autoPlay aria-label="Camera sau" />
          <div
            ref={guideRef}
            aria-hidden
            className="absolute left-1/2 top-1/2 w-[88%] -translate-x-1/2 -translate-y-1/2 rounded-xl border-[3px] border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
            style={{ aspectRatio: CARD_RATIO }}
          />
          <p className="absolute inset-x-0 bottom-3 text-center text-xs font-semibold text-white drop-shadow">Căn thẻ vào khung</p>
          {state.status === "starting" && <p className="absolute inset-0 grid place-items-center text-sm text-white">Đang mở camera…</p>}
        </div>
      )}
      {failed && <Alert>{state.message}</Alert>}
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        {!failed && (
          <Button onClick={capture} disabled={state.status !== "live" || busy} className="flex-1 py-3 text-base">
            <Camera className="size-5" aria-hidden /> {busy ? "Đang xử lý…" : "Chụp"}
          </Button>
        )}
        {(failed || state.status === "idle") && (
          <Button variant="outline" onClick={() => void start()} className="flex-1">
            Mở lại camera
          </Button>
        )}
      </div>
      {failed && coarse && (
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-border px-4 py-3 text-sm font-semibold hover:bg-muted">
          <ImageUp className="size-5" aria-hidden /> Chụp bằng ứng dụng camera của máy
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={busy}
            onChange={(e) => void fromFile(e.currentTarget.files?.[0])}
          />
        </label>
      )}
    </div>
  );
}
