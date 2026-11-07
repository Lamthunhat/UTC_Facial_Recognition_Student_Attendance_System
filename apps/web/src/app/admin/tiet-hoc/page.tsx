"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";

/** T037 — Admin sửa khung giờ 16 tiết học (FR-010a). */
interface Period {
  number: number;
  partOfDay: "sang" | "chieu" | "toi";
  startsAt: string;
  endsAt: string;
}
const PART: Record<Period["partOfDay"], string> = { sang: "Sáng", chieu: "Chiều", toi: "Tối" };

export default function PeriodsPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ periods: Period[] }>("/api/admin/periods")
      .then((r) => setPeriods(r.periods))
      .catch(() => setMsg({ tone: "error", text: "Không tải được bảng tiết." }));
  }, []);

  const update = (n: number, key: "startsAt" | "endsAt", value: string) =>
    setPeriods((ps) => ps.map((p) => (p.number === n ? { ...p, [key]: value } : p)));

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ periods: Period[] }>("/api/admin/periods", {
        method: "PUT",
        json: { periods: periods.map(({ number, startsAt, endsAt }) => ({ number, startsAt, endsAt })) },
      });
      setPeriods(r.periods);
      setMsg({ tone: "success", text: "Đã lưu bảng tiết học." });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof ApiError ? e.message : "Không lưu được." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex max-w-xl flex-col gap-4">
      <h1 className="text-xl font-semibold">Khung giờ tiết học</h1>
      <p className="text-sm text-muted-foreground">
        Giờ bắt đầu/kết thúc buổi học và khung check-out được tính từ bảng này. Ca 1 = tiết 1–3, Ca 2 = 4–6, Ca 3 =
        7–9, Ca 4 = 10–12, Ca 5 = 13–16.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-3 py-2">Buổi</th>
              <th className="px-3 py-2">Tiết</th>
              <th className="px-3 py-2">Bắt đầu</th>
              <th className="px-3 py-2">Kết thúc</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.number} className="border-t border-border">
                <td className="px-3 py-1.5 text-muted-foreground">{PART[p.partOfDay]}</td>
                <td className="px-3 py-1.5 font-semibold">Tiết {p.number}</td>
                <td className="px-3 py-1.5">
                  <Input
                    type="time"
                    value={p.startsAt}
                    onChange={(e) => update(p.number, "startsAt", e.target.value)}
                    aria-label={`Giờ bắt đầu tiết ${p.number}`}
                  />
                </td>
                <td className="px-3 py-1.5">
                  <Input
                    type="time"
                    value={p.endsAt}
                    onChange={(e) => update(p.number, "endsAt", e.target.value)}
                    aria-label={`Giờ kết thúc tiết ${p.number}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Button onClick={save} disabled={busy || periods.length !== 16} className="self-start">
        Lưu thay đổi
      </Button>
    </section>
  );
}
