"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "./ui/button";

export function LogoutButton({ to = "/" }: { to?: string }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      title="Đăng xuất"
      className="shrink-0 max-sm:size-10 max-sm:p-0"
      onClick={async () => {
        await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
        router.replace(to);
        router.refresh();
      }}
    >
      <LogOut className="size-4" aria-hidden /> <span className="max-sm:sr-only">Đăng xuất</span>
    </Button>
  );
}
