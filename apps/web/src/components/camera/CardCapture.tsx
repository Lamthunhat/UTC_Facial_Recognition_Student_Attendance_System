"use client";

import { Camera, ImageUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/input";
import { CARD_IMAGE, CARD_MIN_LONG_EDGE, cardGuideRect, cropLongEdgeOk, guideCrop } from "@/lib/student/image";
import { captureVideo, compressFile } from "@/lib/student/image-browser";
import { useCamera } from "./use-camera";

/**
 * T063 — Chụp mặt trước thẻ SV bằng camera sau (FR-045: chụp trực tiếp). Thẻ SV UTC là thẻ DỌC (CR80 54 × 85,6):
 * khung hướng dẫn dọc cao ~80 % vùng xem trước, căn giữa, bóng mờ bên ngoài — đúng tỉ lệ trên cả điện thoại dọc lẫn
 * webcam ngang. Ảnh gửi đi = vùng cắt theo khung (+ lề nhỏ), nén ≤ 1 MB, cạnh dài ≤ 1600 px.
 * Vùng cắt có cạnh dài < 1000 px điểm ảnh gốc (camera độ phân giải thấp) → nhắc, cho chụp lại hoặc vẫn dùng.
 * Fallback `<input capture=environment>` CHỈ trên thiết bị cảm ứng khi không mở được camera trong trang (FR-045).
 */
export function CardCapture({ onCaptured }: { onCaptured: (card: Blob) => void }) {
  const { videoRef, state, start, stop } = useCamera("environment", { width: 2560, height: 1440 });
  const viewRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<{ w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lowRes, setLowRes] = useState<{ blob: Blob; px: number } | null>(null);
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    setCoarse(window.matchMedia("(pointer: coarse)").matches);
    void start();
  }, [start]);

  // Khung hướng dẫn tính theo kích thước thật của vùng xem trước (đổi khi xoay máy / đổi cỡ cửa sổ)
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const update = () => setView({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [state.status]);

  const guide = view ? cardGuideRect(view.w, view.h) : null;

  async function capture() {
    const video = videoRef.current;
    if (!video || !view || !guide) return;
    setBusy(true);
    setError(null);
    try {
      const region = guideCrop({ videoW: video.videoWidth, videoH: video.videoHeight, viewW: view.w, viewH: view.h }, guide, 0.04);
      const blob = await captureVideo(video, CARD_IMAGE, region);
      if (!cropLongEdgeOk(region)) {
        setLowRes({ blob, px: Math.max(region.width, region.height) });
        setBusy(false);
        return;
      }
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
      <p className="text-sm">
        Chụp <strong>mặt trước thẻ sinh viên</strong> (mặt có ảnh), nơi đủ sáng, không bị loá, rồi bấm Chụp.
      </p>
      {!failed && (
        <div ref={viewRef} className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-black sm:aspect-video">
          <video ref={videoRef} className="absolute inset-0 size-full object-cover" playsInline muted autoPlay aria-label="Camera sau" />
          {guide && (
            <>
              <div
                aria-hidden
                className="absolute rounded-xl border-[3px] border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
                style={{ left: guide.x, top: guide.y, width: guide.width, height: guide.height }}
              />
              <p
                className="absolute inset-x-2 text-center text-xs font-semibold text-white drop-shadow"
                style={{ top: guide.y + guide.height + 4 }}
              >
                Đặt thẻ dọc vừa khung, mặt có ảnh hướng lên
              </p>
            </>
          )}
          {state.status === "starting" && <p className="absolute inset-0 grid place-items-center text-sm text-white">Đang mở camera…</p>}
        </div>
      )}
      {failed && <Alert>{state.message}</Alert>}
      {error && <Alert>{error}</Alert>}
      {lowRes && (
        <div className="flex flex-col gap-2">
          <Alert>
            Ảnh thẻ chưa đủ nét ({lowRes.px} px, cần ≥ {CARD_MIN_LONG_EDGE} px): đưa thẻ lại gần cho vừa khung, giữ chắc tay. Camera máy
            này có độ phân giải thấp — nếu được, hãy dùng camera điện thoại.
          </Alert>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setLowRes(null)}>
              Chụp lại
            </Button>
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => {
                const b = lowRes.blob;
                setLowRes(null);
                stop();
                onCaptured(b);
              }}
            >
              Vẫn dùng ảnh này
            </Button>
          </div>
        </div>
      )}
      {!lowRes && (
        <div className="flex flex-wrap gap-2">
          {!failed && (
            <Button onClick={capture} disabled={state.status !== "live" || busy || !guide} className="flex-1 py-3 text-base">
              <Camera className="size-5" aria-hidden /> {busy ? "Đang xử lý…" : "Chụp"}
            </Button>
          )}
          {(failed || state.status === "idle") && (
            <Button variant="outline" onClick={() => void start()} className="flex-1">
              Mở lại camera
            </Button>
          )}
        </div>
      )}
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
