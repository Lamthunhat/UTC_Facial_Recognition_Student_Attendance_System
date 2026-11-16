/**
 * Đồng hồ ứng dụng — thời gian SERVER (FR-038). Code nghiệp vụ về buổi/khung/lượt điểm danh dùng now() để test cố định
 * được "bây giờ" (giờ của một buổi học) mà không phụ thuộc giờ chạy test. Production: luôn là new Date().
 */
let override: (() => Date) | null = null;

export const now = (): Date => (override ? override() : new Date());

export function setNowForTest(fn: () => Date) {
  if (process.env.NODE_ENV === "production") throw new Error("setNowForTest chỉ dùng trong test");
  override = fn;
}
export function resetNowForTest() {
  override = null;
}
