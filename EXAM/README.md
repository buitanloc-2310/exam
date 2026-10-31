# MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST
## Hệ Thống Khảo Thí Và Đánh Giá Sky First (v7.0.0 — 50-File Modular Architecture)

- **Đơn vị chủ quản:** Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First (`SKY FIRST NETWORK`)
- **Tên hệ thống:** Hệ Thống Khảo Thí Và Đánh Giá Sky First
- **Tên miền chính:** `https://exam.skyfirst.io.vn`
- **Tên miền bổ sung:** `https://www.exam.skyfirst.io.vn`
- **Tài khoản chủ hệ thống tối cao:** `Skyfirst.ec@gmail.com` (`system_owner`, `system_admin`)
- **Email gửi OTP xác thực:** `noreply@skyfirst.io.vn`
- **Cơ sở dữ liệu D1:** `scrd-files` (`6006fe24-6278-4989-8d94-fd4734d71679`, Binding `DB`)
- **Kho lưu trữ R2:** `scrd-files` (Binding `FILES`)
- **Quy mô mã nguồn bàn giao:** Chính xác **50 tệp** thuộc phạm vi dự án (kiểm chứng tự động).

---

## 1. Danh mục 14 URL hoạt động trên 2 tên miền (`exam.skyfirst.io.vn` & `www.exam.skyfirst.io.vn`)

| STT | Đường dẫn trên `exam.skyfirst.io.vn` | Đường dẫn trên `www.exam.skyfirst.io.vn` | Chức năng & API nghiệp vụ |
|---:|---|---|---|
| 1 | `https://exam.skyfirst.io.vn/` | `https://www.exam.skyfirst.io.vn/` | Trang chủ công khai, nhập mã dự thi / liên kết mời (`GET /api/public/catalog`, `POST /api/public/exam-launch/redeem`) |
| 2 | `https://exam.skyfirst.io.vn/admin` | `https://www.exam.skyfirst.io.vn/admin` | Phân hệ Quản trị Khảo thí, kích hoạt chủ hệ thống lần đầu & xác thực OTP 6 số công vụ (`/api/admin/*`) |
| 3 | `https://exam.skyfirst.io.vn/tra-cuu-ket-qua` | `https://www.exam.skyfirst.io.vn/tra-cuu-ket-qua` | Trang Tra cứu kết quả thi chính thức theo dữ liệu D1 (`POST /api/public/results/lookup`) |
| 4 | `https://exam.skyfirst.io.vn/phuc-khao` | `https://www.exam.skyfirst.io.vn/phuc-khao` | Đăng ký phúc khảo & tra cứu tiến độ `PK-...` (`POST /api/public/appeals`, `/track`) |
| 5 | `https://exam.skyfirst.io.vn/ho-tro` | `https://www.exam.skyfirst.io.vn/ho-tro` | Hỗ trợ thí sinh & tra cứu phiếu `HT-...` (`POST /api/public/support`, `/track`) |
| 6 | `https://exam.skyfirst.io.vn/su-co-khan-cap` | `https://www.exam.skyfirst.io.vn/su-co-khan-cap` | Báo sự cố khẩn cấp trong phiên thi `KC-...` (`POST /api/public/emergency-incidents`) |
| 7 | `https://exam.skyfirst.io.vn/to-cao-gian-lan` | `https://www.exam.skyfirst.io.vn/to-cao-gian-lan` | Tố cáo gian lận bảo mật danh tính `TC-...` (`POST /api/public/fraud-reports`, `/track`) |

- **Các đường dẫn đã loại bỏ theo quy chuẩn:** `/tra-cuu` và `/bao-loi` đã được loại bỏ hoàn toàn khỏi thanh điều hướng và định tuyến công khai, trả về HTTP `404 Not Found` (`data-route="404"`), tuyệt đối không tự động chuyển hướng về `/`.
- Mặc định cả hai tên miền `exam.skyfirst.io.vn` và `www.exam.skyfirst.io.vn` phục vụ trực tiếp toàn bộ 7 tuyến đường chính với HTTP `200 OK` và nội dung SSR riêng biệt cho từng trang.
- Nếu bật biến môi trường `ENFORCE_CANONICAL_HOST="1"`, mọi yêu cầu tới `www.exam.skyfirst.io.vn` sẽ chuyển hướng HTTPS `301` về `https://exam.skyfirst.io.vn` và bảo toàn nguyên vẹn đường dẫn + query string.

---

## 2. Quy trình Đăng nhập Tài khoản Chủ Hệ Thống (`Skyfirst.ec@gmail.com`)

1. **Đăng nhập lần đầu (Kích hoạt một lần kiểm soát phía máy chủ):**
   - Truy cập `/admin` và nhập `Skyfirst.ec@gmail.com`.
   - Máy chủ kiểm tra trạng thái khởi tạo một lần trong bảng `exam_owner_bootstrap_state` (`first_login_available = 1`), tự động đồng bộ tương thích với bảng `users` (hỗ trợ đầy đủ các cột `password_hash`, `password_salt`, `role`, `status`, `roles_json`, `expires_at` trên D1 `scrd-files`) và bảng `exam_admin_accounts`.
   - Máy chủ hoàn tất đăng nhập lần đầu ngay lập tức mà **không yêu cầu nhập OTP và không gửi email OTP**, đồng thời **tự khóa vĩnh viễn** trạng thái khởi tạo (`first_login_available = 0`, ghi nhận `completed_at` và nhật ký kiểm toán `admin.owner_first_login_completed`).
2. **Đăng nhập từ lần thứ hai trở đi:**
   - Nhập `Skyfirst.ec@gmail.com` tại `/admin`.
   - Hệ thống gửi mã OTP 6 chữ số có thời hạn 5 phút từ `noreply@skyfirst.io.vn` về hộp thư `Skyfirst.ec@gmail.com` (chỉ thông báo đã gửi khi nhà cung cấp email xác nhận thành công).
   - OTP chỉ sử dụng một lần, tự động vô hiệu hóa mã cũ khi yêu cầu mã mới, và giới hạn tối đa 5 lần nhập sai ở phía máy chủ.
3. **Các tài khoản quản trị khác:**
   - Chỉ các email đã được cấp quyền hợp lệ và đang `active` trong D1 mới được yêu cầu và xác minh OTP quản trị.

---

## 3. Kiến trúc phân lớp độc lập (Repository / Service / Adapter) — Chính xác 50 tệp

1. **Cấu hình & Tài liệu (3 tệp):** `package.json`, `wrangler.json`, `README.md`
2. **Migration D1 tương thích ngược (2 tệp):** `migrations/0001_exam_standalone_schema.sql`, `migrations/0002_exam_upgrade_existing_schema.sql`
3. **Health Endpoint (1 tệp):** `functions/health.js`
4. **Bộ kiểm thử tự động (4 tệp):** `scripts/sqlite-compat.mjs`, `scripts/validate.mjs`, `scripts/validate-runtime.mjs`, `scripts/validate-integration.mjs`
5. **Frontend & Bảo mật Trình duyệt (13 tệp trong `public/`):** `index.html`, `admin.html`, `404.html`, `_headers`, `_redirects`, `styles.css`, `sky-first-logo.webp`, `api.js`, `storage.js`, `core.js`, `security-client.js`, `exam.js`, `admin.js`
6. **Backend Phân lớp (9 tệp trong `src/`):**
   - `src/index.js` — Worker Entrypoint, định tuyến 2 hostname & CORS/Cookie
   - `src/page-router.js` — Bộ dựng SSR HTML riêng biệt cho từng đường dẫn nghiệp vụ và trang 404
   - `src/repository.js` — Lớp Repository / Data Access, tương thích động với schema `users` thực tế trên D1 & tối ưu hóa cold-start
   - `src/adapters.js` — Lớp Adapter tích hợp Dịch vụ Email, Xác minh danh tính bên thứ ba (HMAC + chống replay + fallback) và Lưu trữ R2
   - `src/auth-service.js` — Kích hoạt lần đầu một lần cho Chủ hệ thống, xác thực OTP 6 số, kiểm tra trạng thái/thời hạn/quyền & RBAC
   - `src/security-service.js` — Bảo mật kỳ thi 3 cấp độ, ma trận ngân hàng câu hỏi, đảo đề/đáp án, phân tích bất thường & cam kết không chụp/quay màn hình
   - `src/business-service.js` — Nghiệp vụ Tra cứu kết quả thi, Phúc khảo, Hỗ trợ, Sự cố khẩn cấp, Tố cáo gian lận
   - `src/exam-service.js` — Động cơ làm bài thi thời gian thực, tự động lưu theo revision, chấm điểm & quản trị kỳ thi
   - `src/email-templates.js` — Bộ quản lý 18 mẫu HTML email riêng và 24 sự kiện nghiệp vụ
7. **Mẫu Email HTML độc lập (18 tệp trong `src/emails/*.html`):**
   - `exam@skyfirst.io.vn`: `exam-result.html`, `appeal-received.html`, `appeal-update.html`, `appeal-result.html`, `exam-announcement.html`
   - `noreply@skyfirst.io.vn`: `login-verification-code.html`, `email-verification.html`, `exam-entry.html`, `exam-session-ended.html`, `exam-session-cancelled.html`, `integrity-warning.html`, `fraud-report.html`, `exam-ban-notice.html`, `system-notification.html`
   - `support@skyfirst.io.vn`: `support-request-received.html`, `support-request-update.html`, `support-request-resolved.html`, `technical-incident.html`

---

## 4. Cấu hình Biến môi trường & Triển khai Cloudflare

Thiết lập qua `npx wrangler secret put`:
- `ADMIN_BOOTSTRAP_TOKEN`: Khóa bí mật khởi tạo Quản trị viên dự phòng.
- `EMAIL_API_URL` & `EMAIL_API_KEY`: Endpoint và API key dịch vụ gửi email HTTP POST (Resend, SendGrid, Mailchannels hoặc cổng thư nội bộ).
- `IDENTITY_API_URL` & `IDENTITY_API_SECRET` *(Tùy chọn)*: Endpoint và khóa HMAC-SHA256 tích hợp dịch vụ xác minh danh tính thí sinh bên thứ ba.
- `CLOUDFLARE_API_TOKEN`: Token triển khai Cloudflare Workers/Pages.

Lệnh kiểm thử, áp dụng migration D1 và triển khai:
```bash
npm run build
npx wrangler d1 execute scrd-files --remote --file=migrations/0002_exam_upgrade_existing_schema.sql
npx wrangler deploy
```
