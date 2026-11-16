"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { isActiveNav } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * Menu khu SV/GV. Từ sm trở lên: các link nằm ngang. Màn hẹp (điện thoại ≤ 414 px): nút hamburger mở bảng menu
 * dưới header — header luôn một hàng. Đóng khi chọn mục, đổi trang hoặc bấm Esc.
 */
export function AreaNav({ nav }: { nav: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const link = (n: { href: string; label: string }, mobile: boolean) => {
    const active = isActiveNav(pathname, n.href);
    return (
      <Link
        key={n.href}
        href={n.href}
        aria-current={active ? "page" : undefined}
        onClick={() => setOpen(false)}
        className={cn(
          "rounded-md hover:bg-muted",
          mobile ? "block px-4 py-3 text-base" : "px-3 py-1.5",
          active && "font-semibold text-primary",
        )}
      >
        {n.label}
      </Link>
    );
  };

  return (
    <>
      <nav aria-label="Menu" className="hidden flex-1 flex-wrap gap-1 text-sm sm:flex">
        {nav.map((n) => link(n, false))}
      </nav>
      <div className="ml-auto sm:hidden">
        <button
          type="button"
          aria-label={open ? "Đóng menu" : "Mở menu"}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="grid size-10 place-items-center rounded-md hover:bg-muted"
        >
          {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
        </button>
        {open && (
          <nav id={panelId} aria-label="Menu" className="absolute inset-x-0 top-full z-20 border-b border-border bg-background p-2 shadow-md">
            {nav.map((n) => link(n, true))}
          </nav>
        )}
      </div>
    </>
  );
}
