"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { reviewReasonLines, staffCardStatusLabel, type StaffCardDetail, type StaffCardStatus } from "@/lib/cards";
import { cn } from "@/lib/utils";

/**
 * T063 (giảng viên) — Thẻ SV của lớp: hàng chờ duyệt (lý do chi tiết, ảnh thẻ tải khi bấm xem) + danh sách SV kèm
 * trạng thái thẻ. Duyệt / Từ chối / Đặt lại đều qua hộp xác nhận; server ghi audit (Principle III).
 */
interface Row {
  studentId: string;
  code: string;
  fullName: string;
  adminClass: string | null;
  card: { status: StaffCardStatus; reviewReasons: string[]; registeredAt: string } | null;
}
interface Detail extends StaffCardDetail {
  status: string;
  decodedCode: string;
  decodeMethod: "barcode" | "ocr";
  registeredAt: string;
  cardUrl: string | null;
  portraitUrl: string | null;
}
type Action = { kind: "approve" | "reject" | "reset"; row: Row };

const REASON_SHORT: Record<string, string> = {
  DUPLICATE_FACE: "Trùng mặt SV khác",
  LIVE_MISMATCH: "Mặt trực tiếp lệch thẻ",
  NAME_MISMATCH: "Tên không khớp",
};

const STATUS_TONE: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  pending_review: "bg-amber-100 text-amber-900",
  rejected: "bg-red-100 text-red-800",
  reset: "bg-slate-200 text-slate-800",
};

function StatusChip({ status }: { status: StaffCardStatus | null }) {
  return (
    <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold", status ? STATUS_TONE[status] : "bg-muted text-muted-foreground")}>
      {staffCardStatusLabel(status)}
    </span>
  );
}

const vnDateTime = (iso: string) => new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" });

export default function ClassCardsPage() {
  const { classId } = useParams<{ classId: string }>();
  const [cls, setCls] = useState<{ code: string; courseName: string } | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [showImages, setShowImages] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([
        api<{ class: { code: string; courseName: string } }>(`/api/classes/${classId}`),
        api<{ students: Row[] }>(`/api/classes/${classId}/cards`),
      ]);
      setCls(c.class);
      setRows(r.students);
    } catch (e) {
      setError(e instanceof ApiError && e.status !== 0 ? e.message : "Không tải được danh sách. Kiểm tra mạng rồi thử lại.");
    }
  }, [classId]);

  useEffect(() => {
    document.title = "Thẻ sinh viên của lớp";
    void load();
  }, [load]);

  async function openDetail(row: Row) {
    if (openId === row.studentId) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(row.studentId);
    setDetail(null);
    setDetailError(null);
    setShowImages(false);
    try {
      setDetail((await api<{ card: Detail | null }>(`/api/admin/students/${row.studentId}/card`)).card);
    } catch (e) {
      setDetailError(e instanceof ApiError && e.status !== 0 ? e.message : "Không tải được thẻ.");
    }
  }

  /** Link ảnh chỉ sống 5 phút — tải lại chi tiết để lấy link mới. */
  async function refreshImages() {
    if (!openId) return;
    try {
      setDetail((await api<{ card: Detail | null }>(`/api/admin/students/${openId}/card`)).card);
    } catch {
      setDetailError("Không tải lại được ảnh.");
    }
  }

  async function confirm(text: string) {
    if (!action) return;
    setActing(true);
    setActionError(null);
    const base = `/api/admin/students/${action.row.studentId}/card`;
    try {
      if (action.kind === "reset") await api(`${base}/reset`, { method: "POST", json: { reason: text } });
      else await api(`${base}/review`, { method: "POST", json: { decision: action.kind, ...(text ? { note: text } : {}) } });
      const verb = action.kind === "approve" ? "Đã duyệt" : action.kind === "reject" ? "Đã từ chối" : "Đã đặt lại";
      setNotice(`${verb} thẻ của ${action.row.fullName} (${action.row.code}).`);
      setAction(null);
      setOpenId(null);
      setDetail(null);
      await load();
    } catch (e) {
      setActionError(e instanceof ApiError && e.status !== 0 ? e.message : "Không kết nối được máy chủ.");
    } finally {
      setActing(false);
    }
  }

  const pending = rows?.filter((r) => r.card?.status === "pending_review") ?? [];
  const counts = rows?.reduce<Record<string, number>>((m, r) => ((m[r.card?.status ?? "none"] = (m[r.card?.status ?? "none"] ?? 0) + 1), m), {});

  const detailPanel = (row: Row) =>
    openId === row.studentId && (
      <div className="mt-3 flex flex-col gap-3 rounded-lg bg-muted/60 p-3 text-sm">
        {detailError && <Alert>{detailError}</Alert>}
        {!detail && !detailError && <p className="text-muted-foreground">Đang tải…</p>}
        {detail && (
          <>
            <p className="text-muted-foreground">
              Đăng ký {vnDateTime(detail.registeredAt)} · mã đọc bằng {detail.decodeMethod === "barcode" ? "mã vạch" : "OCR"}: {detail.decodedCode}
            </p>
            {reviewReasonLines(detail).length > 0 && (
              <ul className="flex flex-col gap-2">
                {reviewReasonLines(detail).map((l) => (
                  <li key={l.reason} className="rounded-md border border-amber-200 bg-amber-50 p-2">
                    <div className="font-semibold text-amber-900">{l.title}</div>
                    {l.detail && <div className="text-amber-900">{l.detail}</div>}
                  </li>
                ))}
              </ul>
            )}
            {!showImages ? (
              <Button variant="outline" size="sm" className="self-start" onClick={() => setShowImages(true)} disabled={!detail.cardUrl}>
                {detail.cardUrl ? "Xem ảnh thẻ" : "Không còn ảnh thẻ"}
              </Button>
            ) : (
              <div className="grid grid-cols-[1fr_auto] items-start gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed URL ngắn hạn của kho private */}
                {detail.cardUrl && <img src={detail.cardUrl} alt={`Ảnh thẻ của ${row.fullName}`} className="w-full rounded border border-border" onError={() => void refreshImages()} />}
                {/* eslint-disable-next-line @next/next/no-img-element -- signed URL ngắn hạn của kho private */}
                {detail.portraitUrl && <img src={detail.portraitUrl} alt="Chân dung cắt từ thẻ" className="w-20 rounded border border-border sm:w-28" />}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {detail.status === "pending_review" && (
                <>
                  <Button size="sm" onClick={() => setAction({ kind: "approve", row })}>
                    Duyệt
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setAction({ kind: "reject", row })}>
                    Từ chối
                  </Button>
                </>
              )}
              {(detail.status === "pending_review" || detail.status === "active") && (
                <Button size="sm" variant="outline" onClick={() => setAction({ kind: "reset", row })}>
                  Đặt lại thẻ
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    );

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/gv/lop" className="text-sm text-primary hover:underline">
          ← Lớp của tôi
        </Link>
        <h1 className="text-xl font-semibold">Thẻ sinh viên{cls ? ` · ${cls.code}` : ""}</h1>
        {cls && <p className="text-sm text-muted-foreground">{cls.courseName}</p>}
        <Link href={`/gv/lop/${classId}/danh-sach`} className="text-sm text-primary hover:underline">
          Nhập / cập nhật danh sách lớp
        </Link>
      </div>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {!rows && !error && <p className="text-sm text-muted-foreground">Đang tải…</p>}

      {rows && (
        <>
          <section className="flex flex-col gap-3" aria-labelledby="queue">
            <h2 id="queue" className="text-lg font-semibold">
              Chờ duyệt <span className="tabular-nums text-muted-foreground">({pending.length})</span>
            </h2>
            {pending.length === 0 && <p className="text-sm text-muted-foreground">Không có thẻ nào chờ duyệt.</p>}
            <ul className="flex flex-col gap-3">
              {pending.map((r) => (
                <li key={r.studentId} className="rounded-lg border border-amber-200 p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold">{r.fullName}</div>
                      <div className="text-muted-foreground">
                        {r.code}
                        {r.adminClass ? ` · ${r.adminClass}` : ""}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {r.card!.reviewReasons.map((x) => (
                          <span key={x} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                            {REASON_SHORT[x] ?? x}
                          </span>
                        ))}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => void openDetail(r)} aria-expanded={openId === r.studentId}>
                      {openId === r.studentId ? "Đóng" : "Xem"}
                    </Button>
                  </div>
                  {detailPanel(r)}
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="all">
            <h2 id="all" className="text-lg font-semibold">
              Tất cả sinh viên <span className="tabular-nums text-muted-foreground">({rows.length})</span>
            </h2>
            {counts && (
              <p className="text-sm text-muted-foreground">
                Đã duyệt {counts.active ?? 0} · Chờ duyệt {counts.pending_review ?? 0} · Chưa đăng ký {(counts.none ?? 0) + (counts.reset ?? 0) + (counts.rejected ?? 0)}
              </p>
            )}
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {rows.map((r) => (
                <li key={r.studentId} className="p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{r.fullName}</div>
                      <div className="text-muted-foreground">
                        {r.code}
                        {r.adminClass ? ` · ${r.adminClass}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusChip status={r.card?.status ?? null} />
                      {r.card?.status === "active" && (
                        <Button size="sm" variant="ghost" onClick={() => void openDetail(r)} aria-expanded={openId === r.studentId}>
                          {openId === r.studentId ? "Đóng" : "Xem"}
                        </Button>
                      )}
                    </div>
                  </div>
                  {r.card?.status !== "pending_review" && detailPanel(r)}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <ConfirmDialog
        open={!!action}
        title={action?.kind === "approve" ? "Duyệt thẻ?" : action?.kind === "reject" ? "Từ chối thẻ?" : "Đặt lại thẻ?"}
        description={
          action && (
            <>
              <p>
                {action.row.fullName} ({action.row.code})
              </p>
              <p className="mt-2 text-muted-foreground">
                {action.kind === "approve"
                  ? "Thẻ sẽ có hiệu lực, sinh viên điểm danh được ngay."
                  : action.kind === "reject"
                    ? "Ảnh thẻ và đặc trưng khuôn mặt bị xoá; sinh viên thấy “Bị từ chối” và phải đăng ký lại. Sinh viên không thấy lý do."
                    : "Thẻ hiện tại bị thay thế (xoá ảnh + đặc trưng khuôn mặt, giữ lịch sử); sinh viên phải đăng ký lại."}
              </p>
            </>
          )
        }
        confirmLabel={action?.kind === "approve" ? "Duyệt" : action?.kind === "reject" ? "Từ chối" : "Đặt lại"}
        tone={action?.kind === "approve" ? "primary" : "danger"}
        textLabel={action?.kind === "reset" ? "Lý do đặt lại" : "Ghi chú"}
        textRequired={action?.kind === "reset"}
        pending={acting}
        error={actionError}
        onConfirm={(t) => void confirm(t)}
        onCancel={() => {
          setAction(null);
          setActionError(null);
        }}
      />
    </section>
  );
}
