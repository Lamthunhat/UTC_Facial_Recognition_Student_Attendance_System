# Data Model: Điểm danh lõi (001-attendance-core)

**Date**: 2026-11-07 | **Plan**: [plan.md](./plan.md)

PostgreSQL (Supabase). Extensions: `vector`, `unaccent`, `pg_trgm`, `pgcrypto`. Mọi thời điểm là `timestamptz` (UTC); giờ tiết học là `time` theo Asia/Ho_Chi_Minh. Khoá chính `uuid` (`gen_random_uuid()`) trừ khi ghi khác.

## Sơ đồ quan hệ

```text
users (admin/instructor) 1──* classes 1──* class_schedules
                                   │ 1──* enrollments *──1 students 1──0..1 student_cards (active)
                                   │ 1──* sessions 1──* attendance_windows 1──* attendance_events *──1 students
periods (1–16)   shifts (Ca 1–5)                                        └──* manual_overrides
audit_logs   ai_queries   scan_nonces   rate_limits   geocode_cache
```

## Bảng

### `users` — Admin & Giảng viên
| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | uuid | PK |
| email | citext | UNIQUE, NOT NULL |
| password_hash | text | NOT NULL (argon2id) |
| full_name | text | NOT NULL |
| role | enum `user_role` (`admin`, `instructor`) | NOT NULL |
| is_locked | boolean | default false |
| created_at | timestamptz | default now() |

### `students`
| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | uuid | PK |
| student_code | text | UNIQUE, NOT NULL, `^[0-9]{6,12}$` |
| last_name | text | NOT NULL (Họ + đệm) |
| first_name | text | NOT NULL (Tên) |
| admin_class | text | Lớp hành chính, ví dụ "CNTT3" |
| cohort | text | Khoá, ví dụ "K64" (từ file hoặc từ thẻ) |
| consent_at | timestamptz | NULL = chưa đồng ý (FR-050) |
| search_text | text | GENERATED: lower(f_unaccent(code ‖ họ ‖ tên ‖ họ+tên)) ; GIN trgm index |

### `student_cards` — Thẻ sinh viên (ảnh tham chiếu duy nhất)
| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | uuid | PK |
| student_id | uuid | FK students, NOT NULL |
| card_image_path | text | Storage path (private) |
| portrait_image_path | text | Ảnh chân dung cắt từ thẻ |
| embedding | vector(512) | NOT NULL |
| decoded_code | text | Mã đọc được từ mã vạch/OCR |
| decode_method | enum (`barcode`, `ocr`) | |
| status | enum `card_status` (`active`, `pending_review`, `replaced`, `deleted`) | |
| reviewed_by | uuid | FK users, NULL |
| registered_at | timestamptz | default now() |
| purge_after | timestamptz | = max(class.end_date) của các lớp của SV + 30 ngày; cập nhật khi ghi danh thay đổi |

Ràng buộc: UNIQUE partial `(student_id) WHERE status IN ('active','pending_review')` — mỗi SV tối đa một thẻ hiệu lực/chờ duyệt.

**Chuyển trạng thái**: `pending_review → active` (giảng viên/Admin duyệt) · `active → replaced` (đăng ký lại) · `* → deleted` (hết hạn hoặc SV yêu cầu xoá; xoá file + đặt embedding = NULL qua cột riêng nếu cần giữ bản ghi lịch sử).

### `periods` — Tiết học (Admin quản lý, seed theo FR-010a)
| Cột | Kiểu | Ràng buộc |
|---|---|---|
| number | smallint | PK, 1–16 |
| part_of_day | enum (`sang`, `chieu`, `toi`) | |
| starts_at | time | NOT NULL |
| ends_at | time | NOT NULL, > starts_at |

### `shifts` — Ca học (seed: Ca1 1–3, Ca2 4–6, Ca3 7–9, Ca4 10–12, Ca5 13–16)
| Cột | Kiểu | Ràng buộc |
|---|---|---|
| number | smallint | PK, 1–5 |
| first_period | smallint | FK periods |
| last_period | smallint | FK periods, ≥ first_period |

### `classes` — Lớp học phần
| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | uuid | PK |
| instructor_id | uuid | FK users, NOT NULL |
| code | text | NOT NULL, ví dụ "Khai phá dữ liệu-1-1-26(N03.BT1)"; UNIQUE (instructor_id, code) |
| course_name | text | NOT NULL |
| semester | text | ví dụ "1-2026-2027" |
| start_date | date | NOT NULL |
| end_date | date | NOT NULL; CHECK end_date − start_date ≤ 105 ngày (15 tuần) |
| default_room | text | ví dụ "301-A7-A7" |
| radius_m | smallint | default 50, 10–500 |
| checkin_minutes | smallint | default 15 |
| checkout_offset_before_min | smallint | default 10 |
| checkout_offset_after_min | smallint | default 10 |
| leave_auto_approve | boolean | default false (FR-106) |
| created_at | timestamptz | |

### `class_schedules` — Lịch học hằng tuần
| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | uuid | PK |
| class_id | uuid | FK classes ON DELETE CASCADE |
| weekday | smallint | 2–8 (Thứ 2 … Chủ nhật = 8) |
| first_period | smallint | FK periods |
| last_period | smallint | FK periods, ≥ first_period |
| room | text | NULL = dùng default_room |

### `enrollments` — Ghi danh
| Cột | Kiểu | Ràng buộc |
|---|---|---|
| class_id | uuid | FK classes |
| student_id | uuid | FK students |
| status | enum (`active`, `withdrawn`) | default active |
| added_at / withdrawn_at | timestamptz | |
| | | PK (class_id, student_id) |

### `sessions` — Buổi học
| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | uuid | PK |
| class_id | uuid | FK classes |
| date | date | NOT NULL |
| first_period / last_period | smallint | FK periods |
| starts_at / ends_at | timestamptz | suy ra từ periods + date (FR-010c) |
| room | text | NOT NULL (mặc định từ lịch/lớp, đổi được tới khi `ends_at`) |
| kind | enum (`scheduled`, `makeup`) | |
| center_lat / center_lng | double precision | vị trí giảng viên lúc mở check-in |
| center_accuracy_m | real | |
| checkout_skipped | boolean | default false (FR-067) |
| created_at | timestamptz | |

UNIQUE (class_id, date, first_period).

### `attendance_windows` — Khung giờ
| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | uuid | PK |
| session_id | uuid | FK sessions |
| type | enum `window_type` (`check_in`, `check_out`, `spot_check`) | |
| opens_at | timestamptz | NOT NULL |
| closes_at | timestamptz | NOT NULL, > opens_at |
| closed_early_at | timestamptz | NULL |
| radius_m | smallint | copy từ lớp, chỉnh được |

Ràng buộc: exclusion constraint không cho 2 khung cùng `type` chồng thời gian trong một `session_id` (FR-025). Khung "đang mở" ⇔ `opens_at ≤ now() < coalesce(closed_early_at, closes_at)`.

### `attendance_events` — Lượt điểm danh
| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | uuid | PK |
| window_id | uuid | FK attendance_windows |
| student_id | uuid | FK students |
| attempt_no | smallint | 1..3 (FR-040) |
| server_time | timestamptz | default now() — thời điểm quyết định |
| lat / lng / accuracy_m | double / real | từ thiết bị |
| distance_m | real | Haversine tới tâm buổi |
| card_similarity | real | cosine với thẻ |
| checkin_similarity | real | NULL với check-in; cosine với lượt check-in hợp lệ (FR-043) |
| duplicate_of | uuid[] | các event trùng mặt trong khung (FR-036) |
| liveness_passed | boolean | |
| embedding | vector(512) | NULL sau khi purge |
| evidence_path | text | ảnh đã đóng dấu; NULL sau khi purge |
| address_text | text | địa chỉ in trên ảnh |
| result | enum `event_result` (`valid`, `suspect`, `rejected`, `retry`) | `retry` cũng được lưu để có hồ sơ (FR-111) |
| reason | enum (`ok`, `out_of_range`, `low_accuracy`, `no_face`, `multiple_faces`, `card_mismatch`, `card_borderline`, `duplicate_face`, `checkin_mismatch`, `liveness_failed`, `window_closed`, `not_enrolled`, `no_checkin`, `already_done`, `attempts_exhausted`) | `low_accuracy`, `no_face`, `multiple_faces` đi với `result = retry` |
| late_minutes | real | chỉ check-in: (server_time − window.opens_at) (FR-073) |
| purge_after | timestamptz | server_time + 7 ngày (chỉ ảnh + embedding) |
| record | jsonb | Hồ sơ điểm danh theo schema `attendance-record.v1` (FR-112); giữ sau khi purge ảnh |
| record_purge_after | timestamptz | class.end_date + 30 ngày (FR-114) |
| image_sha256 | text | băm ảnh gốc khung nhìn thẳng |

Ràng buộc: UNIQUE partial `(window_id, student_id) WHERE result IN ('valid','suspect')` — tối đa một lượt hợp lệ/nghi vấn mỗi khung.

**Chuyển trạng thái `result`**: tạo mới → `valid` | `suspect` | `rejected`; `valid → suspect` khi một lượt sau phát hiện trùng; `suspect → valid | rejected` chỉ qua `manual_overrides`.

### `scan_sessions` — Lần mở màn hình quét (FR-111)
| Cột | Kiểu | |
|---|---|---|
| id | uuid | PK (= nonce id) |
| window_id, student_id | uuid | FK |
| issued_at | timestamptz | |
| client_errors | jsonb | lỗi thiết bị client báo về: `[{at, code: 'camera_denied'|'geo_denied'|'network'|'timeout', detail}]` |
| record_purge_after | timestamptz | class.end_date + 30 ngày |

### `leave_requests` — Đơn vắng phép (US8)
| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | uuid | PK |
| student_id | uuid | FK students |
| reason_category | enum (`illness`, `family`, `school_duty`, `other`) | |
| evidence_type | enum (`document`, `chat`) | `chat` không bao giờ tự duyệt (FR-106) |
| leave_date | date | ngày học; = ngày nộp theo giờ VN (FR-101); mọi buổi áp dụng phải cùng ngày |
| reason_text | text | ≤ 500 ký tự |
| extraction | jsonb | JSON trích xuất theo schema `leave-extraction.v1` |
| checks | jsonb | document: `{nameMatch, codeMatch, dateCovers, stampOrSignature, notDuplicate, sameDay, confidence}` · chat: `{instructorMatch, studentRequestFound, instructorApproval, dateMatches, approvedBeforeSessionEnd, noTamperSigns, notDuplicate, sameDay, confidence}` |
| auto_status | enum (`passed`, `needs_review`) | |
| status | enum (`pending`, `approved`, `rejected`, `unused`) | |
| auto_approved | boolean | |
| decided_by | uuid | FK users NULL |
| decision_reason | text | bắt buộc khi rejected/huỷ duyệt |
| decided_at, created_at | timestamptz | |
| purge_after | timestamptz | max(class.end_date) + 30 ngày |

### `leave_request_sessions` — Buổi áp dụng
| Cột | Kiểu | |
|---|---|---|
| leave_request_id | uuid | FK |
| session_id | uuid | FK sessions (có thể là buổi tương lai đã sinh từ lịch) |
| | | PK (leave_request_id, session_id) |

### `leave_documents` — Ảnh minh chứng
| Cột | Kiểu | |
|---|---|---|
| id | uuid | PK |
| leave_request_id | uuid | FK |
| storage_path | text | bucket private `leave` |
| sha256 | text | phát hiện trùng (FR-103e) |
| ocr_text_hash | text | băm nội dung đã chuẩn hoá — phát hiện trùng khi chụp lại |

### `attendance_disputes` — Phản hồi điểm danh (US9)
| Cột | Kiểu | |
|---|---|---|
| id | uuid | PK |
| session_id, student_id | uuid | FK; tối đa 2/buổi/SV |
| message | text | ≤ 1.000 ký tự |
| attachment_path | text | NULL |
| status | enum (`open`, `kept`, `changed`) | |
| instructor_note | text | |
| override_id | uuid | FK manual_overrides NULL |
| created_at, resolved_at | timestamptz | |

### `manual_overrides` — Sửa thủ công (FR-064)
| Cột | Kiểu | |
|---|---|---|
| id | uuid | PK |
| session_id, student_id | uuid | FK |
| window_type | window_type | ô In hay Out |
| old_value / new_value | enum (`valid`, `suspect`, `rejected`, `absent`, `excused`) | `excused` = vắng có phép ghi tay (FR-064) |
| reason | text | NOT NULL, ≥ 5 ký tự |
| actor_id | uuid | FK users |
| created_at | timestamptz | |

Ô hiển thị = override mới nhất nếu có, nếu không thì kết quả tính từ events.

### Bảng phụ
- `audit_logs(id, actor_type, actor_id, action, target_type, target_id, meta jsonb, created_at)` — đăng ký/thay thẻ, duyệt, mở/đóng khung, đổi phòng, xuất file.
- `ai_queries(id, instructor_id, question, filter_spec jsonb, row_count, latency_ms, created_at)` (FR-079).
- `scan_nonces(nonce PK, student_id, window_id NULL, purpose enum(card,checkin), challenge jsonb, expires_at, used_at)` — dùng một lần (Nguyên tắc I).
- `rate_limits(key PK, count, window_start)` — dự phòng khi không dùng SDK firewall.
- `user_sessions(sid PK, actor_type, actor_id, created_at, expires_at, revoked_at)` — thu hồi phiên (FR-094).
- `security_events(id, type enum(login_failed, rate_limited, forbidden, bad_nonce, card_replaced, ai_out_of_scope), ip inet, actor_id, meta jsonb, created_at)` — FR-095.
- `login_failures(email PK, count, locked_until)` — khoá tạm đăng nhập GV.
- `geocode_cache(cell PK text, address text, fetched_at)`.

## Quy tắc tính (dẫn xuất, không lưu)

**Ô In/Out của (session, student)**:
1. Có override → giá trị override (`excused` → 🟦 P).
2. Có event `valid` trong khung tương ứng → 🟩; có `suspect` → 🟨.
2b. Không có event valid/suspect và có `leave_requests.status = approved` cho buổi → 🟦 "P" (đơn chuyển `unused` nếu sau đó có event valid).
3. Khung đang mở và chưa có event valid/suspect → ⬜.
4. Còn lại (khung đã đóng, hoặc chỉ có `rejected`) → 🟥.
5. Ô Out: `checkout_skipped` → không hiển thị; khung check-out chưa tới giờ mở → ⬜ nhạt "chưa mở".

**Trạng thái buổi** (FR-067): Có mặt = In🟩 ∧ (Out🟩 ∨ checkout_skipped) ∧ không trượt spot_check · Về sớm = In🟩 ∧ (Out🟥 ∨ trượt spot_check) · Vắng = In🟥 · Nghi vấn = còn ô 🟨.

## Schema hồ sơ điểm danh `attendance-record.v1` (FR-112)

```json
{
  "schema": "attendance-record.v1",
  "ids": { "session": "uuid", "window": "uuid", "windowType": "check_in", "student": "231230821", "attempt": 1, "scanSession": "uuid" },
  "serverTime": "2026-11-14T00:05:40Z",
  "device": { "browser": "Chrome 140", "os": "Android 15", "ipPrefix": "113.190.x.x" },
  "location": { "lat": 21.02741, "lng": 105.80123, "accuracyM": 18, "distanceM": 128, "radiusM": 50, "address": "3 Cầu Giấy, Láng Thượng, Đống Đa, Hà Nội", "room": "301-A7-A7" },
  "liveness": { "challenge": ["left", "right"], "measuredYawDeg": [-24, 2, 27], "sameFaceAcrossFrames": 0.93, "passed": true },
  "image": { "facesDetected": 1, "faceBoxPx": 212, "brightness": 0.62, "sharpness": 0.81, "frontalYawDeg": 2, "sha256": "…" },
  "matching": { "card": 0.71, "checkin": null, "maxOtherInWindow": { "similarity": 0.18, "student": null } , "thresholds": { "cardReject": 0.35, "cardAccept": 0.5, "duplicate": 0.6, "checkinMatch": 0.55 } },
  "steps": [
    { "step": "nonce", "ok": true },
    { "step": "window_open", "ok": true },
    { "step": "enrolled", "ok": true },
    { "step": "gps_accuracy", "ok": true },
    { "step": "distance", "ok": false, "detail": "128 m > 50 m" }
  ],
  "decision": { "result": "rejected", "reason": "out_of_range" },
  "versions": { "faceModel": "mbf-w600k@1", "detector": "scrfd-500m@1", "rules": "2026-11-07" },
  "evidence": { "imageStored": true, "imagePurgeAfter": "2026-11-21T00:05:40Z" }
}
```

Diễn giải (FR-113, sinh theo mẫu): *"07:05:40 · Check-in lượt 1 · 1 khuôn mặt, liveness đạt (trái → phải), khớp thẻ 0.71 (đạt ≥ 0.50), không trùng ai trong khung · Vị trí cách tâm 128 m (sai số 18 m) > bán kính 50 m → **Từ chối: ngoài phạm vi**."*

Schema `leave-extraction.v1` (FR-102) — union theo `evidenceType`:

```json
{ "evidenceType": "document", "docType": "giay_kham_benh", "fullName": "…", "studentCode": "…", "issuedDate": "2026-11-14", "validFrom": "2026-11-14", "validTo": "2026-11-15", "issuer": "…", "reasonOnDoc": "…", "hasStamp": true, "hasSignature": true, "fullText": "…", "confidence": { "fullName": 0.95, "validFrom": 0.9 } }
```

```json
{
  "evidenceType": "chat",
  "platform": "zalo",
  "screenshotOwner": "student",
  "counterpartName": "Cô Nguyễn Kim Sao",
  "messages": [
    { "from": "student", "time": "2026-11-14T06:12", "text": "Em chào cô, hôm nay em bị sốt nên xin phép nghỉ buổi Khai phá dữ liệu ạ" },
    { "from": "counterpart", "time": "2026-11-14T06:30", "text": "Ok em, nghỉ ngơi nhé" }
  ],
  "requestMessageIndex": 0,
  "instructorReply": { "messageIndex": 1, "stance": "approve", "confidence": 0.94 },
  "absenceDate": "2026-11-14",
  "absenceDateBasis": "relative 'hôm nay' + message time",
  "tamperSigns": [],
  "confidence": { "counterpartName": 0.92, "absenceDate": 0.9 }
}
```

## Truy vấn quan trọng

- **Trùng khuôn mặt trong khung** (FR-036): `SELECT id, student_id FROM attendance_events WHERE window_id = $w AND student_id <> $s AND result IN ('valid','suspect') AND embedding IS NOT NULL AND 1 - (embedding <=> $e) >= $dup_threshold`.
- **Kiểm tra thẻ trùng mặt** (FR-048): như trên trên `student_cards WHERE status='active'`.
- **Bảng điểm danh**: lấy enrollments × sessions × windows × events của một lớp rồi pivot ở tầng ứng dụng.
