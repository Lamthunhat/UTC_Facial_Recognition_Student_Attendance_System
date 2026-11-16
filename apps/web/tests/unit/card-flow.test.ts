import { describe, expect, it } from "vitest";
import { cardFlow, initialCardFlow, type CardFlowState } from "@/lib/student/card-flow";
import { poseSteps } from "@/lib/student/challenge";

/** Máy trạng thái đăng ký thẻ: chụp thẻ → xem lại → mặt trực tiếp 3 khung → gửi → kết quả. */
const blob = (n = 10) => new Blob([new Uint8Array(n)], { type: "image/jpeg" });
const NOW = 1_000_000;
const nonceEvt = { type: "NONCE_RECEIVED" as const, nonce: "n1", challenge: ["left", "right"] as ["left", "right"], expiresAt: NOW + 120_000 };

function run(...events: Parameters<typeof cardFlow>[1][]): CardFlowState {
  return events.reduce(cardFlow, initialCardFlow);
}
const toFace = () => run({ type: "CARD_CAPTURED", card: blob() }, { type: "CARD_ACCEPTED" }, nonceEvt);
const threeFrames = () =>
  [0, 1, 2].reduce((s) => cardFlow(s, { type: "FRAME_CAPTURED", frame: blob() }), toFace());

describe("cardFlow", () => {
  it("bắt đầu ở bước chụp thẻ", () => {
    expect(initialCardFlow.step).toBe("card");
  });

  it("chụp thẻ → xem lại; chụp lại → bỏ ảnh cũ", () => {
    const s = run({ type: "CARD_CAPTURED", card: blob() });
    expect(s.step).toBe("card-preview");
    const again = cardFlow(s, { type: "CARD_RETAKE" });
    expect(again).toEqual({ step: "card" });
  });

  it("dùng ảnh thẻ → giới thiệu bước khuôn mặt → nonce → chụp 3 khung theo thử thách", () => {
    const intro = run({ type: "CARD_CAPTURED", card: blob() }, { type: "CARD_ACCEPTED" });
    expect(intro.step).toBe("face-intro");
    const face = cardFlow(intro, nonceEvt);
    expect(face).toMatchObject({ step: "face", nonce: "n1", challenge: ["left", "right"], frames: [] });
    const full = threeFrames();
    expect(full.step === "face" && full.frames.length).toBe(3);
    // khung thứ 4 bị bỏ qua
    expect(cardFlow(full, { type: "FRAME_CAPTURED", frame: blob() })).toBe(full);
  });

  it("SUBMIT: chỉ khi đủ 3 khung và nonce còn hạn; trạng thái gửi KHÔNG còn giữ khung hình", () => {
    expect(cardFlow(toFace(), { type: "SUBMIT", now: NOW })).toMatchObject({ step: "face" }); // chưa đủ khung
    const sending = cardFlow(threeFrames(), { type: "SUBMIT", now: NOW + 1000 });
    expect(sending.step).toBe("submitting");
    expect(JSON.stringify(Object.keys(sending))).not.toMatch(/frames/);
  });

  it("nonce hết hạn trước khi gửi → về giới thiệu khuôn mặt, bỏ khung, báo cần lấy lại", () => {
    const s = cardFlow(threeFrames(), { type: "SUBMIT", now: NOW + 121_000 });
    expect(s).toMatchObject({ step: "face-intro", notice: { action: "retake-face" } });
    expect("frames" in s).toBe(false);
  });

  it("thành công → done (bỏ ảnh thẻ khỏi bộ nhớ)", () => {
    const s = cardFlow(cardFlow(threeFrames(), { type: "SUBMIT", now: NOW }), { type: "SUBMIT_OK", status: "pending_review" });
    expect(s).toEqual({ step: "done", status: "pending_review" });
  });

  it("lỗi đọc thẻ → về chụp thẻ; lỗi khuôn mặt → về giới thiệu khuôn mặt, GIỮ ảnh thẻ; dừng → blocked", () => {
    const sending = () => cardFlow(threeFrames(), { type: "SUBMIT", now: NOW });
    const cardErr = cardFlow(sending(), { type: "SUBMIT_FAILED", advice: { action: "retake-card", message: "m" } });
    expect(cardErr).toMatchObject({ step: "card", notice: { message: "m" } });
    expect("card" in cardErr && cardErr.card).toBeFalsy();
    const faceErr = cardFlow(sending(), { type: "SUBMIT_FAILED", advice: { action: "retake-face", message: "f" } });
    expect(faceErr).toMatchObject({ step: "face-intro", notice: { message: "f" } });
    expect(faceErr.step === "face-intro" && faceErr.card).toBeInstanceOf(Blob);
    const stop = cardFlow(sending(), { type: "SUBMIT_FAILED", advice: { action: "stop", message: "s" } });
    expect(stop).toEqual({ step: "blocked", notice: { action: "stop", message: "s" } });
  });

  it("làm lại khuôn mặt → BẮT BUỘC nonce mới: không còn nonce cũ, khung bị bỏ qua tới khi có nonce mới", () => {
    const sending = cardFlow(threeFrames(), { type: "SUBMIT", now: NOW });
    const retry = cardFlow(sending, { type: "SUBMIT_FAILED", advice: { action: "retake-face", message: "f" } });
    expect(retry.step).toBe("face-intro");
    expect("nonce" in retry).toBe(false);
    expect(cardFlow(retry, { type: "FRAME_CAPTURED", frame: blob() })).toBe(retry);
    expect(cardFlow(retry, { type: "SUBMIT", now: NOW })).toBe(retry);
    const fresh = cardFlow(retry, { ...nonceEvt, nonce: "n2" });
    expect(fresh).toMatchObject({ step: "face", nonce: "n2", frames: [] });
  });

  it("RESTART từ bất kỳ bước nào → chụp thẻ, không còn ảnh", () => {
    expect(cardFlow(threeFrames(), { type: "RESTART" })).toEqual({ step: "card" });
  });
});

describe("poseSteps — chuỗi khung theo thử thách [hướng 1, nhìn thẳng, hướng 2]", () => {
  it("left,right → trái, thẳng, phải với lời hướng dẫn + mũi tên (xem trước dạng gương: trái của bạn = trái màn hình)", () => {
    expect(poseSteps(["left", "right"])).toEqual([
      { pose: "left", label: "Quay mặt sang TRÁI", arrow: "←" },
      { pose: "center", label: "Nhìn thẳng vào camera", arrow: "•" },
      { pose: "right", label: "Quay mặt sang PHẢI", arrow: "→" },
    ]);
  });
  it("right,left → phải, thẳng, trái", () => {
    expect(poseSteps(["right", "left"]).map((s) => s.pose)).toEqual(["right", "center", "left"]);
  });
});
