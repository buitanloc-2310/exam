# SKY FIRST EXAM 2026 (v5.0.0 — Standalone)

**TRUNG TÂM KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST**  
*Mạng lưới Giáo dục và Phát triển Cộng đồng Sky First (SKY FIRST NETWORK)*

Hệ thống **EXAM 2026 (v5.0.0)** là nền tảng khảo thí và đánh giá độc lập hoàn chỉnh trên kiến trúc Cloudflare Worker + Static Assets (`public/`), cơ sở dữ liệu Cloudflare D1 (`DB`) và lưu trữ đối tượng Cloudflare R2 (`FILES`). Phiên bản 5.0.0 đã **loại bỏ hoàn toàn sự phụ thuộc vào SLC (`slc.skyfirst.io.vn`)**, tích hợp đầy đủ cổng thí sinh công khai, luồng xác minh OTP độc lập, máy chủ chấm điểm tự động và tự luận, nhật ký kiểm toán bất biến và phân hệ quản trị khảo thí `/admin` có kiểm soát phân quyền RBAC phía máy chủ.

---

## 1. Kiến trúc hệ thống đã hoàn thiện

| Thành phần | Tệp mã nguồn | Chức năng thực tế |
|---|---|---|
| Cấu hình Worker | `wrangler.json` | Khai báo Worker entrypoint `src/index.js`, Static Assets `./public`, binding D1 `DB` (`scrd-files`) và binding R2 `FILES` (`scrd-files`). Bảo toàn nguyên vẹn tên và ID tài nguyên hiện hữu. |
| Máy chủ Khảo thí & Quản trị | `src/index.js` | Xử lý toàn bộ API thí sinh (`/api/public/*`, `/api/exam-attempts/*`), xác thực OTP độc lập, quản lý phiên thi có lease và revision, chấm điểm, phúc khảo, hỗ trợ kỹ thuật, và toàn bộ hệ thống API quản trị `/api/admin/*` kèm phân quyền RBAC 10 vai trò. Không còn `proxyToControl` hay bất kỳ lệnh gọi nào sang SLC. |
| Giao diện Thí sinh | `public/index.html`, `public/exam.js`, `public/core.js`, `public/storage.js`, `public/api.js` | Trang chủ cổng khảo thí, danh mục kỳ thi công khai, kiểm tra tương thích thiết bị, xác minh OTP email, phòng thi trực tuyến hỗ trợ 14 loại câu hỏi (bao gồm ghi âm trực tiếp và tải tệp R2), lưu bài tự động theo revision, khóa/mở khóa Strict Mode, nhận biên nhận `EXM-...`, tra cứu điểm và gửi phúc khảo. |
| Phân hệ Quản trị `/admin` | `public/admin.js` | Hệ thống quản trị thực sự tại `/admin`: Đăng nhập OTP quản trị, Khởi tạo quản trị viên đầu tiên (`ADMIN_BOOTSTRAP_TOKEN`), Bảng điều khiển số liệu thực (Dashboard), Quản lý kỳ thi & vòng đời niêm phong đề, Ngân hàng câu hỏi & phiên bản hóa, Quản lý thí sinh & ghi danh, Cấp Launch Token độc lập, Giám sát phòng thi trực tiếp (khóa/mở khóa/cộng giờ/đổi thiết bị), Chấm tự luận & Duyệt/Công bố kết quả, Giải quyết phúc khảo, Phân quyền RBAC và Nhật ký kiểm toán. |
| Kiểu chữ & Giao diện | `public/styles.css` | Toàn bộ giao diện công khai, phòng thi và `/admin` áp dụng phông chữ **Times New Roman** thống nhất, bố cục chuẩn mực, hỗ trợ responsive trên Desktop, Laptop, Tablet và Điện thoại. |
| Migration D1 | `migrations/0001_exam_standalone_schema.sql` | Schema SQL không phá hủy dữ liệu (`CREATE TABLE IF NOT EXISTS`), bảo toàn 16 bảng cốt lõi và mở rộng 8 bảng nghiệp vụ độc lập (`exam_otp_challenges`, `exam_admin_sessions`, `exam_question_bank`, `exam_question_versions`, `exam_enrollments`, `exam_appeals`, `exam_support_requests`, `exam_rate_limits`). |
| Kiểm thử Tự động | `scripts/validate.mjs`, `scripts/validate-runtime.mjs`, `scripts/validate-integration.mjs`, `scripts/sqlite-compat.mjs` | 65 bài kiểm thử tự động (40 static/unit + 14 runtime fault-injection + 11 kịch bản tích hợp end-to-end độc lập). |

---

## 2. Kiểm tra và chạy thử nghiệm cục bộ

Chạy toàn bộ kiểm tra cú pháp và 65 bài kiểm thử tự động:

```bash
npm run build
```

Kết quả đạt chuẩn:
- `npm run check`: Kiểm tra cú pháp toàn bộ 7 tệp JS runtime (`PASS`).
- `node scripts/validate.mjs`: **40/40 PASS**.
- `node scripts/validate-runtime.mjs`: **14/14 PASS**.
- `node scripts/validate-integration.mjs`: **11/11 PASS** (gồm hơn 35 khẳng định bảo mật, phân quyền RBAC, OTP, chống sửa đề khi đang thi, khóa/mở khóa Strict Mode, chấm tự luận, bảo vệ kết quả đã công bố, phúc khảo và chứng minh không có kết nối mạng ra ngoài / không gọi SLC).

---

## 3. Tài liệu bàn giao chi tiết

- Báo cáo kiểm toán, thay đổi, kiểm thử và danh sách giới hạn còn lại: xem `AUDIT-REPORT-2026-10-25.md`.
- Hướng dẫn cấu hình, quản trị `/admin`, vận hành khảo thí, backup/phục hồi và kế hoạch triển khai: xem `OPERATIONS-AND-ADMIN-GUIDE-2026.md`.
