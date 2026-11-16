import { notFound } from "next/navigation";
import { yawDebugEnabled } from "@utc/backend/face/yaw-debug";
import { CameraDebug } from "./camera-debug";

/**
 * /sv/the-sinh-vien/debug — trang chẩn đoán camera + "Thử liveness". CHỈ preview/dev: cùng điều kiện với API
 * liveness-probe (yawDebugEnabled, fail closed). Production (kể cả Vercel thiếu VERCEL_ENV, next start cục bộ) → 404.
 * Đánh giá lúc request (không prerender), để biến môi trường runtime quyết định.
 */
export const dynamic = "force-dynamic";

export default function Page() {
  if (!yawDebugEnabled()) notFound();
  return <CameraDebug />;
}
