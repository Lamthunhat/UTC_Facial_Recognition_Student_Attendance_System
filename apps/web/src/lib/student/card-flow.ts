import type { CardAdvice } from "./card-errors";
import type { Challenge } from "./challenge";

/**
 * Máy trạng thái đăng ký thẻ (T063), thuần: chụp thẻ → xem lại → giới thiệu bước khuôn mặt → lấy nonce + thử thách →
 * 3 khung mặt → gửi → kết quả. Khung mặt bị bỏ khỏi trạng thái ngay khi gửi (không giữ ở client sau khi gửi);
 * ảnh thẻ giữ tới khi xong để làm lại riêng bước khuôn mặt khi cần.
 */
export type Notice = CardAdvice;

export type CardFlowState =
  | { step: "card"; notice?: Notice }
  | { step: "card-preview"; card: Blob }
  | { step: "face-intro"; card: Blob; notice?: Notice }
  | { step: "face"; card: Blob; nonce: string; challenge: Challenge; expiresAt: number; frames: Blob[] }
  | { step: "submitting"; card: Blob }
  | { step: "done"; status: "active" | "pending_review" }
  | { step: "blocked"; notice: Notice };

export type CardFlowEvent =
  | { type: "CARD_CAPTURED"; card: Blob }
  | { type: "CARD_RETAKE" }
  | { type: "CARD_ACCEPTED" }
  | { type: "NONCE_RECEIVED"; nonce: string; challenge: Challenge; expiresAt: number }
  | { type: "FRAME_CAPTURED"; frame: Blob }
  | { type: "FRAMES_RESET" }
  | { type: "SUBMIT"; now: number }
  | { type: "SUBMIT_OK"; status: "active" | "pending_review" }
  | { type: "SUBMIT_FAILED"; advice: CardAdvice }
  | { type: "RESTART" };

export const initialCardFlow: CardFlowState = { step: "card" };

const EXPIRED: Notice = { action: "retake-face", message: "Phiên chụp đã hết hạn. Vui lòng làm lại bước chụp khuôn mặt." };

export function cardFlow(s: CardFlowState, e: CardFlowEvent): CardFlowState {
  switch (e.type) {
    case "RESTART":
      return { step: "card" };
    case "CARD_CAPTURED":
      return s.step === "card" ? { step: "card-preview", card: e.card } : s;
    case "CARD_RETAKE":
      return s.step === "card-preview" ? { step: "card" } : s;
    case "CARD_ACCEPTED":
      return s.step === "card-preview" ? { step: "face-intro", card: s.card } : s;
    case "NONCE_RECEIVED":
      return s.step === "face-intro" || s.step === "face"
        ? { step: "face", card: s.card, nonce: e.nonce, challenge: e.challenge, expiresAt: e.expiresAt, frames: [] }
        : s;
    case "FRAME_CAPTURED":
      return s.step === "face" && s.frames.length < 3 ? { ...s, frames: [...s.frames, e.frame] } : s;
    case "FRAMES_RESET":
      return s.step === "face" ? { ...s, frames: [] } : s;
    case "SUBMIT":
      if (s.step !== "face" || s.frames.length !== 3) return s;
      if (e.now >= s.expiresAt) return { step: "face-intro", card: s.card, notice: EXPIRED };
      return { step: "submitting", card: s.card };
    case "SUBMIT_OK":
      return s.step === "submitting" ? { step: "done", status: e.status } : s;
    case "SUBMIT_FAILED":
      if (s.step !== "submitting") return s;
      if (e.advice.action === "retake-card") return { step: "card", notice: e.advice };
      if (e.advice.action === "retake-face") return { step: "face-intro", card: s.card, notice: e.advice };
      return { step: "blocked", notice: e.advice };
  }
}
