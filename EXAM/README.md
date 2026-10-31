# MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST
## Hệ Thống Khảo Thí Và Đánh Giá Sky First (v7.0.0 — 50-File Modular Architecture)

- **Đơn vị chủ quản:** Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First (`SKY FIRST NETWORK`)
- **Tên hệ thống:** Hệ Thống Khảo Thí Và Đánh Giá Sky First
- **Tên miền chính:** `https://exam.skyfirst.io.vn`
- **Tên miền bổ sung:** `https://www.exam.skyfirst.io.vn`
- **Quy mô mã nguồn bàn giao:** Chính xác **50 tệp** thuộc phạm vi dự án (kiểm chứng tự động).

---

## 1. Danh mục 18 URL bắt buộc trên 2 tên miền (`exam.skyfirst.io.vn` & `www.exam.skyfirst.io.vn`)

| STT | Đường dẫn trên `exam.skyfirst.io.vn` | Đường dẫn trên `www.exam.skyfirst.io.vn` | Chức năng & API nghiệp vụ |
|---:|---|---|---|
| 1 | `https://exam.skyfirst.io.vn/` | `https://www.exam.skyfirst.io.vn/` | Trang chủ công khai, nhập mã dự thi / liên kết mời (`GET /api/public/catalog`, `POST /api/public/exam-launch/redeem`) |
| 2 | `https://exam.skyfirst.io.vn/admin` | `https://www.exam.skyfirst.io.vn/admin` | Phân hệ Quản trị Khảo thí, xác thực OTP công vụ & RBAC 10 vai trò (`/api/admin/*`) |
| 3 | `https://exam.skyfirst.io.vn/tra-cuu` | `https://www.exam.skyfirst.io.vn/tra-cuu` | Cổng tra cứu kết quả & biên nhận tương thích (`POST /api/public/results/lookup`) |
| 4 | `https://exam.skyfirst.io.vn/tra-cuu-ket-qua` | `https://www.exam.skyfirst.io.vn/tra-cuu-ket-qua` | Trang Tra cứu kết quả thi chính thức theo dữ liệu D1 (`POST /api/public/results/lookup`) |
| 5 | `https://exam.skyfirst.io.vn/phuc-khao` | `https://www.exam.skyfirst.io.vn/phuc-khao` | Đăng ký phúc khảo & tra cứu tiến độ `PK-...` (`POST /api/public/appeals`, `/track`) |
| 6 | `https://exam.skyfirst.io.vn/ho-tro` | `https://www.exam.skyfirst.io.vn/ho-tro` | Hỗ trợ thí sinh & tra cứu phiếu `HT-...` (`POST /api/public/support`, `/track`) |
| 7 | `https://exam.skyfirst.io.vn/bao-loi` | `https://www.exam.skyfirst.io.vn/bao-loi` | Báo lỗi kỹ thuật hệ thống kèm tệp R2 `BL-...` (`POST /api/public/bug-reports`) |
| 8 | `https://exam.skyfirst.io.vn/su-co-khan-cap` | `https://www.exam.skyfirst.io.vn/su-co-khan-cap` | Báo sự cố khẩn cấp trong phiên thi `KC-...` (`POST /api/public/emergency-incidents`) |
| 9 | `https://exam.skyfirst.io.vn/to-cao-gian-lan` | `https://www.exam.skyfirst.io.vn/to-cao-gian-lan` | Tố cáo gian lận bảo mật danh tính `TC-...` (`POST /api/public/fraud-reports`, `/track`) |

- Mặc định cả hai tên miền `exam.skyfirst.io.vn` và `www.exam.skyfirst.io.vn` phục vụ trực tiếp toàn bộ 9 tuyến đường với HTTP `200 OK` và nội dung SSR riêng biệt cho từng trang.
- Nếu bật biến môi trường `ENFORCE_CANONICAL_HOST="1"`, mọi yêu cầu tới `www.exam.skyfirst.io.vn` sẽ chuyển hướng HTTPS `301` về `https://exam.skyfirst.io.vn` và bảo toàn nguyên vẹn đường dẫn + query string.

---

## 2. Kiến trúc phân lớp độc lập (Repository / Service / Adapter) — Chính xác 50 tệp

1. **Cấu hình & Tài liệu (3 tệp):** `package.json`, `wrangler.json`, `README.md`
2. **Migration D1 tương thích ngược (2 tệp):** `migrations/0001_exam_standalone_schema.sql`, `migrations/0002_exam_upgrade_existing_schema.sql`
3. **Health Endpoint (1 tệp):** `functions/health.js`
4. **Bộ kiểm thử tự động (4 tệp):** `scripts/sqlite-compat.mjs`, `scripts/validate.mjs`, `scripts/validate-runtime.mjs`, `scripts/validate-integration.mjs`
5. **Frontend & Bảo mật Trình duyệt (13 tệp trong `public/`):** `index.html`, `admin.html`, `404.html`, `_headers`, `_redirects`, `styles.css`, `sky-first-logo.webp`, `api.js`, `storage.js`, `core.js`, `security-client.js`, `exam.js`, `admin.js`
6. **Backend Phân lớp (9 tệp trong `src/`):**
   - `src/index.js` — Worker Entrypoint, định tuyến 2 hostname & CORS/Cookie
   - `src/page-router.js` — Bộ dựng SSR HTML riêng biệt cho từng đường dẫn nghiệp vụ và trang 404
   - `src/repository.js` — Lớp Repository / Data Access & Cache TTL giảm phụ thuộc trực tiếp vào D1
   - `src/adapters.js` — Lớp Adapter tích hợp Dịch vụ Email, Xác minh danh tính bên thứ ba (HMAC + chống replay + fallback) và Lưu trữ R2
   - `src/auth-service.js` — Xác thực tài khoản D1, kiểm tra trạng thái/thời hạn/quyền trước khi gửi OTP 6 số, giới hạn tần suất & RBAC
   - `src/security-service.js` — Bảo mật kỳ thi 3 cấp độ, ma trận ngân hàng câu hỏi, đảo đề/đáp án, phân tích bất thường & cam kết không chụp/quay màn hình
   - `src/business-service.js` — Nghiệp vụ Tra cứu kết quả thi, Phúc khảo, Hỗ trợ, Báo lỗi, Sự cố khẩn cấp, Tố cáo gian lận
   - `src/exam-service.js` — Động cơ làm bài thi thời gian thực, tự động lưu theo revision, chấm điểm & quản trị kỳ thi
   - `src/email-templates.js` — Bộ quản lý 18 mẫu HTML email riêng và 24 sự kiện nghiệp vụ
7. **Mẫu Email HTML độc lập (18 tệp trong `src/emails/*.html`):**
   - `exam@skyfirst.io.vn`: `exam-result.html`, `appeal-received.html`, `appeal-update.html`, `appeal-result.html`, `exam-announcement.html`
   - `noreply@skyfirst.io.vn`: `login-verification-code.html`, `email-verification.html`, `exam-entry.html`, `exam-session-ended.html`, `exam-session-cancelled.html`, `integrity-warning.html`, `fraud-report.html`, `exam-ban-notice.html`, `system-notification.html`
   - `support@skyfirst.io.vn`: `support-request-received.html`, `support-request-update.html`, `support-request-resolved.html`, `technical-incident.html`

---

## 3. Cấu hình Biến môi trường, Dịch vụ Bên thứ ba & Triển khai Cloudflare

Thiết lập qua `npx wrangler secret put`:
- `ADMIN_BOOTSTRAP_TOKEN`: Khóa bí mật khởi tạo Quản trị viên đầu tiên (tự động khóa sau khi đã có `system_admin`).
- `EMAIL_API_URL` & `EMAIL_API_KEY`: Endpoint và API key dịch vụ gửi email HTTP POST (Resend, SendGrid, Mailchannels hoặc cổng thư nội bộ).
- `IDENTITY_API_URL` & `IDENTITY_API_SECRET` *(Tùy chọn)*: Endpoint và khóa HMAC-SHA256 tích hợp dịch vụ xác minh danh tính thí sinh bên thứ ba (hệ thống tự động chuyển sang phương thức dự phòng OTP + đối chiếu danh sách D1 nếu chưa cấu hình).
- `CLOUDFLARE_API_TOKEN`: Token triển khai Cloudflare Workers (quyền: Workers Scripts Edit, Account Settings Read, Zone Routes Edit).

Lệnh kiểm thử và triển khai:
```bash
npm run build
npx wrangler deploy
```
