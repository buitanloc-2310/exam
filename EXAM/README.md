# SLCS Exam

Exam Player độc lập cho `exam.skyfirst.io.vn`.

## Cloudflare Workers Builds
- Root directory: `EXAM`
- Build command: để trống (hoặc `npm run check` nếu giao diện bắt buộc)
- Build output directory: để trống
- Deploy command: `npx wrangler deploy`

Custom Domain `exam.skyfirst.io.vn` được gắn trong Cloudflare Dashboard; repo không tự khai báo route/domain.

Exam không sở hữu D1/migrations. Schema và dữ liệu authoritative do SLCS tại `slc.skyfirst.io.vn` quản lý. Exam Player dùng launch token ngắn hạn để đổi lấy access token giới hạn theo attempt.

Kiểm tra nhanh sau deploy:
- `/` => landing hoặc phiên thi
- `/health` => JSON `{ok:true}`
- static `/styles.css`, `/exam.js` => 200
