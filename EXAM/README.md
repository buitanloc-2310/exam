# Sky First EXAM

EXAM là **delivery plane** cho vận hành phiên khảo thí: redeem launch token, tải gói đề đã niêm phong, lưu câu trả lời, ghi nhận sự kiện toàn vẹn, khóa theo hạn giờ, nộp bài và trả biên nhận. Bản mã nguồn này được cấu hình cho Cloudflare Worker + Static Assets, D1 và R2.

## Ranh giới hệ thống đã xác minh từ gói mã nguồn

- Runtime Worker chính là `src/index.js`; static assets nằm trong `public/`.
- API đọc/lưu/nộp phiên thi dùng D1; tệp trả lời dùng R2; cấu hình resource được lưu tại `wrangler.json`.
- Các endpoint `/api/` không được Worker xử lý cục bộ sẽ được proxy đến control plane `https://slc.skyfirst.io.vn` (xem `src/index.js`). Luồng xác minh OTP/đăng ký và cấp quyền thuộc control plane; mã của control plane không nằm trong gói EXAM này nên không thể kết luận đã kiểm toán đầy đủ OTP hoặc rate limit từ ZIP này.
- Gói EXAM **không chứa trang hoặc API quản trị**. `/admin` hiển thị thông báo rõ ràng thay vì giả làm trang dự thi; không xem đây là triển khai giao diện quản trị.
- `functions/health.js` là một Pages Function riêng kiểm tra control plane, nhưng `wrangler.json` chọn `src/index.js` làm Worker entrypoint. Cần xác nhận cách deploy thực tế trước khi dựa vào route của Pages Function.
- Các tên và ID D1/R2 trong `wrangler.json` có vẻ là cấu hình môi trường thực; không đổi, migrate hoặc deploy mà chưa có phê duyệt.

## Quy tắc runtime

- Giờ máy chủ và deadline có thẩm quyền.
- Mỗi attempt chỉ có một write lease; chuyển thiết bị là thao tác có kiểm toán của control plane.
- Autosave dùng revision; submit chấm từ snapshot cuối cùng máy chủ chấp nhận, không dùng đáp án do request submit tự gửi lên.
- Request JSON, câu trả lời, event log và payload câu hỏi công khai được giới hạn/lọc ở Worker.
- Nội dung câu hỏi đưa cho thí sinh sử dụng allowlist trường, không chỉ xóa một số tên trường nhạy cảm.
- Manual grading phải được publish trước khi điểm được công bố qua receipt.
- Sự kiện toàn vẹn là tín hiệu để xem xét; không tự động kết luận gian lận.
- Camera/display capture bị từ chối mặc định; microphone chỉ dùng theo thao tác chủ động và quy chế kỳ thi.

## Kiểm tra cục bộ

Yêu cầu: Node.js có hỗ trợ `node:sqlite` (trong môi trường hiện tại Node hiển thị cảnh báo API SQLite đang thử nghiệm).

```bash
npm run build
```

Lệnh này chạy syntax checks, bộ kiểm tra chức năng/static (`scripts/validate.mjs`) và test runtime với SQLite trong bộ nhớ (`scripts/validate-runtime.mjs`), bao gồm giả lập lỗi ghi nhật ký để xác minh rollback. Kết quả hiện tại: 39/39 test chức năng/static và 14/14 test runtime PASS. Test không kết nối production D1/R2, không gửi email/OTP và không deploy Cloudflare. Kết quả hiện tại được ghi trong `AUDIT-REPORT-2026-10-25.md`.

Bài test tích hợp với mã nguồn SLCS chỉ là tùy chọn và **không nằm trong phạm vi đầu vào** của đợt kiểm toán EXAM này:

```bash
node scripts/validate-integration.mjs ../SLCS/src/index.js
```

Không chạy lệnh trên nếu không có bản SLCS được cung cấp/cho phép. Việc kiểm tra tích hợp ngoại vi không thể được suy ra chỉ từ test SQLite nội bộ.

## Trước khi triển khai

- Xác minh migrations/schema đã được phê duyệt và áp dụng vào môi trường thử nghiệm; health endpoint yêu cầu 16 bảng và binding R2 hiện diện.
- Kiểm thử OTP/control plane, quyền quản trị, giới hạn tốc độ, upload, email và luồng khôi phục trong môi trường staging có phê duyệt.
- Đo giao diện thật trên trình duyệt desktop/mobile và kiểm tra accessibility.
- Xác nhận backup/restore D1 + R2, giám sát, rollback và pháp lý/quyền riêng tư.
- Xem xét report kiểm toán; không deploy production cho đến khi các hạng mục chờ xử lý được chấp thuận.

`npm run deploy` thực hiện deploy qua Wrangler sau khi build. Không chạy lệnh này khi chưa có phê duyệt triển khai.
