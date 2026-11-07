import { z } from "zod";

/**
 * Hình dạng body JSON của API lớp học (Zod strict, FR-085). Ràng buộc nghiệp vụ (≤ 105 ngày, thứ/tiết/ca hợp lệ,
 * không chồng tiết) kiểm ở classes/service.ts để trả mã lỗi ổn định (DURATION_EXCEEDED, INVALID_SCHEDULE…).
 */
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày dạng YYYY-MM-DD");
const room = z.string().trim().max(60);

export const ScheduleSchema = z
  .object({
    weekday: z.number().int(),
    shift: z.number().int().optional(),
    firstPeriod: z.number().int().optional(),
    lastPeriod: z.number().int().optional(),
    room: room.nullable().optional(),
  })
  .strict();

const settings = {
  semester: z.string().trim().max(40).nullable().optional(),
  defaultRoom: room.nullable().optional(),
  radiusM: z.number().int().min(10).max(500).optional(),
  checkinMinutes: z.number().int().min(5).max(60).optional(),
  checkoutOffsetBeforeMin: z.number().int().min(0).max(60).optional(),
  checkoutOffsetAfterMin: z.number().int().min(0).max(60).optional(),
  leaveAutoApprove: z.boolean().optional(),
};

export const CreateClassSchema = z
  .object({
    code: z.string().trim().min(1).max(120),
    courseName: z.string().trim().min(1).max(200),
    startDate: date,
    endDate: date,
    schedules: z.array(ScheduleSchema).max(14),
    instructorId: z.string().uuid().optional(),
    ...settings,
  })
  .strict();

export const UpdateClassSchema = z
  .object({
    code: z.string().trim().min(1).max(120).optional(),
    courseName: z.string().trim().min(1).max(200).optional(),
    startDate: date.optional(),
    endDate: date.optional(),
    schedules: z.array(ScheduleSchema).max(14).optional(),
    ...settings,
  })
  .strict();
