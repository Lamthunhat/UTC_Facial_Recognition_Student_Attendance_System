/**
 * Tiến trình khi gửi đăng ký thẻ — ƯỚC LƯỢNG theo thời gian đã chờ (server không báo từng bước; đo trên Vercel ~5–7 s).
 * Tăng đều tới ~90 % ở 10 s rồi chậm dần, không vượt 97 % cho tới khi có phản hồi thật.
 */
export const SUBMIT_STAGES = ["Đang gửi ảnh", "Đang đọc thẻ", "Đang kiểm tra khuôn mặt", "Sắp xong…"] as const;
const STAGE_ENDS_MS = [2_000, 5_000, 9_000];

export function submitProgress(elapsedMs: number): { percent: number; stage: number } {
  const t = Math.max(0, elapsedMs);
  const percent = t <= 10_000 ? (90 * t) / 10_000 : 90 + 7 * (1 - Math.exp(-(t - 10_000) / 15_000));
  const stage = STAGE_ENDS_MS.findIndex((end) => t < end);
  return { percent: Math.floor(percent), stage: stage === -1 ? STAGE_ENDS_MS.length : stage };
}
