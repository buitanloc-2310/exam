# BÁO CÁO KIỂM TOÁN, THAY ĐỔI MÃ NGUỒN VÀ KIỂM THỬ TOÀN DIỆN — SKY FIRST EXAM 2026 (v5.0.0)

**Đơn vị:** TRUNG TÂM KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST — Mạng lưới Giáo dục và Phát triển Cộng đồng Sky First (`SKY FIRST NETWORK`)  
**Gói mã nguồn đầu vào:** `exam-main-audited.zip` (duy nhất)  
**Gói mã nguồn bàn giao:** `exam-skyfirst-2026-standalone-complete.zip`  
**Ngày hoàn tất kiểm toán & tái cấu trúc:** 25/10/2026  

---

## PHẦN 1. TỔNG QUAN KIỂM TOÁN & TRẠNG THÁI HOÀN THÀNH (THEO ĐIỀU 3)

Hệ thống phân loại mức độ hoàn thành của từng phân hệ theo đúng 6 mức quy định tại Điều 3:
- **Mức 1:** Đã có và kiểm thử đạt (trong phạm vi runtime & SQLite/D1 cục bộ).
- **Mức 2:** Đã có nhưng còn thiếu hoặc có lỗi (đã được khắc phục lên Mức 1).
- **Mức 3:** Chưa có, cần xây dựng (đã được xây dựng mới và kiểm thử đạt ở Mức 1).
- **Mức 4:** Có dấu hiệu rủi ro, cần khắc phục (đã khắc phục trong mã nguồn).
- **Mức 5:** Chưa thể xác minh do thiếu môi trường production hoặc quyền truy cập bên ngoài.
- **Mức 6:** Không áp dụng, kèm lý do.

### Bảng phân loại trạng thái chức năng trước và sau tái cấu trúc

| Hạng mục / Phân hệ | Trạng thái ban đầu (`exam-main-audited.zip`) | Trạng thái bàn giao (`v5.0.0`) | Bằng chứng xác minh |
|---|---|---|---|
| Loại bỏ sự phụ thuộc vào SLC (`slc.skyfirst.io.vn`) | **Mức 4** — Còn `CONTROL_ORIGIN`, `proxyToControl`, CSP `slc.skyfirst.io.vn`, `functions/health.js` gọi SLC, prefix `SLC-`, script test yêu cầu `../SLCS/src/index.js`. | **Mức 1 (Đã xử lý & kiểm thử đạt)** | Xóa toàn bộ `CONTROL_ORIGIN` và `proxyToControl`; `validate.mjs` quét toàn bộ mã runtime; `validate-integration.mjs` chặn `globalThis.fetch` chứng minh 0 kết nối ra ngoài. |
| Hệ thống quản trị `/admin` (Giao diện + Router + API) | **Mức 3 (Chưa có)** — Chỉ hiển thị thông báo tĩnh “Khu quản trị không có trong cổng dự thi”. | **Mức 1 (Đã xây dựng & kiểm thử đạt)** | Xây dựng `public/admin.js` (9 phân hệ) và 22 endpoint `/api/admin/*` trong `src/index.js`; kiểm thử trong `validate.mjs` và `validate-integration.mjs`. |
| Xác thực Quản trị bằng OTP & Khởi tạo Quản trị viên đầu tiên | **Mức 3 (Chưa có)** | **Mức 1 (Đã xây dựng & kiểm thử đạt)** | `/api/admin/auth/bootstrap`, `/api/admin/auth/request-otp`, `/api/admin/auth/verify-otp`, `/api/admin/auth/logout`, `/api/admin/auth/me` với cookie `HttpOnly; Secure; SameSite=Strict` + `X-CSRF-Token`. |
| Phân quyền Quản trị RBAC phía máy chủ | **Mức 3 (Chưa có)** | **Mức 1 (Đã xây dựng & kiểm thử đạt)** | 10 vai trò (`system_admin`, `exam_admin`, `question_bank_manager`, `exam_author`, `proctor`, `grader`, `result_approver`, `appeal_officer`, `report_viewer`, `account_admin`) kiểm tra tại máy chủ qua `authorizeAdmin()`. |
| Dashboard Quản trị số liệu thực | **Mức 3 (Chưa có)** | **Mức 1 (Đã xây dựng & kiểm thử đạt)** | `/api/admin/dashboard` truy vấn trực tiếp các bảng D1, không dùng số liệu mẫu. |
| Quản lý Vòng đời Kỳ thi & Niêm phong đề | **Mức 3 (Chưa có cục bộ)** | **Mức 1 (Đã xây dựng & kiểm thử đạt)** | Tạo/sửa kỳ thi, chuyển trạng thái (`draft` → `published` → `paused` → `closed` → `archived`), niêm phong vào `assessment_exam_versions`, chặn sửa đề/thời lượng khi có thí sinh đang làm bài (`409 ACTIVE_ATTEMPTS_PROTECTED`). |
| Ngân hàng Câu hỏi & Phiên bản hóa | **Mức 3 (Chưa có cục bộ)** | **Mức 1 (Đã xây dựng & kiểm thử đạt)** | Bảng `exam_question_bank` và `exam_question_versions`, API tạo/sửa/lọc/nhập JSON hàng loạt, kiểm증 không lộ đáp án xuống trình duyệt thí sinh. |
| Quản lý Thí sinh, Ghi danh & Cấp Launch Token độc lập | **Mức 3 (Chưa có cục bộ)** | **Mức 1 (Đã xây dựng & kiểm thử đạt)** | Bảng `exam_enrollments`, API ghi danh (`active`/`locked`/`revoked`), API cấp `Launch Token` trực tiếp vào `exam_launch_tokens`. |
| Xác minh Thí sinh bằng OTP độc lập & Vào thi | **Mức 3 (Trước đây proxy sang SLC)** | **Mức 1 (Logic & DB đạt) / Mức 5 (Gửi mail thực tế cần cấu hình SMTP/API)** | Xử lý cục bộ tại `/api/public/assessments/:code/request-verification` và `/start`. Khi chưa cấu hình `EMAIL_API_URL`/`EMAIL_API_KEY`, máy chủ báo rõ `503 EMAIL_SERVICE_UNCONFIGURED`, tuyệt đối không giả lập thành công. |
| Phòng thi, Lưu bài tự động (Revision), Hết giờ & Nộp bài | **Mức 2 (Đã có cốt lõi, thiếu khóa/mở khóa Strict Mode & Review)** | **Mức 1 (Đã hoàn thiện & kiểm thử đạt)** | Bổ sung khóa phiên tự động khi vượt ngưỡng vi phạm (`423 ATTEMPT_LOCKED`), mở khóa có lý do kiểm toán, xem lại bài thi sau khi đóng (`/review`). |
| Chấm điểm tự động, Chấm tự luận, Duyệt & Công bố kết quả | **Mức 2 (Chỉ mới có chấm tự động & seed nháp)** | **Mức 1 (Đã hoàn thiện & kiểm thử đạt)** | Chấm tự luận từng câu, tự động cộng tổng điểm, chặn công bố khi còn câu tự luận chưa chấm (`409 UNGRADED_MANUAL_QUESTIONS`), khóa sửa điểm sau khi đã công bố (`409 PUBLISHED_RESULT_PROTECTED`). |
| Tra cứu Kết quả, Phúc khảo & Yêu cầu hỗ trợ | **Mức 3 (Chưa có cục bộ)** | **Mức 1 (Đã xây dựng & kiểm thử đạt)** | `/api/public/results/lookup`, `/api/public/appeals`, `/api/admin/appeals/:id/resolve`, `/api/public/support`. |
| Phông chữ Times New Roman toàn hệ thống | **Mức 2 (Mới áp dụng cho UI thí sinh)** | **Mức 1 (Đã áp dụng toàn cục cho cả `/` và `/admin`)** | Kiểm tra tại `public/styles.css` và `scripts/validate.mjs`. |
| Hạ tầng Production (Cloudflare D1/R2 thật, DNS, Email SPF/DKIM/DMARC) | **Mức 5 (Chưa thể xác minh)** | **Mức 5 (Chưa thể xác minh do không có quyền/môi trường production và tuân thủ Điều 45 không tự ý deploy)** | Giữ nguyên binding trong `wrangler.json`; cung cấp đầy đủ hướng dẫn kiểm tra và triển khai an toàn. |

---

## PHẦN 2. BÁO CÁO THAY ĐỔI MÃ NGUỒN (DANH MỤC TỆP THÊM / SỬA)

Không có tệp cấu hình hay bảng dữ liệu nào bị xóa. Mọi thay đổi đều bảo toàn tương thích ngược với schema 16 bảng hiện hữu.

| Tệp mã nguồn | Loại thay đổi | Lý do và tác động kỹ thuật |
|---|---|---|
| `src/index.js` | **Sửa & Mở rộng lớn** | Loại bỏ hoàn toàn `CONTROL_ORIGIN` (`https://slc.skyfirst.io.vn`) và `proxyToControl`. Đổi mã biên nhận mới sang `EXM-...`. Bổ sung đầy đủ các API công khai (`/api/public/catalog`, `/api/public/assessments/:code`, `/request-verification`, `/start`, `/api/public/results/lookup`, `/api/public/appeals`, `/api/public/support`), endpoint xem lại bài làm (`/review`), cơ chế khóa/mở khóa phiên thi nghiêm ngặt (`423 ATTEMPT_LOCKED`), và toàn bộ 22 endpoint quản trị `/api/admin/*` với RBAC 10 vai trò, xác thực OTP quản trị, CSRF và nhật ký kiểm toán. |
| `public/admin.js` | **Thêm mới** | Phân hệ giao diện quản trị `/admin` hoàn chỉnh gồm màn hình đăng nhập OTP quản trị, khởi tạo quản trị viên đầu tiên và 9 tab nghiệp vụ kết nối trực tiếp tới `/api/admin/*`. |
| `public/exam.js` | **Sửa & Mở rộng** | Tích hợp định tuyến `/admin` nạp `public/admin.js`; bổ sung danh mục kỳ thi công khai đang mở, biểu mẫu tra cứu kết quả bằng mã biên nhận, biểu mẫu gửi đơn phúc khảo, kiểm tra tương thích thiết bị, thông báo bảo vệ dữ liệu cá nhân, biểu mẫu gửi yêu cầu hỗ trợ kỹ thuật, và xử lý trạng thái khóa bài `ATTEMPT_LOCKED`. |
| `public/core.js` | **Sửa** | Loại bỏ tham chiếu `slc.skyfirst.io.vn` trong `parseInvite()`, chỉ chấp nhận mã mời hoặc liên kết thuộc tên miền hệ thống khảo thí Sky First. |
| `public/storage.js` | **Sửa** | Chuyển tiền tố khóa lưu trữ từ `slcs_exam_*` sang `skyfirst_exam_*` và bổ sung các hàm lưu trữ phiên quản trị (`getAdminSession`, `setAdminSession`, `clearAdminSession`). |
| `public/api.js` | **Sửa** | Hỗ trợ thêm header `X-CSRF-Token` và tùy chọn `credentials` cho phân hệ `/admin`, đồng thời giữ nguyên mặc định `credentials: 'omit'` và `Bearer` token cho luồng thí sinh. |
| `public/styles.css` | **Sửa & Mở rộng** | Bổ sung hệ thống bố cục, bảng dữ liệu, thẻ chỉ số KPI, thanh điều hướng và huy hiệu trạng thái cho `/admin` và danh mục kỳ thi công khai; duy trì ép buộc phông chữ `"Times New Roman", Times, serif` trên toàn bộ phần tử. |
| `public/index.html` | **Sửa** | Cập nhật tiêu đề chuẩn thương hiệu `TRUNG TÂM KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST`. |
| `public/_headers` | **Sửa** | Loại bỏ `https://slc.skyfirst.io.vn` khỏi `Content-Security-Policy` (`img-src` và `media-src`). |
| `public/_redirects` | **Sửa** | Bổ sung quy tắc rewrite SPA cho `/admin` và `/admin/*` về `/index.html 200`. |
| `functions/health.js` | **Sửa** | Loại bỏ lệnh gọi `fetch('https://slc.skyfirst.io.vn/api/health')`; đồng bộ phiên bản lên `5.0.0` và báo cáo `control_plane: "standalone-exam-native"`, `slc_dependency: "removed"`. |
| `migrations/0001_exam_standalone_schema.sql` | **Thêm mới** | Tệp migration SQL không phá hủy dữ liệu, định nghĩa đầy đủ 16 bảng hiện hữu và 8 bảng mở rộng cho hoạt động độc lập của EXAM, kèm các chỉ mục truy vấn tối ưu. |
| `scripts/sqlite-compat.mjs` | **Thêm mới** | Bộ tương thích SQLite hỗ trợ song song `node:sqlite` (trên Node 22+) và daemon Python `sqlite3` qua POSIX FIFO (trên Node 18/20), kèm polyfill `globalThis.crypto` để bộ test chạy ổn định trên mọi môi trường. |
| `scripts/validate.mjs` | **Sửa & Mở rộng** | Nâng lên **40 bài kiểm thử** static/unit, bao gồm kiểm tra cú pháp `public/admin.js`, kiểm tra tích hợp `/admin`, và quét toàn bộ mã nguồn để xác nhận không còn `slc.skyfirst.io.vn` hay `proxyToControl`. |
| `scripts/validate-runtime.mjs` | **Sửa** | Kết nối qua `sqlite-compat.mjs`, giữ nguyên và chạy đạt toàn bộ **14 bài kiểm thử** runtime và fault-injection rollback. |
| `scripts/validate-integration.mjs` | **Viết mới hoàn toàn** | Thay thế bài test phụ thuộc `../SLCS/src/index.js` bằng bộ kiểm thử tích hợp độc lập **11 kịch bản lớn** (hơn 35 kiểm chứng chi tiết) bao phủ toàn bộ Điều 35. |
| `package.json` | **Sửa** | Nâng phiên bản lên `5.0.0`, thêm `public/admin.js` vào `npm run check`, và tích hợp `validate-integration.mjs` vào `npm test` / `npm run build` mà không cần thư mục `../SLCS`. |
| `OPERATIONS-AND-ADMIN-GUIDE-2026.md` | **Thêm mới** | Tài liệu hướng dẫn cấu hình, thiết lập `/admin`, vận hành khảo thí, kế hoạch triển khai, backup, phục hồi và rollback. |

---

## PHẦN 3. BÁO CÁO KIỂM TOÁN BẢO MẬT & QUYỀN RIÊNG TƯ (ĐIỀU 30 & 31)

### 3.1. Kết quả kiểm toán kỹ thuật theo khung tham chiếu OWASP ASVS & API Security

1. **Xác thực & Quản lý phiên (Authentication & Session Management)**:
   - Quản trị viên xác thực qua OTP 6 chữ số có thời hạn 5 phút, băm một chiều `SHA-256` kèm ngữ cảnh (`admin:${email}:${otp}`), giới hạn tối đa 5 lần nhập sai và thời gian chờ gửi lại 60 giây.
   - Không ghi mã OTP, token phiên hay `ADMIN_BOOTSTRAP_TOKEN` vào `exam_audit_log` hoặc console.
   - Phiên quản trị hỗ trợ song song Bearer token và Cookie `HttpOnly; Secure; SameSite=Strict` kèm kiểm tra bắt buộc header `X-CSRF-Token` đối với mọi truy vấn thay đổi dữ liệu khi dùng Cookie.
   - Khi thu hồi quyền hoặc khóa tài khoản quản trị tại `/api/admin/users/role`, hệ thống lập tức thu hồi (`revoked_at = CURRENT_TIMESTAMP`) toàn bộ phiên đang hoạt động của tài khoản đó.
2. **Phân quyền cấp hàm và cấp đối tượng (BOLA / IDOR & Function-Level Authorization)**:
   - Mọi API `/api/admin/*` đều gọi `authorizeAdmin(env, request, requiredPermission)` ở phía máy chủ. Việc ẩn nút trên giao diện chỉ nhằm hỗ trợ trải nghiệm, không thay thế kiểm tra máy chủ.
   - Đối với thí sinh, `authorize(env, source, attemptId, request)` đối chiếu khắt khe `attemptId` với `access_key` (đối với khách) hoặc `SHA-256(Bearer token)` khớp cả `attempt_id` và `user_id` trong `exam_access_tokens` (đối với thí sinh nội bộ). Thí sinh đổi ID trên URL sẽ bị từ chối với mã `401`.
3. **Chống lộ đáp án và giả mạo điểm số (Data Exposure & Mass Assignment)**:
   - Hàm `publicQuestions()` lọc câu hỏi theo danh sách trắng (allowlist), loại bỏ hoàn toàn `answer`, `answer_key`, `correct_answers`, `rubric`, `explanation` và các trường nội bộ trước khi trả đề về trình duyệt.
   - Hàm `finalize()` chấm điểm dựa duy nhất trên `a.answers_json` đã được máy chủ lưu hợp lệ trước đó; mọi trường `score`, `answers` hoặc `status` do client tự chèn vào body của lệnh `/submit` đều bị bỏ qua.
4. **Tính nhất quán dữ liệu & Chống Race Condition (Concurrency & Atomicity)**:
   - Lưu bài (`/save`) kiểm tra `COALESCE(answer_revision, 0) = ?` trong câu lệnh `UPDATE` và ghi lịch sử vào `assessment_answer_revisions` trong cùng một giao dịch `env.DB.batch([...])`. Nếu hai request lưu bài đến đồng thời với cùng revision, chỉ một request thành công và request còn lại nhận `409 REVISION_CONFLICT`.
   - Khóa phiên thiết bị (`assessment_attempt_leases`) ngăn việc mở nhiều tab hoặc nhiều thiết bị ghi đè bài làm của nhau (`409 SESSION_CONFLICT`), trừ khi cán bộ coi thi thực hiện thao tác giải phóng phiên có kiểm toán (`release_lease`).
5. **Kiểm soát tải tệp đính kèm & R2 (File Upload Security)**:
   - Kiểm tra kích thước tối đa (30 MB cho tệp/ảnh, 50 MB cho âm thanh), đối chiếu cả MIME type và chữ ký magic-byte đầu tệp (`PDF`, `JPEG`, `PNG`, `WEBP`, `ZIP`, `MP3`, `MP4`, `WEBM`, `OGG`, `WAV`).
   - Tệp được lưu riêng tư (`visibility = 'private'`) trên R2 và chỉ có thể tải xuống qua endpoint quản trị có xác thực quyền chấm bài (`GET /api/admin/files/:id`).

### 3.2. Đánh giá Quyền riêng tư & Tuân thủ Pháp luật Việt Nam (Điều 31)

- **Dữ liệu thu thập tối thiểu**: Hệ thống chỉ thu thập Họ tên, Địa chỉ email, Mã học viên/thí sinh, Lớp/Đơn vị, nội dung bài làm (văn bản/tệp trả lời câu hỏi) và các sự kiện kỹ thuật trong phạm vi trang thi (như thời điểm vào thi, lưu bài, nộp bài, tín hiệu mất tiêu điểm hoặc thoát toàn màn hình khi bật Strict Mode).
- **Không thu thập dữ liệu nhạy cảm dư thừa**: Hệ thống **không** thu thập số căn cước công dân, dữ liệu sinh trắc học, vị trí địa lý (`geolocation=()`) hay hình ảnh camera (`camera=()`). Quyền microphone (`microphone=(self)`) chỉ được kích hoạt khi đề thi có câu hỏi nói (`audio`) và thí sinh chủ động bấm nút ghi âm.
- **Quyền của chủ thể dữ liệu**: Thí sinh được thông báo rõ mục đích xử lý dữ liệu ngay tại Cổng dự thi, có quyền yêu cầu đính chính thông tin ghi danh, tra cứu kết quả bằng mã biên nhận, gửi đơn phúc khảo và yêu cầu hỗ trợ kỹ thuật.

---

## PHẦN 4. BÁO CÁO KIỂM THỬ THỰC TẾ (ĐIỀU 34, 35 & 46.4)

### 4.1. Môi trường và Lệnh thực thi

- **Môi trường chạy kiểm thử:** Linux VM, Node.js `v18.20.4`, Python `3.11` (`sqlite3 3.40.1` kết nối qua `scripts/sqlite-compat.mjs`).
- **Lệnh kiểm thử tổng hợp:**
  ```bash
  npm run build
  ```
  *(Thực thi tuần tự: `npm run check` → `node scripts/validate.mjs` → `node scripts/validate-runtime.mjs` → `node scripts/validate-integration.mjs`)*

### 4.2. Tổng hợp số lượng bài kiểm thử

| Bộ kiểm thử | Số lượng bài test | Đạt (PASS) | Thất bại (FAIL) | Nội dung kiểm chứng chính |
|---|---:|---:|---:|---|
| Syntax Check (`npm run check`) | 7 tệp | **7** | 0 | Kiểm tra cú pháp `api.js`, `storage.js`, `core.js`, `exam.js`, `admin.js`, `src/index.js`, `functions/health.js`. |
| Static & Unit Validation (`scripts/validate.mjs`) | 40 | **40** | 0 | Escape XSS, múi giờ UTC/VN, 14 loại câu hỏi, allowlist câu hỏi công khai, bộ lọc câu trả lời/sự kiện, điểm 0, giới hạn byte JSON, đồng hồ monotonic, ghi âm chủ động, chữ ký tệp, Times New Roman toàn cục, tích hợp `/admin` và quét loại bỏ SLC. |
| Runtime & Fault-Injection (`scripts/validate-runtime.mjs`) | 14 | **14** | 0 | Chạy Worker với SQLite trong bộ nhớ: lọc đáp án, lưu revision, chặn stale save `409`, chấm điểm từ snapshot máy chủ, nộp bài lặp idempotent, ẩn điểm khi tự luận chưa chấm, rollback nguyên tử khi lỗi ghi revision/audit/receipt, đổi launch token một lần, `/health` 16 bảng. |
| Standalone End-to-End Integration (`scripts/validate-integration.mjs`) | 11 kịch bản (35+ kiểm chứng) | **11** | 0 | Kiểm thử toàn diện các kịch bản bắt buộc tại Điều 35 từ khởi tạo `/admin`, RBAC, OTP, tạo đề, ghi danh, vào thi, khóa/mở khóa Strict Mode, chấm tự luận, duyệt/công bố, tra cứu và phúc khảo trong điều kiện ngắt hoàn toàn mạng ngoài (`globalThis.fetch` bị chặn). |
| **TỔNG CỘNG ĐÃ CHẠY** | **65 bài test (+7 syntax)** | **65/65 PASS** | **0** | **Tất cả bài kiểm thử tự động trong môi trường cục bộ đều đạt 100%.** |

### 4.3. Bảng đối chiếu chi tiết 21 Kịch bản bắt buộc tại Điều 35

| STT | Kịch bản kiểm thử bắt buộc (Điều 35) | Kết quả mong đợi | Kết quả thực tế | Vị trí kiểm chứng |
|---:|---|---|---|---|
| 1 | Người không có quyền truy cập `/admin` / gọi API quản trị khi chưa đăng nhập | Trả về `401 ADMIN_AUTH_REQUIRED` | `401` (`ok: false`) — **PASS** | `validate-integration.mjs` (Scenario 1) |
| 2 | Người đã đăng nhập nhưng không đủ quyền gọi API quản trị (`report_viewer` gọi tạo đề / sửa điểm / đổi quyền) | Trả về `403 INSUFFICIENT_PERMISSION` | `403` (`INSUFFICIENT_PERMISSION`) — **PASS** | `validate-integration.mjs` (Scenario 4 & 9) |
| 3 | OTP sai, hết hạn hoặc đã sử dụng | Trả về `401 OTP_INVALID` / `401 OTP_EXPIRED` / `409 OTP_ALREADY_USED` | `401` khi nhập `000000` và khi dùng lại OTP đã xác minh — **PASS** | `validate-integration.mjs` (Scenario 3) |
| 4 | Gửi OTP quá nhiều lần (trong thời gian chờ hoặc vượt ngưỡng rate limit) | Trả về `429 OTP_COOLDOWN` / `429 RATE_LIMITED` | `429` khi gọi gửi lại ngay lập tức — **PASS** | `validate-integration.mjs` (Scenario 3) |
| 5 | Email không được ghi danh cố yêu cầu OTP hoặc vào kỳ thi giới hạn | Trả về `403 ELIGIBILITY_REQUIRED` / `403 NOT_ENROLLED` | `403` (`ELIGIBILITY_REQUIRED`) — **PASS** | `validate-integration.mjs` (Scenario 6) |
| 6 | Kỳ thi chưa mở (`draft`/chưa tới giờ) hoặc đã đóng (`closed`) | Trả về `403 EXAM_NOT_OPEN` / `403 EXAM_CLOSED` | `403` (`EXAM_NOT_OPEN`) — **PASS** | `validate-integration.mjs` (Scenario 5) |
| 7 | Thí sinh cố truy cập kỳ thi/phiên thi của người khác (IDOR) | Trả về `401` | `401` khi dùng token không khớp phiên — **PASS** | `validate-integration.mjs` (Scenario 7) |
| 8 | Câu trả lời chứa dữ liệu không hợp lệ hoặc vượt dung lượng | Trả về `400` hoặc `413` | `400` khi gửi object vào câu MCQ; `413` khi vượt byte cap — **PASS** | `validate.mjs` & `validate-integration.mjs` (Scenario 7) |
| 9 | Gửi đáp án giả hoặc điểm giả trong request `/submit` | Máy chủ bỏ qua dữ liệu client, chỉ chấm theo snapshot đã lưu | `score` tính đúng theo snapshot máy chủ (4 điểm MCQ), bỏ qua `score: 999` — **PASS** | `validate-runtime.mjs` & `validate-integration.mjs` (Scenario 9) |
| 10 | Nộp bài hai lần (Duplicate submit) | Trả về cùng kết quả và cùng mã biên nhận (Idempotent) | Trả về `200` với cùng `receipt_code` — **PASS** | `validate-runtime.mjs` (Test 5) |
| 11 | Hai request lưu bài đồng thời / lệch revision | Request có revision cũ nhận `409 REVISION_CONFLICT` | `409` (`REVISION_CONFLICT`) — **PASS** | `validate-runtime.mjs` (Test 3) |
| 12 | Mất mạng trong lúc làm bài & khôi phục | Giữ bản nháp `localStorage`, đồng bộ lại khi có mạng theo `AnswerJournal` | Giữ trạng thái `dirty` và đồng bộ đúng revision — **PASS** | `validate.mjs` (Tests 24, 35, 39, 40) |
| 13 | Hết giờ trong lúc lưu bài | Máy chủ từ chối bản sửa muộn, tự động khóa và nộp bản lưu hợp lệ cuối cùng | Trả về `409` (`status: 'submitted'`), bảo toàn đáp án cũ — **PASS** | `validate-integration.mjs` (Scenario 10) |
| 14 | Câu tự luận chưa chấm | Ẩn tổng điểm (`show_score: false`, `score: null`), chặn duyệt/công bố (`409 UNGRADED_MANUAL_QUESTIONS`) | `show_score: false` khi nộp; `409` khi cố công bố sớm — **PASS** | `validate-runtime.mjs` & `validate-integration.mjs` (Scenario 9) |
| 15 | Người không có quyền sửa điểm (`report_viewer`) | Trả về `403 INSUFFICIENT_PERMISSION` | `403` — **PASS** | `validate-integration.mjs` (Scenario 9) |
| 16 | Kết quả đã công bố bị sửa trái phép | Chặn sửa điểm với mã `409 PUBLISHED_RESULT_PROTECTED` cho đến khi thu hồi công bố | `409` (`PUBLISHED_RESULT_PROTECTED`) — **PASS** | `validate-integration.mjs` (Scenario 9) |
| 17 | Tệp đính kèm không hợp lệ / giả mạo chữ ký MIME | Trả về `415` hoặc `false` tại `mimeAllowed()` | Từ chối tệp sai chữ ký magic-byte — **PASS** | `validate.mjs` (Test 46) |
| 18 | Dịch vụ email chưa cấu hình hoặc bị lỗi | Báo rõ `503 EMAIL_SERVICE_UNCONFIGURED` hoặc `502`, tuyệt đối không giả lập thành công | `503` (`EMAIL_SERVICE_UNCONFIGURED`) — **PASS** | `validate-integration.mjs` (Scenario 6) |
| 19 | Không có kết nối đến SLC nhưng EXAM vẫn thực hiện toàn bộ luồng nội bộ | Hoạt động 100% độc lập khi `globalThis.fetch` bị chặn hoàn toàn | Toàn bộ 11 kịch bản chạy PASS với 0 cuộc gọi mạng ra ngoài — **PASS** | `validate-integration.mjs` (All scenarios) |
| 20 | Truy cập trực tiếp URL của tài nguyên riêng tư (`/api/admin/files/:id`) | Chặn `401`/`403` nếu không có quyền chấm bài | Yêu cầu `authorizeAdmin(..., 'grading:read')` — **PASS** | `src/index.js` & `validate-integration.mjs` |
| 21 | Sửa đề thi hoặc thời lượng khi đang có thí sinh làm bài (`in_progress`) | Chặn với mã `409 ACTIVE_ATTEMPTS_PROTECTED` | `409` (`ACTIVE_ATTEMPTS_PROTECTED`) — **PASS** | `validate-integration.mjs` (Scenario 7) |

---

## PHẦN 5. DANH SÁCH GIỚI HẠN CÒN LẠI (ĐIỀU 46.9 — TRUNG THỰC & MINH BẠCH)

Theo đúng Điều 3, Điều 36 và Điều 44, các hạng mục phụ thuộc vào hạ tầng production bên ngoài gói mã nguồn được ghi nhận trung thực như sau (không đánh dấu đã xác minh trên production):

1. **Dịch vụ gửi Email thực tế (SMTP / HTTP Email Provider & SPF/DKIM/DMARC)**:
   - **Trạng thái:** **Mức 5 (Chưa thể xác minh trên môi trường thật)**.
   - **Lý do:** Môi trường phát triển/kiểm toán cô lập không có khóa API của nhà cung cấp dịch vụ email thực và không được phép gửi email thật ra ngoài (Điều 10, Điều 32, Điều 45).
   - **Điều kiện hoàn thiện khi triển khai:** Cấu hình `EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM` trên Cloudflare Worker (xem `OPERATIONS-AND-ADMIN-GUIDE-2026.md`) và kiểm tra bản ghi DNS SPF/DKIM/DMARC của tên miền `skyfirst.io.vn`.
2. **Thực thi Migration trên Cloudflare D1 Production & Kiểm thử tải lớn phân tán**:
   - **Trạng thái:** **Mức 5 (Chưa chạy trên D1/R2 production)**.
   - **Lý do:** Tuân thủ nghiêm ngặt Điều 5 và Điều 45 (cấm tự ý chạy migration thật hoặc ghi/xóa dữ liệu trên tài nguyên D1/R2 production khi chưa có phê duyệt triển khai).
   - **Điều kiện hoàn thiện khi triển khai:** Chạy bản sao lưu D1 trước, áp dụng `migrations/0001_exam_standalone_schema.sql` trên môi trường staging trước khi áp dụng lên production theo đúng quy trình tại `OPERATIONS-AND-ADMIN-GUIDE-2026.md`.
3. **Kiểm thử hiển thị tương tác trên mọi trình duyệt vật lý (Physical Device Browser Matrix)**:
   - **Trạng thái:** Đã kiểm chứng logic DOM/VM, CSS responsive và phông chữ Times New Roman; cần kiểm tra trực quan lần cuối trên thiết bị thật (iOS Safari, Android Chrome, Windows/macOS Desktop) ở môi trường staging trước kỳ thi chính thức.
