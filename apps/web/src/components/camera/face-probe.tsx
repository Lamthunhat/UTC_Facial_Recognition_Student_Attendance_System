"use client";

import type { FaceDetector } from "@mediapipe/tasks-vision";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/input";
import { detectPose, faceDetectorInitMs, loadFaceDetector } from "@/lib/student/face-detector";
import { CLIENT_YAW, SERVER_YAW, YAW_SCALE, type YawThresholds } from "@utc/shared/face-yaw";
import { classifyYaw } from "@/lib/student/face-pose";
import { useCamera } from "./use-camera";

/**
 * Trang chẩn đoán: thử bộ hướng dẫn khuôn mặt (MediaPipe Face Detector) bằng camera trước — yaw client REALTIME, phân
 * loại theo ngưỡng client và ngưỡng server, min/max yaw đã thấy, thời gian tải/khởi tạo + dung lượng tải. Dùng để hiệu
 * chỉnh ngưỡng bằng mặt thật. Không chụp, không gửi, không lưu ảnh nào.
 */
const POSE_VI = { left: "trái", right: "phải", center: "thẳng", too_far: "QUÁ MẠNH", unclear: "chưa rõ" } as const;
const fmt = (t: YawThresholds) => `thẳng ≤ ${t.centerMax} · quay ${t.turnMin}–${t.turnMax} · > ${t.turnMax} quá mạnh`;

export function FaceProbe() {
  const { videoRef, state, start, stop } = useCamera("user", { width: 1280, height: 720 });
  const [phase, setPhase] = useState<"idle" | "loading" | "running" | "failed">("idle");
  const [load, setLoad] = useState<string | null>(null);
  const [live, setLive] = useState<{ faces: number; yaw: number | null; fps: number } | null>(null);
  const [range, setRange] = useState<{ min: number; max: number } | null>(null);
  const raf = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    },
    [],
  );

  function loop(fd: FaceDetector) {
    let last = 0;
    let frames = 0;
    let windowStart = performance.now();
    let fps = 0;
    const tick = () => {
      const video = videoRef.current;
      const now = performance.now();
      if (video && video.readyState >= 2 && now - last >= 80) {
        last = now;
        frames++;
        if (now - windowStart >= 1000) {
          fps = Math.round((frames * 1000) / (now - windowStart));
          frames = 0;
          windowStart = now;
        }
        const { faces, yaw } = detectPose(fd, video, now);
        setLive({ faces, yaw, fps });
        if (faces === 1 && yaw !== null) setRange((r) => ({ min: Math.min(r?.min ?? yaw, yaw), max: Math.max(r?.max ?? yaw, yaw) }));
      }
      raf.current = requestAnimationFrame(tick);
    };
    tick();
  }

  async function run() {
    setPhase("loading");
    const t0 = performance.now();
    void start();
    const fd = await loadFaceDetector();
    if (!fd) {
      setPhase("failed");
      return;
    }
    const res = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter((r) => r.name.includes("/mediapipe/"));
    const mb = (n: number) => (n / 1e6).toFixed(2);
    const transfer = res.reduce((a, r) => a + (r.transferSize || 0), 0);
    const body = res.reduce((a, r) => a + (r.decodedBodySize || 0), 0);
    setLoad(
      `Sẵn sàng sau ${Math.round(performance.now() - t0)} ms (khởi tạo ${faceDetectorInitMs() ?? "?"} ms) · tải ${mb(transfer)} MB qua mạng, ${mb(body)} MB sau giải nén (${res.length} file; 0 = lấy từ cache)`,
    );
    setPhase("running");
    loop(fd);
  }

  function end() {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    stop();
    setPhase("idle");
    setLive(null);
  }

  const yaw = live?.yaw ?? null;
  const rows: [string, string][] = live
    ? [
        ["Số mặt", String(live.faces)],
        ["Yaw (client)", yaw === null ? "—" : yaw.toFixed(3)],
        ["Theo ngưỡng client", `${POSE_VI[classifyYaw(yaw, CLIENT_YAW)]} (${fmt(CLIENT_YAW)})`],
        ["Theo ngưỡng server", `${POSE_VI[classifyYaw(yaw, SERVER_YAW)]} (${fmt(SERVER_YAW)})`],
        ["Yaw nhỏ nhất / lớn nhất", range ? `${range.min.toFixed(3)} / ${range.max.toFixed(3)}` : "—"],
        ["Tốc độ nhận diện", `${live.fps} khung/giây`],
      ]
    : [];

  return (
    <section className="flex flex-col gap-3" aria-labelledby="face-probe">
      <h2 id="face-probe" className="text-lg font-semibold">
        Bộ hướng dẫn khuôn mặt (camera trước)
      </h2>
      <p className="text-xs text-muted-foreground">
        Thang yaw [-1, 1] = {YAW_SCALE} × (mũi − tâm 2 mắt) / bề rộng khung mặt (≈ sin góc quay). Quay sang TRÁI của bạn → dương;
        sang phải → âm. Không chụp, không gửi ảnh.
      </p>
      {phase !== "idle" && (
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-black sm:aspect-video">
          <video ref={videoRef} className="absolute inset-0 size-full -scale-x-100 object-cover" playsInline muted autoPlay aria-label="Camera trước" />
          {yaw !== null && (
            <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 font-mono text-lg text-white" aria-live="off">
              yaw {yaw.toFixed(3)}
            </span>
          )}
        </div>
      )}
      {state.status === "error" && <Alert>{state.message}</Alert>}
      {phase === "failed" && <Alert>Không tải được bộ hướng dẫn khuôn mặt — khi đăng ký thẻ sẽ dùng đếm ngược.</Alert>}
      {load && <p className="text-sm">{load}</p>}
      {rows.length > 0 && (
        <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-3 gap-y-1 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex flex-wrap gap-2">
        {phase === "idle" || phase === "failed" ? (
          <Button variant="outline" onClick={() => void run()}>
            Thử bộ hướng dẫn khuôn mặt
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={() => setRange(null)} disabled={phase !== "running"}>
              Đặt lại min/max
            </Button>
            <Button variant="ghost" onClick={end}>
              Dừng
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
