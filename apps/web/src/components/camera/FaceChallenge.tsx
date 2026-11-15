"use client";

import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/input";
import { poseSteps, type Challenge } from "@/lib/student/challenge";
import { loadFaceLandmarker } from "@/lib/student/face-landmarker";
import { createPoseTracker, yawFromLandmarks } from "@/lib/student/face-pose";
import { FACE_FRAME } from "@/lib/student/image";
import { captureVideo } from "@/lib/student/image-browser";
import { cn } from "@/lib/utils";
import { useCamera } from "./use-camera";

/**
 * T063 / FR-045a — Chụp 3 khung mặt trực tiếp bằng camera trước theo thử thách của server:
 * [quay hướng 1, nhìn thẳng, quay hướng 2].
 * - Có MediaPipe Face Landmarker (tự host): ước lượng yaw realtime (cùng quy ước server), hướng dẫn "Không thấy khuôn
 *   mặt / Quay thêm sang trái|phải / Nhìn thẳng / Giữ yên", TỰ CHỤP khi đạt góc và ổn định ~300 ms; quá 10 s mỗi khung
 *   thì nhắc lại (và hiện nút chụp theo đếm ngược cho khung đó).
 * - Model không tải được → đếm ngược 3 giây mỗi khung như trước.
 * Client chỉ HƯỚNG DẪN — server vẫn quyết định liveness. Xem trước lật như gương; ảnh chụp lấy từ luồng gốc (không lật).
 * Khung ~720p, nén ≤ 0,9 MB. Camera tắt ngay sau khung cuối; khung chỉ được trao cho onComplete (không lưu lại).
 */
const COUNTDOWN = 3;
const DETECT_EVERY_MS = 80;
/** Tải model quá lâu (mạng yếu) → không chờ nữa, dùng đếm ngược. */
const MODEL_LOAD_TIMEOUT_MS = 15_000;

type Run = { index: number; count: number | null; flash: boolean; guide: string | null; hold: boolean; notice: string | null };

export function FaceChallenge({ challenge, onComplete }: { challenge: Challenge; onComplete: (frames: Blob[]) => void }) {
  const { videoRef, state, start, stop } = useCamera("user", { width: 1280, height: 720 });
  const steps = poseSteps(challenge);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<"loading" | "ready" | "unavailable">("loading");
  const [canFallback, setCanFallback] = useState(false);
  const landmarker = useRef<FaceLandmarker | null>(null);
  const cancelled = useRef(false);
  const raf = useRef<number | null>(null);
  const fallbackNow = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    void start();
    let alive = true;
    void Promise.race([loadFaceLandmarker(), new Promise<null>((r) => setTimeout(() => r(null), MODEL_LOAD_TIMEOUT_MS))]).then((lm) => {
      if (!alive) return;
      landmarker.current = lm;
      setModel(lm ? "ready" : "unavailable");
    });
    return () => {
      alive = false;
      cancelled.current = true;
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [start]);

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function countdownStep(video: HTMLVideoElement, i: number): Promise<Blob | null> {
    for (let c = COUNTDOWN; c > 0; c--) {
      if (cancelled.current) return null;
      setRun({ index: i, count: c, flash: false, guide: null, hold: false, notice: null });
      await wait(1000);
    }
    return cancelled.current ? null : captureVideo(video, FACE_FRAME);
  }

  /** Tự chụp theo hướng dẫn; trả "countdown" nếu SV chọn chụp theo đếm ngược cho khung này. */
  function guidedStep(video: HTMLVideoElement, lm: FaceLandmarker, i: number): Promise<Blob | "countdown" | null> {
    const tracker = createPoseTracker(steps[i].pose, performance.now());
    fallbackNow.current = false;
    let last = 0;
    let notice: string | null = null;
    return new Promise((resolve, reject) => {
      const tick = () => {
        if (cancelled.current) return resolve(null);
        if (fallbackNow.current) return resolve("countdown");
        const now = performance.now();
        if (now - last >= DETECT_EVERY_MS && video.readyState >= 2) {
          last = now;
          let faces = 0;
          let yaw: number | null = null;
          try {
            const res = lm.detectForVideo(video, now);
            faces = res.faceLandmarks.length;
            yaw = faces === 1 ? yawFromLandmarks(res.faceLandmarks[0], video.videoWidth, video.videoHeight) : faces > 1 ? 0 : null;
          } catch {
            /* khung lỗi → coi như không thấy mặt */
          }
          const r = tracker.feed(now, faces, yaw);
          if (r.status === "capture") {
            captureVideo(video, FACE_FRAME).then(resolve, reject);
            return;
          }
          if (r.status === "timeout") {
            notice = r.message; // nhắc lại, giữ trên màn hình tới khi chụp được
            setCanFallback(true);
          }
          setRun({ index: i, count: null, flash: false, guide: r.status === "timeout" ? null : r.message, hold: r.status === "hold", notice });
        }
        raf.current = requestAnimationFrame(tick);
      };
      tick();
    });
  }

  async function begin() {
    const video = videoRef.current;
    if (!video) return;
    setError(null);
    setCanFallback(false);
    const frames: Blob[] = [];
    try {
      for (let i = 0; i < steps.length; i++) {
        const lm = landmarker.current;
        let shot: Blob | "countdown" | null = lm ? await guidedStep(video, lm, i) : await countdownStep(video, i);
        if (shot === "countdown") shot = await countdownStep(video, i);
        if (!shot || cancelled.current) return;
        frames.push(shot);
        setCanFallback(false);
        setRun({ index: i, count: null, flash: true, guide: null, hold: false, notice: null });
        await wait(350);
      }
      stop();
      setRun(null);
      onComplete(frames.splice(0)); // trao khung đi, không giữ lại bản nào trong component
    } catch {
      frames.length = 0;
      setRun(null);
      setError("Không chụp được khung hình. Vui lòng thử lại.");
    }
  }

  const step = run ? steps[run.index] : null;
  const failed = state.status === "error";
  return (
    <div className="flex flex-col gap-3">
      {!run && (
        <ol className="flex flex-col gap-1 text-sm">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded-full bg-muted text-xs font-semibold">{i + 1}</span>
              <span aria-hidden className="w-5 text-center font-semibold">{s.arrow}</span>
              {s.label}
            </li>
          ))}
        </ol>
      )}
      {!run && !failed && (
        <p className="text-xs text-muted-foreground">
          {model === "loading"
            ? "Đang tải bộ hướng dẫn khuôn mặt…"
            : model === "ready"
              ? "Làm theo hướng dẫn trên màn hình — hệ thống tự chụp khi bạn giữ đúng tư thế."
              : "Mỗi khung được chụp sau 3 giây đếm ngược."}
        </p>
      )}
      {!failed && (
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-black sm:aspect-video">
          <video
            ref={videoRef}
            className="absolute inset-0 size-full -scale-x-100 object-cover"
            playsInline
            muted
            autoPlay
            aria-label="Camera trước"
          />
          <div
            aria-hidden
            className={cn(
              "absolute left-1/2 top-[45%] h-[62%] w-[58%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-[3px] sm:w-[34%]",
              run?.hold ? "border-green-400" : "border-white/80",
            )}
          />
          {step && (
            <div className="absolute inset-x-0 top-0 flex flex-col items-center gap-1 bg-black/55 p-3 text-white" aria-live="assertive">
              <span className="text-xs">Khung {run!.index + 1}/3</span>
              <span className="text-lg font-semibold">{step.label}</span>
              <span aria-hidden className="text-5xl leading-none">{step.arrow}</span>
            </div>
          )}
          {run && (run.guide || run.notice) && (
            <div className="absolute inset-x-3 bottom-16 flex flex-col items-center gap-1 text-center" aria-live="polite">
              {run.notice && <span className="rounded-md bg-amber-500/90 px-2 py-1 text-sm font-semibold text-black">{run.notice}</span>}
              {run.guide && (
                <span className={cn("rounded-md px-3 py-1 text-base font-semibold", run.hold ? "bg-green-600 text-white" : "bg-black/60 text-white")}>
                  {run.guide}
                </span>
              )}
            </div>
          )}
          {run && (run.count !== null || run.flash) && (
            <div
              aria-hidden
              className={cn("absolute inset-x-0 bottom-4 text-center text-6xl font-semibold text-white drop-shadow", run.flash && "text-green-300")}
            >
              {run.flash ? "✓" : run.count}
            </div>
          )}
          {state.status === "starting" && <p className="absolute inset-0 grid place-items-center text-sm text-white">Đang mở camera…</p>}
        </div>
      )}
      {failed && <Alert>{state.message}</Alert>}
      {error && <Alert>{error}</Alert>}
      {run && canFallback && run.count === null && !run.flash && (
        <Button variant="outline" onClick={() => (fallbackNow.current = true)}>
          Chụp theo đếm ngược
        </Button>
      )}
      {!run &&
        (failed ? (
          <Button variant="outline" onClick={() => void start()}>
            Mở lại camera
          </Button>
        ) : (
          <Button onClick={() => void begin()} disabled={state.status !== "live" || model === "loading"} className="py-3 text-base">
            Bắt đầu chụp khuôn mặt
          </Button>
        ))}
    </div>
  );
}
