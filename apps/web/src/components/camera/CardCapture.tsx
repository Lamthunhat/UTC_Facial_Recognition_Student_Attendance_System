"use client";

import { Camera } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/input";
import { CARD_IMAGE, cardCropVerdict, cardGuideRect, guideCrop } from "@/lib/student/image";
import { captureCard } from "@/lib/student/image-browser";
import { detectInAppBrowser, inAppBrowserHint } from "@/lib/student/webview";
import { useCamera } from "./use-camera";

/**
 * T063 — Chụp mặt trước thẻ SV bằng camera sau, CHỈ chụp trực tiếp trong trang (FR-045: không có chọn file / ứng dụng
 * camera). Thẻ SV UTC là thẻ DỌC (CR80 54 × 85,6): khung hướng dẫn dọc cao ~80 % vùng xem, căn giữa, bóng mờ ngoài.
 * Ảnh gửi = vùng cắt theo khung (ImageCapture.takePhoto nếu được, không thì khung video), nén ≤ 1 MB.
 * Cạnh dài vùng cắt (điểm ảnh gốc): < 500 chặn · 500–999 cảnh báo + "Vẫn dùng ảnh này" · ≥ 1000 dùng luôn (research R3).
 * Mở trong webview (Zalo, Facebook…) → hướng dẫn mở bằng Chrome/Safari.
 */
export function CardCapture({ onCaptured }: { onCaptured: (card: Blob) => void }) {
  const { videoRef, state, start, stop, track } = useCamera("environment", { width: 2560, height: 1440 });
  const viewRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<{ w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [small, setSmall] = useState<{ blob: Blob; px: number } | null>(null);
  const [webview, setWebview] = useState<string | null>(null);

  useEffect(() => {
    setWebview(detectInAppBrowser(navigator.userAgent));
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
      const shot = await captureCard(video, track(), region, CARD_IMAGE);
      const verdict = cardCropVerdict(shot.longEdge);
      setBusy(false);
      if (verdict === "block") {
        setError(`Ảnh thẻ quá nhỏ (${shot.longEdge} px) — không đọc được. Hãy dùng camera điện thoại để chụp thẻ.`);
        return;
      }
      if (verdict === "warn") {
        setSmall({ blob: shot.blob, px: shot.longEdge });
        return;
      }
      stop();
      onCaptured(shot.blob);
    } catch {
      setError("Không chụp được ảnh. Vui lòng thử lại.");
      setBusy(false);
    }
  }

  const failed = state.status === "error";
  return (
    <div className="flex flex-col gap-3">
      {webview && <Alert>{inAppBrowserHint(webview)}</Alert>}
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
      {small ? (
        <div className="flex flex-col gap-2">
          <Alert>Ảnh hơi nhỏ ({small.px} px), nên dùng camera điện thoại để mã và chữ trên thẻ đọc được chắc chắn.</Alert>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setSmall(null)}>
              Chụp lại
            </Button>
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => {
                const b = small.blob;
                setSmall(null);
                stop();
                onCaptured(b);
              }}
            >
              Vẫn dùng ảnh này
            </Button>
          </div>
        </div>
      ) : (
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
    </div>
  );
}
