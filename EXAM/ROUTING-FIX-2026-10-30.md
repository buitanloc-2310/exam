# Sửa định tuyến dịch vụ khảo thí — 30/10/2026

## Nguyên nhân đã xác định trong gói trước
Các trang dịch vụ được cấu hình trong `public/_redirects` để proxy về `/index.html`. Trong khi đó, `/index.html` có thể bị lớp phục vụ HTML chuẩn hóa thành `/`, khiến đường dẫn dịch vụ kết thúc ở trang chủ. Cấu hình SPA fallback cũng cho phép mọi đường dẫn không có asset nhận nội dung trang chủ.

## Thay đổi trong gói này
- Tạo trang asset riêng tại `public/<route>/index.html` cho sáu trang dịch vụ.
- Worker nhận diện sáu đường dẫn dịch vụ và phục vụ đúng asset thư mục tương ứng, giữ nguyên URL trang mà người dùng đang mở.
- Loại bỏ các quy tắc `_redirects` cho trang dịch vụ và `/admin`; không còn proxy những đường dẫn đó về `/index.html`.
- Chuyển `not_found_handling` sang `404-page` và thêm `public/404.html`, tránh đường dẫn không tồn tại hiển thị nhầm trang chủ.
- Đổi chuỗi phiên bản tài nguyên sang `20261030-routes-v2` để trình duyệt tải lại bundle mới.
- Giữ nguyên các binding D1, R2 và tên Worker hiện có trong `wrangler.json`.

## Các đường dẫn được định tuyến
- `/admin` và `/admin/`: Worker trả giao diện quản trị; đăng nhập vẫn do API xác thực.
- `/tra-cuu/`, `/phuc-khao/`, `/ho-tro/`, `/bao-loi/`, `/su-co-khan-cap/`, `/to-cao-gian-lan/`: từng asset route độc lập, cùng dùng bộ điều khiển trang theo `location.pathname`.
- `/exam/*` và `/join/*`: tiếp tục dùng shell dự thi hiện có.

## Lưu ý triển khai
Gói này chưa được triển khai lên Cloudflare. Nếu sau khi triển khai đúng Worker vẫn bị điều hướng về `/`, cần kiểm tra và tắt Redirect Rule/Bulk Redirect bên ngoài mã nguồn, đồng thời xác nhận `exam.skyfirst.io.vn` đang gắn với đúng Worker `slcs-exam`. Bulk Redirect có thể chạy trước Worker nên mã nguồn không thể vô hiệu hóa một quy tắc redirect cấp tài khoản/domain.

## Đóng gói và triển khai đúng loại dự án
Đây là dự án **Cloudflare Worker có Static Assets**, không phải gói HTML tĩnh độc lập. Triển khai từ thư mục `EXAM/` bằng:

```bash
npm run build
npm run deploy
```

Lệnh `deploy` chạy Wrangler theo `wrangler.json`, giữ nguyên Worker name `slcs-exam`, D1 database ID và R2 bucket hiện có. Không tạo database/bucket mới, không chạy migration chỉ để sửa định tuyến.

Sau khi deploy, vào Cloudflare kiểm tra:
1. Worker `slcs-exam` đã nhận phiên bản triển khai mới và custom domain `exam.skyfirst.io.vn` đang trỏ đúng Worker này.
2. Trong **Rules → Redirect Rules** và **Bulk Redirects**, không còn quy tắc điều hướng `exam.skyfirst.io.vn/*` hoặc sáu đường dẫn dịch vụ về `/`. Bulk Redirects có thể chạy trước Worker nên mã Worker không thể ghi đè một quy tắc như vậy.
3. Không dùng Pages static upload thay cho Worker deployment của gói này.
4. Mở lần lượt sáu trang dịch vụ, kiểm tra thanh địa chỉ vẫn giữ nguyên URL và trang nội dung tương ứng được hiển thị.

## Kết quả kiểm thử cục bộ
- `npm run build`: PASS.
- Validation: 43/43 PASS.
- Runtime: 14/14 PASS.
- Integration: 15/15 PASS.
- Scenario định tuyến bổ sung: sáu URL dịch vụ đều trả HTTP 200, không có `Location` redirect và trả app shell.
