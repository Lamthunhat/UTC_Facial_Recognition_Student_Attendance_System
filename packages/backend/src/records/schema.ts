import { z } from "zod";
import { eventReason, windowType } from "@utc/database/schema";

/**
 * T081 — Schema hồ sơ điểm danh `attendance-record.v1` (FR-112, research R16), validate khi ghi.
 * Strict ở mọi cấp: không có chỗ cho ảnh, vector khuôn mặt hay suy đoán nhân khẩu học (FR-114, Constitution IV).
 * Yaw theo thang chung @utc/shared/face-yaw (−1…1), không phải độ. Đổi cấu trúc → tăng phiên bản (v2), không sửa v1.
 */
const sim = z.number().min(-1).max(1);
const yaw = z.number().min(-1).max(1).nullable();
const pose = z.enum(["left", "right"]);
const iso = z.iso.datetime();

export const RECORD_SCHEMA = "attendance-record.v1" as const;

export const attendanceRecordV1 = z
  .object({
    schema: z.literal(RECORD_SCHEMA),
    ids: z
      .object({
        session: z.string(),
        window: z.string(),
        windowType: z.enum(windowType.enumValues),
        studentCode: z.string(),
        attempt: z.number().int().min(1),
        scanSession: z.string().nullable(),
      })
      .strict(),
    serverTime: iso,
    device: z.object({ browser: z.string().max(40), os: z.string().max(40), ipPrefix: z.string().max(40).nullable() }).strict().nullable(),
    location: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracyM: z.number().nonnegative(),
        distanceM: z.number().nonnegative().nullable(),
        radiusM: z.number().positive(),
        address: z.string().max(200).nullable(),
        room: z.string().max(100),
        anomalies: z.array(z.enum(["implausible_accuracy", "impossible_speed"])).max(2),
      })
      .strict()
      .nullable(),
    liveness: z
      .object({
        challenge: z.tuple([pose, pose]),
        measuredYaw: z.array(yaw).length(3),
        passed: z.boolean(),
        sameFace: sim.nullable(),
      })
      .strict()
      .nullable(),
    image: z
      .object({
        facesDetected: z.array(z.number().int().nonnegative()).length(3),
        faceBoxPx: z.number().nonnegative().nullable(),
        sharpness: z.number().nonnegative().nullable(),
        frontalYaw: yaw,
        sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
      })
      .strict()
      .nullable(),
    matching: z
      .object({
        card: sim.nullable(),
        checkin: sim.nullable(),
        maxOther: z.object({ similarity: sim, studentCode: z.string() }).strict().nullable(),
        thresholds: z.object({ cardReject: sim, cardAccept: sim, duplicate: sim, checkinMatch: sim }).strict(),
      })
      .strict()
      .nullable(),
    steps: z.array(z.object({ step: z.string().max(40), ok: z.boolean(), detail: z.string().max(300).optional() }).strict()).max(20),
    decision: z
      .object({
        result: z.enum(["valid", "suspect", "rejected", "retry"]),
        reason: z.enum(eventReason.enumValues),
        flags: z.array(z.enum(["card_borderline", "checkin_mismatch", "duplicate_face", "gps_anomaly"])).max(4),
      })
      .strict(),
    versions: z.object({ faceModel: z.string(), detector: z.string(), rules: z.string() }).strict(),
    evidence: z.object({ imageStored: z.boolean(), imagePurgeAfter: iso.nullable() }).strict(),
    /** Sự kiện SAU khi lượt đã quyết (lượt khác phát hiện trùng mặt / lệch check-in) — lượt này chuyển nghi vấn. */
    followUps: z
      .array(
        z
          .object({
            at: iso,
            reason: z.enum(["duplicate_face", "checkin_mismatch"]),
            byEvent: z.string(),
            byStudentCode: z.string(),
            similarity: sim,
          })
          .strict(),
      )
      .max(50)
      .optional(),
  })
  .strict();

export type AttendanceRecordV1 = z.infer<typeof attendanceRecordV1>;
export type RecordFollowUp = NonNullable<AttendanceRecordV1["followUps"]>[number];
