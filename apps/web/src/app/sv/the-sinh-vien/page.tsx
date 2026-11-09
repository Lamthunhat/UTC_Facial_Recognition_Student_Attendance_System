"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CardRegistration } from "@/components/student/card-registration";
import { CardStatusBanner } from "@/components/student/card-status-banner";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { studentCardView, type StudentCardStatus } from "@/lib/student/card-status";

type Card = { status: StudentCardStatus } | null;

/** T063 — Trạng thái thẻ + đăng ký thẻ (chụp thẻ bằng camera sau, mặt trực tiếp bằng camera trước). */
export default function StudentCardPage() {
  const router = useRouter();
  const [card, setCard] = useState<Card | undefined>(undefined);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<{ card: Card }>("/api/student/card")
      .then((r) => {
        setCard(r.card);
        setRegistering(false);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.code === "CONSENT_REQUIRED") return router.replace("/sv/dong-y?next=/sv/the-sinh-vien");
        if (e instanceof ApiError && e.status === 401) return router.replace("/sv?next=/sv/the-sinh-vien");
        setError(e instanceof ApiError && e.status !== 0 ? e.message : "Không tải được trạng thái thẻ. Kiểm tra mạng rồi thử lại.");
      });
  }, [router]);

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
      {registering && <CardRegistration onFinished={load} />}
    </section>
  );
}
