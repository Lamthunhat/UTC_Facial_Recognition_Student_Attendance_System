import type { FaceThresholds, Verdict, WindowType } from "../attendance/decide";
import type { GpsAnomaly } from "../geo/location-check";
import { attendanceRecordV1, RECORD_SCHEMA, type AttendanceRecordV1 } from "./schema";

/**
 * T081 — Dựng hồ sơ `attendance-record.v1` từ kết quả từng bước (kể cả khi dừng sớm: phần chưa tới là null) rồi
 * validate Zod. Làm tròn: toạ độ 5 chữ số (~1 m), khoảng cách 0,1 m, tương đồng/yaw 3 chữ số. Không ảnh, không vector.
 */
export const RULES_VERSION = "2026-11-17";
export const MODEL_VERSIONS = { faceModel: "w600k_mbf", detector: "scrfd-500m" } as const;

export interface RecordInput {
  ids: { session: string; window: string; windowType: WindowType; studentCode: string; attempt: number; scanSession: string | null };
  serverTime: Date;
  userAgent: string | null;
  ip: string | null;
  location: {
    lat: number;
    lng: number;
    accuracyM: number;
    distanceM: number | null;
    radiusM: number;
    address: string | null;
    room: string;
    anomalies: GpsAnomaly[];
  } | null;
  liveness: { challenge: ["left" | "right", "left" | "right"]; measuredYaw: (number | null)[]; passed: boolean; sameFace: number | null } | null;
  image: { facesDetected: number[]; faceBoxPx: number | null; sharpness: number | null; frontalYaw: number | null; sha256: string | null } | null;
  matching: { card: number | null; checkin: number | null; maxOther: { similarity: number; studentCode: string } | null } | null;
  thresholds: FaceThresholds;
  verdict: Verdict;
  evidence: { imageStored: boolean; imagePurgeAfter: Date | null };
}

const r = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
const r3 = (x: number | null) => (x === null || !Number.isFinite(x) ? null : r(x, 3));

/** Trình duyệt + hệ điều hành rút gọn (không lưu nguyên user-agent). */
export function deviceInfo(ua: string | null): { browser: string; os: string } {
  const s = ua ?? "";
  const ver = (re: RegExp) => s.match(re)?.[1]?.replace(/_/g, ".");
  const browser =
    (ver(/(?:CriOS|Chrome)\/(\d+)/) && !/Edg\//.test(s) && `Chrome ${ver(/(?:CriOS|Chrome)\/(\d+)/)}`) ||
    (ver(/Edg\/(\d+)/) && `Edge ${ver(/Edg\/(\d+)/)}`) ||
    (ver(/(?:FxiOS|Firefox)\/(\d+)/) && `Firefox ${ver(/(?:FxiOS|Firefox)\/(\d+)/)}`) ||
    (/Safari\//.test(s) && ver(/Version\/(\d+(?:\.\d+)?)/) && `Safari ${ver(/Version\/(\d+(?:\.\d+)?)/)}`) ||
    "khác";
  const os =
    (ver(/(?:iPhone|CPU) OS (\d+(?:_\d+)?)/) && `iOS ${ver(/(?:iPhone|CPU) OS (\d+(?:_\d+)?)/)}`) ||
    (ver(/Android (\d+(?:\.\d+)?)/) && `Android ${ver(/Android (\d+(?:\.\d+)?)/)}`) ||
    (/Windows NT/.test(s) && "Windows") ||
    (/Mac OS X/.test(s) && "macOS") ||
    (/Linux/.test(s) && "Linux") ||
    "khác";
  return { browser, os };
}

/** IP rút gọn: IPv4 giữ 2 octet đầu, IPv6 giữ 2 nhóm đầu. */
export function ipPrefix(ip: string | null): string | null {
  if (!ip) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return `${ip.split(".").slice(0, 2).join(".")}.x.x`;
  if (ip.includes(":")) return `${ip.split(":").slice(0, 2).join(":")}:x`;
  return null;
}

export function buildRecord(i: RecordInput): AttendanceRecordV1 {
  const v = i.verdict;
  const record: AttendanceRecordV1 = {
    schema: RECORD_SCHEMA,
    ids: { ...i.ids },
    serverTime: i.serverTime.toISOString(),
    device: i.userAgent || i.ip ? { ...deviceInfo(i.userAgent), ipPrefix: ipPrefix(i.ip) } : null,
    location: i.location && {
      lat: r(i.location.lat, 5),
      lng: r(i.location.lng, 5),
      accuracyM: r(i.location.accuracyM, 1),
      distanceM: i.location.distanceM === null ? null : r(i.location.distanceM, 1),
      radiusM: i.location.radiusM,
      address: i.location.address,
      room: i.location.room,
      anomalies: [...i.location.anomalies],
    },
    liveness: i.liveness && {
      challenge: i.liveness.challenge,
      measuredYaw: i.liveness.measuredYaw.map(r3),
      passed: i.liveness.passed,
      sameFace: r3(i.liveness.sameFace),
    },
    image: i.image && {
      facesDetected: i.image.facesDetected,
      faceBoxPx: i.image.faceBoxPx === null ? null : Math.round(i.image.faceBoxPx),
      sharpness: r3(i.image.sharpness),
      frontalYaw: r3(i.image.frontalYaw),
      sha256: i.image.sha256,
    },
    matching: i.matching && {
      card: r3(i.matching.card),
      checkin: r3(i.matching.checkin),
      maxOther: i.matching.maxOther && { similarity: r(i.matching.maxOther.similarity, 3), studentCode: i.matching.maxOther.studentCode },
      thresholds: { ...i.thresholds },
    },
    steps: v.steps.map((s) => ({ ...s })),
    decision: { result: v.result, reason: v.reason, flags: [...v.flags] },
    versions: { ...MODEL_VERSIONS, rules: RULES_VERSION },
    evidence: { imageStored: i.evidence.imageStored, imagePurgeAfter: i.evidence.imagePurgeAfter?.toISOString() ?? null },
  };
  return attendanceRecordV1.parse(record);
}
