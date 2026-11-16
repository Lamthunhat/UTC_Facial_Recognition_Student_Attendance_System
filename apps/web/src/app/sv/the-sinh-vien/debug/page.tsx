"use client";

import { useEffect, useState } from "react";
import { FaceProbe } from "@/components/camera/face-probe";
import { LivenessProbe } from "@/components/camera/liveness-probe";
import { useCamera } from "@/components/camera/use-camera";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/input";
import { cardCropVerdict, cardGuideRect, guideCrop } from "@/lib/student/image";
import { imageCaptureSupported, takePhotoBitmap } from "@/lib/student/image-browser";
import { detectInAppBrowser } from "@/lib/student/webview";

/**
 * Chẩn đoán camera cho việc chụp thẻ (thử trên điện thoại thật): môi trường trình duyệt, độ phân giải luồng camera sau,
 * khả năng ImageCapture, cạnh dài vùng thẻ sẽ cắt ra. CHỈ đo trên máy — không gửi, không lưu ảnh (ảnh takePhoto chỉ đọc
 * kích thước rồi huỷ ngay). Riêng mục "Thử liveness" (chỉ preview/dev) gửi 3 khung mặt lên server để chấm — server không lưu.
 */
type Row = [string, string];

export default function CameraDebugPage() {
  const { videoRef, state, start, stop, track } = useCamera("environment", { width: 2560, height: 1440 });
  const [env, setEnv] = useState<Row[]>([]);
  const [cam, setCam] = useState<Row[]>([]);
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    document.title = "Chẩn đoán camera";
    setEnv([
      ["Trình duyệt nhúng (webview)", detectInAppBrowser(navigator.userAgent) ?? "không"],
      ["Kết nối an toàn (https)", window.isSecureContext ? "có" : "KHÔNG"],
      ["getUserMedia", typeof navigator.mediaDevices?.getUserMedia === "function" ? "có" : "KHÔNG"],
      ["ImageCapture (takePhoto)", imageCaptureSupported() ? "có" : "không"],
      ["Màn hình", `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`],
      ["User agent", navigator.userAgent],
    ]);
  }, []);

  function measure() {
    const t = track();
    const v = videoRef.current;
    const box = v?.parentElement;
    if (!t || !v || !box) return;
    const s = t.getSettings();
    const caps = (t.getCapabilities?.() ?? {}) as MediaTrackCapabilities;
    const viewW = box.clientWidth;
    const viewH = box.clientHeight;
    const region = guideCrop({ videoW: v.videoWidth, videoH: v.videoHeight, viewW, viewH }, cardGuideRect(viewW, viewH), 0.04);
    const long = Math.max(region.width, region.height);
    setCam([
      ["Luồng video", `${v.videoWidth}×${v.videoHeight}`],
      ["Cài đặt track", `${s.width}×${s.height}, facingMode=${s.facingMode ?? "?"}, fps=${s.frameRate ?? "?"}`],
      ["Tối đa camera hỗ trợ", caps.width && caps.height ? `${caps.width.max}×${caps.height.max}` : "?"],
      ["Vùng thẻ cắt từ video", `${region.width}×${region.height} (cạnh dài ${long} px → ${cardCropVerdict(long)})`],
    ]);
  }

  async function testPhoto() {
    setPhoto("Đang chụp thử…");
    const bmp = await takePhotoBitmap(track());
    if (!bmp) return setPhoto("takePhoto không dùng được — sẽ chụp từ khung video.");
    const v = videoRef.current;
    const msg = `takePhoto: ${bmp.width}×${bmp.height}${v ? ` (video ${v.videoWidth}×${v.videoHeight})` : ""}`;
    bmp.close(); // huỷ ngay, không lưu
    setPhoto(msg);
  }

  const table = (rows: Row[]) => (
    <dl className="grid grid-cols-[minmax(0,8rem)_1fr] gap-x-3 gap-y-1 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Chẩn đoán camera</h1>
      <p className="text-sm text-muted-foreground">
        Các phép đo chạy trên máy của bạn, không gửi ảnh — trừ mục “Thử liveness” (gửi 3 khung để server chấm, không lưu).
      </p>
      {table(env)}
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-black sm:aspect-video">
        <video ref={videoRef} className="absolute inset-0 size-full object-cover" playsInline muted autoPlay aria-label="Camera sau" />
      </div>
      {state.status === "error" && <Alert>{state.message}</Alert>}
      <div className="flex flex-wrap gap-2">
        {state.status !== "live" ? (
          <Button onClick={() => void start()}>Mở camera sau</Button>
        ) : (
          <>
            <Button onClick={measure}>Đo</Button>
            <Button variant="outline" onClick={() => void testPhoto()}>
              Thử takePhoto
            </Button>
            <Button variant="ghost" onClick={stop}>
              Tắt camera
            </Button>
          </>
        )}
      </div>
      {cam.length > 0 && table(cam)}
      {photo && <p className="text-sm">{photo}</p>}
      <FaceProbe />
      <LivenessProbe />
    </section>
  );
}
