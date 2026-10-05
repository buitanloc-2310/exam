# Báo cáo kiểm tra bản Professional — 05/10/2026

## Thay đổi chính

1. Xây lại giao diện workspace navy/trắng: đồng hồ cố định, khu vực câu hỏi, thí sinh/phiên, tiến độ, bảng câu hỏi và xác nhận nộp.
2. Sửa lỗi đánh dấu đã lưu khi còn thao tác nhập mới chưa được server chấp nhận. Mỗi lần lưu gửi snapshot; acknowledgment chỉ xác nhận đúng phiên bản thay đổi đã gửi.
3. Gộp các lượt autosave đồng thời; giữ revision từ backend và khóa sửa khi xung đột.
4. Chuẩn hóa UTC cho thời gian database và UTC+07:00 cho lịch cũ. Đồng hồ dùng `performance.now()` sau đồng bộ thời gian máy chủ, giảm ảnh hưởng đổi giờ thiết bị.
5. Phân biệt câu hoàn tất, câu ghép/sắp xếp chưa đủ hoặc lặp lựa chọn, câu chưa trả lời và câu đánh dấu.
6. Lưu nháp ngay khi nhập, autosave 5 giây, tăng tần suất gần hết giờ; khóa đáp án khi hết giờ và thử nộp. Trạng thái lỗi không được trình bày như đã nộp thành công.
7. Phối hợp lease giữa tab cùng trình duyệt; khôi phục snapshot khi revision phù hợp; giữ bản lệch revision để đối chiếu.
8. Storage bị chặn không làm văng ứng dụng; thông báo hạn chế lưu dự phòng.
9. API có timeout, kiểm tra JSON và giữ mã lỗi server; dùng bearer và không gửi cookie trong request khác origin.
10. Xác nhận nộp có tổng số câu hoàn tất/chưa xong/đánh dấu. Biên nhận tải xuống chỉ có dữ liệu xác nhận, không chứa access token hay đáp án.
11. Toàn màn hình bắt buộc cần bật được trước khi vào màn hình làm bài; các sự kiện theo quy chế được lưu mà không tuyên bố tự kết luận gian lận.
12. Modal có role/aria, focus trap, inert nền, Escape; bảng câu hỏi mobile có lớp phủ và thao tác bàn phím.

## Kết quả

- `npm run build`: PASS; toàn bộ runtime JS được kiểm tra cú pháp.
- `npm test`: **26/26 PASS**; lặp ở UTC và Asia/Bangkok đều PASS.
- Kiểm thử API tích hợp với backend SLCS đã sửa: **7/7 PASS**. Luồng launch → redeem → tải câu → save revision → nộp có điểm/biên nhận, và luồng khách đều hoạt động trên SQLite tạm.
- Kiểm thử frontend bằng VM tập trung vào render các dạng câu, escape HTML, save concurrency, clock monotonic và chính sách ẩn điểm. Đây không phải kiểm thử hiển thị trong trình duyệt.

## Phạm vi chưa xác minh

Chưa chạy/chụp giao diện bằng trình duyệt thật vì môi trường không có Chromium khả dụng. Chưa triển khai Cloudflare, kiểm tra DNS/CORS thật, email OTP, thiết bị toàn màn hình hoặc tình huống mạng thực. Cần kiểm tra desktop/mobile trên domain thật trước tổ chức kỳ thi chính thức.

Giao diện thi máy tính và các chức năng trên không chứng minh tương đương 100% với một hệ thống của Bộ GD&ĐT. Đây là cổng Sky First, dùng cơ chế xác thực/chấm điểm/lưu bài của SLCS.
