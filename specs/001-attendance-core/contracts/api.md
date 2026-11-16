# API Contracts: Điểm danh lõi

Next.js Route Handlers dưới `/api`. JSON UTF-8. Xác thực bằng cookie `session` (JWT). Lỗi dùng chung dạng:

```json
{ "error": { "code": "OUT_OF_RANGE", "message": "Bạn đang ở ngoài phạm vi lớp học (128 m)." } }
```

Ký hiệu quyền: 🅐 Admin · 🅖 Giảng viên (chỉ lớp của mình) · 🅢 Sinh viên (chỉ bản ghi của mình) · 🌐 công khai.

## 1. Xác thực

| Method | Path | Quyền | Body → Response |
|---|---|---|---|
| POST | `/api/auth/staff/login` | 🌐 | `{email, password}` → `{user:{id, fullName, role}}` + cookie |
| POST | `/api/auth/student/login` | 🌐 | `{studentCode}` → `{student:{id, code, fullName, consentAt, consentValid, hasActiveCard}}` + cookie phiên trình duyệt (không Max-Age; JWT + `user_sessions` hết hạn 2h, có `sid` thu hồi được). Thành công khi mã có ghi danh `active` trong ≥ 1 lớp chưa qua ngày kết thúc (lớp sắp mở vẫn tính). 401 `LOGIN_FAILED` với một thông báo chung cho mọi lý do — kể cả body sai kiểu/thừa trường (FR-083); 429 `RATE_LIMITED` (theo IP: 50 lượt thất bại/5 phút — đầy thì chặn mọi lượt từ IP đó; Polish T144: thay bằng Turnstile — và trần tổng 300 lượt/5 phút; theo mã: 5 lượt thất bại/5 phút, đăng nhập đúng không bao giờ bị khoá theo mã) + `security_events`. Thử thách chống bot sau 3 lần thất bại: chưa làm (cần dịch vụ CAPTCHA) |
| POST | `/api/auth/logout` | mọi vai trò | → 204 |
| GET | `/api/me` | mọi vai trò | → thông tin phiên |

## 2. Admin

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET/POST | `/api/admin/instructors` | 🅐 | Danh sách / tạo giảng viên |
| PATCH | `/api/admin/instructors/{id}` | 🅐 | Khoá, đặt lại mật khẩu |
| GET/PUT | `/api/admin/periods` | 🅐 | Xem / sửa bảng 16 tiết |
| GET | `/api/admin/students/{id}/card` | 🅐 🅖* | Thẻ của SV: `{card:{status, decodedCode, decodeMethod, reviewReasons:[DUPLICATE_FACE|LIVE_MISMATCH|NAME_MISMATCH], nameMatched, rosterName, ocrName (dòng họ tên OCR — chỉ lưu khi NAME_MISMATCH), liveSimilarity, duplicateOf:{studentId, code, fullName, similarity}|null, registeredAt, purgeAfter, cardUrl, portraitUrl}}` (URL ký 5 phút; dev pglite không có Supabase: data: URL từ kho cục bộ) |
| POST | `/api/admin/students/{id}/card/reset` | 🅐 🅖* | `{reason}` → thẻ hiệu lực thành `replaced` (giữ bản ghi, xoá ảnh + embedding), audit trong transaction + `security_events` `card_replaced`; SV đăng ký lại được. 404 `NO_CARD` |
| POST | `/api/admin/students/{id}/card/review` | 🅐 🅖* | `{decision:"approve"|"reject", note?}` cho thẻ `pending_review` → `active` / `deleted` (xoá ảnh + embedding). 409 `NOT_PENDING`. (*giảng viên: SV đang ghi danh trong lớp của mình, ngược lại 404) |
| GET | `/api/admin/attendance` | 🅐 | Dữ liệu điểm danh toàn trường (bộ lọc như mục 6) |

## 3. Lớp học & danh sách

| Method | Path | Quyền | Body → Response |
|---|---|---|---|
| GET | `/api/classes` | 🅖 🅐 | → `{classes:[{id, code, courseName, semester, startDate, endDate, defaultRoom, instructorId, activeStudents, schedules}]}` — giảng viên: lớp của mình; admin: mọi lớp |
| POST | `/api/classes` | 🅖 🅐 | `{code, courseName, semester?, startDate, endDate, defaultRoom?, schedules:[{weekday 2–8, shift? 1–5 \| firstPeriod+lastPeriod 1–16, room?}], radiusM? 10–500, checkinMinutes? 5–60, checkoutOffsetBeforeMin?, checkoutOffsetAfterMin?, leaveAutoApprove?, instructorId? (chỉ admin, bắt buộc)}` → 201 `{class}`. 422 `DURATION_EXCEEDED` (> 105 ngày) · `INVALID_DATE_RANGE` · `INVALID_SCHEDULE` (thứ/tiết/ca sai, tiết đầu > tiết cuối, chồng tiết cùng thứ) · `INSTRUCTOR_REQUIRED`; 409 `CLASS_CODE_EXISTS` |
| GET/PATCH | `/api/classes/{id}` | 🅖 🅐 | Xem / sửa (các trường như POST, đều tuỳ chọn; `schedules` thay toàn bộ lịch tuần, buổi đã tạo giữ nguyên) → `{class}`. 422 `END_BEFORE_LAST_SESSION` / `START_AFTER_FIRST_SESSION` nếu đổi ngày làm buổi học đã có nằm ngoài khoảng; `NOTHING_TO_UPDATE` |
| POST | `/api/classes/{id}/roster/preview` | 🅖 🅐 | multipart `{file (.xlsx/.csv ≤ 4 MB), columnMapping? (JSON {code,lastName,firstName,fullName,adminClass,cohort} → chỉ số cột), headerRowIndex?}` → `{headerRowIndex, headerCells:[...] (ô của dòng tiêu đề, hoặc dòng đầu khi không nhận ra — để ghép cột thủ công), columnsDetected (cột nhận ra được, kể cả khi còn thiếu), missing:[...], rows:[{rowNo, data, errors:[...]}], summary:{valid, invalid, new, reactivated, existing, toWithdraw}, warnings:[{code:'LARGE_WITHDRAWAL', toWithdraw, active} \| {code:'FORMULA_LIKE_NAMES', rows:[rowNo]} | {code:'ENCODING_LOSS', rows:[rowNo]} (file CSV bị mất dấu tiếng Việt — vd. Excel "CSV (Comma delimited)" trên Windows tiếng Anh; dòng có '?' trong họ/tên bị lỗi `LOST_CHARACTERS`)]}`. Không ghi DB |
| POST | `/api/classes/{id}/roster/commit` | 🅖 🅐 | multipart — gửi lại **chính file** đã xem trước (server không lưu file/bản xem trước): `{file, columnMapping?, headerRowIndex?, confirmLargeWithdrawal?: 'true'}` → `{result:{added, reactivated, existing, withdrawn}, invalidRows}`. Chỉ lưu dòng hợp lệ. 422 `MISSING_COLUMNS` / `EMPTY_ROSTER`; 409 `LARGE_WITHDRAWAL_CONFIRM_REQUIRED` khi sẽ rút > 50% SV đang học mà chưa xác nhận |
| GET | `/api/classes/{id}/cards` | 🅖 🅐 | → `{students:[{studentId, code, fullName, adminClass, card:{status:'active'|'pending_review'|'rejected'|'reset', reviewReasons (chỉ khác rỗng khi pending_review), registeredAt}|null}]}` — SV ghi danh `active` của lớp; không có ảnh/URL/embedding (xem chi tiết qua `GET /api/admin/students/{id}/card`) |
| POST/DELETE | `/api/classes/{id}/students/{studentCode}` | 🅖 🅐 | POST `{lastName?, firstName?, adminClass?, cohort?}` (bắt buộc họ + tên nếu SV chưa có trong hệ thống — 422 `STUDENT_INFO_REQUIRED`; 422 `INVALID_CODE`) → 201 ghi danh mới / 200 ghi danh lại hoặc không đổi: `{enrollment:{studentId, code, status}, changed}`. DELETE → `{enrollment, changed}` (đổi `withdrawn`, giữ lịch sử); 404 `NOT_ENROLLED` |

Lỗi chung của 2 API nhập file: 411 `LENGTH_REQUIRED` (thiếu `content-length`), 413 `PAYLOAD_TOO_LARGE` (`content-length` hoặc file > 4 MB, kiểm trước khi đọc body), 400 `BAD_FORM`, 422 `FILE_REQUIRED` / `INVALID_COLUMN_MAPPING` / `UNSUPPORTED_TYPE` / `TOO_MANY_ROWS` / `SUSPICIOUS_ARCHIVE` / `CORRUPT_FILE`, 429 `RATE_LIMITED` (20 lần/giờ/giảng viên, tính chung preview + commit). Mọi API có `{id}` kiểm quyền sở hữu lớp trước tiên — lớp của người khác trả 404.

## 4. Buổi học & khung giờ (giảng viên)

| Method | Path | Quyền | Body → Response |
|---|---|---|---|
| GET | `/api/classes/{id}/sessions/today` | 🅖 | Buổi theo lịch hôm nay (tiết, giờ, phòng) |
| POST | `/api/classes/{id}/sessions/open-checkin` | 🅖 | `{date?, firstPeriod?, lastPeriod?, room?, kind:'scheduled'|'makeup', lat, lng, accuracyM, checkinMinutes?}` → `{session, checkinWindow, checkoutWindow}`. Cảnh báo `LOW_GPS_ACCURACY` nếu accuracy > 50 m |
| PATCH | `/api/sessions/{id}` | 🅖 | `{room?, checkoutSkipped?}` — đổi phòng (trước `endsAt`), bỏ check-out |
| POST | `/api/sessions/{id}/spot-check` | 🅖 | `{minutes?}` → window |
| POST | `/api/windows/{id}/close` | 🅖 | Đóng sớm |

## 5. Sinh viên: thẻ & điểm danh

| Method | Path | Quyền | Body → Response |
|---|---|---|---|
| POST | `/api/student/consent` | 🅢 | `{version}` → 204. Lưu `consent_at` + `consent_version`; phiên bản phải bằng `CONSENT_VERSION` (`@utc/shared/consent`), sai → 422 `CONSENT_VERSION_MISMATCH`. Mọi API thẻ/khuôn mặt của SV trả 403 `CONSENT_REQUIRED` khi chưa đồng ý đúng phiên bản hiện hành |
| GET | `/api/geo/reverse?lat=&lng=` | 🅢 | Địa chỉ cho lớp phủ camera từ toạ độ của chính SV (cache ô 4 chữ số, rate limit 6/phút/SV); không trả gì về vị trí giảng viên (FR-031) |
| GET | `/api/student/classes` | 🅢 | → `{classes:[{classId, code, courseName, room, openWindow:{id, type, closesAt}|null}]}` — ghi danh `active`, lớp chưa qua ngày kết thúc; cần đã đồng ý (403 `CONSENT_REQUIRED`). `openWindow` luôn `null` tới khi có check-in (US2) |
| POST | `/api/student/card/nonce` | 🅢 | → `{nonce, expiresAt, challenge}` — `challenge` là `['left','right']` hoặc `['right','left']` (thử thách quay đầu ngẫu nhiên, FR-045a); nonce 2 phút, dùng một lần. **Chỉ preview/dev** (`VERCEL_ENV=preview`/`development` hoặc `pnpm dev`): thêm `yawDebug: true` — production không có trường này. 403 `CONSENT_REQUIRED` / `NOT_ENROLLED`; 409 `CARD_ALREADY_REGISTERED` / `CARD_PENDING_REVIEW`; 429 (6/phút) |
| GET | `/api/student/card` | 🅢 | → `{card:{status:'active'|'pending_review'|'rejected'|'reset', registeredAt}|null}` — `rejected` = giảng viên từ chối, `reset` = giảng viên/Admin đặt lại (cả hai: đăng ký lại được). Không có ảnh, embedding, lý do chờ duyệt hay ghi chú của giảng viên |
| POST | `/api/student/card` | 🅢 | multipart `{nonce, image, frames×3}`: `image` = ảnh thẻ (JPEG/PNG/WebP/HEIC ≤ 1 MB); `frames` = 3 khung mặt trực tiếp theo `challenge` — [hướng 1, nhìn thẳng, hướng 2], mỗi khung ≤ 1 MB; tổng ≤ 4 MB. **Công cụ so sánh yaw (chỉ preview/dev, khi nonce có `yawDebug: true`)**: client gửi thêm `clientYaw` = JSON `[số|null ×3]` (yaw MediaPipe lúc chụp); 201 và lỗi liveness (`LIVENESS_FAILED` / `LIVE_NO_FACE` / `LIVE_MULTIPLE_FACES`) kèm `yawDebug = {thresholds:{server,client}, reason: mã lỗi | 'SAME_PERSON_FAILED' | null, frames:[{frame, expected, faces, serverYaw, serverPose, clientYaw, ok}]}` — `thresholds` lấy từ `@utc/shared/face-yaw-thresholds` (hiện tại server `{centerMax: 0.18, turnMin: 0.22, turnMax: 0.8}`, client `{centerMax: 0.12, turnMin: 0.4, turnMax: 0.65}`; |yaw| ≤ centerMax thẳng · turnMin–turnMax quay hợp lệ · > turnMax quá mạnh); production bỏ qua `clientYaw`, không trả, không log. → 201 `{status:'active'|'pending_review', decodedCode}` (không trả lý do chờ duyệt). Thứ tự: đồng ý → thuộc lớp → chưa có thẻ → nonce → rate limit 6/giờ/SV → sanitize (bỏ EXIF) → mã vạch/OCR → chân dung → liveness 3 khung → so mặt trực tiếp ↔ chân dung thẻ → trùng 1:N → **chỉ khi qua hết mới lưu ảnh thẻ + chân dung**; khung mặt trực tiếp không bao giờ được lưu; thẻ bị từ chối không lưu file, không ghi DB. Chờ duyệt (`review_reasons`): `DUPLICATE_FACE`, `LIVE_MISMATCH` (cosine < `CARD_ACCEPT_ABOVE`), `NAME_MISMATCH`. 422 `CODE_MISMATCH` / `UNREADABLE` / `NO_PORTRAIT` / `MULTIPLE_FACES` / `LIVENESS_FAILED` / `LIVE_NO_FACE` / `LIVE_MULTIPLE_FACES` / `UNSUPPORTED_TYPE` / `VALIDATION_ERROR` (không đủ 3 khung); 403 `BAD_NONCE`; 413 ảnh > 1 MB hoặc tổng > 4 MB; 429 khi hết lượt; 503 `STORAGE_BUCKET_MISSING` / `STORAGE_UNAVAILABLE` / `OCR_UNAVAILABLE` (lỗi phía server đã phân loại — **lượt được hoàn**). Lượt: **6/giờ/SV** (hoàn khi 503 đã phân loại; lỗi 500 không phân loại thì không hoàn) + **trần tổng 20/giờ/SV** tính mọi lượt kể cả lượt được hoàn. Mọi lỗi sau khi đã tính lượt (trừ 500 không phân loại) kèm `error.remainingAttempts` = min(6 − lượt đã tính, 20 − tổng) (429 → 0); lỗi trước đó (chưa đồng ý, nonce sai) không tiêu lượt |
| POST | `/api/student/liveness-probe/nonce` | 🅢 | **Chỉ preview/dev** (production **404** `NOT_FOUND`). → `{nonce, expiresAt, challenge}` — cần đã đồng ý (403 `CONSENT_REQUIRED`), không cần thuộc lớp / chưa có thẻ; 429 (6/phút). Nonce purpose `card` với challenge bọc `{kind:'liveness_probe', challenge}` → không dùng được cho đăng ký thẻ (403 `BAD_NONCE`) và ngược lại |
| POST | `/api/student/liveness-probe` | 🅢 | **Chỉ preview/dev** (production **404**). multipart `{nonce, frames×3, clientYaw?}` → 200 `{passed, yawDebug}` (cấu trúc `yawDebug` như đăng ký thẻ). Chạy đúng pipeline liveness của đăng ký thẻ, không cần ảnh thẻ; **không lưu** ảnh / embedding / dòng DB / audit; **không trừ lượt đăng ký thẻ** — bộ đếm riêng **30/giờ/SV** (429). 403 `BAD_NONCE`; 413/422 như khung mặt của đăng ký thẻ |
| POST | `/api/windows/{id}/scan-nonce` | 🅢 | → `{nonce, challenge:['left','right'], expiresAt}` (2 phút). 403 `NOT_ENROLLED` / `NO_CHECKIN` / 409 `ALREADY_DONE` / 410 `WINDOW_CLOSED` / 412 `CARD_REQUIRED` |
| POST | `/api/windows/{id}/events` | 🅢 | multipart `{nonce, frames[3] (jpeg), lat, lng, accuracyM}` → xem dưới |

Response tạo lượt:

```json
{
  "result": "valid | suspect | rejected | retry",
  "reason": "ok | out_of_range | card_mismatch | card_borderline | duplicate_face | checkin_mismatch | liveness_failed | low_accuracy | no_face | multiple_faces",
  "distanceM": 23.4,
  "serverTime": "2026-11-14T00:07:12Z",
  "attemptsLeft": 2,
  "evidenceUrl": "https://…signed (5 phút)"
}
```

`retry` không tiêu tốn lượt thử (sai số GPS lớn, không thấy mặt, nhiều mặt).

## 6. Bảng điểm danh, lọc, xuất

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/classes/{id}/sheet?since=` | 🅖 | `{sessions:[{id, date, periods, room, windows}], rows:[{student, cells:{[sessionId]:{in, out}}, summary}], changedSince}` |
| GET | `/api/sessions/{id}/students/{studentId}/evidence` | 🅖 | Ảnh thẻ + ảnh In/Out (signed URL), distance, similarity, lịch sử override |
| POST | `/api/sessions/{id}/students/{studentId}/override` | 🅖 | `{windowType, newValue: 'valid'|'suspect'|'rejected'|'absent'|'excused', reason}` |
| POST | `/api/classes/{id}/query` | 🅖 | Body = `FilterSpec` (xem `ai-filter-spec.schema.json`) → `{columns, rows, total}` |
| POST | `/api/classes/{id}/export` | 🅖 | `{format:'xlsx'|'csv', filter?: FilterSpec, view:'sheet'|'query'}` → file |
| POST | `/api/assistant` | 🅖 | `{question, classId?}` → `{filterSpec, explanation, assumptions[], result:{columns, rows, total}} ` hoặc `{clarifyingQuestion}`; 403 `OUT_OF_SCOPE` cho yêu cầu ghi/lớp khác |

## 6b. Vắng có phép (US8)

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/student/leave/eligible-sessions` | 🅢 | Các buổi của hôm nay (giờ VN) thuộc các lớp của SV (FR-101) |
| POST | `/api/student/leave/extract` | 🅢 | multipart `{evidenceType:'document'|'chat', sessionIds[], images[1..3]}` → 422 `NOT_TODAY` nếu có buổi không thuộc hôm nay; `{draftId, extraction, checks, autoStatus}` (rate limit 10/giờ/SV) |
| POST | `/api/student/leave` | 🅢 | `{draftId, sessionIds[], reasonCategory, reasonText, note?}` → đơn |
| GET | `/api/student/leave` | 🅢 | Lịch sử đơn của tôi |
| GET | `/api/classes/{id}/leave?status=` | 🅖 | Danh sách đơn của lớp |
| POST | `/api/leave/{id}/decision` | 🅖 | `{decision:'approve'|'reject'|'revoke', reason?}` |
| POST | `/api/classes/{id}/leave/approve-passed` | 🅖 | Duyệt hàng loạt đơn `passed` |
| PATCH | `/api/classes/{id}` | 🅖 | thêm `{leaveAutoApprove}` (chỉ áp dụng minh chứng giấy tờ) |

## 6c. Hồ sơ điểm danh & phản hồi (US9)

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| POST | `/api/scan-sessions/{id}/client-error` | 🅢 | `{code, detail}` — lỗi thiết bị (FR-111) |
| GET | `/api/sessions/{id}/students/{studentId}/records` | 🅖 | Dòng thời gian `{scanSessions[], events:[{record, narrative}]}` |
| GET | `/api/classes/{id}/records/export?scope=cell|session|class&format=json|txt` | 🅖 | Tải hồ sơ (FR-118) |
| POST | `/api/student/disputes` | 🅢 | `{sessionId, message, attachment?}` |
| GET | `/api/student/disputes` | 🅢 | Phản hồi của tôi + kết quả |
| GET | `/api/classes/{id}/disputes?status=open` | 🅖 | Phản hồi chờ xử lý |
| POST | `/api/disputes/{id}/resolve` | 🅖 | `{action:'keep'|'change', note, newValue?, windowType?}` (change → tạo manual_override) |

## 7. Cron

| Method | Path | Bảo vệ | Mô tả |
|---|---|---|---|
| GET | `/api/cron/purge` | header `Authorization: Bearer $CRON_SECRET` | Xoá ảnh + embedding của events có `purge_after < now()`; thẻ, ảnh vắng phép, hồ sơ JSON, scan_sessions, phản hồi quá hạn; nonce hết hạn |
