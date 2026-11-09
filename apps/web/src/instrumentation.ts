/**
 * Chạy một lần khi server Next.js khởi động. Chỉ kiểm ở runtime nodejs (Edge/middleware không có các biến server
 * và không import được backend). Thiếu/sai biến môi trường → ném lỗi, server không lên; log chỉ nêu tên biến.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkEnvOnStartup } = await import("@utc/backend/startup");
  checkEnvOnStartup();
}
