# MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST
## Hệ Thống Khảo Thí Và Đánh Giá Sky First (v6.0.0)

- **Tên đơn vị:** Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First (Sky First Network)
- **Tên hệ thống:** Hệ Thống Khảo Thí Và Đánh Giá Sky First
- **Tên miền vận hành:** `https://exam.skyfirst.io.vn/`

---

## 1. Cấu trúc hệ thống và các tuyến đường nghiệp vụ tách biệt

| Tuyến đường dẫn | Chức năng nghiệp vụ | Endpoint API máy chủ tương ứng |
|---|---|---|
| `/` | Trang chủ công khai: Giới thiệu hệ thống, nhập mã dự thi / liên kết mời, danh mục kỳ thi công khai đang mở, hướng dẫn chuẩn bị thiết bị và điều hướng nghiệp vụ | `GET /api/public/catalog`, `POST /api/public/exam-launch/redeem` |
| `/join/:code` & `/exam/:id` | Xác nhận dự thi, xác minh OTP email, phòng thi trực tuyến, tự động lưu theo revision và nộp bài nhận biên nhận | `/api/public/assessments/:code/*`, `/api/public/exam-attempts/:id/*`, `/api/exam-attempts/:id/*` |
| `/tra-cuu` | Tra cứu kết quả thi theo Mã biên nhận và Mã thí sinh, hiển thị rõ trạng thái công bố và hướng dẫn phúc khảo | `POST /api/public/results/lookup` |
| `/phuc-khao` | Gửi đề nghị xem xét lại kết quả thi kèm minh chứng và tra cứu tiến độ xử lý theo mã yêu cầu riêng (`PK-...`) | `POST /api/public/appeals`, `POST /api/public/appeals/track` |
| `/ho-tro` | Hướng dẫn sử dụng hệ thống, tiếp nhận câu hỏi hỗ trợ thông thường và tra cứu trạng thái (`HT-...`) | `POST /api/public/support`, `POST /api/public/support/track` |
| `/bao-loi` | Báo lỗi kỹ thuật hoặc lỗi chức năng (tuân thủ tối thiểu hóa dữ liệu, không thu thập mật khẩu/OTP) (`BL-...`) | `POST /api/public/bug-reports` |
| `/su-co-khan-cap` | Báo sự cố khẩn cấp ảnh hưởng trực tiếp đến phiên thi đang diễn ra, tự động gắn mã phiên nếu có (`KC-...`) | `POST /api/public/emergency-incidents` |
| `/to-cao-gian-lan` | Tiếp nhận phản ánh bảo mật về dấu hiệu gian lận kèm minh chứng bắt buộc (tệp hoặc đường dẫn hợp lệ) (`TC-...`) | `POST /api/public/fraud-reports`, `POST /api/public/fraud-reports/track` |

---

## 2. Hệ thống dịch vụ Email tự động và 18 mẫu HTML độc lập

Hệ thống phân luồng nghiêm ngặt 3 địa chỉ gửi ở phía máy chủ (`src/email-templates.js` & `src/emails/*.html`):

1. **`exam@skyfirst.io.vn` (Nghiệp vụ khảo thí & phúc khảo):**
   - `src/emails/exam-result.html` — Thông báo công bố kết quả kỳ thi
   - `src/emails/appeal-received.html` — Xác nhận tiếp nhận yêu cầu phúc khảo
   - `src/emails/appeal-update.html` — Cập nhật tiến độ xử lý phúc khảo
   - `src/emails/appeal-result.html` — Thông báo kết quả giải quyết phúc khảo
   - `src/emails/exam-announcement.html` — Thông báo nghiệp vụ kỳ thi
2. **`noreply@skyfirst.io.vn` (Thông báo hệ thống tự động — không nhận thư trả lời):**
   - `src/emails/email-verification.html` — Mã OTP xác minh email dự thi
   - `src/emails/login-verification-code.html` — Mã xác minh đăng nhập một lần
   - `src/emails/exam-entry.html` — Thông báo bắt đầu phiên làm bài thi
   - `src/emails/exam-session-ended.html` — Thông báo kết thúc phiên thi và biên nhận nộp bài
   - `src/emails/exam-session-cancelled.html` — Thông báo hủy phiên thi
   - `src/emails/integrity-warning.html` — Cảnh báo tín hiệu giám sát quy chế phòng thi
   - `src/emails/fraud-report.html` — Xác nhận tiếp nhận phản ánh dấu hiệu gian lận
   - `src/emails/exam-ban-notice.html` — Thông báo quyết định xử lý vi phạm quy chế khảo thí
   - `src/emails/system-notification.html` — Thông báo tự động từ hệ thống khảo thí
3. **`support@skyfirst.io.vn` (Hỗ trợ kỹ thuật & xử lý sự cố):**
   - `src/emails/support-request-received.html` — Xác nhận tiếp nhận yêu cầu hỗ trợ
   - `src/emails/support-request-update.html` — Cập nhật tiến độ xử lý yêu cầu hỗ trợ
   - `src/emails/support-request-resolved.html` — Thông báo hoàn tất xử lý yêu cầu hỗ trợ
   - `src/emails/technical-incident.html` — Xác nhận tiếp nhận báo cáo lỗi / sự cố kỹ thuật

---

## 3. Kiểm tra cú pháp và chạy bộ kiểm thử tự động

```bash
npm run build
```

- Kiểm tra cú pháp toàn bộ 8 mô-đun JS (`npm run check`): **PASS**
- Kiểm thử đơn vị & thương hiệu & mẫu email (`node scripts/validate.mjs`): **43/43 PASS**
- Kiểm thử runtime & tính nguyên tử D1 (`node scripts/validate-runtime.mjs`): **14/14 PASS**
- Kiểm thử tích hợp đầu-cuối, phân quyền RBAC, tải tệp minh chứng & phân luồng email (`node scripts/validate-integration.mjs`): **15/15 PASS** (+ Scenario 15 routing)
