# Báo cáo kiểm toán EXAM — 25/10/2026

**Dự án:** EXAM — Trung tâm Dự thi Sky First  
**Nguồn mã nguồn:** `exam-main.zip` duy nhất  
**Phạm vi an toàn:** làm việc trên bản giải nén cô lập; không kết nối hoặc ghi dữ liệu production, không gửi OTP/email thật, không chạy migration production và không deploy.  
**Kết luận nghiệm thu:** **Chưa đủ điều kiện kết luận hoàn thành toàn bộ hoặc sẵn sàng production.** Một số lỗi có bằng chứng đã được vá và kiểm thử cục bộ; còn các hạng mục phụ thuộc control plane, giao diện quản trị, môi trường thật, browser smoke test và vận hành cần được xác minh riêng.

## 1. Tóm tắt điều hành

ZIP chứa một ứng dụng thực thi bài thi trực tuyến theo mô hình Cloudflare Worker + static assets, D1 và R2; không chứa một bộ quản trị khảo thí toàn diện. `src/index.js` là Worker entrypoint theo `wrangler.json`; `public/` chứa UI dành cho thí sinh; `public/api.js` gọi các endpoint `/api/`; các endpoint chưa xử lý cục bộ được proxy đến `https://slc.skyfirst.io.vn`.

Trong phạm vi mã có thể kiểm tra, phát hiện được các vấn đề về lọc payload câu hỏi, nguồn dữ liệu chấm điểm khi submit, điều kiện hiển thị điểm tự luận, giới hạn request, kiểm soát answer revision, health/readiness và phông chữ. Những mục này đã được sửa trong bản làm việc và có test hồi quy. Tuy nhiên, không thể dùng kết quả test cục bộ để kết luận OTP/control plane, R2/D1 production, quyền quản trị thật, DNS, gửi email, hiệu năng tải lớn hay tuân thủ pháp luật đã đạt yêu cầu.

### Bảng kết quả kiểm chứng

| Hạng mục | Kết quả quan sát |
|---|---|
| Syntax check các tệp runtime | PASS |
| Kiểm tra chức năng/static | **39/39 PASS** |
| Test runtime chạy Worker thật với D1 giả lập SQLite trong bộ nhớ | **14/14 PASS** |
| Tổng test check hiện hành | **53/53 PASS** (39 test chức năng/static + 14 test runtime; không phải 53 kịch bản production) |
| Build bundle/deploy Cloudflare | Chưa chạy; `npm run build` hiện là syntax + test, không phải deploy build |
| Browser smoke test/chụp màn hình | Chưa xác minh; lần thử Chromium headless bị treo/hết thời gian, không có bằng chứng ảnh chụp |
| Tích hợp với SLCS/control plane | Chưa chạy — mã nguồn đó không thuộc đầu vào được phép |
| D1/R2/email/OTP/DNS production | Không truy cập/không kiểm thử |

## 2. Kiểm kê mã nguồn và kiến trúc thực tế

### 2.1. Tệp/chức năng chính

| Vị trí | Vai trò đã xác minh |
|---|---|
| `wrangler.json` | Cloudflare Worker entrypoint, Static Assets, D1 binding `DB`, R2 binding `FILES`, resource name/ID |
| `src/index.js` | API cục bộ: redeem launch, tải attempt, save, submit, violation, upload, health; proxy endpoint API còn lại sang control plane |
| `public/index.html` | Shell giao diện dự thi, metadata, CSS và module script |
| `public/exam.js` | Luồng thí sinh, mở attempt, autosave, phòng thi, submit, upload và sự kiện trình duyệt |
| `public/api.js` | Fetch wrapper: bearer token, session ID, timeout, JSON validation, `credentials: omit` |
| `public/core.js` | Logic UI/câu hỏi và hỗ trợ các loại câu hỏi |
| `public/storage.js` | Lưu session trong `sessionStorage`, bản nháp trong `localStorage` |
| `public/styles.css` | Phong cách giao diện và responsive styling |
| `public/_headers`, `public/_redirects` | Header bảo mật cho static assets; rewrite `/exam/*`, `/join/*` |
| `scripts/validate.mjs` | Bộ kiểm tra chức năng/static và regression |
| `scripts/validate-runtime.mjs` | Test Worker với schema SQLite cục bộ giả lập D1/R2 |
| `scripts/validate-integration.mjs` | Test tích hợp tùy chọn yêu cầu source SLCS bên ngoài ZIP |
| `functions/health.js` | Pages Function riêng kiểm tra SLC health; chưa chứng minh được runtime triển khai vì `wrangler.json` chọn `src/index.js` |

### 2.2. Luồng dữ liệu/điều khiển

**Luồng attempt nội bộ:** token bearer → `authorize()` → kiểm tra attempt/access token trong D1 → `claimLease()` → lấy câu hỏi công khai qua allowlist → thí sinh lưu với revision → D1 ghi snapshot + revision → submit lấy snapshot đã lưu → chấm tự động/khởi tạo manual grading → receipt.

**Luồng khách/invite:** UI gọi endpoint đăng ký/xác minh thuộc `/api/public/assessments/...`; Worker proxy sang control plane. Sau khi có launch token, `/api/public/exam-launch/redeem` được xử lý trong Worker và tạo access token có hash lưu tại D1.

**Luồng tệp:** UI upload qua endpoint upload; Worker xác thực câu hỏi và chữ ký/MIME được hỗ trợ, lưu object private trong R2 cùng metadata D1. Chưa có bằng chứng về quét malware/AV.

### 2.3. Ranh giới và phụ thuộc

- `wrangler.json` có resource name/ID D1/R2 mang dáng dấp cấu hình môi trường thật. Không sửa/di chuyển resource binding trong đợt này.
- `CONTROL_ORIGIN` là hằng số `https://slc.skyfirst.io.vn` trong `src/index.js`; không đổi vì cần đánh giá hợp đồng tích hợp trước.
- Không tìm thấy giao diện hoặc API quản trị trong các tệp được kiểm tra. Endpoint `/admin` hiện được chuyển sang thông báo không khả dụng thay vì màn hình thí sinh. Đây là biện pháp minh bạch, **không phải giao diện quản trị đã hoàn thành**.
- Logic OTP thực tế, cấp quyền đầu vào và nhiều endpoint công khai nằm ở control plane ngoài ZIP; chưa có đủ bằng chứng để kiểm toán.

## 3. Phát hiện đã sửa và kiểm chứng

Các mức độ phản ánh ảnh hưởng kỹ thuật của vấn đề trước khi sửa. “Đã test” ở đây chỉ là test cục bộ, không khẳng định không còn đường khai thác khác.

### EX-01 — Payload câu hỏi công khai dựa trên blacklist

- **Mức độ:** High — **Trạng thái:** Đã sửa trong bản làm việc, test hồi quy PASS.
- **Vị trí:** `src/index.js:78-92` (`publicQuestions`); test tại `scripts/validate.mjs`.
- **Bằng chứng:** Bản trước trải rộng đối tượng câu hỏi rồi xóa một số trường như answer/rubric. Cách này có thể để lộ một trường bí mật mới hoặc trường lồng chưa được thêm vào blacklist.
- **Tác động:** Có nguy cơ đưa đáp án, rubric hoặc metadata nội bộ tới trình duyệt trước khi được phép.
- **Khắc phục:** Tạo payload bằng allowlist trường được phép; `options` và stimulus được chuẩn hóa có kiểm soát. Trường lạ không được sao chép vào payload.
- **Kiểm chứng:** Regression kiểm tra `answer`, `answer_key` và `rubric` không xuất hiện; runtime trả câu hỏi cho client không chứa các trường này.
- **Giới hạn:** Chưa chạy trên dữ liệu production hoặc kiểm tra tất cả kiểu schema có thể tồn tại ngoài ZIP.

### EX-02 — Submit có thể dựa vào đáp án do request gửi lên thay vì snapshot máy chủ

- **Mức độ:** High — **Trạng thái:** Đã sửa, test runtime PASS.
- **Vị trí:** `src/index.js:129-153`, `src/index.js:176`; `public/exam.js:113`.
- **Bằng chứng:** Submit trước đây cần được bảo vệ khỏi việc coi payload submit do client gửi là nguồn quyết định cuối cùng. Bản hiện tại chỉ dùng `a.answers_json` và `a.event_log_json` đã được server chấp nhận; frontend submit chỉ gửi revision.
- **Tác động:** Nếu tin dữ liệu client khi nộp, điểm có thể bị tính từ dữ liệu khác snapshot đã lưu, tạo bất nhất giữa bài làm, điểm và lịch sử.
- **Khắc phục:** Submit chỉ dựa vào snapshot server; UPDATE kiểm tra trạng thái `in_progress` và `answer_revision`; nếu xung đột thì trả conflict, còn hết giờ có retry có giới hạn.
- **Kiểm chứng:** Runtime test lưu câu trả lời đúng, gửi payload submit cố tình đổi thành đáp án sai; server vẫn chấm theo snapshot đã lưu. Test nộp lặp xác nhận idempotent.
- **Giới hạn:** Chưa stress-test race condition thực trên Cloudflare D1 hoặc nhiều worker đồng thời.

### EX-03 — Điểm câu hỏi có `0` bị thay thành điểm mặc định

- **Mức độ:** Medium — **Trạng thái:** Đã sửa, test PASS.
- **Vị trí:** `src/index.js:104`.
- **Bằng chứng:** Dùng fallback truthy `q.points || 1` sẽ khiến `points: 0` thành `1`.
- **Tác động:** Sai điểm tối đa/điểm đạt có thể ảnh hưởng kết quả thi.
- **Khắc phục:** Dùng nullish fallback, xác định điểm số hữu hạn và không âm; giá trị `0` được giữ nguyên.
- **Kiểm chứng:** Unit test `server accepted zero-point items remain zero-point`.

### EX-04 — Hiển thị điểm khi chấm thủ công chưa xuất bản hoặc thiếu dữ liệu

- **Mức độ:** High — **Trạng thái:** Đã sửa, test runtime PASS.
- **Vị trí:** `src/index.js:114-127`, `src/index.js:146-149`.
- **Bằng chứng:** Có loại câu hỏi cần chấm tay. Receipt cần xác minh tất cả câu manual tương ứng có trạng thái `published`, không chỉ dựa trên điểm tự động.
- **Tác động:** Điểm tạm có thể bị hiểu nhầm là kết quả cuối cùng.
- **Khắc phục:** Đảm bảo các hàng chấm tay tồn tại; chỉ công bố điểm khi toàn bộ câu manual tương ứng đã publish; nếu truy vấn/chèn gặp lỗi, giữ trạng thái điểm chưa hiển thị (fail closed).
- **Kiểm chứng:** Runtime test kiểm tra bài luận chưa publish trả `show_score=false`, `score=null`, `pending_manual=1`; workflow ở trạng thái `marking`.
- **Giới hạn:** Chưa kiểm thử vai trò người chấm/duyệt và workflow bên control plane.

### EX-05 — JSON/body và dữ liệu câu trả lời/event chưa giới hạn/lọc đầy đủ

- **Mức độ:** Medium — **Trạng thái:** Đã sửa, test static PASS; phạm vi fuzz chưa đầy đủ.
- **Vị trí:** `src/index.js:14-43`, `src/index.js:44-72`, `src/index.js:156-174`, `src/index.js:177-188`, `src/index.js:193-203`.
- **Bằng chứng:** Endpoint nhận dữ liệu JSON, câu trả lời và event log do client gửi.
- **Tác động:** Payload lớn hoặc trường tùy ý có thể làm tăng chi phí parse/lưu trữ và lưu metadata không cần thiết.
- **Khắc phục:** Đọc stream có giới hạn byte trước parse; giới hạn body submit/token; lọc answer theo ID và kiểu câu hỏi, giới hạn độ dài/list, lọc event thành allowlist; chỉ lưu event metadata cần thiết.
- **Kiểm chứng:** Các kiểm thử body cap, answer sanitizer và event sanitizer PASS.
- **Giới hạn:** Rate limit phân tán vẫn chưa có bằng chứng; byte cap không thay thế chống lạm dụng request.

### EX-06 — Cập nhật answer thiếu điều kiện revision phía server

- **Mức độ:** High — **Trạng thái:** Đã sửa, runtime stale-save test PASS.
- **Vị trí:** `src/index.js:166-173`, `src/index.js:137-149`.
- **Bằng chứng:** Autosave/submit có thể gặp request đến lệch thứ tự; so sánh revision chỉ ở frontend là không đủ.
- **Tác động:** Một snapshot cũ có thể ghi đè snapshot mới hoặc submit từ dữ liệu cũ.
- **Khắc phục:** So khớp revision trong SQL `UPDATE`; nếu không có row thay đổi, trả `409 REVISION_CONFLICT`; deadline finalize có retry có giới hạn.
- **Kiểm chứng:** Runtime test lưu revision 1 rồi gửi save revision 0 và xác nhận 409.
- **Giới hạn:** Không có kiểm thử tải đồng thời hoặc kiểm tra tính nguyên tử trên dịch vụ D1 thật.

### EX-07 — Health endpoint kiểm tra schema/binding chưa đủ để phản ánh sẵn sàng

- **Mức độ:** Medium — **Trạng thái:** Đã sửa, runtime test PASS.
- **Vị trí:** `src/index.js:204-210`.
- **Bằng chứng:** Worker cần nhiều bảng cho attempt, lease, token, file, manual grade, workflow và audit; chỉ có binding DB chưa chứng minh schema sẵn sàng.
- **Tác động:** Runtime có thể báo available trong khi thiếu bảng quan trọng, rồi lỗi lúc thi.
- **Khắc phục:** Health kiểm tra 16 bảng cần thiết và binding `FILES`; thiếu bảng/binding trả 503 `degraded` và liệt kê tên bảng còn thiếu.
- **Kiểm chứng:** Runtime test health đầy đủ trả 200; bảng thiếu trả 503.
- **Giới hạn:** Chưa gọi health trên staging/production; đây không phải xác nhận schema thật đã migrate.

### EX-08 — Phông giao diện không tuân thủ Times New Roman

- **Mức độ:** Medium — **Trạng thái:** Đã sửa ở CSS, static test PASS.
- **Vị trí:** `public/styles.css:1`, `public/index.html`.
- **Bằng chứng:** CSS trước đó ưu tiên Segoe UI/Arial/system font.
- **Tác động:** Không đáp ứng yêu cầu font thống nhất.
- **Khắc phục:** Đặt Times New Roman/Times/serif làm font toàn cục, ép các descendant/control/component kế thừa bằng selector `!important`, giữ `button,input,select,textarea { font: inherit }`.
- **Kiểm chứng:** Static test xác nhận Times New Roman được thực thi toàn cục.
- **Giới hạn:** Chưa quan sát bằng browser rendering thật do Chromium headless bị treo; cần kiểm tra thực trên desktop/mobile.

### EX-09 — `/admin` không có module quản trị trong gói nhưng fallback có thể gây hiểu nhầm

- **Mức độ:** Medium — **Trạng thái:** Đã có thông báo chặn rõ; module quản trị vẫn chưa có.
- **Vị trí:** `public/exam.js:44`; `wrangler.json` chọn `src/index.js` làm Worker entrypoint.
- **Bằng chứng:** Mã nguồn hiện có tập trung vào luồng thi và không chứa route/API admin riêng.
- **Tác động:** Người dùng có thể tưởng cổng dự thi cũng là cổng quản trị hoặc cố nhập thông tin quản trị ở sai nơi.
- **Khắc phục:** `/admin` không còn âm thầm render UI thí sinh; hiển thị rằng cổng này không có UI/API quản trị.
- **Kiểm chứng:** Regression `unimplemented admin URL does not silently render the candidate home screen` PASS.
- **Chưa hoàn thành:** Chưa xây dựng dashboard, quản lý kỳ thi, ngân hàng câu hỏi, chấm/duyệt điểm, phân quyền hoặc audit console vì không có admin API/role contract trong ZIP. Không tạo frontend giả.

### EX-10 — Nhật ký revision, audit submit và biên nhận có thể thất bại nhưng vẫn báo thành công

- **Mức độ:** High — **Trạng thái:** Đã sửa trong bản làm việc, runtime fault-injection tests PASS.
- **Vị trí:** `src/index.js:113-114` (biên nhận), `src/index.js:129-154` (submit/audit/workflow), `src/index.js:156-176` (revision log), `src/index.js:177-189` (integrity audit).
- **Bằng chứng:** Trước thay đổi, một số ghi revision/workflow/audit/receipt dùng `.catch(()=>{})` hoặc trả mã biên nhận dự phòng ngay cả khi thao tác lưu thất bại.
- **Tác động:** Có thể mất lịch sử hoặc audit mà giao diện vẫn coi thao tác đã thành công; receipt có thể được trả dù chưa ghi bền vững.
- **Khắc phục:** Dùng D1 batch cho cập nhật answer + revision history, cập nhật submit + audit event + workflow, và cập nhật event + audit signal; lỗi ở một bước bắt buộc làm rollback transaction. Biên nhận chỉ được trả sau khi đọc lại bản ghi đã lưu; lỗi lưu biên nhận trả lỗi thay vì giả tạo thành công.
- **Kiểm chứng:** Thêm fault-injection SQLite triggers làm hỏng revision log, submit audit và receipt write; test xác nhận snapshot/submit rollback khi write bắt buộc lỗi, và receipt được phục hồi rồi đọc lại sau khi lỗi giả lập được gỡ.
- **Giới hạn:** Đây là mô phỏng transaction SQLite trong bộ nhớ. Cần xác minh semantics và quyền D1 trên staging; không chạy injection trên production.

### EX-11 — Kiểm tra thời hạn launch token và đổi mã đồng thời chưa fail-closed đầy đủ

- **Mức độ:** High — **Trạng thái:** Đã sửa trong bản làm việc, runtime test PASS.
- **Vị trí:** `src/index.js:193-203`; test tại `scripts/validate-runtime.mjs`.
- **Bằng chứng:** Phân tích mã trước sửa cho thấy `Date.parse()` có thể trả `NaN`; so sánh `expires <= Date.now()` không tự loại `NaN`. Batch cũ cũng thực hiện INSERT access-token kể cả khi UPDATE claim không đổi hàng nào, có thể để lại token mồ côi khi có request đua.
- **Tác động:** Token có ngày hết hạn sai định dạng có thể không bị loại đúng; request đổi mã đua nhau có thể tạo bản ghi access token không được trả cho người dùng.
- **Khắc phục:** Dùng `databaseTimeMs()` và kiểm tra `Number.isFinite`; điều kiện UPDATE gồm `expires_at > CURRENT_TIMESTAMP`; INSERT access token chỉ chạy khi `changes()=1`; xác nhận cả kết quả UPDATE và INSERT trong cùng D1 batch.
- **Kiểm chứng:** Runtime kiểm tra timestamp SQLite dạng UTC, replay, mô phỏng stale read khi token đã được dùng, và thời hạn malformed bị 401.
- **Giới hạn:** Mô phỏng bằng SQLite trong bộ nhớ; chưa kiểm thử tải cạnh tranh trên D1 thật.

## 4. Rủi ro và yêu cầu chưa được đóng

| ID | Mức độ | Trạng thái | Vị trí/bằng chứng | Tác động và việc cần làm |
|---|---|---|---|---|
| EX-R01 | High | Chưa đủ bằng chứng | `src/index.js:212-216`; UI OTP trong `public/exam.js:40` | OTP/registration/eligibility được proxy sang control plane; cần audit riêng rate limit, expiry, one-time use, account enumeration, retry, log, sender email và anti-abuse bằng source/control plane và staging có phê duyệt. |
| EX-R02 | High | Chưa làm/Chờ đặc tả | Không có module admin trong ZIP; `public/exam.js:44` | Cần hợp đồng API/role thực tế, mô hình phân quyền và phê duyệt nghiệp vụ trước khi xây dựng giao diện quản trị có thao tác thật. |
| EX-R03 | High | Chưa đủ bằng chứng | `src/index.js:192` | Upload 30 MB/50 MB theo loại; chưa có giới hạn tần suất theo user/attempt/IP, quét malware hoặc cơ chế phát hiện nội dung nguy hiểm. Thiết kế rate limit/scan theo hạ tầng được phê duyệt; không áp dụng stress test production. |
| EX-R04 | Medium | Chưa xử lý — cần quyết định dữ liệu | `src/index.js:192` đánh dấu file cũ `replaced`, nhưng không xóa object cũ khỏi R2 | Storage có thể tăng theo các lần thay tệp. Cần chính sách lưu giữ, điều tra và dọn dẹp có phê duyệt trước khi xóa object; không tự xóa vì có thể ảnh hưởng chứng cứ/khiếu nại. |
| EX-R05 | Medium | Chưa xử lý — kiến trúc | `public/storage.js:7-12` | Access token nằm trong `sessionStorage`; XSS có thể đọc token. CSP/escape giảm một phần rủi ro nhưng không xóa bỏ. Cần đánh giá kiến trúc cookie HttpOnly/BFF và CSRF trước khi đổi cơ chế xác thực. |
| EX-R06 | Medium | Chưa đủ bằng chứng | `src/index.js:191-192` | Kiểm tra magic-byte/MIME không phải antivirus hoặc sandbox file. Cần chốt loại tệp cho phép, lưu riêng tư, giới hạn tải, chính sách tải xuống và quy trình scan nếu phù hợp. |
| EX-R07 | Medium | Chưa đủ bằng chứng | `src/index.js:110` | Lease theo attempt được giữ cho session ID đến khi có quy trình chuyển thiết bị từ control plane; chưa kiểm thử phục hồi session mất/hỏng, takeover được duyệt và đồng thời đa thiết bị. Cần tài liệu vận hành/diễn tập staging. |
| EX-R08 | Medium | Chưa đủ bằng chứng | `src/index.js:204-210`, `wrangler.json` | Health chỉ xác nhận truy vấn từng bảng và R2 binding được cấu hình; không kiểm tra ghi/đọc R2 thực, migration version, quyền bảng, latency hay khả năng khôi phục. Cần readiness sâu hơn ở staging sau khi được duyệt. |
| EX-R09 | Medium | Chưa đủ bằng chứng | `functions/health.js` so với `wrangler.json` | Pages Function health tham chiếu SLC, nhưng runtime config chọn Worker entrypoint; cần xác nhận cấu trúc deploy thực tế, tránh dựa vào route không được triển khai. |
| EX-R10 | Medium | Chưa kiểm thử | Tất cả UI/CSS | Đã có responsive styles trong mã, nhưng browser thật, zoom, keyboard, screen reader và contrast chưa được kiểm tra trong đợt này. Cần browser matrix và accessibility review. |
| EX-R11 | Medium | Chưa đủ bằng chứng | D1/R2/email/DNS không có credential/môi trường | Không có bằng chứng backup/restore D1+R2, RPO/RTO, alerting, retry email, SPF/DKIM/DMARC, production monitoring hoặc incident playbook. Phải kiểm tra ở môi trường được ủy quyền. |
| EX-R12 | Informational | Đang giữ nguyên | `wrangler.json` | Resource name/ID D1/R2, compatibility date và `CONTROL_ORIGIN` không thay đổi. Trước deploy phải xác nhận tài nguyên đích và quyền; không chạy migration/ deploy tự động. |
| EX-R13 | Informational | Đã ghi nhận | `functions/health.js` | File hiện báo phiên bản `3.0.0`, trong khi Worker health là `4.1.0`; nếu Pages Function được deploy, metadata có thể không nhất quán. Chỉ sửa sau khi xác nhận route thực tế có được dùng. |

## 5. Giao diện và trải nghiệm

- **Đã có trong ZIP:** một shell web cho thí sinh, xác minh/nhận phiên từ API, màn hình làm bài, trạng thái lưu/kết nối, đồng hồ, điều hướng câu, upload tệp/audio, modal xác nhận và màn hình hoàn tất theo logic hiện có.
- **Đã chỉnh:** Times New Roman được áp dụng toàn cục trong `public/styles.css`; cache-busting URL của CSS/JS tăng lên `20261025-audit-fix-1`; `/admin` hiển thị thông báo không khả dụng thay vì trang thí sinh.
- **Chưa dựng:** giao diện quản trị, danh sách kỳ thi công khai, workflow quản lý ngân hàng câu hỏi/duyệt đề/chấm điểm/phúc khảo vì ZIP không có API/hợp đồng admin đủ để tạo chức năng thật một cách an toàn.
- **Chưa xác minh bằng browser:** không có kết quả screenshot/browser pass. Test VM/static chứng minh logic một phần, không chứng minh hình thức, responsive, focus/keyboard, contrast hay khả năng tiếp cận theo WCAG.
- **Times New Roman:** được ép CSS; vẫn cần browser check để phát hiện CSS injection style hoặc control bên ngoài và đối chiếu computed style thực tế.

## 6. Kiểm thử đã chạy và bằng chứng

Lệnh thực thi: `npm run build` trong thư mục `EXAM`.

### Kết quả

1. `node --check` cho `public/api.js`, `public/storage.js`, `public/core.js`, `public/exam.js`, `src/index.js`, `functions/health.js`: PASS.
2. `scripts/validate.mjs`: **39/39 PASS**, gồm escape HTML, timezone, trạng thái câu hỏi, allowlist payload, sanitizer answer/events, zero-point scoring, byte cap, autosave/revision, event filtering, attachment signature, Times New Roman và route `/admin`.
3. `scripts/validate-runtime.mjs`: **14/14 PASS**, chạy Worker handler với `node:sqlite` trong bộ nhớ và adapter D1/R2 giả lập. Các kịch bản gồm lọc đáp án, save/revision, stale-save conflict, submit theo snapshot server, submit lặp, manual grade chưa publish, rollback nếu revision log/audit submit lỗi, biên nhận chỉ thành công sau khi được lưu, launch-token expiry/replay/racing và health success/degrade.
4. Có cảnh báo Node `ExperimentalWarning: SQLite is an experimental feature`; đây là cảnh báo runtime test, không phải test fail.

### Chưa chạy hoặc chưa đạt bằng chứng

- Browser smoke test/screenshot: lần thử Chromium headless bị treo/hết timeout, không có ảnh/kết quả DOM để chứng minh rendering; không đánh dấu pass.
- `scripts/validate-integration.mjs`: không chạy vì yêu cầu source SLCS ngoài phạm vi ZIP; không dùng để thay thế kiểm toán EXAM đơn lẻ.
- Không chạy `wrangler deploy`, không gọi endpoint production, không đọc/ghi D1/R2 thật, không gửi email/OTP, không chạy migration, không chạy stress test.
- Không đo throughput/concurrency thực, thời gian tải, SLO, backup/restore, DNS, CORS hoặc domain production.

## 7. Các thay đổi trong bản làm việc

| Tệp | Thay đổi |
|---|---|
| `src/index.js` | Thêm giới hạn JSON; lọc câu trả lời và event; payload câu hỏi theo allowlist; bảo vệ revision/submit; ghi revision/audit/workflow theo D1 batch; biên nhận phải tồn tại bền vững mới trả thành công; điểm 0 được giữ nguyên; fail-closed cho điểm manual; kiểm tra expiry/claim launch token an toàn; health kiểm tra 16 bảng/R2 binding; cập nhật lease last-seen; CSP cho media từ control origin đã cấu hình. |
| `public/exam.js` | Submit chỉ gửi revision; violation chỉ gửi event/reason/revision; `/admin` hiển thị trạng thái không có admin UI/API. |
| `public/styles.css` | Times New Roman được áp dụng trên toàn bộ giao diện và controls/components. |
| `public/index.html` | Cache-busting CSS/JS sang `20261025-audit-fix-1`. |
| `public/_headers` | CSP ảnh/media cho static assets được đồng bộ với Worker. |
| `package.json` | Đặt tên package `sky-first-exam`, version `4.1.0`; thêm test runtime SQLite vào `npm test`/`npm run build`. |
| `scripts/validate.mjs` | Thêm regression checks cho allowlist, sanitation, zero-point, request cap, Times New Roman, snapshot submit và `/admin`. |
| `scripts/validate-runtime.mjs` | Thêm 14 test runtime với SQLite memory, gồm kiểm thử lỗi giả lập để xác minh rollback khi journal/audit/receipt write thất bại và kiểm tra launch-token expiry/replay; không truy cập hệ thống ngoài. |
| `README.md` | Ghi rõ kiến trúc, ranh giới control plane/admin, lệnh test và điều kiện trước triển khai. |
| `VALIDATION-2026-10-05.md` | Giữ báo cáo lịch sử và thêm cảnh báo nó không phải kết quả hiện hành. |
| `AUDIT-REPORT-2026-10-25.md` | Báo cáo kiểm toán này. |

Không có migration hoặc thay đổi resource ID/binding, không có dữ liệu production bị chủ động sửa và không có deploy được thực hiện.

## 8. Khung tham chiếu bảo mật, accessibility và pháp luật

Đây là khung đánh giá để xây dựng kiểm thử; không phải tuyên bố EXAM đã đạt chứng nhận/tuân thủ.

- OWASP Application Security Verification Standard (ASVS): <https://asvs.owasp.org/> — dùng để lập ma trận xác minh ứng dụng phù hợp rủi ro; cần chọn level/phạm vi cụ thể sau khi chốt mô hình đe dọa.
- OWASP API Security: <https://owasp.org/www-project-api-security/> — tham chiếu lỗi phân quyền object/function, xác thực, lạm dụng tài nguyên và API misconfiguration.
- W3C WCAG 2.2: <https://www.w3.org/TR/wcag/> — cần audit bàn phím, focus, contrast, zoom, semantics và trình đọc màn hình bằng kiểm tra thực.
- Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15: <https://vanban.chinhphu.vn/?docid=214590&pageid=27160>.
- Nghị định 356/2025/NĐ-CP: <https://vanban.chinhphu.vn/?docid=216387&pageid=27160>.
- Luật An ninh mạng số 116/2025/QH15: <https://vanban.chinhphu.vn/?classid=&docid=216499&pageid=27160>.

Cần luật sư/chuyên gia tuân thủ xác nhận phiên bản hiệu lực, phạm vi áp dụng, vai trò kiểm soát/xử lý dữ liệu, nghĩa vụ thông báo, quyền của chủ thể dữ liệu, thời hạn lưu giữ, dữ liệu của người chưa thành niên, giám sát/camera và chuyển dữ liệu cho dịch vụ bên ngoài. Báo cáo kỹ thuật này không kết luận đã tuân thủ pháp luật.

## 9. Phê duyệt và kế hoạch khắc phục tiếp theo

### P0 — Trước khi cho chạy kỳ thi chính thức

1. Phê duyệt/kiểm tra phiên bản schema và migration trên staging; đối chiếu schema thật với 16 bảng health yêu cầu.
2. Kiểm toán control plane cho OTP, đăng ký, token launch, quyền cấp dự thi, rate limit, log, gửi mail và chống account enumeration.
3. Diễn tập multi-session, mất mạng, submit/timeout đồng thời, chuyển thiết bị, thu hồi session và recovery trên staging.
4. Xác nhận quy tắc chấm điểm, manual grading, publish result, receipt, deadline và ngoại lệ bằng owner nghiệp vụ; không tự thay đổi chính sách kỳ thi.
5. Browser test desktop/mobile và accessibility; không chỉ dựa vào test static/VM.
6. Thử backup/restore D1 + R2, xác nhận retention, rollback và người chịu trách nhiệm.

### P1 — Trước khi tuyên bố đầy đủ năng lực vận hành

1. Thiết kế/bổ sung quản trị thật sau khi có API/role contract được phê duyệt.
2. Thiết kế rate limit cho OTP, token redemption, upload và các endpoint public; chọn cơ chế phù hợp Cloudflare/D1/Durable Objects hiện hữu.
3. Quyết định chính sách R2 orphan/replaced object và thực hiện cleanup chỉ sau khi được phê duyệt, có dry run và audit.
4. Xem xét lưu access token trong `sessionStorage`; mọi thay đổi sang cookie/BFF cần threat model và test CSRF/session.
5. Kiểm tra file type allowlist, file size, storage quotas và malware scanning tùy mức rủi ro.
6. Xác nhận `functions/health.js` có được deploy hay là tệp cũ; đồng bộ version/route nếu thực sự dùng.
7. Hoàn thiện monitoring, alerts, incident response, retention và tài liệu quyền riêng tư.

### Checklist phê duyệt production

- [ ] Có xác nhận bằng văn bản về môi trường, D1/R2 bindings và migration đích.
- [ ] Không còn Critical/High chưa xử lý, hoặc có người có thẩm quyền chấp nhận rủi ro bằng văn bản.
- [ ] Luồng OTP/control plane và role/authorization vượt test staging.
- [ ] Browser matrix + responsive + accessibility review đã lưu bằng chứng.
- [ ] Có backup/restore và rollback test.
- [ ] Có kiểm tra logging/alerting và incident response.
- [ ] Có xác nhận pháp lý/quyền riêng tư theo mô hình dữ liệu thật.
- [ ] Chủ sở hữu sản phẩm/phụ trách khảo thí duyệt công thức, deadline, điểm và ngoại lệ.
- [ ] Có phê duyệt triển khai; chỉ sau đó mới được chạy `npm run deploy`.

---

**Phán quyết cuối:** Bản làm việc có sửa lỗi mã nguồn trong phạm vi được phép và **53/53 test cục bộ hiện hành đạt**. Tuy nhiên, việc xây dựng giao diện quản trị thật, audit control plane/OTP, kiểm thử browser, xác minh D1/R2 production, phục hồi, pháp lý và triển khai vẫn chưa được hoàn tất. Vì vậy không kết luận “hoàn thành toàn bộ” hoặc “sẵn sàng production”.
