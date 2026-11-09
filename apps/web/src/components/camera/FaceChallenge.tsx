"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/input";
import { poseSteps, type Challenge } from "@/lib/student/challenge";
import { FACE_FRAME } from "@/lib/student/image";
import { captureVideo } from "@/lib/student/image-browser";
import { cn } from "@/lib/utils";
import { useCamera } from "./use-camera";

/**
 * T063 / FR-045a — Chụp 3 khung mặt trực tiếp bằng camera trước theo thử thách của server:
 * [quay hướng 1, nhìn thẳng, quay hướng 2]; mỗi khung có chữ + mũi tên + đếm ngược 3 giây.
 * Xem trước lật như gương (tự nhiên với camera trước); ảnh chụp lấy từ luồng gốc (không lật) — đúng quy ước server.
 * Khung ~720p, nén ≤ 0,9 MB. Camera tắt ngay sau khung cuối; khung chỉ được trao cho onComplete (không lưu lại).
 */
const COUNTDOWN = 3;

export function FaceChallenge({ challenge, onComplete }: { challenge: Challenge; onComplete: (frames: Blob[]) => void }) {
  const { videoRef, state, start, stop } = useCamera("user", { width: 1280, height: 720 });
  const steps = poseSteps(challenge);
  const [run, setRun] = useState<{ index: number; count: number; flash: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    void start();
    return () => {
      cancelled.current = true;
    };
  }, [start]);

  async function begin() {
    const video = videoRef.current;
    if (!video) return;
    setError(null);
    const frames: Blob[] = [];
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      for (let i = 0; i < steps.length; i++) {
        for (let c = COUNTDOWN; c > 0; c--) {
          if (cancelled.current) return;
          setRun({ index: i, count: c, flash: false });
          await wait(1000);
        }
        if (cancelled.current) return;
        frames.push(await captureVideo(video, FACE_FRAME));
        setRun({ index: i, count: 0, flash: true });
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
          <div aria-hidden className="absolute left-1/2 top-[45%] h-[62%] w-[58%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-[3px] border-white/80 sm:w-[34%]" />
          {step && (
            <div className="absolute inset-x-0 top-0 flex flex-col items-center gap-1 bg-black/55 p-3 text-white" aria-live="assertive">
              <span className="text-xs">Khung {run!.index + 1}/3</span>
              <span className="text-lg font-semibold">{step.label}</span>
              <span aria-hidden className="text-5xl leading-none">{step.arrow}</span>
            </div>
          )}
          {run && (
            <div
              aria-hidden
              className={cn(
                "absolute inset-x-0 bottom-4 text-center text-6xl font-semibold text-white drop-shadow",
                run.flash && "text-green-300",
              )}
            >
              {run.flash ? "✓" : run.count}
            </div>
          )}
          {state.status === "starting" && <p className="absolute inset-0 grid place-items-center text-sm text-white">Đang mở camera…</p>}
        </div>
      )}
      {failed && <Alert>{state.message}</Alert>}
      {error && <Alert>{error}</Alert>}
      {!run &&
        (failed ? (
          <Button variant="outline" onClick={() => void start()}>
            Mở lại camera
          </Button>
        ) : (
          <Button onClick={() => void begin()} disabled={state.status !== "live"} className="py-3 text-base">
            Bắt đầu chụp khuôn mặt
          </Button>
        ))}
    </div>
  );
}
