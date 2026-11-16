"use client";

import { LogOut } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "./ui/button";

export function LogoutButton({ to = "/" }: { to?: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      title="Đăng xuất"
      className="shrink-0 max-sm:size-10 max-sm:p-0"
      onClick={async () => {
        await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
        // Tải DOCUMENT mới: bỏ trạng thái phiên cũ ở client và nhận CSP chặt của trang đích (khu SV có 'wasm-unsafe-eval')
        window.location.replace(to);
      }}
    >
      <LogOut className="size-4" aria-hidden /> <span className="max-sm:sr-only">Đăng xuất</span>
    </Button>
  );
}
