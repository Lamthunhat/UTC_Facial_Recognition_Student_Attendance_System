import { CheckCircle2, Clock, CreditCard, XCircle } from "lucide-react";
import { studentCardView, type StudentCardStatus } from "@/lib/student/card-status";
import { cn } from "@/lib/utils";

/** Trạng thái thẻ của SV — không bao giờ có lý do chờ duyệt (Principle III). */
export function CardStatusBanner({ card, children }: { card: { status: StudentCardStatus } | null; children?: React.ReactNode }) {
  const v = studentCardView(card);
  const Icon = v.tone === "success" ? CheckCircle2 : v.tone === "danger" ? XCircle : v.tone === "warning" ? Clock : CreditCard;
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-4 text-sm",
        v.tone === "success" && "border-green-200 bg-green-50 text-green-900",
        v.tone === "warning" && "border-amber-200 bg-amber-50 text-amber-900",
        v.tone === "danger" && "border-red-200 bg-red-50 text-red-900",
        v.tone === "neutral" && "border-border bg-muted",
      )}
    >
      <div className="flex items-center gap-2 font-semibold">
        <Icon className="size-5 shrink-0" aria-hidden /> Thẻ sinh viên: {v.label}
      </div>
      <p>{v.description}</p>
      {children}
    </div>
  );
}
