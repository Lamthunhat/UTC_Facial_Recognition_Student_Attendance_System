"use client";

import { AppLink } from "@/components/app-link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CardStatusBanner } from "@/components/student/card-status-banner";
import { Alert } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { studentCardView, type StudentCardStatus } from "@/lib/student/card-status";

interface StudentClass {
  classId: string;
  code: string;
  courseName: string;
  room: string | null;
  openWindow: { id: string; type: string; closesAt: string } | null;
}
type Card = { status: StudentCardStatus } | null;

/** T062 — Lớp của SV (chọn lớp) + trạng thái thẻ. Điểm danh theo lớp có ở US2. */
export default function StudentClassesPage() {
  const router = useRouter();
  const [classes, setClasses] = useState<StudentClass[] | null>(null);
  const [card, setCard] = useState<Card | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Lớp học";
    Promise.all([api<{ classes: StudentClass[] }>("/api/student/classes"), api<{ card: Card }>("/api/student/card")])
      .then(([c, k]) => {
        setClasses(c.classes);
        setCard(k.card);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.code === "CONSENT_REQUIRED") return router.replace("/sv/dong-y?next=/sv/lop");
        if (e instanceof ApiError && e.status === 401) return router.replace("/sv?next=/sv/lop");
        setError(e instanceof ApiError && e.status !== 0 ? e.message : "Không tải được danh sách lớp. Kiểm tra mạng rồi thử lại.");
      });
  }, [router]);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Lớp học của bạn</h1>
      {error && <Alert>{error}</Alert>}
      {card !== undefined && (
        <CardStatusBanner card={card}>
          {studentCardView(card).canRegister && (
            <AppLink
              href="/sv/the-sinh-vien"
              className="inline-flex justify-center rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground hover:opacity-90"
            >
              Đăng ký thẻ sinh viên
            </AppLink>
          )}
        </CardStatusBanner>
      )}
      {!classes && !error && <p className="text-sm text-muted-foreground">Đang tải…</p>}
      {classes?.length === 0 && <p className="text-sm text-muted-foreground">Bạn chưa có lớp học phần nào đang học.</p>}
      {classes && classes.length > 0 && (
        <ul className="flex flex-col gap-3">
          {classes.map((c) => (
            <li key={c.classId} className="flex flex-col gap-1 rounded-lg border border-border p-4 text-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold">{c.courseName}</span>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {c.openWindow ? "Đang mở điểm danh" : "Chưa mở điểm danh"}
                </span>
              </div>
              <span className="text-muted-foreground">
                {c.code}
                {c.room ? ` · Phòng ${c.room}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
