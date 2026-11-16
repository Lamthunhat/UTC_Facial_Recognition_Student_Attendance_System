"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { classifyCameraError, type CameraErrorKind } from "@/lib/student/camera-errors";

/**
 * Mở camera trực tiếp (getUserMedia) cho một <video>. Luôn tắt camera (stop mọi track) khi:
 * component bị gỡ (đổi bước / rời trang), trang bị ẩn (chuyển ứng dụng, khoá màn hình) hoặc pagehide.
 */
export type CameraState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "live" }
  | { status: "error"; kind: CameraErrorKind; message: string };

export function useCamera(facing: "environment" | "user", ideal: { width: number; height: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** Số thứ tự yêu cầu mở camera: luồng trả về muộn (đã có yêu cầu mới / đã stop / đã gỡ) bị tắt ngay — tránh rò camera. */
  const requestRef = useRef(0);
  const [state, setState] = useState<CameraState>({ status: "idle" });

  const stop = useCallback(() => {
    requestRef.current++;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setState((s) => (s.status === "error" ? s : { status: "idle" }));
  }, []);

  const start = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!window.isSecureContext) return setState({ status: "error", ...classifyCameraError("insecure") });
    if (!navigator.mediaDevices?.getUserMedia) return setState({ status: "error", ...classifyCameraError("unsupported") });
    const req = ++requestRef.current;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState({ status: "starting" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: facing }, width: { ideal: ideal.width }, height: { ideal: ideal.height } },
      });
      const v = videoRef.current;
      if (req !== requestRef.current || !v) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      v.srcObject = stream;
      await v.play().catch(() => undefined); // iOS: cần playsInline + muted
      if (req === requestRef.current) setState({ status: "live" });
    } catch (e) {
      if (req === requestRef.current) setState({ status: "error", ...classifyCameraError(e) });
    }
  }, [facing, ideal.width, ideal.height]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") stop();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", stop);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", stop);
      stop(); // tắt track; luồng đang chờ cấp quyền cũng bị tắt khi về (số thứ tự yêu cầu đã đổi)
    };
  }, [stop]);

  /** Track video đang chạy (cho ImageCapture.takePhoto / trang chẩn đoán). */
  const track = useCallback(() => streamRef.current?.getVideoTracks()[0] ?? null, []);

  return { videoRef, state, start, stop, track };
}
