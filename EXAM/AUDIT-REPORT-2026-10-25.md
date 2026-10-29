# BÁO CÁO KIỂM TOÁN, NHẬT KÝ THAY ĐỔI, KIỂM THỬ THỰC TẾ VÀ DANH SÁCH VẤN ĐỀ TỒN ĐỌNG — SKY FIRST EXAM 2026 (v5.0.0)

**Đơn vị:** Hệ Thống Khảo Thí Và Đánh Giá Sky First — Mạng lưới Giáo dục và Phát triển Cộng đồng Sky First (`SKY FIRST NETWORK`)  
**Gói mã nguồn đầu vào đối chiếu:** `exam-main-audited.zip` (gốc) & `exam-skyfirst-2026-standalone-complete.zip` (`v5.0.0`)  
**Gói mã nguồn hoàn thiện bàn giao:** `exam-skyfirst-2026-standalone-complete.zip` (25 tệp, đã cập nhật và kiểm chứng toàn diện)  
**Ngày hoàn tất kiểm toán & nghiệm thu kỹ thuật:** 25/10/2026  

---

## PHẦN 1. KẾT QUẢ RÀ SOÁT ĐỘC LẬP KHỎI HỆ THỐNG SLC (MỤC III)

Toàn bộ kho mã nguồn đã được rà soát từng dòng và kiểm chứng bằng cả quét tĩnh (`scripts/validate.mjs`) lẫn chặn mạng runtime (`scripts/validate-integration.mjs`):

1. **Loại bỏ hoàn toàn kết nối và proxy sang SLC**:
   - Đã xóa hằng số `CONTROL_ORIGIN = 'https://slc.skyfirst.io.vn'` và hàm `proxyToControl(request)` khỏi `src/index.js`.
   - Mọi request `/api/*` không khớp route nội bộ đều trả về lỗi JSON `404 API_NOT_FOUND` tại chỗ, tuyệt đối không chuyển tiếp sang bất kỳ máy chủ bên ngoài nào.
   - Đã gỡ bỏ `https://slc.skyfirst.io.vn` khỏi `Content-Security-Policy` trong cả `src/index.js` và `public/_headers`.
   - Đã cập nhật `functions/health.js` để không gọi `fetch('https://slc.skyfirst.io.vn/api/health')`, đồng bộ phiên bản `5.0.0` và trạng thái `slc_dependency: "removed"`.
2. **Độc lập hóa toàn bộ quy trình định danh, lưu trữ và biên nhận**:
   - Khóa lưu trữ trình duyệt trong `public/storage.js` sử dụng tiền tố `skyfirst_exam_*` và `skyfirst_admin_*` (thay cho `slcs_exam_*`).
   - Hàm `parseInvite()` trong `public/core.js` kiểm tra tên miền thuộc hệ thống khảo thí Sky First, từ chối tên miền lạ.
   - Mã biên nhận nộp bài mới trong `receiptFor()` (`src/index.js`) được sinh theo quy tắc riêng `EXM-<8 ký tự đầu mã phiên>-<4 ký tự ngẫu nhiên hex>` (trong khi vẫn đọc tương thích ngược các bản ghi biên nhận lịch sử đã lưu trong bảng `assessment_receipts`).
   - Bộ kiểm thử tích hợp `scripts/validate-integration.mjs` ghi đè `globalThis.fetch` để ném lỗi `FORBIDDEN_OUTBOUND_NETWORK_CALL` nếu có bất kỳ kết nối mạng nào ra ngoài, chứng minh toàn bộ 14 kịch bản đầu-cuối chạy độc lập 100%.

---

## PHẦN 2. KIỂM KÊ ĐỐI CHIẾU TOÀN BỘ 24 ENDPOINT API QUẢN TRỊ `/api/admin/*` & 17 ENDPOINT THÍ SINH (MỤC IV.2 & V.2)

### 2.1. Bảng đối chiếu 24 Endpoint Quản trị (`/api/admin/*`) trong `src/index.js` và `public/admin.js`

| STT | Phương thức & Đường dẫn | Quyền RBAC bắt buộc (`authorizeAdmin`) | Xác thực đầu vào & Xử lý máy chủ | Nhật ký kiểm toán (`exam_audit_log`) | Nơi sử dụng tại `public/admin.js` |
|---:|---|---|---|---|---|
| 1 | `POST /api/admin/auth/bootstrap` | Khóa bằng `ADMIN_BOOTSTRAP_TOKEN` + khóa 1 lần (`409` nếu đã có `system_admin`) | So khớp hằng thời gian `timingSafeStringEqual`, kiểm tra định dạng email, rate-limit 5 lần/10 phút | `admin.bootstrap.provisioned` / `.failed` / `.locked` | Biểu mẫu `#adminBootstrapForm` |
| 2 | `POST /api/admin/auth/request-otp` | Chỉ user `active` có vai trò trong `ADMIN_ROLES` (`403` nếu chưa cấp quyền) | Cooldown 60s, rate-limit 5 lần/10 phút, tạo OTP 6 số hạn 5 phút băm `SHA-256` | `admin.otp.requested` / `admin.otp.denied` | Nút `#btnSendAdminOtp` |
| 3 | `POST /api/admin/auth/verify-otp` | Đối chiếu OTP băm một chiều, tối đa 5 lần thử sai | Cấp token phiên 8h + Cookie `HttpOnly; Secure; SameSite=Strict` + `csrf_token` | `admin.login.success` / `admin.login.failed` | Biểu mẫu `#adminOtpForm` |
| 4 | `POST /api/admin/auth/logout` | Phiên quản trị hợp lệ (+ kiểm tra Origin/CSRF nếu dùng Cookie) | Đánh dấu `revoked_at = CURRENT_TIMESTAMP`, xóa Cookie phiên | `admin.logout` | Nút `#btnAdminLogout` |
| 5 | `GET /api/admin/auth/me` | Phiên quản trị hợp lệ | Trả thông tin quản trị viên, danh sách `roles` và `csrf_token` | — (Truy vấn đọc phiên) | Hàm `bootAdmin()` |
| 6 | `GET /api/admin/dashboard` | `dashboard:view` | Tổng hợp số liệu thực từ D1 (kỳ thi, thí sinh, phiên thi, chấm điểm, bảo mật, phúc khảo, hỗ trợ) | — (Truy vấn đọc) | Tab `dashboard` (`renderDashboardTab`) |
| 7 | `GET /api/admin/exams` | `exams:read` | Lọc theo `status`, từ khóa `q`, đếm số câu hỏi và số phiên đang thi/tổng | — | Tab `exams` (`renderExamsTab`) |
| 8 | `POST /api/admin/exams` | `exams:write` | Kiểm tra tiêu đề, khung giờ `closes_at > opens_at` (`400 INVALID_SCHEDULE_WINDOW`), chuẩn hóa mảng câu hỏi | `exam.created` | Biểu mẫu `#examForm` (Tạo mới) |
| 9 | `GET /api/admin/exams/:id` | `exams:read` | Trả chi tiết cấu hình kỳ thi, danh sách câu hỏi và các phiên bản đề đã niêm phong | — | Nút `[data-edit-exam]` |
| 10 | `PUT /api/admin/exams/:id` (`PATCH`) | `exams:write` | Chặn sửa câu hỏi/thời lượng khi có thí sinh đang làm bài (`409 ACTIVE_ATTEMPTS_PROTECTED`) | `exam.updated` | Biểu mẫu `#examForm` (Cập nhật) |
| 11 | `POST /api/admin/exams/:id/lifecycle` | `exams:lifecycle` | Kiểm tra ma trận chuyển trạng thái `VALID_EXAM_TRANSITIONS`, niêm phong gói đề vào `assessment_exam_versions` khi `published` | `exam.status.<nextStatus>` | Nút `[data-lifecycle-exam]` |
| 12 | `GET /api/admin/questions` | `questions:read` | Tìm kiếm theo `topic`, `difficulty`, từ khóa `q` trên các câu hỏi chưa xóa | — | Tab `questions` (`renderQuestionsTab`) |
| 13 | `POST /api/admin/questions` | `questions:write` | Kiểm tra cấu trúc câu hỏi, điểm số $\ge 0$, khởi tạo `version = 1` và lưu bản chụp `exam_question_versions` | `qbank.created` | Biểu mẫu `#qbankForm` (Tạo mới) |
| 14 | `PUT /api/admin/questions/:id` (`PATCH`) | `questions:write` | Tăng `version = version + 1`, lưu lịch sử vào `exam_question_versions` | `qbank.updated` | Biểu mẫu `#qbankForm` (Cập nhật) |
| 15 | `DELETE /api/admin/questions/:id` | `questions:delete` | Chuyển trạng thái câu hỏi sang `deleted` (lưu trữ an toàn, không làm hỏng đề cũ) | `qbank.deleted` | Nút `[data-delete-question]` |
| 16 | `POST /api/admin/questions/import` | `questions:write` | Kiểm tra toàn bộ mảng câu hỏi JSON trước khi nhập hàng loạt | `qbank.imported` | API nhập ngân hàng câu hỏi |
| 17 | `GET /api/admin/candidates` | `candidates:read` | Lọc theo `exam_id` và từ khóa `q`; không trả về OTP hash hay token bí mật | — | Tab `candidates` & `users` |
| 18 | `POST /api/admin/candidates/enroll` | `candidates:write` | Kiểm tra kỳ thi tồn tại, email hợp lệ, ghi danh hoặc cập nhật trạng thái (`active`/`locked`/`revoked`) | `candidate.enrollment.upserted` | Biểu mẫu `#enrollForm` |
| 19 | `POST /api/admin/candidates/launch` | `candidates:write` | Kiểm tra kỳ thi `published`, tạo phiên thi nội bộ và cấp `launch_token` dùng 1 lần hạn 24h | `attempt.launch_token.issued` | Biểu mẫu `#issueLaunchForm` |
| 20 | `GET /api/admin/monitor` | `monitor:read` | Liệt kê phiên thi, thời điểm lưu bài, số tín hiệu trình duyệt và danh sách yêu cầu hỗ trợ kỹ thuật | — | Tab `monitor` (`renderMonitorTab`) |
| 21 | `POST /api/admin/monitor/:attemptId/action` | `monitor:write` | Bắt buộc có `reason`; thực hiện `lock`, `unlock`, `add_time` (1–180 phút), hoặc `release_lease` | `attempt.locked` / `.unlocked` / `.extra_time` / `.lease_released` | Các nút `[data-proctor-action]` |
| 22 | `POST /api/admin/support/:id/resolve` | `support:write` | Bắt buộc nhập `resolution_note`, chuyển yêu cầu hỗ trợ sang `resolved` | `support.resolved` | Biểu mẫu `.support-resolve-form` |
| 23 | `GET /api/admin/grading/:attemptId` | `grading:read` | Trả bài làm, câu hỏi, đáp án chuẩn, trạng thái workflow và điểm chấm thủ công từng câu | — | Nút `[data-open-grading]` |
| 24 | `POST /api/admin/grading/:attemptId/grade` | `grading:write` | Chặn sửa khi đã `published` (`409 PUBLISHED_RESULT_PROTECTED`), kiểm tra `0 <= score <= maxPoints`, tính lại tổng điểm | `grading.manual.updated` | Biểu mẫu `.manual-grade-form` |
| 25 | `POST /api/admin/grading/:attemptId/workflow` | `results:approve` / `results:publish` / `results:revoke` | Chặn duyệt/công bố khi còn tự luận chưa chấm (`409`); bắt buộc duyệt trước khi công bố (`409`); chặn tự duyệt bài mình chấm (`403 SEGREGATION_OF_DUTIES_VIOLATION`) | `result.approved` / `.published` / `.revoked` | Nút `[data-workflow-action]` |
| 26 | `GET /api/admin/appeals` & `POST /api/admin/appeals/:id/resolve` | `appeals:read` / `appeals:write` | Liệt kê và giải quyết đơn phúc khảo, lưu `score_before`, `score_after` và `resolution_note` | `appeal.resolved` | Tab `appeals` (`.appeal-resolve-form`) |
| 27 | `POST /api/admin/users/role` | `users:write` | Gán/thu hồi vai trò; tự động thu hồi mọi phiên đang mở nếu tài khoản bị khóa hoặc gỡ quyền admin | `admin.user_role.updated` | Biểu mẫu `#userRoleForm` |
| 28 | `GET /api/admin/audit-logs` & `GET /api/admin/files/:id` | `audit:read` / `grading:read` | Lọc và phân trang nhật ký kiểm toán (`limit`, `offset`); tải tệp bài làm riêng tư từ R2 | `file.downloaded` | Tab `audit` & link tải tệp chấm bài |

### 2.2. Ma trận Phân quyền Thực tế (RBAC Matrix — Mục V.2)

| Quyền hạn (`Permission`) | `system_admin` | `account_admin` | `exam_admin` | `question_bank_manager` | `exam_author` | `proctor` | `grader` | `result_approver` | `appeal_officer` | `report_viewer` |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Xem Dashboard (`dashboard:view`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Xem / Tạo / Sửa Kỳ thi (`exams:read/write`) | ✓ | — | ✓ | Chỉ xem | ✓ | Chỉ xem | Chỉ xem | Chỉ xem | — | Chỉ xem |
| Chuyển trạng thái / Niêm phong đề (`exams:lifecycle`) | ✓ | — | ✓ | — | — | — | — | — | — | — |
| Tạo / Sửa Ngân hàng câu hỏi (`questions:write`) | ✓ | — | ✓ | ✓ | ✓ | — | — | — | — | Chỉ xem |
| Xóa / Lưu trữ câu hỏi (`questions:delete`) | ✓ | — | ✓ | ✓ | — | — | — | — | — | — |
| Quản lý Thí sinh & Ghi danh (`candidates:write`) | ✓ | — | ✓ | — | — | Chỉ xem | — | — | — | Chỉ xem |
| Giám sát & Khóa/Mở khóa phiên (`monitor:write`) | ✓ | — | ✓ | — | — | ✓ | — | — | — | Chỉ xem |
| Xử lý yêu cầu hỗ trợ (`support:write`) | ✓ | — | ✓ | — | — | ✓ | — | — | — | Chỉ xem |
| Chấm điểm tự luận (`grading:write`) | ✓ | — | Chỉ xem | — | — | — | ✓ | Chỉ xem | Chỉ xem | — |
| Phê duyệt / Công bố / Thu hồi kết quả (`results:*`) | ✓ | — | Chỉ xem | — | — | — | — | ✓ *(Không tự duyệt bài mình chấm)* | Chỉ xem | Chỉ xem |
| Giải quyết phúc khảo (`appeals:write`) | ✓ | — | — | — | — | — | — | — | ✓ | Chỉ xem |
| Quản trị Tài khoản & Vai trò (`users:write`) | ✓ | ✓ | — | — | — | — | — | — | — | — |
| Xem Nhật ký kiểm toán (`audit:read`) | ✓ | ✓ | ✓ | — | — | — | — | ✓ | ✓ | ✓ |

---

## PHẦN 3. NHẬT KÝ THAY ĐỔI MÃ NGUỒN CHI TIẾT (MỤC XIV.2)

| Hạng mục | Tình trạng ban đầu (`exam-main-audited.zip` & bản nháp đầu) | Thay đổi đã thực hiện trực tiếp trên mã nguồn | Tệp liên quan | Kết quả kiểm thử |
|---|---|---|---|---|
| 1. Loại bỏ phụ thuộc SLC & Proxy | Còn `CONTROL_ORIGIN`, `proxyToControl`, CSP chứa `slc.skyfirst.io.vn`, `functions/health.js` gọi SLC, script test phụ thuộc `../SLCS`. | Xóa hoàn toàn `CONTROL_ORIGIN` và `proxyToControl`; trả `404 API_NOT_FOUND` cho route `/api/*` lạ; xóa SLC khỏi CSP; cập nhật `functions/health.js`; đổi tiền tố lưu trữ sang `skyfirst_exam_*` và mã biên nhận mới sang `EXM-<8 ký tự>-<4 hex>`. | `src/index.js`, `functions/health.js`, `public/_headers`, `public/core.js`, `public/storage.js` | `validate.mjs` (Test 40 PASS) & `validate-integration.mjs` (14/14 kịch bản PASS khi chặn `globalThis.fetch`) |
| 2. Khóa khởi tạo Quản trị viên 1 lần & So khớp hằng thời gian | Cần bảo vệ chống gọi lại `/api/admin/auth/bootstrap` sau khi hệ thống đã có `system_admin` và chống tấn công timing attack. | Bổ sung hàm `timingSafeStringEqual(a, b)`, áp dụng rate-limit cho `/api/admin/auth/bootstrap`, và tự động khóa chức năng bootstrap (`409 BOOTSTRAP_ALREADY_COMPLETED`) ngay khi đã có `system_admin` đang hoạt động. | `src/index.js` | `validate-integration.mjs` (Scenario 3 & Scenario 12 PASS) |
| 3. Bảo vệ Cookie CSRF thực chất (Origin/Referer + Token) | Khi xác thực qua Cookie `exam_admin_session`, cần kiểm tra thêm nguồn gửi request bên cạnh header `X-CSRF-Token`. | Bổ sung kiểm tra nghiêm ngặt header `Origin` (`403 CSRF_ORIGIN_MISMATCH`) và `Referer` (`403 CSRF_REFERER_MISMATCH`) kết hợp so khớp hằng thời gian `X-CSRF-Token` trong `authorizeAdmin()`. | `src/index.js`, `public/api.js` | `validate-integration.mjs` (Scenario 12 PASS) |
| 4. Phân tách nhiệm vụ (Segregation of Duties) & Bắt buộc duyệt trước khi công bố | Cần ngăn người chấm tự phê duyệt kết quả của chính mình và ngăn công bố kết quả tự luận khi chưa qua bước `approve`. | Trong `adminResultWorkflowAction()`: bắt buộc trạng thái `approved` trước khi `publish` (`409 APPROVAL_REQUIRED_BEFORE_PUBLISH`) và chặn người dùng không phải `system_admin` tự `approve` bài thi do chính mình chấm (`403 SEGREGATION_OF_DUTIES_VIOLATION`). | `src/index.js` | `validate-integration.mjs` (Scenario 9 & Scenario 13 PASS) |
| 5. Kiểm tra mâu thuẫn lịch thi & Bảo vệ phiên đang thi | Cần chặn cấu hình `closes_at <= opens_at` và chặn sửa đề/thời lượng khi có thí sinh đang làm bài. | Kiểm tra `closeMs <= openMs` trả `400 INVALID_SCHEDULE_WINDOW`; kiểm tra `activeCount > 0` chặn sửa câu hỏi và thời lượng trả `409 ACTIVE_ATTEMPTS_PROTECTED`. | `src/index.js` | `validate-integration.mjs` (Scenario 7 & Scenario 12 PASS) |
| 6. Hoàn thiện Giao diện & API Quản trị `/admin` | Chưa có `/admin`; cần thêm tìm kiếm, sửa, xóa/lưu trữ câu hỏi, xuất JSON ngân hàng đề và đóng yêu cầu hỗ trợ kỹ thuật. | Xây dựng `public/admin.js` (9 tab), thêm `DELETE /api/admin/questions/:id`, `POST /api/admin/support/:id/resolve`, bộ lọc tìm kiếm câu hỏi/thí sinh/nhật ký kiểm toán và xuất JSON. | `public/admin.js`, `public/exam.js`, `public/_redirects`, `src/index.js` | `validate.mjs` (Test 39 PASS) & `validate-integration.mjs` (Scenario 5, 11, 12 PASS) |
| 7. Migration cho DB mới & Đường nâng cấp cho DB 16 bảng hiện hữu | Cần chứng minh migration chạy đúng trên cả DB trống và DB đã có sẵn 16 bảng cũ mà không mất dữ liệu. | Tạo `migrations/0001_exam_standalone_schema.sql` (cho DB mới) và `migrations/0002_exam_upgrade_existing_schema.sql` + `ensureAdditiveSchema()` dùng `WeakSet` theo từng DB instance (cho DB nâng cấp). | `migrations/0001_exam_standalone_schema.sql`, `migrations/0002_exam_upgrade_existing_schema.sql`, `src/index.js` | `validate-integration.mjs` (Scenario 14 PASS) |
| 8. Phông chữ Times New Roman toàn cục & Responsive UI | Cần đảm bảo toàn bộ trang công khai, phòng thi và `/admin` kế thừa đúng Times New Roman. | Áp dụng `font-family: "Times New Roman", Times, serif !important` trên mọi phần tử, pseudo-element và form control; thiết kế responsive từ 320px đến 1450px+. | `public/styles.css`, `public/index.html` | `validate.mjs` (Test 37 PASS) |

---

## PHẦN 4. BÁO CÁO KIỂM THỬ THỰC TẾ (MỤC XI & XIV.3)

### 4.1. Lệnh chạy và Môi trường kiểm thử thực tế

- **Môi trường:** Linux VM, Node.js `v18.20.4`, Python `3.11.2` (`sqlite3 3.40.1` kết nối qua `scripts/sqlite-compat.mjs`).
- **Lệnh kiểm thử chuẩn:**
  ```bash
  npm run build
  ```
- **Tổng kết thực thi thực tế:**
  - `npm run check`: **7/7 tệp JS PASS** (`public/api.js`, `public/storage.js`, `public/core.js`, `public/exam.js`, `public/admin.js`, `src/index.js`, `functions/health.js`).
  - `node scripts/validate.mjs`: **40/40 bài kiểm thử tĩnh & đơn vị PASS**.
  - `node scripts/validate-runtime.mjs`: **14/14 bài kiểm thử runtime & fault-injection rollback PASS**.
  - `node scripts/validate-integration.mjs`: **14/14 kịch bản tích hợp đầu-cuối, bảo mật & nâng cấp migration PASS** (tổng cộng **68/68 bài kiểm thử tự động PASS**, **0 FAIL**).

### 4.2. Danh sách đầy đủ 68 bài kiểm thử đã chạy và đạt (PASS)

#### A. Bộ kiểm thử Tĩnh & Đơn vị (`scripts/validate.mjs` — 40 bài test)
1. `runtime JavaScript syntax across all frontend and backend modules`
2. `UTC database dates independent from host timezone`
3. `legacy schedules use Vietnam timezone`
4. `clock handles unlimited, minutes, hours and elapsed deadline`
5. `all supported question types have correct progress status`
6. `partial matching and duplicate ordering are not complete`
7. `zero and false are meaningful answers`
8. `invalid exam and duplicate question IDs rejected`
9. `HTML escaping blocks injected markup`
10. `public question payload uses an allowlist and strips nested scoring secrets`
11. `server answer sanitizer drops unknown question IDs and rejects wrong answer shapes`
12. `integrity events store only bounded approved fields`
13. `server accepted zero-point items remain zero-point`
14. `JSON request reader enforces byte cap before parsing`
15. `cache answers scoped to current questions`
16. `journal never acknowledges edits made during pending save`
17. `events deduplicated and legacy UI state excluded`
18. `invitation parsing supports direct code, /join/* URL and Sky First links while rejecting external domains`
19. `API sends bearer token without session cookies by default`
20. `API preserves revision conflict details`
21. `API rejects successful HTML, null and array payloads`
22. `network errors distinguished from server rejection`
23. `session roundtrip includes candidate identity and admin session helpers`
24. `local snapshot keeps revision and dirty edits`
25. `active tab lease cannot be taken by another owner`
26. `blocked browser storage has safe fallback`
27. `workstation renders all supported question types with escaped content`
28. `saving older payload cannot mark newer typing as saved`
29. `simultaneous autosaves share one request`
30. `server clock advances by monotonic performance time`
31. `completion respects hidden score policy`
32. `multilingual question content preserves per-question language and Unicode`
33. `rendered exam localizes an RTL audio question and displays the recorder controls`
34. `speaking runtime records only after an explicit microphone action`
35. `MediaRecorder audio containers require valid WebM/Ogg signatures`
36. `large candidate logo converted to a smaller WebP asset`
37. `Times New Roman is enforced globally across interface controls and components`
38. `submission body and server finalizer rely on the saved server snapshot`
39. `/admin route loads the real admin subsystem module and RBAC roles`
40. `SLC control-plane proxy and URLs are completely removed from runtime files`

#### B. Bộ kiểm thử Runtime & Fault-Injection (`scripts/validate-runtime.mjs` — 14 bài test)
41. `runtime load attempt returns no answer/rubric metadata`
42. `runtime save persists revisioned sanitized answers and events`
43. `runtime stale save is rejected with revision conflict`
44. `runtime submit scores only the server-accepted snapshot, not client-supplied answers`
45. `runtime duplicate submit is idempotent`
46. `runtime manual grading stays pending and auto-score is hidden until publication`
47. `runtime answer save rolls back if revision journal cannot be persisted`
48. `runtime submission state and audit log are atomic and recover after audit failure`
49. `runtime receipt failure is reported until a receipt is durably persisted`
50. `runtime launch redemption accepts a valid SQLite UTC timestamp and persists one access token`
51. `runtime replayed/racing launch token is rejected without an orphan access token`
52. `runtime malformed launch expiry is rejected instead of treated as non-expiring`
53. `runtime health checks the required local schema and R2 binding`
54. `runtime health fails closed when a required schema table is missing`

#### C. Bộ kiểm thử Tích hợp Đầu-Cuối, Bảo mật & Nâng cấp Schema (`scripts/validate-integration.mjs` — 14 kịch bản lớn)
55. `integration [1]: Unauthenticated access to /api/admin/dashboard is rejected with 401`
56. `integration [2]: Unprovisioned email cannot request admin OTP (403 ADMIN_NOT_PROVISIONED)`
57. `integration [3]: Bootstrap system_admin, enforce OTP cooldown/validation/single-use, and issue session`
58. `integration [4]: RBAC enforces least privilege across roles (403 INSUFFICIENT_PERMISSION)`
59. `integration [5]: Question Bank versioning and Exam lifecycle state transitions work end-to-end`
60. `integration [6]: Enrollment check, honest email failure reporting, and candidate OTP verification flow`
61. `integration [7]: Mid-exam question/duration edits are blocked while attempt is active, and IDOR is blocked`
62. `integration [8]: Strict mode locks attempt upon reaching violation threshold and proctor can unlock with audit reason`
63. `integration [9]: Submission, manual grading workflow, published result protection, lookup, and appeals work end-to-end`
64. `integration [10]: Admin launch token issuance, redemption, and hard deadline auto-submission work independently of SLC`
65. `integration [11]: Dashboard metrics and immutable audit log reflect all real operations`
66. `integration [12]: One-time bootstrap lock, Cookie CSRF Origin defense, schedule validation, question delete, and support resolution`
67. `integration [13]: Segregation of duties prevents a grader from approving their own manual grading (403 SEGREGATION_OF_DUTIES_VIOLATION)`
68. `integration [14]: Legacy 16-table database upgrades cleanly via 0002 migration + ensureAdditiveSchema without losing existing data`

---

## PHẦN 5. DANH SÁCH VẤN ĐỀ TỒN ĐỌNG & RỦI RO MÔI TRƯỜNG CHƯA XÁC MINH (MỤC XIV.4)

Không còn lỗi mã nguồn nghiêm trọng (Critical/High) nào bị bỏ qua trong phạm vi gói mã nguồn. Các hạng mục dưới đây thuộc về cấu hình môi trường bên ngoài hoặc giới hạn kiến trúc trình duyệt cần lưu ý khi vận hành:

| Mã vấn đề | Mức độ | Mô tả & Điều kiện tái hiện | Ảnh hưởng tới nghiệp vụ / dữ liệu | Nguyên nhân | Phương án xử lý & Lý do chưa xác minh trên production |
|---|---|---|---|---|---|
| **ENV-01** | **Medium** (Chặn gửi OTP thực tế nếu chưa cấu hình) | Khi gọi `/api/admin/auth/request-otp` hoặc `/api/public/assessments/:code/request-verification` mà chưa cấu hình `EMAIL_API_URL` và `EMAIL_API_KEY`, API trả về `503 EMAIL_SERVICE_UNCONFIGURED`. | Không thể nhận email OTP qua hộp thư thật cho tới khi cấu hình dịch vụ gửi thư. | Môi trường kiểm toán cô lập không có khóa API dịch vụ email thực và tuân thủ quy định không gửi email thật (Mục I.7 & XII.4). | Thiết lập `EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM` qua `wrangler secret put` và kiểm tra bản ghi DNS SPF/DKIM/DMARC trước khi mở kỳ thi có bật `require_email_verify`. |
| **ENV-02** | **Medium** (Cần thực hiện khi triển khai) | Các bảng mở rộng trong `0001_exam_standalone_schema.sql` / `0002_exam_upgrade_existing_schema.sql` chưa được chạy trên D1 production (`scrd-files`). | Nếu deploy Worker mới mà chưa chạy migration (hoặc nếu tài khoản D1 bị giới hạn quyền `CREATE TABLE` tự động), các tính năng `/admin` mới sẽ thiếu bảng. | Tuân thủ nghiêm ngặt Mục I.6 & XII.2: tuyệt đối không chạy migration trên D1 production trong quá trình kiểm toán. | Sao lưu D1 bằng `wrangler d1 export`, thử nghiệm trên D1 staging trước, sau đó chạy `wrangler d1 execute scrd-files --remote --file=migrations/0002_exam_upgrade_existing_schema.sql`. |
| **ARCH-01** | **Low / Informational** | Giới hạn tự nhiên của trình duyệt web trong chế độ thi nghiêm ngặt (`Strict Mode`). | Trình duyệt có thể ghi nhận sự kiện mất tiêu điểm (`window_blur`), ẩn tab (`visibility_hidden`), thoát toàn màn hình (`fullscreen_exit`), chặn `copy`/`paste`, nhưng không thể ngăn chặn thí sinh dùng thiết bị thứ hai hoặc chụp ảnh màn hình bằng điện thoại. | Giớiধি bảo mật sandbox của các trình duyệt web tiêu chuẩn. | Hệ thống đã phân biệt rõ “tín hiệu trình duyệt quan sát được” với kết luận gian lận, đồng thời hỗ trợ khóa phiên tự động (`STRICT_LOCK`) để cán bộ coi thi kiểm tra và mở khóa có kiểm toán. |
| **ARCH-02** | **Low / Informational** | Khi thí sinh tải tệp trả lời mới thay thế tệp cũ trong cùng một câu hỏi, bản ghi cũ trong `assessment_response_files` chuyển sang `replaced` nhưng tệp vật lý cũ trên R2 vẫn được giữ lại. | Dung lượng R2 có thể tăng nhẹ nếu thí sinh thay tệp nhiều lần. | Chủ đích giữ lại tệp cũ để bảo toàn chứng cứ phục vụ đối chiếu hoặc phúc khảo khi cần. | Chỉ thực hiện dọn dẹp các tệp `replaced` trên R2 sau khi kỳ thi đã hết thời hạn phúc khảo và lưu trữ theo quy chế của đơn vị. |

---

## PHẦN 6. ĐÁNH GIÁ ĐIỀU KIỆN NGHIỆM THU CUỐI CÙNG (MỤC XIII & XVI.8)

- **Trạng thái nghiệm thu:** **ĐẠT CÓ ĐIỀU KIỆN (CONDITIONAL PASS — Sẵn sàng về mã nguồn và kiểm thử cục bộ; chờ cấu hình Secrets & Migration trên Staging/Production được phê duyệt)**.
- **Căn cứ xác lập:**
  - **ĐẠT 100% về mặt Mã nguồn, Kiến trúc độc lập và Kiểm thử cục bộ:** Toàn bộ 12 điều kiện kỹ thuật trong phạm vi mã nguồn (loại bỏ SLC, hoàn thiện `/admin`, RBAC 10 vai trò + phân tách nhiệm vụ, bảo vệ CSRF/IDOR/XSS, migration cho cả DB mới và DB nâng cấp 16 bảng, quy trình thi đầu-cuối, phông chữ Times New Roman, 68/68 bài kiểm thử tự động PASS) đều đã hoàn thành và có bằng chứng thực tế.
  - **ĐIỀU KIỆN trước khi mở kỳ thi thật trên Production:** Vì nhiệm vụ này nghiêm cấm tác động lên môi trường production (Mục XII), đơn vị vận hành cần thực hiện bước cấu hình `EMAIL_API_URL`/`EMAIL_API_KEY`, sao lưu D1 và chạy migration trên môi trường Staging/Production theo đúng hướng dẫn tại `OPERATIONS-AND-ADMIN-GUIDE-2026.md`.
