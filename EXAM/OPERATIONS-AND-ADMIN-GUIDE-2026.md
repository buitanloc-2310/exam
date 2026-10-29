# HƯỚNG DẪN CẤU HÌNH, QUẢN TRỊ `/admin`, VẬN HÀNH KHẢO THÍ, TRIỂN KHAI & KHÔI PHỤC — SKY FIRST EXAM 2026 (v5.0.0)

**Đơn vị:** Hệ Thống Khảo Thí Và Đánh Giá Sky First  
**Hệ thống:** Mạng lưới Giáo dục và Phát triển Cộng đồng Sky First (`SKY FIRST NETWORK`)  

Tài liệu này cung cấp đầy đủ:
1. **Hướng dẫn cấu hình biến môi trường, D1/R2 binding và dịch vụ email** (Điều 46.5).
2. **Hướng dẫn thiết lập và sử dụng hệ thống quản trị `/admin`** (Điều 46.6).
3. **Hướng dẫn vận hành toàn trình một kỳ thi trên EXAM** (Điều 46.7).
4. **Kế hoạch triển khai, kiểm tra sau triển khai, sao lưu (Backup), phục hồi (Restore) và hoàn nguyên (Rollback)** (Điều 38 & Điều 46.8).

---

## PHẦN 1. HƯỚNG DẪN CẤU HÌNH HỆ THỐNG & DỊCH VỤ EMAIL (ĐIỀU 46.5)

### 1.1. Tài nguyên Binding trong `wrangler.json` (Giữ nguyên bảo toàn)

Hệ thống sử dụng cấu hình tài nguyên đã được khai báo trong `wrangler.json`:
- **Cloudflare D1 Database (`DB`)**:
  - `binding`: `"DB"`
  - `database_name`: `"scrd-files"`
  - `database_id`: `"6006fe24-6278-4989-8d94-fd4734d71679"`
- **Cloudflare R2 Bucket (`FILES`)**:
  - `binding`: `"FILES"`
  - `bucket_name`: `"scrd-files"`
- **Static Assets (`ASSETS`)**:
  - `directory`: `"./public"`
  - `not_found_handling`: `"single-page-application"`
  - `run_worker_first`: `true`

> **Nguyên tắc an toàn:** Tuyệt đối không đổi tên binding `DB` hoặc `FILES`, không xóa bảng dữ liệu đang vận hành.

### 1.2. Biến môi trường & Bí mật (Cloudflare Secrets)

Không lưu khóa bí mật vào tệp `.env` trong gói mã nguồn hoặc commit lên kho lưu trữ. Thiết lập các biến bí mật qua lệnh `wrangler secret put`:

| Tên biến môi trường / Secret | Mức độ | Mô tả và mục đích sử dụng |
|---|---|---|
| `ADMIN_BOOTSTRAP_TOKEN` | Bắt buộc khi khởi tạo | Mã bí mật dùng một lần hoặc dùng trong giai đoạn thiết lập quản trị viên hệ thống (`system_admin`) đầu tiên tại `/admin`. Nên đặt chuỗi ngẫu nhiên tối thiểu 32 ký tự và xóa/xoay vòng sau khi đã provision xong quản trị viên đầu tiên. |
| `EMAIL_API_URL` | Bắt buộc để gửi OTP thật | Endpoint HTTP POST của dịch vụ gửi email giao dịch (ví dụ: Resend `https://api.resend.com/emails`, Mailchannels, SendGrid hoặc cổng thư nội bộ của Sky First nhận payload JSON `{ from, to, subject, text, html }`). |
| `EMAIL_API_KEY` | Bắt buộc để gửi OTP thật | Khóa API Bearer xác thực với `EMAIL_API_URL`. |
| `EMAIL_FROM` | Khuyến nghị | Địa chỉ người gửi hiển thị trên email OTP (mặc định: `no-reply@exam.skyfirst.io.vn`). Tên miền gửi cần được cấu hình đầy đủ bản ghi DNS **SPF, DKIM và DMARC** để tránh rơi vào hộp thư rác. |

Lệnh thiết lập trên môi trường được ủy quyền:
```bash
npx wrangler secret put ADMIN_BOOTSTRAP_TOKEN
npx wrangler secret put EMAIL_API_URL
npx wrangler secret put EMAIL_API_KEY
npx wrangler secret put EMAIL_FROM
```

---

## PHẦN 2. HƯỚNG DẪN SỬ DỤNG HỆ THỐNG QUẢN TRỊ `/admin` (ĐIỀU 46.6)

### 2.1. Thiết lập Quản trị viên đầu tiên an toàn (Provisioning)

Hệ thống **không** tự động cấp quyền quản trị cho bất kỳ địa chỉ email nào (kể cả `skyfirst.ec@gmail.com`) nếu chưa được provision hợp lệ trong cơ sở dữ liệu. Để cấp quyền cho quản trị viên đầu tiên:

1. Đảm bảo biến `ADMIN_BOOTSTRAP_TOKEN` đã được cấu hình trên Worker.
2. Truy cập đường dẫn `/admin` trên trình duyệt.
3. Mở mục **“Khởi tạo Quản trị viên đầu tiên”** ở cuối trang đăng nhập.
4. Nhập chính xác `ADMIN_BOOTSTRAP_TOKEN`, địa chỉ email quản trị viên (ví dụ: `skyfirst.ec@gmail.com` hoặc email cán bộ khảo thí được ủy quyền) và Họ tên.
5. Bấm **“Kích hoạt quyền Quản trị hệ thống”**. Hệ thống sẽ tạo/cập nhật bản ghi trong bảng `users` với vai trò `["system_admin"]` và ghi nhận sự kiện `admin.bootstrap.provisioned` vào nhật ký kiểm toán.

### 2.2. Quy trình Đăng nhập Quản trị bằng OTP

1. Tại trang `/admin`, nhập địa chỉ email đã được cấp quyền vào ô **Email quản trị viên**.
2. Bấm **“1. Yêu cầu gửi mã OTP”**.
   - Nếu email chưa được cấp quyền, máy chủ từ chối ngay với mã `403 ADMIN_NOT_PROVISIONED`.
   - Nếu hợp lệ, máy chủ tạo mã OTP 6 chữ số có hiệu lực trong **5 phút** (chỉ dùng 1 lần, tối đa 5 lần thử sai, thời gian chờ gửi lại 60 giây) và gửi tới hộp thư.
3. Nhập 6 chữ số OTP và bấm **“2. Xác minh OTP & Đăng nhập”**.
4. Máy chủ thiết lập phiên quản trị có thời hạn **8 giờ** (kèm Cookie `HttpOnly; Secure; SameSite=Strict` và `X-CSRF-Token`).

### 2.3. Ma trận 10 Vai trò Phân quyền (RBAC) trong `/admin`

Quản trị viên hệ thống (`system_admin`) hoặc Quản trị tài khoản (`account_admin`) có thể phân quyền cho các cán bộ tại tab **Phân quyền RBAC (`/admin/users`)**:

| Mã vai trò (`role`) | Tên vai trò nghiệp vụ | Quyền hạn được phép thực hiện trên máy chủ |
|---|---|---|
| `system_admin` | Quản trị hệ thống | Toàn quyền quản trị hệ thống, cấu hình, phân quyền và kiểm toán. |
| `exam_admin` | Quản trị kỳ thi | Tạo, sửa, mở/đóng/lưu trữ kỳ thi, quản lý câu hỏi, ghi danh thí sinh, giám sát phòng thi và xem kết quả/kiểm toán. |
| `question_bank_manager` | Quản lý ngân hàng câu hỏi | Tạo, sửa, phiên bản hóa và nhập/xuất ngân hàng câu hỏi. |
| `exam_author` | Cán bộ ra đề | Soạn thảo câu hỏi và cấu hình dự thảo đề thi (`draft`). |
| `proctor` | Cán bộ coi thi / Giám sát | Xem bảng giám sát trực tiếp, khóa phiên thi (`lock`), mở khóa (`unlock`), cộng bù thời gian (`add_time`), giải phóng thiết bị (`release_lease`). |
| `grader` | Cán bộ chấm thi | Xem bài làm đã nộp và chấm điểm các câu hỏi tự luận/tệp đính kèm. |
| `result_approver` | Người duyệt & công bố kết quả | Duyệt điểm (`approve`), công bố kết quả (`publish`), hoặc thu hồi công bố (`revoke`) kèm lý do kiểm toán. |
| `appeal_officer` | Cán bộ xử lý phúc khảo | Tiếp nhận đơn phúc khảo, cập nhật điểm sau phúc khảo và ghi kết luận giải quyết. |
| `report_viewer` | Người xem báo cáo | Chỉ có quyền xem Dashboard, danh sách kỳ thi, tiến độ và nhật ký kiểm toán (Read-only). |
| `account_admin` | Quản trị tài khoản | Cấp mới, thay đổi vai trò hoặc thu hồi quyền quản trị của các tài khoản. |

> **Thu hồi quyền khẩn cấp:** Khi chuyển trạng thái tài khoản sang `revoked` hoặc `locked` tại tab **Phân quyền RBAC**, hệ thống lập tức hủy mọi phiên đăng nhập hiện hành của người đó.

---

## PHẦN 3. HƯỚNG DẪN VẬN HÀNH KỲ THI TRÊN EXAM (ĐIỀU 46.7)

### Bước 1: Chuẩn bị Ngân hàng câu hỏi (`/admin/questions`)
- Thêm từng câu hỏi hoặc nhập danh sách câu hỏi JSON qua API `/api/admin/questions/import`.
- Hỗ trợ 14 loại câu hỏi: `mcq` (1 lựa chọn), `multi` (nhiều lựa chọn), `truefalse` (Đúng/Sai), `matching` (ghép cặp `Vế trái|||Vế phải`), `ordering` (sắp xếp thứ tự), `fill` (điền từ), `short` (trả lời ngắn), `numeric` (số học có `numeric_tolerance`), `math` (toán học), `essay` (tự luận), `long` (bài viết dài), `structured` (có cấu trúc), `file` / `image` / `audio` (nộp tệp hoặc ghi âm trực tiếp).
- Mọi lần chỉnh sửa câu hỏi tự động tăng số phiên bản (`version`) và lưu bản chụp vào `exam_question_versions`.

### Bước 2: Tạo và Cấu hình Kỳ thi (`/admin/exams`)
- Nhập Mã kỳ thi (`id`), Mã mời công khai (`public_token`), Tiêu đề, Thời lượng (phút), Số lượt thi tối đa (`max_attempts`), Điểm đạt (`passing_score`), Khung giờ mở/đóng (`opens_at`, `closes_at`).
- Chọn **Chính sách bảo mật**:
  - Bật `Strict Mode` và `Fullscreen Required` nếu yêu cầu thí sinh làm bài toàn màn hình.
  - Chọn hồ sơ `STRICT_LOCK` hoặc đặt `violation_threshold` (ví dụ: `2`) để máy chủ tự động khóa phiên thi khi phát hiện thí sinh rời trang vượt ngưỡng.
  - Bật `Require Email Verify` nếu yêu cầu thí sinh phải xác minh OTP 6 số qua email trước khi mở đề.
  - Tắt `Public Access` nếu chỉ cho phép thí sinh nằm trong danh sách ghi danh (`exam_enrollments`) được vào thi.

### Bước 3: Mở kỳ thi & Niêm phong gói đề (`Publish`)
- Trên bảng danh sách kỳ thi, bấm **“Mở kỳ thi (Publish)”**.
- Hệ thống tự động kiểm tra đề thi có câu hỏi hợp lệ, tạo bản niêm phong bất biến trong bảng `assessment_exam_versions` và chuyển trạng thái kỳ thi sang `published`.
- **Quy tắc bảo vệ công bằng:** Khi kỳ thi đang có thí sinh làm bài (`active_attempts > 0`), máy chủ tự động chặn mọi thao tác sửa câu hỏi, đáp án hoặc thời lượng làm bài.

### Bước 4: Ghi danh Thí sinh hoặc Cấp Launch Token (`/admin/candidates`)
- **Cách 1 (Qua cổng mời `/join/<Mã-mời>`):** Ghi danh danh sách thí sinh (Họ tên, Email, Mã thí sinh, Đơn vị) tại mục **Ghi danh thí sinh vào kỳ thi**.
- **Cách 2 (Cấp liên kết trực tiếp `/?launch=<Token>`):** Sử dụng biểu mẫu **Cấp mã khởi chạy một lần (Launch Token)** để tạo liên kết cá nhân hóa cho từng thí sinh.

### Bước 5: Giám sát phòng thi trực tiếp (`/admin/monitor`)
- Theo dõi thời gian lưu bài gần nhất, số revision và số lượng tín hiệu trình duyệt (`visibility_hidden`, `window_blur`, `fullscreen_exit`, `copy_blocked`, `paste_blocked`).
- Nếu thí sinh bị khóa bài do sự cố khách quan (mất điện, thông báo hệ điều hành làm thoát toàn màn hình), cán bộ coi thi bấm **“Mở khóa”** (hệ thống lưu nhật ký kiểm toán kèm lý do).
- Nếu thí sinh cần đổi máy tính do hỏng thiết bị, bấm **“Đổi thiết bị”** (`release_lease`) để giải phóng khóa phiên cho phép thí sinh đăng nhập lại trên thiết bị mới.

### Bước 6: Chấm điểm tự luận, Duyệt và Công bố kết quả (`/admin/grading` & `/admin/appeals`)
1. Sau khi thí sinh nộp bài, các câu trắc nghiệm/số học/ngắn được máy chủ chấm tự động ngay lập tức từ snapshot đã lưu.
2. Nếu đề thi có câu hỏi tự luận/tệp đính kèm, bài thi ở trạng thái `marking` và điểm số được giữ kín (`show_score: false`).
3. Cán bộ chấm thi (`grader`) mở chi tiết bài làm tại `/admin/grading`, tải tệp trả lời (nếu có), nhập điểm từng câu tự luận và nhận xét. Hệ thống tự động cộng tổng điểm.
4. Khi toàn bộ câu tự luận đã chấm xong (`pending_manual = 0`), Người duyệt kết quả (`result_approver`) bấm **“Duyệt điểm”** (`approved`) rồi bấm **“Công bố kết quả”** (`published`).
5. Sau khi công bố, điểm số được khóa bảo vệ (`PUBLISHED_RESULT_PROTECTED`). Thí sinh có thể tra cứu kết quả bằng **Mã biên nhận (`EXM-...`)** + **Mã thí sinh** ngay trên trang chủ và gửi đơn phúc khảo nếu cần.

---

## PHẦN 4. KẾ HOẠCH TRIỂN KHAI, BACKUP, PHỤC HỒI & ROLLBACK (ĐIỀU 38 & 46.8)

> **Cảnh báo tuân thủ (Điều 45):** Không tự ý chạy lệnh deploy hoặc chạy migration lên production khi chưa có phê duyệt bằng văn bản của Chủ sở hữu hệ thống Sky First.

### 4.1. Quy trình Sao lưu (Backup) trước khi triển khai

1. **Sao lưu Cơ sở dữ liệu Cloudflare D1 (`scrd-files`)**:
   ```bash
   npx wrangler d1 export scrd-files --remote --output=backup-scrd-files-$(date +%Y%m%d-%H%M%S).sql
   ```
2. **Kiểm tra tính toàn vẹn của tệp Backup D1**:
   - Kiểm tra dung lượng tệp `.sql` khác 0 và chứa đầy đủ câu lệnh `CREATE TABLE` + `INSERT INTO` của 16 bảng hiện hữu.
   - Nạp thử tệp backup vào SQLite cục bộ để xác minh không có lỗi cú pháp SQL:
     ```bash
     sqlite3 /tmp/verify-backup.db < backup-scrd-files-*.sql
     ```

### 4.2. Các bước Triển khai có kiểm soát (Staging → Production)

1. **Bước 1 — Kiểm tra gói mã nguồn và chạy toàn bộ bộ kiểm thử cục bộ**:
   ```bash
   npm run build
   ```
   Chỉ tiếp tục khi toàn bộ **65/65 bài kiểm thử** báo `PASS`.
2. **Bước 2 — Áp dụng Migration không phá hủy dữ liệu**:
   Tệp `migrations/0001_exam_standalone_schema.sql` chỉ sử dụng `CREATE TABLE IF NOT EXISTS` và `CREATE INDEX IF NOT EXISTS`, không xóa hay sửa đổi bất kỳ dữ liệu nào đang có:
   ```bash
   npx wrangler d1 execute scrd-files --remote --file=migrations/0001_exam_standalone_schema.sql
   ```
3. **Bước 3 — Cấu hình Secrets (nếu chưa đặt)**:
   Đặt `ADMIN_BOOTSTRAP_TOKEN`, `EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM`.
4. **Bước 4 — Triển khai Worker & Static Assets**:
   ```bash
   npm run deploy
   ```

### 4.3. Kiểm tra sau triển khai (Post-Deployment Verification)

1. Gọi `GET https://exam.skyfirst.io.vn/health`:
   - Xác nhận HTTP `200 OK`, `"status": "available"`, `"version": "5.0.0"`, `"slc_dependency": "removed"`, `"missing": []` (đầy đủ 16 bảng cốt lõi và R2 binding).
2. Mở `https://exam.skyfirst.io.vn/` và `https://exam.skyfirst.io.vn/admin`:
   - Kiểm tra giao diện hiển thị phông chữ Times New Roman, không có lỗi CSP trong Console.
3. Thực hiện khởi tạo quản trị viên đầu tiên tại `/admin` và đăng nhập thử bằng OTP.

### 4.4. Quy trình Hoàn nguyên (Rollback) và Phục hồi khi gặp sự cố

1. **Hoàn nguyên phiên bản Worker (Code Rollback)**:
   - Sử dụng tính năng Rollback tức thời của Cloudflare Workers để quay về deployment ổn định ngay trước đó mà không ảnh hưởng dữ liệu D1/R2:
     ```bash
     npx wrangler deployments list
     npx wrangler rollback
     ```
2. **Hoàn nguyên Schema / Khôi phục dữ liệu D1**:
   - Vì `0001_exam_standalone_schema.sql` chỉ bổ sung các bảng mới (`exam_otp_challenges`, `exam_admin_sessions`, `exam_question_bank`, `exam_question_versions`, `exam_enrollments`, `exam_appeals`, `exam_support_requests`, `exam_rate_limits`) và giữ nguyên toàn bộ 16 bảng cũ, phiên bản Worker cũ hoàn toàn tương thích với cơ sở dữ liệu sau migration mà không cần xóa bảng.
   - Trong trường hợp cần khôi phục dữ liệu từ bản sao lưu `.sql` vào môi trường thử nghiệm/khôi phục:
     ```bash
     npx wrangler d1 execute scrd-files --remote --file=backup-scrd-files-YYYYMMDD-HHMMSS.sql
     ```
3. **Bảo vệ và khôi phục tệp R2 (`scrd-files`)**:
   - Khi thí sinh tải lại tệp trả lời mới cho cùng một câu hỏi, hệ thống chỉ đánh dấu bản ghi cũ trong `assessment_response_files` là `replaced` mà **không xóa vật lý object cũ trên R2**, đảm bảo luôn có thể tra cứu và khôi phục tệp bài làm gốc khi đối chiếu hoặc phúc khảo.
