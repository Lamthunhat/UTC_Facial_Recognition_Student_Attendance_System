"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAppNavigate } from "./app-link";
import { api } from "@/lib/api";
import { Button } from "./ui/button";

export function LogoutButton({ to = "/" }: { to?: string }) {
  const router = useRouter();
  const navigate = useAppNavigate();
  return (
    <Button
      variant="ghost"
      size="sm"
      title="Đăng xuất"
      className="shrink-0 max-sm:size-10 max-sm:p-0"
      onClick={async () => {
        await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
        navigate(to, { replace: true });
        router.refresh();
      }}
    >
      <LogOut className="size-4" aria-hidden /> <span className="max-sm:sr-only">Đăng xuất</span>
    </Button>
  );
}
