// Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First
// =============================================================================
// SKY FIRST EXAM 2026 — DEDICATED MULTI-ROUTE SSR HTML PAGE ROUTER
// (src/page-router.js)
// Ensures all 9 mandatory paths on both hostnames (exam.skyfirst.io.vn &
// www.exam.skyfirst.io.vn) serve their own distinct, route-specific HTML content
// with HTTP 200 (never redirecting to / or returning generic homepage markup),
// while returning HTTP 404 for unknown routes.
// =============================================================================

import { BRAND_UNIT_NAME, BRAND_SYSTEM_NAME } from './email-templates.js';

export const BUILD_VERSION = '20261031-skyfirst-v7';

export const ALLOWED_HOSTNAMES = new Set([
  'exam.skyfirst.io.vn',
  'www.exam.skyfirst.io.vn',
  'localhost',
  '127.0.0.1',
  'exam.test'
]);

const PUBLIC_NAV_ITEMS = [
  ['/', 'Trang chủ'],
  ['/tra-cuu-ket-qua', 'Tra cứu kết quả thi'],
  ['/phuc-khao', 'Phúc khảo'],
  ['/ho-tro', 'Hỗ trợ'],
  ['/bao-loi', 'Báo lỗi'],
  ['/su-co-khan-cap', 'Sự cố khẩn cấp'],
  ['/to-cao-gian-lan', 'Tố cáo gian lận']
];

export const PUBLIC_ROUTE_DEFINITIONS = Object.freeze({
  '/': {
    routeKey: 'home',
    title: `${BRAND_UNIT_NAME} — ${BRAND_SYSTEM_NAME}`,
    heading: BRAND_SYSTEM_NAME,
    subtitle: 'Cổng khảo thí trực tuyến, xác minh danh tính dự thi, tra cứu kết quả và tiếp nhận nghiệp vụ khảo thí.',
    description: `${BRAND_UNIT_NAME} — ${BRAND_SYSTEM_NAME}. Nhập mã dự thi hoặc liên kết mời do đơn vị tổ chức cung cấp để tiếp tục vào kỳ thi.`,
    ssrBody: `
      <p class="lead">Nhập mã dự thi hoặc liên kết mời do đơn vị tổ chức cung cấp để bắt đầu xác minh danh tính và vào phòng thi, hoặc chọn dịch vụ khảo thí bên dưới.</p>
      <div class="service-grid" style="margin-top:16px">
        <a class="service-card" href="/tra-cuu-ket-qua"><div><b>Tra cứu kết quả thi</b><p>Thí sinh sử dụng thông tin dự thi đã được cấp để tra cứu kết quả và trạng thái công bố.</p></div><span>Truy cập /tra-cuu-ket-qua →</span></a>
        <a class="service-card" href="/tra-cuu"><div><b>Tra cứu biên nhận &amp; hồ sơ (/tra-cuu)</b><p>Cổng tra cứu tương thích theo Mã biên nhận nộp bài và Mã thí sinh.</p></div><span>Truy cập /tra-cuu →</span></a>
        <a class="service-card" href="/phuc-khao"><div><b>Đăng ký phúc khảo</b><p>Gửi yêu cầu phúc khảo theo kỳ thi, bài thi và theo dõi tiến độ thẩm định.</p></div><span>Truy cập /phuc-khao →</span></a>
        <a class="service-card" href="/ho-tro"><div><b>Hỗ trợ thí sinh</b><p>Gửi câu hỏi hoặc yêu cầu hỗ trợ kỹ thuật, quy chế và tra cứu mã tiếp nhận.</p></div><span>Truy cập /ho-tro →</span></a>
        <a class="service-card" href="/bao-loi"><div><b>Báo lỗi hệ thống</b><p>Báo lỗi giao diện, đăng nhập, dự thi, tra cứu kèm hình ảnh/tệp đính kèm.</p></div><span>Truy cập /bao-loi →</span></a>
        <a class="service-card" href="/su-co-khan-cap"><div><b>Báo sự cố khẩn cấp</b><p>Báo các tình huống khẩn cấp ảnh hưởng trực tiếp đến phiên thi đang diễn ra.</p></div><span>Truy cập /su-co-khan-cap →</span></a>
        <a class="service-card" href="/to-cao-gian-lan"><div><b>Tố cáo gian lận</b><p>Gửi phản ánh bảo mật về hành vi gian lận hoặc vi phạm quy chế thi kèm minh chứng.</p></div><span>Truy cập /to-cao-gian-lan →</span></a>
      </div>`
  },
  '/tra-cuu': {
    routeKey: 'tra-cuu',
    title: `Tra cứu kết quả thi (/tra-cuu) — ${BRAND_UNIT_NAME} — ${BRAND_SYSTEM_NAME}`,
    heading: 'Tra cứu kết quả thi',
    subtitle: 'Thí sinh sử dụng thông tin dự thi đã được cấp để tra cứu kết quả và trạng thái công bố.',
    description: 'Thí sinh sử dụng thông tin dự thi đã được cấp để tra cứu kết quả và trạng thái công bố trên Hệ Thống Khảo Thí Và Đánh Giá Sky First.',
    ssrBody: `
      <p class="lead">Thí sinh sử dụng thông tin dự thi đã được cấp để tra cứu kết quả và trạng thái công bố.</p>
      <div class="notice">Chỉ hiển thị kết quả đã được công bố chính thức từ cơ sở dữ liệu khảo thí. Các trạng thái gồm: Chưa có kết quả, Đang chấm thi, Chờ phê duyệt, Đã công bố, hoặc Đã điều chỉnh sau phúc khảo.</div>`
  },
  '/tra-cuu-ket-qua': {
    routeKey: 'tra-cuu-ket-qua',
    title: `Tra cứu kết quả thi — ${BRAND_UNIT_NAME} — ${BRAND_SYSTEM_NAME}`,
    heading: 'Tra cứu kết quả thi',
    subtitle: 'Thí sinh sử dụng thông tin dự thi đã được cấp để tra cứu kết quả và trạng thái công bố.',
    description: 'Thí sinh sử dụng thông tin dự thi đã được cấp để tra cứu kết quả và trạng thái công bố trên Hệ Thống Khảo Thí Và Đánh Giá Sky First.',
    ssrBody: `
      <p class="lead">Thí sinh sử dụng thông tin dự thi đã được cấp để tra cứu kết quả và trạng thái công bố.</p>
      <div class="notice">Hệ thống đối chiếu trực tiếp Mã biên nhận dự thi và Mã thí sinh với dữ liệu chính thức trong D1. Không hiển thị điểm tạm tính hoặc dữ liệu chấm thi nội bộ.</div>`
  },
  '/phuc-khao': {
    routeKey: 'phuc-khao',
    title: `Đăng ký phúc khảo kết quả thi — ${BRAND_UNIT_NAME} — ${BRAND_SYSTEM_NAME}`,
    heading: 'Đăng ký phúc khảo kết quả thi',
    subtitle: 'Tiếp nhận đề nghị xem xét lại kết quả bài thi theo kỳ thi, bài thi và tra cứu trạng thái xử lý.',
    description: 'Cho phép thí sinh gửi yêu cầu phúc khảo theo kỳ thi và bài thi tương ứng kèm tài liệu minh chứng.',
    ssrBody: `
      <p class="lead">Cho phép thí sinh gửi yêu cầu phúc khảo theo kỳ thi và bài thi tương ứng, lưu hồ sơ vào D1 và cấp mã tiếp nhận (PK-...) để theo dõi tiến độ xử lý.</p>`
  },
  '/ho-tro': {
    routeKey: 'ho-tro',
    title: `Hỗ trợ thí sinh — ${BRAND_UNIT_NAME} — ${BRAND_SYSTEM_NAME}`,
    heading: 'Hỗ trợ thí sinh & Giải đáp quy chế',
    subtitle: 'Tiếp nhận câu hỏi, phân loại yêu cầu hỗ trợ thí sinh và theo dõi tiến độ phản hồi.',
    description: 'Cổng tiếp nhận câu hỏi và yêu cầu hỗ trợ dành cho thí sinh tham gia Hệ Thống Khảo Thí Và Đánh Giá Sky First.',
    ssrBody: `
      <p class="lead">Gửi câu hỏi hoặc yêu cầu hỗ trợ về thủ tục dự thi, mã truy cập, xác thực OTP hoặc tra cứu kết quả. Mỗi yêu cầu được cấp mã tiếp nhận (HT-...) và xác nhận qua support@skyfirst.io.vn.</p>`
  },
  '/bao-loi': {
    routeKey: 'bao-loi',
    title: `Báo lỗi hệ thống — ${BRAND_UNIT_NAME} — ${BRAND_SYSTEM_NAME}`,
    heading: 'Báo lỗi hệ thống & Kỹ thuật',
    subtitle: 'Tiếp nhận báo cáo lỗi giao diện, đăng nhập, dự thi, tra cứu hoặc lỗi chức năng kỹ thuật.',
    description: 'Báo lỗi giao diện, đăng nhập, dự thi, tra cứu hoặc các vấn đề kỹ thuật kèm tệp/hình ảnh minh chứng.',
    ssrBody: `
      <p class="lead">Mô tả chi tiết lỗi gặp phải, các bước tái hiện và đính kèm hình ảnh/tệp minh họa (được kiểm tra chữ ký tệp và lưu trữ bảo mật trên R2). Nhận mã biên nhận kỹ thuật (BL-...).</p>`
  },
  '/su-co-khan-cap': {
    routeKey: 'su-co-khan-cap',
    title: `Báo sự cố khẩn cấp — ${BRAND_UNIT_NAME} — ${BRAND_SYSTEM_NAME}`,
    heading: 'Báo sự cố khẩn cấp trong kỳ thi',
    subtitle: 'Tiếp nhận và phân loại ưu tiên các tình huống ảnh hưởng trực tiếp đến phiên làm bài đang diễn ra.',
    description: 'Cho phép thí sinh báo các tình huống ảnh hưởng trực tiếp đến việc dự thi để ghi nhận dấu thời gian và hỗ trợ xử lý theo quy chế.',
    ssrBody: `
      <p class="lead">Dành cho thí sinh gặp sự cố gián đoạn kết nối, mất điện, lỗi thiết bị hoặc sự cố khẩn cấp ngay trong giờ làm bài. Hệ thống ghi nhận tức thời vào bảng giám sát coi thi và cấp mã tiếp nhận (KC-...).</p>`
  },
  '/to-cao-gian-lan': {
    routeKey: 'to-cao-gian-lan',
    title: `Tố cáo gian lận khảo thí — ${BRAND_UNIT_NAME} — ${BRAND_SYSTEM_NAME}`,
    heading: 'Tố cáo gian lận & Vi phạm quy chế thi',
    subtitle: 'Kênh tiếp nhận bảo mật thông tin vi phạm quy chế thi kèm tài liệu chứng minh.',
    description: 'Tiếp nhận thông tin hành vi gian lận hoặc vi phạm quy chế thi với cơ chế bảo vệ thông tin người gửi và nhật ký kiểm toán truy cập.',
    ssrBody: `
      <p class="lead">Mọi hồ sơ tố cáo gian lận (TC-...) được bảo vệ nghiêm ngặt danh tính người gửi, giới hạn quyền truy cập theo RBAC và ghi nhật ký kiểm toán cho từng lượt xem hồ sơ.</p>`
  }
});

export function renderPublicRouteHtml(pathname, origin = 'https://exam.skyfirst.io.vn') {
  const cleanPath = String(pathname || '/').replace(/\/+$/, '') || '/';
  const def = PUBLIC_ROUTE_DEFINITIONS[cleanPath] || PUBLIC_ROUTE_DEFINITIONS['/'];
  const canonicalUrl = `${origin}${cleanPath === '/' ? '/' : cleanPath}`;

  const navHtml = PUBLIC_NAV_ITEMS.map(([href, label]) => {
    const isCurrent = href === cleanPath || (href === '/tra-cuu-ket-qua' && cleanPath === '/tra-cuu');
    return `<a class="nav-pill ${isCurrent ? 'active' : ''}" href="${href}">${label}</a>`;
  }).join('');

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <meta name="description" content="${def.description}">
  <meta property="og:title" content="${def.title}">
  <meta property="og:description" content="${def.description}">
  <meta property="og:url" content="${canonicalUrl}">
  <title>${def.title}</title>
  <link rel="icon" href="/sky-first-logo.webp">
  <link rel="stylesheet" href="/styles.css?build=20261030-routes-v2">
</head>
<body data-route="${def.routeKey}" data-pathname="${cleanPath}">
  <a class="skip-link" href="#questionStage">Đến nội dung chính</a>
  <div id="app" class="gate">
    <header class="gate-header">
      <a class="gate-brand" href="/" aria-label="${BRAND_SYSTEM_NAME}">
        <img src="/sky-first-logo.webp" alt="Sky First">
        <span>
          <b>${BRAND_UNIT_NAME}</b>
          <small>${BRAND_SYSTEM_NAME}</small>
        </span>
      </a>
      <nav class="public-nav" aria-label="Điều hướng dịch vụ khảo thí">${navHtml}</nav>
    </header>
    <main class="gate-card gate-wide">
      <div class="ey">${BRAND_UNIT_NAME}</div>
      <div class="sys-sub">${BRAND_SYSTEM_NAME}</div>
      <h1>${def.heading}</h1>
      ${def.ssrBody}
    </main>
  </div>
  <noscript>
    <main class="gate">
      <section class="gate-card">
        <div class="ey">MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST</div>
        <h1>${def.heading}</h1>
        <p>Vui lòng bật JavaScript trong trình duyệt để sử dụng đầy đủ biểu mẫu và chức năng tương tác của Hệ Thống Khảo Thí Và Đánh Giá Sky First.</p>
      </section>
    </main>
  </noscript>
  <script type="module" src="/exam.js?build=20261030-routes-v2"></script>
</body>
</html>`;
}

export function renderAdminRouteHtml() {
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="theme-color" content="#0d2a4a" />
  <meta name="color-scheme" content="light" />
  <meta name="description" content="${BRAND_UNIT_NAME} — ${BRAND_SYSTEM_NAME} — Phân hệ Quản trị Khảo thí (/admin)" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Phân hệ Quản trị (/admin) — ${BRAND_UNIT_NAME} — ${BRAND_SYSTEM_NAME}</title>
  <link rel="icon" type="image/webp" href="/sky-first-logo.webp" />
  <link rel="apple-touch-icon" href="/sky-first-logo.webp" />
  <link rel="stylesheet" href="/styles.css?build=20261030-routes-v2" />
</head>
<body data-route="admin">
  <noscript>
    <div style="padding:18px;font-family:'Times New Roman',Times,serif;background:#fff4d6;color:#5f3dc4;border-bottom:1px solid #e5dbff">
      Hệ Thống Khảo Thí Và Đánh Giá Sky First yêu cầu bật JavaScript để xác thực phiên làm việc quản trị.
    </div>
  </noscript>
  <div id="app" aria-live="polite">
    <div class="shell" style="padding-top:36px">
      <div class="card">
        <div class="badge">MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST</div>
        <h1 class="h1" style="margin-top:10px">Phân hệ Quản trị — Hệ Thống Khảo Thí Và Đánh Giá Sky First</h1>
        <p class="sub">Xác thực tài khoản công vụ được cấp quyền bằng mã OTP một lần…</p>
      </div>
    </div>
  </div>
  <script type="module" src="/admin.js?build=20261030-routes-v2"></script>
</body>
</html>`;
}

export function renderNotFoundHtml(pathname = '') {
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Không tìm thấy trang (404) — ${BRAND_UNIT_NAME} — ${BRAND_SYSTEM_NAME}</title>
  <link rel="icon" href="/sky-first-logo.webp">
  <link rel="stylesheet" href="/styles.css?build=20261030-routes-v2">
</head>
<body data-route="404">
  <main class="gate">
    <section class="gate-card">
      <div class="ey">MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST</div>
      <h1>Không tìm thấy đường dẫn yêu cầu (404)</h1>
      <p class="lead">Đường dẫn bạn truy cập không tồn tại trên Hệ Thống Khảo Thí Và Đánh Giá Sky First.</p>
      <div class="actions">
        <a class="btn primary" href="/">Về trang chủ</a>
        <a class="btn" href="/tra-cuu-ket-qua">Tra cứu kết quả thi</a>
        <a class="btn" href="/ho-tro">Hỗ trợ thí sinh</a>
      </div>
    </section>
  </main>
</body>
</html>`;
}
