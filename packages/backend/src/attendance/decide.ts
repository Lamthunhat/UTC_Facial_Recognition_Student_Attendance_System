import type { eventReason, windowType } from "@utc/database/schema";
import type { LiveFrameError } from "../face/liveness";
import { GPS_RULES, type GpsAnomaly, type LocationStatus } from "../geo/location-check";

/**
 * T075 — Pipeline quyết định MỘT lượt điểm danh, phần thuần (plan.md "Luồng quyết định"; test: decide.test.ts).
 * Thứ tự bước, dừng ở kết luận cuối đầu tiên (retry/rejected) — service gọi từng bước và chỉ tính bước sau khi bước
 * trước chưa dừng (không tốn CPU nhận diện cho lượt ngoài phạm vi):
 *   window_open → enrolled → [checkin_required] → attempts → gps_accuracy → distance → faces → liveness
 *   → card_match → [checkin_match] → duplicate → gps_anomaly
 * Các cờ nghi vấn (thẻ vùng biên, lệch check-in, trùng mặt, GPS bất thường) KHÔNG từ chối: gom lại, lượt thành
 * `suspect` với lý do chính theo mức nghiêm trọng — giảng viên quyết định (Constitution III).
 */
export type WindowType = (typeof windowType.enumValues)[number];
export type EventReason = (typeof eventReason.enumValues)[number];
export type EventResult = "valid" | "suspect" | "rejected" | "retry";
export type SuspectReason = "card_borderline" | "checkin_mismatch" | "duplicate_face" | "gps_anomaly";

/** FR-040: tối đa 3 lượt bị từ chối mỗi khung (lượt "thử lại" không tính). */
export const MAX_REJECTED_ATTEMPTS = 3;
/** Lý do chính khi có nhiều cờ — nghiêm trọng nhất trước. */
const SUSPECT_PRIORITY: SuspectReason[] = ["duplicate_face", "checkin_mismatch", "card_borderline", "gps_anomaly"];
/** Lượt bị từ chối do chính lượt chụp (tính vào 3 lượt); lỗi của khung/ghi danh không tính. */
const ATTEMPT_REASONS = new Set<EventReason>(["out_of_range", "liveness_failed", "card_mismatch"]);

export type StepName =
  | "window_open"
  | "enrolled"
  | "checkin_required"
  | "attempts"
  | "gps_accuracy"
  | "distance"
  | "faces"
  | "liveness"
  | "card_match"
  | "checkin_match"
  | "duplicate"
  | "gps_anomaly";
export interface Step {
  step: StepName;
  ok: boolean;
  detail?: string;
}

export interface FaceThresholds {
  cardReject: number;
  cardAccept: number;
  duplicate: number;
  checkinMatch: number;
}

export interface LocationFacts {
  status: LocationStatus;
  distanceM: number;
  accuracyM: number;
  radiusM: number;
  anomalies: GpsAnomaly[];
}
export interface DuplicateMatch {
  eventId: string;
  studentCode: string;
  similarity: number;
}

export interface Preconditions {
  windowType: WindowType;
  windowOpen: boolean;
  enrolled: boolean;
  hasCheckin: boolean;
  checkoutSkipped: boolean;
  alreadyDone: boolean;
  rejectedCount: number;
}

export interface Verdict {
  result: EventResult;
  reason: EventReason;
  flags: SuspectReason[];
  steps: Step[];
  /** Các lượt của mã KHÁC trùng mặt vượt ngưỡng (để chuyển chúng sang nghi vấn trong cùng transaction). */
  duplicateOf: string[];
  countsAsAttempt: boolean;
}

const m = (x: number) => `${Math.round(x)} m`;
const f2 = (x: number) => x.toFixed(2);

export class Decision {
  readonly steps: Step[] = [];
  private readonly flags = new Set<SuspectReason>();
  private final: { result: EventResult; reason: EventReason } | null = null;
  private dupIds: string[] = [];

  get done(): boolean {
    return this.final !== null;
  }

  private pass(step: StepName, detail?: string) {
    this.steps.push(detail === undefined ? { step, ok: true } : { step, ok: true, detail });
  }
  private stop(step: StepName, result: EventResult, reason: EventReason, detail?: string): boolean {
    this.steps.push(detail === undefined ? { step, ok: false } : { step, ok: false, detail });
    this.final = { result, reason };
    return true;
  }
  private flag(step: StepName, reason: SuspectReason, detail: string) {
    this.steps.push({ step, ok: false, detail });
    this.flags.add(reason);
  }

  /** Bước 2 (plan): khung mở, ghi danh, đã check-in (check-out/đột xuất), chưa có lượt hợp lệ, còn lượt. Trả true nếu dừng. */
  preconditions(p: Preconditions): boolean {
    if (this.done) return true;
    if (p.windowType === "check_out" && p.checkoutSkipped) return this.stop("window_open", "rejected", "window_closed", "GV đã bỏ check-out");
    if (!p.windowOpen) return this.stop("window_open", "rejected", "window_closed");
    this.pass("window_open");
    if (!p.enrolled) return this.stop("enrolled", "rejected", "not_enrolled");
    this.pass("enrolled");
    if (p.windowType !== "check_in") {
      if (!p.hasCheckin) return this.stop("checkin_required", "rejected", "no_checkin");
      this.pass("checkin_required");
    }
    if (p.alreadyDone) return this.stop("attempts", "rejected", "already_done", "đã có lượt hợp lệ/nghi vấn");
    if (p.rejectedCount >= MAX_REJECTED_ATTEMPTS) {
      return this.stop("attempts", "rejected", "attempts_exhausted", `${p.rejectedCount}/${MAX_REJECTED_ATTEMPTS} lượt bị từ chối`);
    }
    this.pass("attempts");
    return false;
  }

  /** Bước 3: GPS. Trả true nếu dừng. */
  location(l: LocationFacts): boolean {
    if (this.done) return true;
    if (l.status === "retry_low_accuracy") {
      return this.stop("gps_accuracy", "retry", "low_accuracy", `sai số ${m(l.accuracyM)} > ${GPS_RULES.accuracyMaxM} m`);
    }
    this.pass("gps_accuracy");
    if (l.status === "out_of_range") return this.stop("distance", "rejected", "out_of_range", `${m(l.distanceM)} > ${m(l.radiusM)}`);
    this.pass("distance", `${m(l.distanceM)} ≤ ${m(l.radiusM)}`);
    return false;
  }

  /** Bước 4: số mặt (0/≥2 → chụp lại, không tính lượt) và liveness (sai thử thách / khác người → từ chối). */
  liveness(live: { ok: true } | { ok: false; error: LiveFrameError }): boolean {
    if (this.done) return true;
    if (!live.ok && live.error === "LIVE_NO_FACE") return this.stop("faces", "retry", "no_face");
    if (!live.ok && live.error === "LIVE_MULTIPLE_FACES") return this.stop("faces", "retry", "multiple_faces");
    this.pass("faces");
    if (!live.ok) return this.stop("liveness", "rejected", "liveness_failed");
    this.pass("liveness");
    return false;
  }

  /** Bước 5: so với chân dung thẻ, 2 ngưỡng (FR-035a). */
  card(similarity: number | null, t: FaceThresholds): boolean {
    if (this.done) return true;
    if (similarity === null) return this.stop("card_match", "rejected", "card_mismatch", "không có thẻ hiệu lực");
    if (similarity < t.cardReject) return this.stop("card_match", "rejected", "card_mismatch", `${f2(similarity)} < ${f2(t.cardReject)}`);
    if (similarity < t.cardAccept) this.flag("card_match", "card_borderline", `${f2(similarity)} trong ${f2(t.cardReject)}–${f2(t.cardAccept)}`);
    else this.pass("card_match", `${f2(similarity)} ≥ ${f2(t.cardAccept)}`);
    return false;
  }

  /** Bước 6 (check-out/đột xuất): so với lượt check-in hợp lệ của chính mã (FR-043). null = không còn dữ liệu → bỏ qua. */
  checkin(windowType: WindowType, similarity: number | null, t: FaceThresholds): boolean {
    if (this.done) return true;
    if (windowType === "check_in") return false;
    if (similarity === null) this.pass("checkin_match", "không có dữ liệu khuôn mặt của lượt check-in");
    else if (similarity < t.checkinMatch) this.flag("checkin_match", "checkin_mismatch", `${f2(similarity)} < ${f2(t.checkinMatch)}`);
    else this.pass("checkin_match", `${f2(similarity)} ≥ ${f2(t.checkinMatch)}`);
    return false;
  }

  /** Bước 7: trùng mặt với mã KHÁC trong cùng khung (FR-036/037). */
  duplicates(matches: DuplicateMatch[], t: FaceThresholds): boolean {
    if (this.done) return true;
    const hits = matches.filter((x) => x.similarity >= t.duplicate).sort((a, b) => b.similarity - a.similarity);
    this.dupIds = hits.map((h) => h.eventId);
    if (hits.length) this.flag("duplicate", "duplicate_face", `${hits.map((h) => `${h.studentCode} (${f2(h.similarity)})`).join(", ")}`);
    else this.pass("duplicate");
    return false;
  }

  /** Dấu hiệu GPS giả (research R17) — chỉ gắn cờ. */
  gpsAnomalies(anomalies: GpsAnomaly[]): boolean {
    if (this.done) return true;
    if (anomalies.length) this.flag("gps_anomaly", "gps_anomaly", anomalies.join(", "));
    else this.pass("gps_anomaly");
    return false;
  }

  verdict(): Verdict {
    const flags = SUSPECT_PRIORITY.filter((r) => this.flags.has(r)).sort();
    const final =
      this.final ?? (flags.length ? { result: "suspect" as const, reason: SUSPECT_PRIORITY.find((r) => this.flags.has(r))! } : { result: "valid" as const, reason: "ok" as const });
    return {
      ...final,
      flags: this.final ? [] : flags,
      steps: [...this.steps],
      duplicateOf: this.final ? [] : this.dupIds,
      countsAsAttempt: final.result === "rejected" && ATTEMPT_REASONS.has(final.reason),
    };
  }
}

/** Số lượt còn lại sau `rejectedCount` lượt bị từ chối. */
export const attemptsLeft = (rejectedCount: number) => Math.max(0, MAX_REJECTED_ATTEMPTS - rejectedCount);

/** Toàn bộ dữ kiện của một lượt — dùng cho test bảng kịch bản và dựng hồ sơ (service gọi từng bước của Decision). */
export interface Facts extends Preconditions {
  location: LocationFacts | null;
  live: { ok: true } | { ok: false; error: LiveFrameError } | null;
  cardSimilarity: number | null;
  checkinSimilarity: number | null;
  duplicates: DuplicateMatch[];
  thresholds: FaceThresholds;
}

export function decideFromFacts(f: Facts): Verdict {
  const d = new Decision();
  const stopped =
    d.preconditions(f) ||
    (f.location !== null && d.location(f.location)) ||
    (f.live !== null && d.liveness(f.live)) ||
    d.card(f.cardSimilarity, f.thresholds) ||
    d.checkin(f.windowType, f.checkinSimilarity, f.thresholds) ||
    d.duplicates(f.duplicates, f.thresholds) ||
    (f.location !== null && d.gpsAnomalies(f.location.anomalies));
  void stopped;
  return d.verdict();
}
