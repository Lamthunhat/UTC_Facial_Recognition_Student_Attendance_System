"use client";

import { CheckCircle2, Clock } from "lucide-react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AppLink, useAppNavigate } from "@/components/app-link";
import { CardCapture } from "@/components/camera/CardCapture";
import { FaceChallenge } from "@/components/camera/FaceChallenge";
import { SubmitProgress } from "@/components/student/submit-progress";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { cardErrorAdvice, type CardAdvice } from "@/lib/student/card-errors";
import { cardFlow, initialCardFlow, type Notice } from "@/lib/student/card-flow";
import { isChallenge } from "@/lib/student/challenge";
import { loadFaceDetector } from "@/lib/student/face-detector";
import { requestFits } from "@/lib/student/image";

/**
 * T063 — Đăng ký thẻ: (1) chụp thẻ → xem lại → (2) mặt trực tiếp theo thử thách → (3) gửi → kết quả.
 * Khung mặt chỉ tồn tại trong lúc tạo request; ảnh thẻ bỏ khi xong / làm lại từ đầu.
 * Kết quả không bao giờ kèm lý do chờ duyệt.
 */
const HERE = "/sv/the-sinh-vien";

function adviceFrom(e: unknown): CardAdvice {
  if (e instanceof ApiError) {
    const remaining = e.details.remainingAttempts;
    return cardErrorAdvice({
      status: e.status,
      code: e.code,
      remainingAttempts: typeof remaining === "number" ? remaining : undefined,
      retryAfterSec: e.retryAfterSec,
    });
  }
  if (e instanceof Error && e.message === "IMAGE_TOO_LARGE") return cardErrorAdvice({ status: 400, code: "IMAGE_TOO_LARGE" });
  return cardErrorAdvice({ status: 0, code: "NETWORK" });
}

function NoticeBox({ notice }: { notice?: Notice }) {
  if (!notice) return null;
  return (
    <Alert>
      {notice.message}
      {notice.attemptsNote && <span className="mt-1 block font-semibold">{notice.attemptsNote}</span>}
    </Alert>
  );
}

function Stepper({ current }: { current: 1 | 2 | 3 }) {
  const items = ["Chụp thẻ", "Khuôn mặt", "Gửi"];
  return (
    <ol className="flex gap-2 text-xs" aria-label="Các bước">
      {items.map((label, i) => (
        <li
          key={label}
          aria-current={i + 1 === current ? "step" : undefined}
          className={`flex-1 rounded-full px-2 py-1 text-center ${i + 1 === current ? "bg-primary text-primary-foreground" : i + 1 < current ? "bg-green-100 text-green-800" : "bg-muted text-muted-foreground"}`}
        >
          {i + 1}. {label}
        </li>
      ))}
    </ol>
  );
}

export function CardRegistration({ onFinished }: { onFinished: () => void }) {
  const navigate = useAppNavigate();
  const [s, dispatch] = useReducer(cardFlow, initialCardFlow);
  const [nonceError, setNonceError] = useState<CardAdvice | null>(null);
  const [loadingNonce, setLoadingNonce] = useState(false);

  // Xem trước ảnh thẻ bằng blob: URL — thu hồi khi rời bước
  const previewUrl = useMemo(() => (s.step === "card-preview" ? URL.createObjectURL(s.card) : null), [s]);
  useEffect(() => () => void (previewUrl && URL.revokeObjectURL(previewUrl)), [previewUrl]);

  // Tải sẵn bộ hướng dẫn khuôn mặt (MediaPipe) khi SV đang đọc màn giới thiệu — lỗi thì FaceChallenge tự dùng đếm ngược
  useEffect(() => {
    if (s.step === "face-intro") void loadFaceDetector();
  }, [s.step]);

  function follow(advice: CardAdvice) {
    if (advice.action === "consent") navigate(`/sv/dong-y?next=${encodeURIComponent(HERE)}`);
    else if (advice.action === "login") navigate(`/sv?next=${encodeURIComponent(HERE)}`);
    else if (advice.action === "refresh") onFinished();
  }

  async function getNonce() {
    setLoadingNonce(true);
    setNonceError(null);
    try {
      const r = await api<{ nonce: string; expiresAt: string; challenge: unknown }>("/api/student/card/nonce", { method: "POST" });
      if (!isChallenge(r.challenge)) throw new Error("BAD_CHALLENGE");
      dispatch({ type: "NONCE_RECEIVED", nonce: r.nonce, challenge: r.challenge, expiresAt: Date.parse(r.expiresAt) });
    } catch (e) {
      const advice = adviceFrom(e);
      setNonceError(advice);
      follow(advice);
    } finally {
      setLoadingNonce(false);
    }
  }

  // Khoá gửi: một lượt gửi tại một thời điểm (không gửi lại khi đang xử lý)
  const sending = useRef(false);

  async function submit(frames: Blob[]) {
    if (s.step !== "face" || sending.current) return;
    sending.current = true;
    try {
      await send(frames);
    } finally {
      sending.current = false;
    }
  }

  async function send(frames: Blob[]) {
    if (s.step !== "face") return;
    const { card, nonce, expiresAt } = s;
    frames.forEach((frame) => dispatch({ type: "FRAME_CAPTURED", frame }));
    const now = Date.now();
    dispatch({ type: "SUBMIT", now });
    if (now >= expiresAt) return; // reducer báo hết hạn, quay lại bước khuôn mặt
    if (!requestFits([card.size, ...frames.map((f) => f.size)])) {
      dispatch({ type: "SUBMIT_FAILED", advice: cardErrorAdvice({ status: 413, code: "PAYLOAD_TOO_LARGE" }) });
      return;
    }
    const form = new FormData();
    form.append("nonce", nonce);
    form.append("image", card, "the-sinh-vien.jpg");
    frames.forEach((f, i) => form.append("frames", f, `khung-${i + 1}.jpg`));
    frames.length = 0;
    try {
      const r = await api<{ status: "active" | "pending_review" }>("/api/student/card", { method: "POST", body: form });
      dispatch({ type: "SUBMIT_OK", status: r.status });
    } catch (e) {
      const advice = adviceFrom(e);
      dispatch({ type: "SUBMIT_FAILED", advice });
      follow(advice);
    }
  }

  switch (s.step) {
    case "card":
      return (
        <div className="flex flex-col gap-4">
          <Stepper current={1} />
          <NoticeBox notice={s.notice} />
          <CardCapture onCaptured={(card) => dispatch({ type: "CARD_CAPTURED", card })} />
        </div>
      );
    case "card-preview":
      return (
        <div className="flex flex-col gap-4">
          <Stepper current={1} />
          <p className="text-sm">Kiểm tra ảnh: thấy rõ <strong>mã sinh viên, họ tên và ảnh chân dung</strong>, không bị loá hay mờ.</p>
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- blob: URL cục bộ, không qua next/image
            <img src={previewUrl} alt="Ảnh thẻ vừa chụp" className="mx-auto max-h-[60dvh] w-auto max-w-full rounded-lg border border-border" />
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => dispatch({ type: "CARD_RETAKE" })}>
              Chụp lại
            </Button>
            <Button className="flex-1" onClick={() => dispatch({ type: "CARD_ACCEPTED" })}>
              Dùng ảnh này
            </Button>
          </div>
        </div>
      );
    case "face-intro":
      return (
        <div className="flex flex-col gap-4">
          <Stepper current={2} />
          <NoticeBox notice={s.notice} />
          {nonceError && <NoticeBox notice={nonceError} />}
          <div className="rounded-lg border border-border p-4 text-sm">
            <p className="font-semibold">Chụp khuôn mặt trực tiếp</p>
            <p className="mt-1 text-muted-foreground">
              Để chắc chắn đúng là bạn, hệ thống chụp 3 khung bằng camera trước: quay mặt theo mũi tên, nhìn thẳng, rồi quay sang
              hướng còn lại. Chỉ một mình bạn trong khung, đủ sáng, không đeo khẩu trang hay kính râm. Các khung này không được lưu lại.
            </p>
          </div>
          <Button onClick={() => void getNonce()} disabled={loadingNonce} className="py-3 text-base">
            {loadingNonce ? "Đang chuẩn bị…" : "Tiếp tục"}
          </Button>
          <Button variant="ghost" onClick={() => dispatch({ type: "RESTART" })}>
            Chụp lại thẻ
          </Button>
        </div>
      );
    case "face":
      return (
        <div className="flex flex-col gap-4">
          <Stepper current={2} />
          <FaceChallenge key={s.nonce} challenge={s.challenge} onComplete={(frames) => void submit(frames)} />
        </div>
      );
    case "submitting":
      return (
        <div className="flex flex-col gap-4">
          <Stepper current={3} />
          <SubmitProgress />
        </div>
      );
    case "done":
      return s.status === "active" ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-6 text-center" role="status">
          <CheckCircle2 className="size-10 text-green-700" aria-hidden />
          <p className="font-semibold text-green-800">Đăng ký thẻ thành công</p>
          <p className="text-sm text-green-800">Bạn đã có thể điểm danh ở các lớp của mình.</p>
          <AppLink href="/sv/lop" className="text-sm font-semibold text-primary hover:underline">
            Về danh sách lớp
          </AppLink>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-6 text-center" role="status">
          <Clock className="size-10 text-amber-700" aria-hidden />
          <p className="font-semibold text-amber-900">Đang chờ giảng viên duyệt</p>
          <p className="text-sm text-amber-900">Ảnh thẻ đã được gửi. Bạn sẽ điểm danh được khi giảng viên duyệt.</p>
          <AppLink href="/sv/lop" className="text-sm font-semibold text-primary hover:underline">
            Về danh sách lớp
          </AppLink>
        </div>
      );
    case "blocked":
      return (
        <div className="flex flex-col gap-4">
          <NoticeBox notice={s.notice} />
          <AppLink href="/sv/lop" className="text-center text-sm font-semibold text-primary hover:underline">
            Về danh sách lớp
          </AppLink>
        </div>
      );
  }
}
