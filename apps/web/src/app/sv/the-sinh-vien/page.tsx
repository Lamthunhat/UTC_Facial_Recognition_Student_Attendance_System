"use client";

import { useCallback, useEffect, useState } from "react";
import { CardRegistration } from "@/components/student/card-registration";
import { CardStatusBanner } from "@/components/student/card-status-banner";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/input";
import { useAppNavigate } from "@/components/app-link";
import { api, ApiError } from "@/lib/api";
import { studentCardView, type StudentCardStatus } from "@/lib/student/card-status";

type Card = { status: StudentCardStatus } | null;

/** T063 — Trạng thái thẻ + đăng ký thẻ (chụp thẻ bằng camera sau, mặt trực tiếp bằng camera trước). */
export default function StudentCardPage() {
  const navigate = useAppNavigate();
  const [card, setCard] = useState<Card | undefined>(undefined);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<{ card: Card }>("/api/student/card")
      .then((r) => setCard(r.card))
      .catch((e) => {
        if (e instanceof ApiError && e.code === "CONSENT_REQUIRED") return navigate("/sv/dong-y?next=/sv/the-sinh-vien", { replace: true });
        if (e instanceof ApiError && e.status === 401) return navigate("/sv?next=/sv/the-sinh-vien", { replace: true });
        setError(e instanceof ApiError && e.status !== 0 ? e.message : "Không tải được trạng thái thẻ. Kiểm tra mạng rồi thử lại.");
      });
  }, [navigate]);

  useEffect(() => {
    document.title = "Thẻ sinh viên";
    load();
  }, [load]);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Thẻ sinh viên</h1>
      {error && <Alert>{error}</Alert>}
      {card === undefined && !error && <p className="text-sm text-muted-foreground">Đang tải…</p>}
      {card !== undefined && !registering && (
        <CardStatusBanner card={card}>
          {studentCardView(card).canRegister && (
            <Button onClick={() => setRegistering(true)} className="py-2.5">
              {card ? "Đăng ký lại thẻ" : "Đăng ký thẻ"}
            </Button>
          )}
        </CardStatusBanner>
      )}
      {registering && (
        <CardRegistration
          onFinished={() => {
            // Chỉ đóng luồng đăng ký khi nó kết thúc — không đóng khi một lần tải trạng thái về muộn
            setRegistering(false);
            load();
          }}
        />
      )}
    </section>
  );
}
