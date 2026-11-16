import type { EventReason, SuspectReason } from "../attendance/decide";
import { GPS_RULES } from "../geo/location-check";
import type { AttendanceRecordV1 } from "./schema";

/**
 * T084 — Diễn giải tiếng Việt từ hồ sơ JSON theo MẪU CỐ ĐỊNH (FR-113, không dùng AI): ổn định, kiểm thử được.
 * Dạng: "07:05:40 · Check-in lượt 1 · <các số đo đã có> → <kết luận>."
 */
const WINDOW_LABEL = { check_in: "Check-in", check_out: "Check-out", spot_check: "Kiểm tra đột xuất" } as const;
const POSE_VI = { left: "trái", right: "phải" } as const;

const CONCLUSION: Record<EventReason, string> = {
  ok: "Hợp lệ",
  out_of_range: "Từ chối: ngoài phạm vi",
  low_accuracy: "Yêu cầu thử lại: vị trí chưa đủ chính xác",
  no_face: "Yêu cầu chụp lại: không thấy khuôn mặt",
  multiple_faces: "Yêu cầu chụp lại: có nhiều khuôn mặt",
  card_mismatch: "Từ chối: khuôn mặt không khớp ảnh thẻ",
  card_borderline: "Nghi vấn: khớp thẻ ở vùng biên",
  duplicate_face: "Nghi vấn: khuôn mặt trùng mã khác trong khung",
  checkin_mismatch: "Nghi vấn: khuôn mặt khác lượt check-in",
  liveness_failed: "Từ chối: chưa chứng minh được người thật",
  window_closed: "Từ chối: hết giờ điểm danh",
  not_enrolled: "Từ chối: không có trong danh sách lớp",
  no_checkin: "Từ chối: chưa check-in hợp lệ trong buổi",
  already_done: "Từ chối: đã điểm danh trong khung này",
  attempts_exhausted: "Từ chối: hết lượt thử trong khung",
  gps_anomaly: "Nghi vấn: vị trí bất thường",
};
const FLAG_TEXT: Record<SuspectReason, string> = {
  card_borderline: "khớp thẻ ở vùng biên",
  checkin_mismatch: "khuôn mặt khác lượt check-in",
  duplicate_face: "khuôn mặt trùng mã khác trong khung",
  gps_anomaly: "vị trí bất thường",
};
const ANOMALY_TEXT = { implausible_accuracy: "độ chính xác phi thực tế", impossible_speed: "di chuyển bất thường giữa hai lượt" } as const;
const FACE_RETRY = new Set<EventReason>(["no_face", "multiple_faces"]);

const vnTime = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString().slice(11, 19);
const meters = (x: number) => `${x < 10 ? Math.round(x * 10) / 10 : Math.round(x)} m`;
const f2 = (x: number) => x.toFixed(2);

export function narrate(rec: AttendanceRecordV1): string {
  const { decision: d, location: loc, liveness: live, matching: mt } = rec;
  const parts = [`${vnTime(rec.serverTime)} · ${WINDOW_LABEL[rec.ids.windowType]} lượt ${rec.ids.attempt}`];

  if (loc) {
    if (d.reason === "low_accuracy") parts.push(`sai số vị trí ${meters(loc.accuracyM)} > ${GPS_RULES.accuracyMaxM} m`);
    else if (loc.distanceM !== null && d.reason === "out_of_range") {
      parts.push(`Cách tâm ${meters(loc.distanceM)} (sai số ${meters(loc.accuracyM)}) > bán kính ${meters(loc.radiusM)}`);
    } else if (loc.distanceM !== null) {
      parts.push(`Cách tâm ${meters(loc.distanceM)} (sai số ${meters(loc.accuracyM)}, bán kính ${meters(loc.radiusM)})`);
    }
  }
  if (live && !FACE_RETRY.has(d.reason) && d.reason !== "low_accuracy" && d.reason !== "out_of_range") {
    const ch = `${POSE_VI[live.challenge[0]]} → ${POSE_VI[live.challenge[1]]}`;
    parts.push(live.passed ? `liveness đạt (${ch})` : `liveness KHÔNG đạt (${ch})`);
  }
  if (mt) {
    const t = mt.thresholds;
    if (mt.card !== null) {
      parts.push(
        mt.card < t.cardReject
          ? `khớp thẻ ${f2(mt.card)} (< ${f2(t.cardReject)})`
          : mt.card < t.cardAccept
            ? `khớp thẻ ${f2(mt.card)} (vùng biên ${f2(t.cardReject)}–${f2(t.cardAccept)})`
            : `khớp thẻ ${f2(mt.card)} (đạt ≥ ${f2(t.cardAccept)})`,
      );
    }
    if (mt.checkin !== null) {
      parts.push(`so lượt check-in ${f2(mt.checkin)} (${mt.checkin < t.checkinMatch ? "<" : "≥"} ${f2(t.checkinMatch)})`);
    }
    if (mt.maxOther && mt.maxOther.similarity >= t.duplicate) {
      parts.push(`trùng mặt mã ${mt.maxOther.studentCode} (${f2(mt.maxOther.similarity)} ≥ ${f2(t.duplicate)})`);
    }
  }
  if (loc?.anomalies.length) parts.push(`vị trí bất thường: ${loc.anomalies.map((a) => ANOMALY_TEXT[a]).join(", ")}`);

  const extra = d.flags.filter((f) => f !== d.reason).map((f) => FLAG_TEXT[f]);
  return `${parts.join(" · ")} → ${CONCLUSION[d.reason]}${extra.length ? `; kèm: ${extra.join(", ")}` : ""}.`;
}
