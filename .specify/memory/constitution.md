<!--
Sync Impact Report
- Version: 2.5.0 → 2.5.1 (PATCH: ghi rõ cấu trúc monorepo apps/web + packages/backend, database, shared)
- Trước đó: 2.4.1 → 2.5.0 (MINOR: IV đổi hạn giữ ảnh thẻ thành 30 ngày sau khi lớp cuối kết thúc để khớp hạn phản hồi; PATCH II: liveness theo thử thách quay đầu ngẫu nhiên; kết quả /speckit-analyze 2026-11-07)
- Trước đó: 2.4.0 → 2.4.1 (PATCH: làm rõ ngoại lệ VIII bao gồm ảnh chụp màn hình chat xin phép; đơn dùng ảnh chat không tự duyệt)
- Trước đó: 2.3.0 → 2.4.0 (MINOR: III cho phép tự duyệt vắng phép có thể huỷ; IV thêm hồ sơ điểm danh JSON và minh chứng vắng phép; VIII cho phép AI đọc ảnh giấy tờ vắng phép)
- Trước đó: 2.2.0 → 2.3.0 (MINOR: thêm Nguyên tắc IX — Bảo mật theo chiều sâu & chống lạm dụng)
- Trước đó: 2.1.0 → 2.2.0 (MINOR: thêm Nguyên tắc VIII — Trợ lý AI chỉ đọc, giới hạn theo quyền)
- Trước đó: 2.0.0 → 2.1.0 (MINOR: thêm lớp kiểm tra khuôn mặt với ảnh thẻ sinh viên vào Nguyên tắc II; quy định lưu ảnh thẻ ở Nguyên tắc IV)
- Trước đó: 1.0.0 → 2.0.0 (MAJOR: định nghĩa lại Nguyên tắc II và IV)
- Nguyên tắc sửa: II (bỏ so khớp 1:1 với khuôn mặt mẫu; thêm khớp khuôn mặt giữa các lượt của cùng mã trong một buổi),
  IV (không lưu khuôn mặt mẫu; ảnh + đặc trưng xoá sau 7 ngày)
- Lý do: kết quả /speckit-clarify ngày 2026-11-07 (đăng nhập chỉ bằng mã SV, không khuôn mặt mẫu, lưu bằng chứng 7 ngày)
- Templates cần rà lại: ✅ plan-template.md (mục Constitution Check sẽ đối chiếu các nguyên tắc dưới đây)
  ✅ spec-template.md (không đổi) ✅ tasks-template.md (không đổi)
- TODO hoãn lại: không có
-->

# UTC Face Attendance Constitution

Hệ thống điểm danh sinh viên bằng nhận diện khuôn mặt + xác minh GPS cho Trường Đại học Giao thông Vận tải (UTC).

## Core Principles

### I. Server là nguồn sự thật duy nhất (NON-NEGOTIABLE)
Mọi quyết định điểm danh (hợp lệ / nghi vấn / từ chối) MUST được đưa ra ở server.
- Client MUST NOT tự tính vector khuôn mặt làm căn cứ quyết định; server nhận ảnh gốc và tự trích xuất.
- Thời gian điểm danh MUST lấy theo đồng hồ server, không theo thiết bị.
- Toạ độ tâm của giảng viên MUST NOT được gửi xuống thiết bị sinh viên dưới bất kỳ dạng nào (kể cả mã hoá).
- Chữ in trên ảnh (giờ, địa chỉ) chỉ để hiển thị; MUST NOT dùng làm căn cứ xác minh.
- Mỗi lần quét MUST gắn một nonce dùng một lần do server cấp, hết hạn ngắn, để chống gửi lại (replay).

### II. Chống điểm danh hộ nhiều lớp
Một lượt điểm danh chỉ hợp lệ khi qua TẤT CẢ các lớp kiểm tra:
1. Sinh viên thuộc danh sách lớp của buổi và khung giờ đang mở.
2. Liveness (thử thách quay đầu ngẫu nhiên do server cấp) đạt.
3. Khuôn mặt khớp ảnh chân dung trên thẻ sinh viên đã đăng ký của chính mã đó (thẻ được chụp trực tiếp, mã trên thẻ khớp mã đăng nhập).
3b. Khuôn mặt không trùng khuôn mặt của mã sinh viên khác trong cùng khung giờ (1:N).
4. Với check-out / kiểm tra đột xuất: khuôn mặt khớp lượt check-in hợp lệ của chính mã đó trong cùng buổi.
5. Vị trí trong bán kính cho phép so với vị trí giảng viên lúc mở khung giờ.
Phát hiện trùng khuôn mặt MUST đánh dấu *nghi vấn* cho TẤT CẢ các lượt liên quan để giảng viên phán quyết; MUST NOT tự động từ chối riêng lượt đến sau.

### III. Con người có quyền quyết định cuối cùng
Giảng viên MUST luôn có thể xem bằng chứng (ảnh, khoảng cách, độ khớp) và sửa trạng thái thủ công. Mọi chỉnh sửa MUST ghi audit log: ai, lúc nào, giá trị cũ/mới, lý do (bắt buộc).
Tự động hoá chỉ được dùng cho quyết định có lợi cho sinh viên và đảo ngược được (ví dụ tự duyệt đơn vắng phép có minh chứng giấy tờ đạt kiểm tra khi giảng viên bật; minh chứng dạng ảnh chụp màn hình chat luôn cần giảng viên xác nhận); mọi quyết định tự động MUST hiển thị cho giảng viên và huỷ được. Mỗi quyết định điểm danh MUST có hồ sơ giải thích đủ để xem lại sau khi ảnh bị xoá.

### IV. Bảo vệ dữ liệu sinh trắc học
Dữ liệu khuôn mặt là dữ liệu cá nhân nhạy cảm.
- MUST có sự đồng ý rõ ràng của sinh viên trước lần chụp đầu tiên.
- Ảnh tham chiếu duy nhất được lưu là ảnh thẻ sinh viên; MUST tự xoá 30 ngày sau khi lớp cuối cùng của sinh viên kết thúc. Ảnh và đặc trưng của mỗi lượt điểm danh MUST tự xoá sau 7 ngày.
- Ảnh và vector MUST lưu ở storage riêng tư, chỉ truy cập qua URL ký có thời hạn; MUST NOT công khai.
- Chỉ giảng viên của lớp và Admin được xem ảnh bằng chứng của lớp đó.
- MUST NOT ghi vector/ảnh vào log ứng dụng.
- Hồ sơ điểm danh dạng JSON (thời gian, vị trí làm tròn, kết quả từng bước, điểm tương đồng, chất lượng ảnh, mã băm) MUST được giữ đến 30 ngày sau khi lớp kết thúc để giải quyết thắc mắc; MUST NOT chứa ảnh, vector hay suy đoán nhân khẩu học (giới tính, tuổi, dân tộc…).
- Ảnh minh chứng vắng phép là dữ liệu cá nhân (có thể chứa thông tin sức khoẻ): lưu riêng tư, chỉ giảng viên của lớp xem, xoá 30 ngày sau khi lớp kết thúc.

### V. Phân quyền theo vai trò (RBAC) ở mọi endpoint
Ba vai trò: Admin, Giảng viên, Sinh viên. Mọi API MUST xác thực JWT và kiểm tra vai trò + quyền sở hữu tài nguyên (giảng viên chỉ thao tác lớp của mình; sinh viên chỉ thao tác bản ghi của mình). Mặc định là từ chối.

### VI. Kiểm thử bắt buộc cho logic quyết định
Các hàm quyết định (Haversine, phát hiện trùng 1:N, khớp check-in ↔ check-out, tổng hợp trạng thái buổi, nhập danh sách lớp) MUST có unit test viết trước khi cài đặt. Luồng check-in/check-out đầu-cuối MUST có integration test. Ngưỡng nhận diện MUST được hiệu chỉnh trên dữ liệu thử, ghi lại tỉ lệ nhận nhầm/từ chối nhầm.

### VII. Đơn giản, đủ dùng
Thiết kế cho ~100 người dùng đồng thời, không hơn. Ưu tiên giải pháp có sẵn của nền tảng; mọi thành phần phụ thêm (hàng đợi, cache, service riêng) MUST được giải thích trong plan. Bảng điểm danh dạng cột theo ngày là *view* dựng từ dữ liệu dạng dòng; MUST NOT thay đổi schema khi có buổi mới.

### VIII. Trợ lý AI chỉ đọc và bị giới hạn theo quyền
Trợ lý AI cho giảng viên MUST chỉ sinh bộ lọc/truy vấn có cấu trúc thuộc tập thao tác được định nghĩa sẵn (lọc, sắp xếp, đếm, tổng hợp); MUST NOT sinh hay chạy SQL tự do. Server MUST áp dụng phạm vi lớp của giảng viên lên mọi truy vấn trước khi chạy, bất kể trợ lý sinh ra gì. Trợ lý MUST NOT ghi dữ liệu và MUST NOT nhận ảnh, ảnh thẻ hay đặc trưng khuôn mặt. Dữ liệu cá nhân của sinh viên MUST NOT gửi tới dịch vụ AI bên ngoài khi không cần thiết để trả lời.
Ngoại lệ duy nhất: ảnh giấy tờ minh chứng vắng phép hoặc ảnh chụp màn hình đoạn chat xin phép giảng viên được gửi tới dịch vụ AI đọc ảnh để trích xuất, sau khi sinh viên được thông báo; đầu ra MUST khớp schema và chỉ là gợi ý cho bước kiểm tra. Ảnh khuôn mặt MUST NOT gửi tới bất kỳ dịch vụ AI bên ngoài nào.

### IX. Bảo mật theo chiều sâu & chống lạm dụng
- Mọi endpoint công khai MUST có giới hạn tần suất ở biên (WAF) và ở ứng dụng (theo IP + theo danh tính); thao tác tốn CPU (nhận diện, OCR, AI) MUST bị chặn trước khi xử lý nếu thiếu nonce/quyền.
- Áp dụng OWASP Top 10 làm danh mục kiểm tra bắt buộc: truy vấn tham số hoá, kiểm tra đầu vào bằng schema, CSP + header bảo mật, chống CSRF, kiểm tra quyền sở hữu theo ID, kiểm tra file tải lên, vô hiệu hoá công thức khi xuất Excel/CSV.
- Không có bí mật nào ở client; khoá service-role của DB/Storage chỉ dùng ở server.
- Sự kiện bảo mật MUST được ghi log có cấu trúc và có cảnh báo; quét lỗ hổng phụ thuộc mỗi lần build, High/Critical chặn triển khai.
- Mọi tính năng mới MUST được đánh giá "có thể bị lạm dụng thế nào" trong plan trước khi cài đặt.

## Ràng buộc kỹ thuật & triển khai

- **Stack**: Next.js (App Router, TypeScript) full-stack; API qua Route Handlers chạy Vercel Serverless Functions.
- **Cấu trúc monorepo (pnpm workspaces)**: `apps/web` (giao diện + route mỏng), `packages/backend` (logic server), `packages/database` (schema, migration, truy cập DB), `packages/shared` (mã dùng chung). Phụ thuộc một chiều web → backend → database → shared; giao diện MUST NOT truy cập database trực tiếp.
- **Database**: PostgreSQL (Supabase hoặc Neon) có `pgvector`; MUST dùng connection pooler / serverless driver.
- **Nhận diện khuôn mặt**: trích xuất embedding ở server; client chỉ được chạy model nhẹ để hướng dẫn người dùng (căn khung mặt, liveness UX).
- **Bí mật**: chuỗi kết nối, JWT secret, API key bản đồ MUST nằm trong Vercel Environment Variables; MUST NOT commit vào repo.
- **Ngôn ngữ giao diện**: tiếng Việt; múi giờ hiển thị Asia/Ho_Chi_Minh; lưu trữ UTC.
- **Thiết bị mục tiêu**: trình duyệt di động hiện đại (Chrome Android, Safari iOS) qua HTTPS.

## Quy trình phát triển & cổng chất lượng

- Quy trình Spec Kit: constitution → specify → clarify → plan → checklist → tasks → analyze → implement.
- Mỗi plan MUST có mục Constitution Check đối chiếu nguyên tắc I–VII; vi phạm phải được ghi lý do trong Complexity Tracking.
- Trước khi merge: lint + type-check + test xanh; thay đổi liên quan auth/sinh trắc học cần tự review lại theo Nguyên tắc I, IV, V.

## Governance

Constitution này được ưu tiên trên mọi hướng dẫn khác của dự án. Sửa đổi MUST ghi lại trong Sync Impact Report ở đầu file và tăng phiên bản theo SemVer: MAJOR khi bỏ/định nghĩa lại nguyên tắc, MINOR khi thêm nguyên tắc/mục, PATCH khi làm rõ câu chữ. Mỗi lần `/speckit-analyze` MUST kiểm tra tuân thủ; xung đột với constitution được xếp mức CRITICAL.

**Version**: 2.5.1 | **Ratified**: 2026-11-07 | **Last Amended**: 2026-11-07
