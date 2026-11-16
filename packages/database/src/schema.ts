/**
 * T019 — Drizzle schema theo specs/001-attendance-core/data-model.md.
 * Các ràng buộc Drizzle chưa diễn đạt được (extension, hàm unaccent, cột sinh search_text,
 * exclusion constraint, RLS) nằm trong migration SQL viết tay 0001_hardening.sql.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => ts("created_at").notNull().defaultNow();

// ---------- Enums ----------
export const userRole = pgEnum("user_role", ["admin", "instructor"]);
export const cardStatus = pgEnum("card_status", ["active", "pending_review", "replaced", "deleted"]);
export const decodeMethod = pgEnum("decode_method", ["barcode", "ocr"]);
export const partOfDay = pgEnum("part_of_day", ["sang", "chieu", "toi"]);
export const enrollmentStatus = pgEnum("enrollment_status", ["active", "withdrawn"]);
export const sessionKind = pgEnum("session_kind", ["scheduled", "makeup"]);
export const windowType = pgEnum("window_type", ["check_in", "check_out", "spot_check"]);
export const eventResult = pgEnum("event_result", ["valid", "suspect", "rejected", "retry"]);
export const eventReason = pgEnum("event_reason", [
  "ok",
  "out_of_range",
  "low_accuracy",
  "no_face",
  "multiple_faces",
  "card_mismatch",
  "card_borderline",
  "duplicate_face",
  "checkin_mismatch",
  "liveness_failed",
  "window_closed",
  "not_enrolled",
  "no_checkin",
  "already_done",
  "attempts_exhausted",
  // 0005 — toạ độ bất thường (độ chính xác phi thực tế, "dịch chuyển tức thời" giữa các lượt): nghi vấn, GV quyết
  "gps_anomaly",
]);
export const cellValue = pgEnum("cell_value", ["valid", "suspect", "rejected", "absent", "excused"]);
export const noncePurpose = pgEnum("nonce_purpose", ["card", "checkin"]);
export const leaveReason = pgEnum("leave_reason", ["illness", "family", "school_duty", "other"]);
export const evidenceType = pgEnum("evidence_type", ["document", "chat"]);
export const leaveAutoStatus = pgEnum("leave_auto_status", ["passed", "needs_review"]);
export const leaveStatus = pgEnum("leave_status", ["pending", "approved", "rejected", "unused"]);
export const disputeStatus = pgEnum("dispute_status", ["open", "kept", "changed"]);
export const actorType = pgEnum("actor_type", ["admin", "instructor", "student", "system"]);
export const securityEventType = pgEnum("security_event_type", [
  "login_failed",
  "rate_limited",
  "forbidden",
  "bad_nonce",
  "card_replaced",
  "ai_out_of_scope",
  "csrf_blocked",
]);

// ---------- Người dùng ----------
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  role: userRole("role").notNull(),
  isLocked: boolean("is_locked").notNull().default(false),
  createdAt: createdAt(),
});

export const students = pgTable(
  "students",
  {
    id: id(),
    studentCode: text("student_code").notNull().unique(),
    lastName: text("last_name").notNull(),
    firstName: text("first_name").notNull(),
    adminClass: text("admin_class"),
    cohort: text("cohort"),
    consentAt: ts("consent_at"),
    /** Phiên bản văn bản điều khoản SV đã đồng ý (FR-050) — đổi văn bản thì phải đồng ý lại. */
    consentVersion: text("consent_version"),
    createdAt: createdAt(),
  },
  (t) => [check("student_code_format", sql`${t.studentCode} ~ '^[0-9]{6,12}$'`)],
);

export const studentCards = pgTable(
  "student_cards",
  {
    id: id(),
    studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    cardImagePath: text("card_image_path"),
    portraitImagePath: text("portrait_image_path"),
    embedding: vector("embedding", { dimensions: 512 }),
    decodedCode: text("decoded_code").notNull(),
    decodeMethod: decodeMethod("decode_method").notNull(),
    status: cardStatus("status").notNull(),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    registeredAt: ts("registered_at").notNull().defaultNow(),
    purgeAfter: ts("purge_after"),
    /** Lý do giữ chờ duyệt (DUPLICATE_FACE, NAME_MISMATCH) — chỉ giảng viên/Admin xem (Principle III). */
    reviewReasons: jsonb("review_reasons").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    duplicateStudentId: uuid("duplicate_student_id").references(() => students.id, { onDelete: "set null" }),
    duplicateSimilarity: real("duplicate_similarity"),
    /** Họ tên OCR trên thẻ có khớp hồ sơ SV không (null = không đọc được chữ). */
    nameMatched: boolean("name_matched"),
    /** Cosine giữa khung mặt trực tiếp (nhìn thẳng) lúc đăng ký và chân dung thẻ — khung hình KHÔNG được lưu (FR-045a, FR-051). */
    liveSimilarity: real("live_similarity"),
    /** Dòng họ tên OCR trên thẻ — chỉ lưu khi NAME_MISMATCH, để giảng viên đối chiếu với họ tên trong danh sách. */
    ocrName: text("ocr_name"),
  },
  (t) => [
    uniqueIndex("one_live_card_per_student")
      .on(t.studentId)
      .where(sql`${t.status} in ('active','pending_review')`),
  ],
);

// ---------- Tiết, ca ----------
export const periods = pgTable(
  "periods",
  {
    number: smallint("number").primaryKey(),
    partOfDay: partOfDay("part_of_day").notNull(),
    startsAt: time("starts_at").notNull(),
    endsAt: time("ends_at").notNull(),
  },
  (t) => [
    check("period_range", sql`${t.number} between 1 and 16`),
    check("period_order", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

export const shifts = pgTable(
  "shifts",
  {
    number: smallint("number").primaryKey(),
    firstPeriod: smallint("first_period").notNull().references(() => periods.number),
    lastPeriod: smallint("last_period").notNull().references(() => periods.number),
  },
  (t) => [check("shift_order", sql`${t.lastPeriod} >= ${t.firstPeriod}`)],
);

// ---------- Lớp học ----------
export const classes = pgTable(
  "classes",
  {
    id: id(),
    instructorId: uuid("instructor_id").notNull().references(() => users.id),
    code: text("code").notNull(),
    courseName: text("course_name").notNull(),
    semester: text("semester"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    defaultRoom: text("default_room"),
    radiusM: smallint("radius_m").notNull().default(50),
    checkinMinutes: smallint("checkin_minutes").notNull().default(15),
    checkoutOffsetBeforeMin: smallint("checkout_offset_before_min").notNull().default(10),
    checkoutOffsetAfterMin: smallint("checkout_offset_after_min").notNull().default(10),
    leaveAutoApprove: boolean("leave_auto_approve").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("class_code_per_instructor").on(t.instructorId, t.code),
    check("class_duration_15_weeks", sql`${t.endDate} >= ${t.startDate} and ${t.endDate} - ${t.startDate} <= 105`),
    check("class_radius", sql`${t.radiusM} between 10 and 500`),
  ],
);

export const classSchedules = pgTable(
  "class_schedules",
  {
    id: id(),
    classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
    weekday: smallint("weekday").notNull(),
    firstPeriod: smallint("first_period").notNull().references(() => periods.number),
    lastPeriod: smallint("last_period").notNull().references(() => periods.number),
    room: text("room"),
  },
  (t) => [
    check("weekday_range", sql`${t.weekday} between 2 and 8`),
    check("schedule_order", sql`${t.lastPeriod} >= ${t.firstPeriod}`),
  ],
);

export const enrollments = pgTable(
  "enrollments",
  {
    classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull().references(() => students.id),
    status: enrollmentStatus("status").notNull().default("active"),
    addedAt: ts("added_at").notNull().defaultNow(),
    withdrawnAt: ts("withdrawn_at"),
  },
  (t) => [primaryKey({ columns: [t.classId, t.studentId] }), index("enrollments_student").on(t.studentId)],
);

// ---------- Buổi học & khung giờ ----------
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    firstPeriod: smallint("first_period").notNull().references(() => periods.number),
    lastPeriod: smallint("last_period").notNull().references(() => periods.number),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    room: text("room").notNull(),
    kind: sessionKind("kind").notNull(),
    centerLat: doublePrecision("center_lat"),
    centerLng: doublePrecision("center_lng"),
    centerAccuracyM: real("center_accuracy_m"),
    checkoutSkipped: boolean("checkout_skipped").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("session_unique_slot").on(t.classId, t.date, t.firstPeriod), index("sessions_date").on(t.date)],
);

export const attendanceWindows = pgTable(
  "attendance_windows",
  {
    id: id(),
    sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    type: windowType("type").notNull(),
    opensAt: ts("opens_at").notNull(),
    closesAt: ts("closes_at").notNull(),
    closedEarlyAt: ts("closed_early_at"),
    radiusM: smallint("radius_m").notNull(),
  },
  (t) => [check("window_order", sql`${t.closesAt} > ${t.opensAt}`), index("windows_session").on(t.sessionId)],
);

export const scanNonces = pgTable("scan_nonces", {
  nonce: uuid("nonce").primaryKey().defaultRandom(),
  studentId: uuid("student_id").notNull().references(() => students.id),
  windowId: uuid("window_id").references(() => attendanceWindows.id),
  purpose: noncePurpose("purpose").notNull(),
  challenge: jsonb("challenge"),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});

export const scanSessions = pgTable("scan_sessions", {
  id: uuid("id").primaryKey(), // = nonce
  windowId: uuid("window_id").notNull().references(() => attendanceWindows.id, { onDelete: "cascade" }),
  studentId: uuid("student_id").notNull().references(() => students.id),
  issuedAt: ts("issued_at").notNull().defaultNow(),
  clientErrors: jsonb("client_errors").notNull().default(sql`'[]'::jsonb`),
  recordPurgeAfter: ts("record_purge_after").notNull(),
});

export const attendanceEvents = pgTable(
  "attendance_events",
  {
    id: id(),
    windowId: uuid("window_id").notNull().references(() => attendanceWindows.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull().references(() => students.id),
    attemptNo: smallint("attempt_no").notNull(),
    serverTime: ts("server_time").notNull().defaultNow(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    accuracyM: real("accuracy_m"),
    distanceM: real("distance_m"),
    cardSimilarity: real("card_similarity"),
    checkinSimilarity: real("checkin_similarity"),
    duplicateOf: uuid("duplicate_of").array(),
    livenessPassed: boolean("liveness_passed"),
    embedding: vector("embedding", { dimensions: 512 }),
    evidencePath: text("evidence_path"),
    addressText: text("address_text"),
    result: eventResult("result").notNull(),
    reason: eventReason("reason").notNull(),
    lateMinutes: real("late_minutes"),
    imageSha256: text("image_sha256"),
    record: jsonb("record").notNull(),
    purgeAfter: ts("purge_after").notNull(),
    recordPurgeAfter: ts("record_purge_after").notNull(),
  },
  (t) => [
    check("attempt_range", sql`${t.attemptNo} between 1 and 10`),
    uniqueIndex("one_decision_per_window")
      .on(t.windowId, t.studentId)
      .where(sql`${t.result} in ('valid','suspect')`),
    index("events_window").on(t.windowId),
    index("events_student").on(t.studentId),
    index("events_purge").on(t.purgeAfter),
  ],
);

export const manualOverrides = pgTable(
  "manual_overrides",
  {
    id: id(),
    sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull().references(() => students.id),
    windowType: windowType("window_type").notNull(),
    oldValue: cellValue("old_value"),
    newValue: cellValue("new_value").notNull(),
    reason: text("reason").notNull(),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [check("override_reason_len", sql`char_length(${t.reason}) >= 5`)],
);

// ---------- Vắng phép ----------
export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: id(),
    studentId: uuid("student_id").notNull().references(() => students.id),
    reasonCategory: leaveReason("reason_category").notNull(),
    reasonText: text("reason_text"),
    evidenceType: evidenceType("evidence_type").notNull(),
    leaveDate: date("leave_date").notNull(),
    extraction: jsonb("extraction"),
    checks: jsonb("checks"),
    autoStatus: leaveAutoStatus("auto_status").notNull(),
    status: leaveStatus("status").notNull().default("pending"),
    autoApproved: boolean("auto_approved").notNull().default(false),
    decidedBy: uuid("decided_by").references(() => users.id),
    decisionReason: text("decision_reason"),
    decidedAt: ts("decided_at"),
    createdAt: createdAt(),
    purgeAfter: ts("purge_after").notNull(),
  },
  (t) => [
    check("leave_reason_len", sql`${t.reasonText} is null or char_length(${t.reasonText}) <= 500`),
    // Đơn ảnh chat không bao giờ tự duyệt (FR-106, Constitution III)
    check("chat_never_auto", sql`not (${t.evidenceType} = 'chat' and ${t.autoApproved})`),
  ],
);

export const leaveRequestSessions = pgTable(
  "leave_request_sessions",
  {
    leaveRequestId: uuid("leave_request_id").notNull().references(() => leaveRequests.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => sessions.id),
  },
  (t) => [primaryKey({ columns: [t.leaveRequestId, t.sessionId] })],
);

export const leaveDocuments = pgTable(
  "leave_documents",
  {
    id: id(),
    leaveRequestId: uuid("leave_request_id").notNull().references(() => leaveRequests.id, { onDelete: "cascade" }),
    storagePath: text("storage_path"),
    sha256: text("sha256").notNull(),
    ocrTextHash: text("ocr_text_hash"),
  },
  (t) => [index("leave_docs_sha").on(t.sha256), index("leave_docs_text").on(t.ocrTextHash)],
);

// ---------- Phản hồi ----------
export const attendanceDisputes = pgTable(
  "attendance_disputes",
  {
    id: id(),
    sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull().references(() => students.id),
    message: text("message").notNull(),
    attachmentPath: text("attachment_path"),
    status: disputeStatus("status").notNull().default("open"),
    instructorNote: text("instructor_note"),
    overrideId: uuid("override_id").references(() => manualOverrides.id),
    createdAt: createdAt(),
    resolvedAt: ts("resolved_at"),
  },
  (t) => [check("dispute_msg_len", sql`char_length(${t.message}) between 1 and 1000`)],
);

// ---------- Nhật ký, bảo mật, hạ tầng ----------
export const auditLogs = pgTable("audit_logs", {
  id: id(),
  actorType: actorType("actor_type").notNull(),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  meta: jsonb("meta"),
  createdAt: createdAt(),
});

export const aiQueries = pgTable("ai_queries", {
  id: id(),
  instructorId: uuid("instructor_id").notNull().references(() => users.id),
  question: text("question").notNull(),
  filterSpec: jsonb("filter_spec"),
  rowCount: integer("row_count"),
  latencyMs: integer("latency_ms"),
  createdAt: createdAt(),
});

export const userSessions = pgTable("user_sessions", {
  sid: text("sid").primaryKey(),
  actorType: actorType("actor_type").notNull(),
  actorId: uuid("actor_id").notNull(),
  createdAt: createdAt(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
});

export const securityEvents = pgTable(
  "security_events",
  {
    id: id(),
    type: securityEventType("type").notNull(),
    ip: inet("ip"),
    actorId: uuid("actor_id"),
    meta: jsonb("meta"),
    createdAt: createdAt(),
  },
  (t) => [index("security_events_time").on(t.createdAt, t.type)],
);

export const loginFailures = pgTable("login_failures", {
  email: text("email").primaryKey(),
  count: integer("count").notNull().default(0),
  lockedUntil: ts("locked_until"),
});

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: ts("window_start").notNull(),
});

export const geocodeCache = pgTable("geocode_cache", {
  cell: text("cell").primaryKey(),
  address: text("address").notNull(),
  fetchedAt: ts("fetched_at").notNull().defaultNow(),
});
