"use client";

import { yawDebugRows, yawReasonText, yawThresholdsText as fmt, type YawDebugReport } from "@/lib/student/yaw-debug";

/**
 * Bảng so sánh yaw client ↔ server — CHỈ hiện ở preview/dev (server chỉ trả `yawDebug` ở đó). Dùng để hiệu chỉnh ngưỡng.
 */

export function YawDebugTable({ report }: { report: YawDebugReport }) {
  const rows = yawDebugRows(report);
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-dashed border-amber-400 bg-amber-50/60 p-3 text-xs" aria-label="So sánh yaw">
      <p className="font-semibold">
        So sánh yaw client ↔ server <span className="font-normal text-muted-foreground">(chỉ preview/dev)</span>
      </p>
      <p>{yawReasonText(report.reason)}</p>
      <div className="overflow-x-auto">
        <table className="w-full tabular-nums">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="pr-2 font-normal">Khung</th>
              <th className="pr-2 font-normal">Cần</th>
              <th className="pr-2 font-normal">Client</th>
              <th className="pr-2 font-normal">Server</th>
              <th className="pr-2 font-normal">S − C</th>
              <th className="font-normal">KQ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.frame} className={r.ok ? "" : "font-semibold text-red-700"}>
                <td className="pr-2">{r.frame}</td>
                <td className="pr-2">{r.expected}</td>
                <td className="whitespace-nowrap pr-2">{r.client}</td>
                <td className="whitespace-nowrap pr-2">{r.server}</td>
                <td className="pr-2">{r.delta}</td>
                <td>{r.ok ? "✓" : "✗"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground">
        Ngưỡng server: {fmt(report.thresholds.server)} · client: {fmt(report.thresholds.client)}. Quay sang TRÁI của SV → yaw dương.
      </p>
    </section>
  );
}
