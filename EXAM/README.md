# Trung tâm Dự thi Sky First — Professional

Cổng làm bài độc lập tại `exam.skyfirst.io.vn`, kết nối API của SLCS tại `slc.skyfirst.io.vn`. Bản nâng cấp 05/10/2026 sử dụng giao diện thi trên máy tính trang trọng, tập trung vào đọc đề, lựa chọn đáp án, theo dõi thời gian và xác nhận nộp bài. Nhận diện và tên đơn vị là Sky First.

## Trải nghiệm làm bài

- Kiểm tra thông tin dự thi, hướng dẫn và đồng ý quy chế trước màn hình làm bài.
- Header cố định, tên bài thi và đồng hồ; đổi cỡ chữ và toàn màn hình.
- Bảng câu hỏi: chưa trả lời, chưa hoàn tất, đã hoàn tất, đánh dấu xem lại.
- Lọc câu chưa xong hoặc đã đánh dấu; chuyển câu bằng chuột hoặc Alt + ←/→.
- Hỗ trợ 8 dạng: chọn một, chọn nhiều, đúng/sai, điền, trả lời ngắn, tự luận, ghép cặp, sắp xếp.
- Lưu sau thao tác nhập, lưu định kỳ, bản dự phòng trên thiết bị và khôi phục khi revision tương thích.
- Đếm giờ theo máy chủ và đồng hồ monotonic của trình duyệt; tải lại không đặt lại thời gian.
- Khóa nhập khi hết giờ; nộp tự động, báo lỗi thật và thử lại khi mạng phục hồi.
- Kiểm tra tổng quan trước nộp; chỉ hiện hoàn tất sau máy chủ xác nhận; tải biên nhận JSON.
- Bảo vệ revision, phối hợp lease giữa tab; ghi nhận sự kiện theo quy chế, không dùng camera/microphone.
- Thiết kế thích ứng cho máy tính và điện thoại; modal hỗ trợ bàn phím và focus.

## Kiểm tra và chạy

```bash
npm run build
npm run dev
```

`public/` là đầu ra tĩnh, không có thư mục `dist`. `build` kiểm tra cú pháp và kiểm thử logic; không cần bundler hay cài framework.

Kiểm thử tích hợp với mã nguồn SLCS (Node >=22.13):

```bash
node scripts/validate-integration.mjs /absolute/path/to/SLCS/src/index.js
```

Mã nguồn SLCS không nằm trong ZIP này. Test tích hợp tạo SQLite trong RAM, không kết nối database hay email production.

## Triển khai

Cấu hình hiện có là Cloudflare Worker + Static Assets. Root directory là `EXAM`; lệnh build `npm run build`; lệnh deploy `npx --yes wrangler@4.34.0 deploy` hoặc `npm run deploy` trên máy có quyền Cloudflare. `wrangler.json` giữ tên `slcs-exam` và entry `src/index.js`.

Nếu dự án hiện chạy Cloudflare Pages: root `EXAM`, build `npm run build`, output `public`; giữ Pages Function `functions/health.js` và `_redirects` cho `/exam/*`, `/join/*`.

API origin giữ `https://slc.skyfirst.io.vn`. Nếu đổi domain, phải đổi `public/api.js`, CSP trong `_headers` và `src/index.js`, đồng thời cho phép origin tương ứng ở backend SLCS. Không đưa token hoặc thông tin thí sinh vào source/config công khai.

Mở bài từ SLCS dùng `/?launch=...`; link khách dùng `/join/<invite>` hoặc `?invite=...`. Không dán launch token vào ô mã mời. Quyền truy cập được lưu theo session trình duyệt; link `/exam/<id>` riêng lẻ không đủ để mở bài trên máy khác.

## Lưu ý vận hành

Đồng hồ đã chạy khi máy chủ tạo phiên, cả trong màn hình hướng dẫn. Khi máy chủ khóa thời gian, câu trả lời được chấm theo dữ liệu máy chủ chấp nhận, không đảm bảo bản offline nộp muộn được tính điểm. Không đóng tab khi mất mạng. Lưu dự phòng có thể không khả dụng nếu trình duyệt hạn chế storage.

Tên thí sinh và lớp lấy từ thông tin đã xác nhận đối với khách; tài khoản SLCS hiển thị mã phiên nếu API chưa trả thông tin định danh. Lease phối hợp các tab trong cùng trình duyệt; revision phía server mới là kiểm soát dữ liệu chính.

Cổng này là sản phẩm Sky First. Giao diện được thiết kế theo phong cách thi máy tính; không tuyên bố là phần mềm, quy trình được chứng nhận hay hệ thống chính thức của Bộ GD&ĐT.

Xem `VALIDATION-2026-10-05.md` để biết kết quả kiểm thử và phần còn cần xác minh trước triển khai.
