"use client";

import { useState } from "react";
import { FaceChallenge } from "@/components/camera/FaceChallenge";
import { YawDebugTable } from "@/components/student/yaw-debug-table";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { isChallenge, type Challenge } from "@/lib/student/challenge";
import { clientYawField, parseProbeResult, type YawDebugReport } from "@/lib/student/yaw-debug";

/**
 * Trang chẩn đoán — thử liveness KHÔNG tốn lượt đăng ký thẻ (CHỈ preview/dev; production API trả 404 → báo không có).
 * Đúng luồng chụp thật (FaceChallenge theo thử thách của server) rồi gửi 3 khung + yaw client tới
 * POST /api/student/liveness-probe; server chạy cùng pipeline liveness như đăng ký thẻ và trả bảng so sánh yaw.
 * Server không lưu ảnh/embedding; bộ đếm riêng 30 lượt/giờ.
 */
type State =
  | { step: "idle" }
  | { step: "loading" }
  | { step: "face"; nonce: string; challenge: Challenge }
  | { step: "sending" }
  | { step: "result"; passed: boolean; report: YawDebugReport }
  | { step: "error"; message: string };

export function LivenessProbe() {
  const [s, setS] = useState<State>({ step: "idle" });

  async function start() {
    setS({ step: "loading" });
    try {
      const r = await api<{ nonce: string; challenge: unknown }>("/api/student/liveness-probe/nonce", { method: "POST" });
      if (!isChallenge(r.challenge)) throw new Error("BAD_CHALLENGE");
      setS({ step: "face", nonce: r.nonce, challenge: r.challenge });
    } catch (e) {
      setS({ step: "error", message: messageOf(e) });
    }
  }

  async function send(nonce: string, frames: Blob[], yaws: (number | null)[]) {
    setS({ step: "sending" });
    const form = new FormData();
    form.append("nonce", nonce);
    frames.forEach((f, i) => form.append("frames", f, `khung-${i + 1}.jpg`));
    form.append("clientYaw", clientYawField(yaws));
    frames.length = 0;
    try {
      const r = parseProbeResult(await api<unknown>("/api/student/liveness-probe", { method: "POST", body: form }));
      setS(r ? { step: "result", ...r } : { step: "error", message: "Phản hồi không đúng định dạng." });
    } catch (e) {
      setS({ step: "error", message: messageOf(e) });
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="liveness-probe">
      <h2 id="liveness-probe" className="text-lg font-semibold">
        Thử liveness (không tốn lượt)
      </h2>
      <p className="text-xs text-muted-foreground">
        Chụp 3 khung theo thử thách như khi đăng ký thẻ; server chấm liveness và trả bảng yaw client ↔ server. Không cần ảnh thẻ,
        không trừ lượt đăng ký, không lưu ảnh. Chỉ có ở bản preview/dev.
      </p>
      {s.step === "face" && (
        <FaceChallenge key={s.nonce} challenge={s.challenge} onComplete={(frames, yaws) => void send(s.nonce, frames, yaws)} />
      )}
      {s.step === "sending" && <p className="text-sm">Đang chấm liveness…</p>}
      {s.step === "result" && (
        <>
          <p className={s.passed ? "font-semibold text-green-700" : "font-semibold text-red-700"} role="status">
            {s.passed ? "Qua liveness" : "Không qua liveness"}
          </p>
          <YawDebugTable report={s.report} />
        </>
      )}
      {s.step === "error" && <Alert>{s.message}</Alert>}
      {(s.step === "idle" || s.step === "result" || s.step === "error") && (
        <Button variant="outline" onClick={() => void start()}>
          {s.step === "idle" ? "Thử liveness (không tốn lượt)" : "Thử lại"}
        </Button>
      )}
      {s.step === "loading" && <p className="text-sm text-muted-foreground">Đang chuẩn bị…</p>}
    </section>
  );
}

function messageOf(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 404) return "Công cụ này chỉ có ở bản preview/dev.";
    if (e.status === 429) return `Đã thử quá nhiều lần (30 lượt/giờ). Thử lại sau ${Math.ceil((e.retryAfterSec ?? 60) / 60)} phút.`;
    if (e.status !== 0) return `${e.message} (${e.code})`;
  }
  return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
}
