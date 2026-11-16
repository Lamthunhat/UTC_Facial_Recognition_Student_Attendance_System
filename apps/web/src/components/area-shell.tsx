import Link from "next/link";
import { AreaNav } from "./area-nav";
import { LogoutButton } from "./logout-button";

/**
 * Khung khu SV/GV/Admin. Header luôn MỘT hàng: tên app (+ tên khu từ sm) · menu (hamburger trên màn hẹp) · đăng xuất
 * (chỉ icon trên màn hẹp, vẫn có nhãn cho trình đọc màn hình).
 */
export function AreaShell({
  title,
  nav,
  children,
  logoutTo = "/login",
}: {
  title: string;
  nav: { href: string; label: string }[];
  children: React.ReactNode;
  /** Trang về sau khi đăng xuất (SV: /sv). */
  logoutTo?: string;
}) {
  return (
    <div className="min-h-dvh">
      <header className="relative border-b border-border bg-background">
        <div className="mx-auto flex max-w-6xl flex-nowrap items-center gap-2 px-4 py-2 sm:gap-4 sm:py-3">
          <Link href="/" className="min-w-0 truncate font-semibold">
            Điểm danh UTC <span className="text-muted-foreground max-sm:hidden">· {title}</span>
          </Link>
          <AreaNav nav={nav} />
          <LogoutButton to={logoutTo} />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
