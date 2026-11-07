import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import "./globals.css";

const beVietnamPro = localFont({
  src: [
    { path: "../../public/fonts/BeVietnamPro-Regular.ttf", weight: "400", style: "normal" },
    { path: "../../public/fonts/BeVietnamPro-SemiBold.ttf", weight: "600", style: "normal" },
  ],
  variable: "--font-be-vietnam-pro",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Điểm danh UTC",
    template: "%s · Điểm danh UTC",
  },
  description: "Hệ thống điểm danh sinh viên bằng nhận diện khuôn mặt và GPS — Trường ĐH Giao thông Vận tải",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1d4ed8",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Đọc header để mọi trang render động → Next.js gắn nonce CSP (middleware) vào script của framework.
  await headers();
  return (
    <html lang="vi">
      <body className={`${beVietnamPro.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
