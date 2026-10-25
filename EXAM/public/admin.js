// =============================================================================
// SKY FIRST EXAM 2026 — FULL /admin MANAGEMENT SUBSYSTEM (public/admin.js)
// Real server-backed administrative console for TRUNG TÂM KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST.
// Zero mock numbers; server-verified RBAC; OTP login + CSRF protection.
// =============================================================================

import { apiRequest } from './api.js?build=20261025-audit-fix-1';
import { getAdminSession, setAdminSession, clearAdminSession } from './storage.js?build=20261025-audit-fix-1';
import { escapeHtml as esc, timeMs } from './core.js?build=20261025-audit-fix-1';

let adminState = {
  tab: 'dashboard',
  user: null,
  token: '',
  csrf: '',
  dashboard: null,
  exams: [],
  selectedExam: null,
  selectedQuestion: null,
  qSearch: '',
  questions: [],
  candidates: { enrollments: [], users: [] },
  monitor: { attempts: [], support_requests: [], disclaimer: '' },
  gradingAttempt: null,
  appeals: [],
  auditLogs: [],
  loading: false,
  error: ''
};

const fmtDate = v => {
  const ms = timeMs(v);
  return Number.isFinite(ms) ? new Date(ms).toLocaleString('vi-VN') : (v || '—');
};

function adminReq(path, options = {}) {
  return apiRequest(path, {
    token: adminState.token,
    csrfToken: adminState.csrf,
    credentials: 'same-origin',
    ...options
  });
}

function showAdminToast(msg, isBad = false) {
  let el = document.querySelector('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  el.className = `toast ${isBad ? 'toast-bad' : ''}`;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el.hideTimer);
  el.hideTimer = setTimeout(() => { el.hidden = true; }, 5500);
}

export async function bootAdmin(appEl) {
  const saved = getAdminSession();
  adminState.token = saved.token || '';
  adminState.csrf = saved.csrf || '';
  adminState.user = saved.user || null;

  const subPath = location.pathname.replace(/^\/admin\/?/, '').split('/')[0];
  if (['dashboard', 'exams', 'questions', 'candidates', 'monitor', 'grading', 'appeals', 'users', 'audit'].includes(subPath)) {
    adminState.tab = subPath;
  }

  try {
    const me = await adminReq('/api/admin/auth/me');
    if (me?.user) {
      adminState.user = me.user;
      if (me.user.csrf_token) adminState.csrf = me.user.csrf_token;
      setAdminSession(adminState.token, adminState.csrf, adminState.user);
      await loadTabData(adminState.tab);
      renderAdminShell(appEl);
      return;
    }
  } catch {
    clearAdminSession();
    adminState.token = '';
    adminState.csrf = '';
    adminState.user = null;
  }

  renderAdminLogin(appEl);
}

function renderAdminLogin(appEl) {
  document.title = 'Quản trị Khảo thí (/admin) | TRUNG TÂM KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST';
  appEl.className = 'gate';
  appEl.innerHTML = `
    <header class="gate-header">
      <a class="gate-brand" href="/" aria-label="Cổng dự thi Sky First">
        <img src="/sky-first-logo.webp" alt="Sky First">
        <span>
          <b>SKY FIRST NETWORK</b>
          <small>TRUNG TÂM KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST</small>
        </span>
      </a>
      <span class="gate-tag">PHÂN HỆ QUẢN TRỊ KHẢO THÍ (/ADMIN)</span>
    </header>
    <main class="gate-card gate-wide">
      <div class="ey">MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST</div>
      <h1>Đăng nhập Quản trị Khảo thí</h1>
      <p class="lead">Hệ thống xác thực quản trị bằng mã OTP một lần qua email đã được cấp quyền (RBAC). Mọi thao tác đăng nhập và quản trị đều được ghi nhật ký kiểm toán.</p>
      <div class="notice">
        <b>Nguyên tắc bảo mật:</b> Chỉ tài khoản email đã được provision vai trò quản trị trong cơ sở dữ liệu mới được nhận mã OTP. Không cấp quyền tự động theo tên miền hoặc email quen thuộc.
      </div>
      <form id="adminOtpForm">
        <div class="two">
          <div class="field">
            <label for="adminEmail">Email quản trị viên được cấp quyền</label>
            <input id="adminEmail" name="email" type="email" required maxlength="220" autocomplete="email" placeholder="Ví dụ: canbo.khaothi@skyfirst.io.vn">
          </div>
          <div class="field">
            <label for="adminOtp">Mã OTP quản trị (6 chữ số)</label>
            <input id="adminOtp" name="otp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="Nhập 6 chữ số OTP">
          </div>
        </div>
        <div id="adminAuthStatus" class="notice" hidden role="status" aria-live="polite"></div>
        <div class="actions">
          <button type="button" class="btn" id="btnSendAdminOtp">1. Yêu cầu gửi mã OTP</button>
          <button type="submit" class="btn primary">2. Xác minh OTP & Đăng nhập →</button>
          <a class="btn" href="/">← Về cổng thí sinh</a>
        </div>
      </form>
      <details class="rules" style="margin-top:24px">
        <summary>Khởi tạo Quản trị viên đầu tiên (Dành cho Quản trị hệ thống khi mới cài đặt)</summary>
        <form id="adminBootstrapForm" style="padding-bottom:16px">
          <p class="footnote">Chức năng này chỉ hoạt động khi máy chủ đã cấu hình biến môi trường <code>ADMIN_BOOTSTRAP_TOKEN</code>.</p>
          <div class="two">
            <div class="field">
              <label for="bootToken">Mã khởi tạo hệ thống (Bootstrap Token)</label>
              <input id="bootToken" name="bootstrap_token" type="password" required placeholder="Nhập ADMIN_BOOTSTRAP_TOKEN">
            </div>
            <div class="field">
              <label for="bootEmail">Email quản trị viên cần cấp quyền</label>
              <input id="bootEmail" name="email" type="email" required placeholder="Email nhận quyền system_admin">
            </div>
          </div>
          <div class="field">
            <label for="bootName">Họ và tên quản trị viên</label>
            <input id="bootName" name="full_name" required placeholder="Họ tên cán bộ quản trị">
          </div>
          <button type="submit" class="btn">Kích hoạt quyền Quản trị hệ thống</button>
        </form>
      </details>
    </main>
    <footer class="gate-footer">© 2026 SKY FIRST NETWORK · Mạng lưới Giáo dục và Phát triển Cộng đồng Sky First · TRUNG TÂM KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST</footer>
  `;

  const statusBox = appEl.querySelector('#adminAuthStatus');
  const setStatus = (msg, bad = false) => {
    statusBox.hidden = false;
    statusBox.className = `notice ${bad ? 'bad' : ''}`;
    statusBox.textContent = msg;
  };

  appEl.querySelector('#btnSendAdminOtp')?.addEventListener('click', async ev => {
    const emailInput = appEl.querySelector('#adminEmail');
    if (!emailInput.reportValidity()) return;
    const btn = ev.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Đang kiểm tra quyền & gửi OTP…';
    try {
      const r = await apiRequest('/api/admin/auth/request-otp', {
        method: 'POST',
        body: JSON.stringify({ email: emailInput.value.trim() })
      });
      setStatus(r.message || 'Đã gửi mã OTP quản trị. Vui lòng kiểm tra hộp thư.', false);
      let sec = 60;
      const t = setInterval(() => {
        if (!btn.isConnected) { clearInterval(t); return; }
        btn.textContent = `Gửi lại sau ${--sec}s`;
        if (sec <= 0) {
          clearInterval(t);
          btn.disabled = false;
          btn.textContent = '1. Yêu cầu gửi mã OTP';
        }
      }, 1000);
    } catch (err) {
      setStatus(err.message || 'Không thể gửi OTP.', true);
      btn.disabled = false;
      btn.textContent = '1. Yêu cầu gửi mã OTP';
    }
  });

  appEl.querySelector('#adminOtpForm')?.addEventListener('submit', async ev => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const email = form.elements.email.value.trim();
    const otp = form.elements.otp.value.trim();
    if (!otp || !/^\d{6}$/.test(otp)) {
      setStatus('Vui lòng nhập mã OTP gồm 6 chữ số.', true);
      return;
    }
    try {
      const r = await apiRequest('/api/admin/auth/verify-otp', {
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ email, otp })
      });
      adminState.token = r.admin_token;
      adminState.csrf = r.csrf_token;
      adminState.user = r.user;
      setAdminSession(r.admin_token, r.csrf_token, r.user);
      await loadTabData('dashboard');
      renderAdminShell(appEl);
    } catch (err) {
      setStatus(err.message || 'Xác minh OTP thất bại.', true);
    }
  });

  appEl.querySelector('#adminBootstrapForm')?.addEventListener('submit', async ev => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.currentTarget));
    try {
      const r = await apiRequest('/api/admin/auth/bootstrap', {
        method: 'POST',
        body: JSON.stringify({ ...fd, roles: ['system_admin'] })
      });
      setStatus(`Đã cấp quyền system_admin cho ${r.email}. Bây giờ bạn có thể yêu cầu mã OTP để đăng nhập.`, false);
      appEl.querySelector('#adminEmail').value = r.email;
    } catch (err) {
      setStatus(err.message || 'Không thể khởi tạo quản trị viên.', true);
    }
  });
}

async function loadTabData(tab) {
  adminState.loading = true;
  adminState.error = '';
  try {
    if (tab === 'dashboard') {
      adminState.dashboard = await adminReq('/api/admin/dashboard');
    } else if (tab === 'exams') {
      const r = await adminReq('/api/admin/exams');
      adminState.exams = r.exams || [];
    } else if (tab === 'questions') {
      const r = await adminReq('/api/admin/questions');
      adminState.questions = r.questions || [];
    } else if (tab === 'candidates') {
      const [cRes, eRes] = await Promise.all([
        adminReq('/api/admin/candidates'),
        adminReq('/api/admin/exams').catch(() => ({ exams: [] }))
      ]);
      adminState.candidates = { enrollments: cRes.enrollments || [], users: cRes.users || [] };
      adminState.exams = eRes.exams || [];
    } else if (tab === 'monitor' || tab === 'grading') {
      const r = await adminReq('/api/admin/monitor');
      adminState.monitor = r;
    } else if (tab === 'appeals') {
      const r = await adminReq('/api/admin/appeals');
      adminState.appeals = r.appeals || [];
    } else if (tab === 'users') {
      const r = await adminReq('/api/admin/candidates');
      adminState.candidates = { enrollments: r.enrollments || [], users: r.users || [] };
    } else if (tab === 'audit') {
      const r = await adminReq('/api/admin/audit-logs');
      adminState.auditLogs = r.logs || [];
    }
  } catch (err) {
    adminState.error = err.message || 'Không thể tải dữ liệu phân hệ.';
  } finally {
    adminState.loading = false;
  }
}

function renderAdminShell(appEl) {
  document.title = `Quản trị Khảo thí · ${adminState.tab.toUpperCase()} | Sky First EXAM`;
  const u = adminState.user || { email: 'admin', full_name: 'Quản trị viên', roles: [] };
  const tabs = [
    { id: 'dashboard', label: 'Tổng quan' },
    { id: 'exams', label: 'Kỳ thi & Đề thi' },
    { id: 'questions', label: 'Ngân hàng câu hỏi' },
    { id: 'candidates', label: 'Thí sinh & Ghi danh' },
    { id: 'monitor', label: 'Giám sát phòng thi' },
    { id: 'grading', label: 'Chấm điểm & Công bố' },
    { id: 'appeals', label: 'Phúc khảo' },
    { id: 'users', label: 'Phân quyền RBAC' },
    { id: 'audit', label: 'Nhật ký kiểm toán' }
  ];

  appEl.className = 'admin-app';
  appEl.innerHTML = `
    <header class="exam-header admin-header">
      <div class="exam-brand">
        <img src="/sky-first-logo.webp" alt="Sky First">
        <div>
          <b>TRUNG TÂM KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST</b>
          <small>Mạng lưới Giáo dục và Phát triển Cộng đồng Sky First</small>
        </div>
      </div>
      <div class="exam-title">
        <small>HỆ THỐNG QUẢN TRỊ KHẢO THÍ (/ADMIN)</small>
        <h1>${esc(u.full_name)} · <span class="role-pill">${esc((u.roles || []).join(', '))}</span></h1>
      </div>
      <div class="admin-header-actions">
        <a class="btn" href="/">Cổng thí sinh</a>
        <button type="button" class="btn" id="btnAdminLogout">Đăng xuất</button>
      </div>
    </header>
    <nav class="admin-nav" aria-label="Điều hướng phân hệ quản trị">
      ${tabs.map(t => `<button type="button" class="admin-tab ${adminState.tab === t.id ? 'active' : ''}" data-admin-tab="${t.id}">${esc(t.label)}</button>`).join('')}
    </nav>
    <main class="admin-workspace" id="adminMain">
      ${adminState.error ? `<div class="notice bad" role="alert">${esc(adminState.error)}</div>` : ''}
      ${renderTabContent()}
    </main>
    <footer class="gate-footer">© 2026 SKY FIRST NETWORK · Mạng lưới Giáo dục và Phát triển Cộng đồng Sky First · TRUNG TÂM KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST</footer>
  `;

  bindAdminEvents(appEl);
}

function renderTabContent() {
  const tab = adminState.tab;
  if (tab === 'dashboard') return renderDashboardTab();
  if (tab === 'exams') return renderExamsTab();
  if (tab === 'questions') return renderQuestionsTab();
  if (tab === 'candidates') return renderCandidatesTab();
  if (tab === 'monitor') return renderMonitorTab();
  if (tab === 'grading') return renderGradingTab();
  if (tab === 'appeals') return renderAppealsTab();
  if (tab === 'users') return renderUsersTab();
  if (tab === 'audit') return renderAuditTab();
  return '';
}

function renderDashboardTab() {
  const d = adminState.dashboard;
  if (!d || !d.metrics) return `<div class="admin-panel"><p>Đang tải số liệu thực từ máy chủ…</p></div>`;
  const m = d.metrics;
  const cards = [
    ['Tổng số kỳ thi', m.total_exams, 'Toàn bộ kỳ thi trên hệ thống'],
    ['Kỳ thi đang mở', m.open_exams, 'Đang trong khung giờ nhận bài'],
    ['Sắp diễn ra / Đã đóng', `${m.upcoming_exams} / ${m.closed_exams}`, 'Theo lịch mở/đóng kỳ thi'],
    ['Thí sinh & Ghi danh', m.total_registered_candidates, `${m.enrolled_records} bản ghi ghi danh kỳ thi`],
    ['Phiên đang làm bài', m.active_attempts, `${m.locked_attempts} phiên đang tạm khóa`],
    ['Bài thi đã nộp', m.submitted_attempts, 'Đã ghi nhận snapshot & biên nhận'],
    ['Chờ chấm tự luận', m.pending_manual_grading, 'Trạng thái workflow: marking'],
    ['Chờ công bố / Đã công bố', `${m.pending_result_publication} / ${m.published_results}`, 'Trạng thái duyệt và công bố điểm'],
    ['Sự kiện bảo mật & Hỗ trợ', `${m.security_events} / ${m.open_support_requests}`, `${m.pending_appeals} đơn phúc khảo chờ xử lý`]
  ];

  return `
    <section class="admin-section">
      <div class="section-head">
        <div>
          <div class="ey">SỐ LIỆU THỜI GIAN THỰC TỪ CƠ SỞ DỮ LIỆU D1</div>
          <h2>Bảng điều khiển Khảo thí</h2>
        </div>
        <button type="button" class="btn" id="btnRefreshDashboard">Làm mới dữ liệu</button>
      </div>
      <div class="admin-kpi-grid">
        ${cards.map(([label, val, sub]) => `
          <article class="admin-kpi-card">
            <small>${esc(label)}</small>
            <b>${esc(val)}</b>
            <span>${esc(sub)}</span>
          </article>
        `).join('')}
      </div>
    </section>
    <section class="admin-section">
      <h2>Hoạt động quản trị và sự kiện kiểm toán gần đây</h2>
      <div class="table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Sự kiện</th>
              <th>Kỳ thi / Phiên thi</th>
              <th>Chủ thể thực hiện</th>
              <th>Chi tiết kỹ thuật</th>
            </tr>
          </thead>
          <tbody>
            ${(d.recent_activities || []).length ? d.recent_activities.map(a => `
              <tr>
                <td><b>${esc(a.event_type)}</b></td>
                <td>${esc(a.exam_id || '—')} ${a.attempt_id ? `<br><small>Phiên: ${esc(a.attempt_id.slice(0, 10))}</small>` : ''}</td>
                <td>${esc(a.actor_user_id || 'Hệ thống / Thí sinh')}</td>
                <td><code>${esc(JSON.stringify(a.detail || {}))}</code></td>
              </tr>
            `).join('') : `<tr><td colspan="4">Chưa có sự kiện nào được ghi nhận.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderExamsTab() {
  const ex = adminState.selectedExam;
  return `
    <section class="admin-section">
      <div class="section-head">
        <div>
          <div class="ey">VÒNG ĐỜI KỲ THI & NIÊM PHONG ĐỀ</div>
          <h2>Quản lý Kỳ thi (${adminState.exams.length})</h2>
        </div>
        <button type="button" class="btn primary" id="btnNewExam">+ Tạo kỳ thi mới</button>
      </div>
      <div class="table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Mã / Liên kết mời</th>
              <th>Tiêu đề kỳ thi</th>
              <th>Trạng thái</th>
              <th>Thời lượng</th>
              <th>Số câu</th>
              <th>Phiên (Đang thi / Tổng)</th>
              <th>Thao tác vòng đời & Chỉnh sửa</th>
            </tr>
          </thead>
          <tbody>
            ${adminState.exams.length ? adminState.exams.map(e => `
              <tr>
                <td>
                  <b>${esc(e.id)}</b>
                  <br><small>Mã mời: <code>${esc(e.public_token || e.id)}</code></small>
                </td>
                <td>
                  <b>${esc(e.title)}</b>
                  <br><small>${esc(e.assessment_label || '')} · Chính sách điểm: ${esc(e.result_policy || 'score_after_submit')}</small>
                </td>
                <td><span class="status-badge status-${esc(e.status)}">${esc(e.status)}</span></td>
                <td>${Number(e.time_limit_enabled) !== 0 ? `${esc(e.duration_minutes)} phút` : 'Không giới hạn'}</td>
                <td>${esc(e.question_count)}</td>
                <td><b>${esc(e.active_attempts)}</b> / ${esc(e.total_attempts)}</td>
                <td>
                  <div class="row-actions">
                    <button type="button" class="btn btn-sm" data-edit-exam="${esc(e.id)}">Sửa / Xem đề</button>
                    ${e.status === 'draft' ? `<button type="button" class="btn btn-sm primary" data-lifecycle-exam="${esc(e.id)}" data-next-status="published">Mở kỳ thi (Publish)</button>` : ''}
                    ${e.status === 'published' ? `<button type="button" class="btn btn-sm" data-lifecycle-exam="${esc(e.id)}" data-next-status="paused">Tạm dừng</button><button type="button" class="btn btn-sm" data-lifecycle-exam="${esc(e.id)}" data-next-status="closed">Đóng kỳ thi</button>` : ''}
                    ${e.status === 'paused' ? `<button type="button" class="btn btn-sm primary" data-lifecycle-exam="${esc(e.id)}" data-next-status="published">Mở lại</button><button type="button" class="btn btn-sm" data-lifecycle-exam="${esc(e.id)}" data-next-status="closed">Đóng</button>` : ''}
                    ${e.status === 'closed' ? `<button type="button" class="btn btn-sm" data-lifecycle-exam="${esc(e.id)}" data-next-status="archived">Lưu trữ</button>` : ''}
                  </div>
                </td>
              </tr>
            `).join('') : `<tr><td colspan="7">Chưa có kỳ thi nào. Hãy bấm “+ Tạo kỳ thi mới”.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>

    <section class="admin-section" id="examEditorSection">
      <h2>${ex ? `Chỉnh sửa kỳ thi: ${esc(ex.title)} (${esc(ex.id)})` : 'Biểu mẫu Tạo / Cấu hình Kỳ thi'}</h2>
      <p class="footnote">Lưu ý: Nếu kỳ thi đang có thí sinh làm bài (in_progress), hệ thống tự động khóa việc sửa câu hỏi, đáp án và thời lượng để bảo vệ tính công bằng.</p>
      <form id="examForm">
        <input type="hidden" name="is_update" value="${ex ? '1' : ''}">
        <div class="two">
          <div class="field">
            <label>Mã kỳ thi (ID)</label>
            <input name="id" required maxlength="80" value="${esc(ex?.id || '')}" ${ex ? 'readonly' : ''} placeholder="Ví dụ: olympic-toan-2026">
          </div>
          <div class="field">
            <label>Mã liên kết mời công khai (Public Invite Code)</label>
            <input name="public_token" required maxlength="80" value="${esc(ex?.public_token || '')}" placeholder="Ví dụ: SKYFIRST-2026-A">
          </div>
          <div class="field">
            <label>Tiêu đề kỳ thi</label>
            <input name="title" required maxlength="240" value="${esc(ex?.title || '')}" placeholder="Kỳ thi Đánh giá Năng lực Sky First 2026">
          </div>
          <div class="field">
            <label>Nhãn phân loại</label>
            <input name="assessment_label" maxlength="140" value="${esc(ex?.assessment_label || 'Kỳ thi Đánh giá Năng lực')}">
          </div>
          <div class="field">
            <label>Thời lượng làm bài (phút)</label>
            <input name="duration_minutes" type="number" min="1" max="600" required value="${esc(ex?.duration_minutes ?? 60)}">
          </div>
          <div class="field">
            <label>Số lượt dự thi tối đa mỗi thí sinh</label>
            <input name="max_attempts" type="number" min="1" max="20" required value="${esc(ex?.max_attempts ?? 1)}">
          </div>
          <div class="field">
            <label>Điểm đạt (Passing Score)</label>
            <input name="passing_score" type="number" step="0.5" min="0" value="${esc(ex?.passing_score ?? 5)}">
          </div>
          <div class="field">
            <label>Chính sách công bố kết quả</label>
            <select name="result_policy">
              <option value="score_after_submit" ${ex?.result_policy === 'score_after_submit' ? 'selected' : ''}>Hiển thị điểm ngay sau khi nộp (nếu không có tự luận chờ chấm)</option>
              <option value="manual_publish_only" ${ex?.result_policy === 'manual_publish_only' ? 'selected' : ''}>Chỉ hiển thị sau khi Hội đồng duyệt và công bố</option>
              <option value="full_review_after_close" ${ex?.result_policy === 'full_review_after_close' ? 'selected' : ''}>Cho phép xem lại đáp án chi tiết sau khi đóng kỳ thi</option>
            </select>
          </div>
          <div class="field">
            <label>Thời gian mở kỳ thi (ISO / giờ Việt Nam)</label>
            <input name="opens_at" value="${esc(ex?.opens_at || '')}" placeholder="2026-10-01T08:00:00+07:00">
          </div>
          <div class="field">
            <label>Thời gian đóng kỳ thi (ISO / giờ Việt Nam)</label>
            <input name="closes_at" value="${esc(ex?.closes_at || '')}" placeholder="2026-12-31T22:00:00+07:00">
          </div>
          <div class="field">
            <label>Chính sách giám sát & khóa tự động khi vi phạm</label>
            <select name="security_profile">
              <option value="STANDARD" ${ex?.security_profile === 'STANDARD' ? 'selected' : ''}>Tiêu chuẩn (Ghi nhận tín hiệu, không khóa tự động)</option>
              <option value="STRICT_LOCK" ${ex?.security_profile === 'STRICT_LOCK' ? 'selected' : ''}>Nghiêm ngặt (Tự động khóa bài khi phát hiện rời màn hình)</option>
            </select>
          </div>
          <div class="field">
            <label>Ngưỡng số lần rời trang trước khi khóa bài (0 = theo hồ sơ)</label>
            <input name="violation_threshold" type="number" min="0" max="50" value="${esc(ex?.violation_threshold ?? 0)}">
          </div>
        </div>
        <div class="checkbox-grid">
          <label class="consent"><input type="checkbox" name="time_limit_enabled" ${Number(ex?.time_limit_enabled ?? 1) !== 0 ? 'checked' : ''}> Giới hạn thời gian làm bài</label>
          <label class="consent"><input type="checkbox" name="strict_mode" ${Number(ex?.strict_mode ?? 1) !== 0 ? 'checked' : ''}> Bật chế độ giám sát nghiêm ngặt (Strict Mode)</label>
          <label class="consent"><input type="checkbox" name="fullscreen_required" ${Number(ex?.fullscreen_required ?? 0) !== 0 ? 'checked' : ''}> Yêu cầu bật Toàn màn hình trước khi thi</label>
          <label class="consent"><input type="checkbox" name="require_email_verify" ${Number(ex?.require_email_verify ?? 0) !== 0 ? 'checked' : ''}> Bắt buộc xác minh OTP qua Email trước khi vào thi</label>
          <label class="consent"><input type="checkbox" name="public_access" ${Number(ex?.public_access ?? 1) !== 0 ? 'checked' : ''}> Cho phép thí sinh ngoài danh sách ghi danh tham gia bằng mã mời</label>
          <label class="consent"><input type="checkbox" name="show_score" ${Number(ex?.show_score ?? 1) !== 0 ? 'checked' : ''}> Cho phép hiển thị điểm theo chính sách</label>
          <label class="consent"><input type="checkbox" name="randomize_questions" ${Number(ex?.randomize_questions ?? 0) !== 0 ? 'checked' : ''}> Trộn thứ tự câu hỏi theo từng phiên thi</label>
          <label class="consent"><input type="checkbox" name="randomize_options" ${Number(ex?.randomize_options ?? 0) !== 0 ? 'checked' : ''}> Trộn thứ tự phương án trả lời</label>
        </div>
        <div class="field">
          <label>Hướng dẫn và Quy chế phòng thi</label>
          <textarea name="instructions" style="min-height:100px">${esc(ex?.instructions || 'Thí sinh kiểm tra kỹ kết nối mạng, không tự ý đóng trình duyệt trước khi nhận được mã biên nhận nộp bài.')}</textarea>
        </div>
        <div class="field">
          <label>Danh sách câu hỏi của đề thi (Định dạng JSON chuẩn)</label>
          <textarea name="questions_json" style="min-height:220px;font-size:13px">${esc(JSON.stringify(ex?.questions || [
            { id: 'q1', type: 'mcq', question: 'Thủ đô của nước Cộng hòa Xã hội Chủ nghĩa Việt Nam là thành phố nào?', options: ['Hà Nội', 'Đà Nẵng', 'TP. Hồ Chí Minh', 'Huế'], answer: 'Hà Nội', points: 2 },
            { id: 'q2', type: 'essay', question: 'Trình bày ngắn gọn mục tiêu học tập và phát triển kỹ năng của bạn trong năm 2026.', points: 3 }
          ], null, 2))}</textarea>
        </div>
        <div class="actions">
          <button type="submit" class="btn primary">${ex ? 'Lưu cập nhật kỳ thi' : 'Tạo kỳ thi mới'}</button>
          ${ex ? `<button type="button" class="btn" id="btnCancelEditExam">Hủy chọn</button>` : ''}
        </div>
      </form>
    </section>
  `;
}

function renderQuestionsTab() {
  const sq = adminState.selectedQuestion;
  const filteredQs = (adminState.questions || []).filter(q => {
    if (!adminState.qSearch) return true;
    const term = adminState.qSearch.toLowerCase();
    return String(q.question || '').toLowerCase().includes(term) || String(q.topic || '').toLowerCase().includes(term) || String(q.id || '').toLowerCase().includes(term);
  });
  return `
    <section class="admin-section">
      <div class="section-head">
        <div>
          <div class="ey">NGÂN HÀNG CÂU HỎI & PHIÊN BẢN HÓA</div>
          <h2>Ngân hàng câu hỏi (${filteredQs.length} / ${adminState.questions.length})</h2>
        </div>
        <div class="row-actions">
          <input id="qbankSearchInput" placeholder="Tìm theo chủ đề / nội dung…" value="${esc(adminState.qSearch)}" style="min-height:36px;padding:6px 10px;border:1px solid #cbd5e3;border-radius:6px">
          <button type="button" class="btn btn-sm" id="btnExportQbank">Xuất JSON</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Mã câu / Phiên bản</th>
              <th>Chủ đề & Độ khó</th>
              <th>Loại câu</th>
              <th>Nội dung câu hỏi</th>
              <th>Điểm</th>
              <th>Đáp án chuẩn</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            ${filteredQs.length ? filteredQs.map(q => `
              <tr>
                <td><b>${esc(q.code || q.id)}</b><br><small>v${esc(q.version || 1)}</small></td>
                <td>${esc(q.topic || 'Chung')}<br><small>Độ khó: ${esc(q.difficulty || 'medium')}</small></td>
                <td><code>${esc(q.type)}</code></td>
                <td>${esc(q.question)}</td>
                <td><b>${esc(q.points)}</b></td>
                <td><code>${esc(typeof q.answer === 'object' ? JSON.stringify(q.answer) : (q.answer ?? 'Chấm thủ công'))}</code></td>
                <td>
                  <div class="row-actions">
                    <button type="button" class="btn btn-sm" data-edit-question="${esc(q.id)}">Sửa</button>
                    <button type="button" class="btn btn-sm" data-delete-question="${esc(q.id)}">Lưu trữ/Xóa</button>
                  </div>
                </td>
              </tr>
            `).join('') : `<tr><td colspan="7">Ngân hàng câu hỏi hiện đang trống hoặc không có kết quả khớp.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>

    <section class="admin-section" id="qbankEditorSection">
      <h2>${sq ? `Chỉnh sửa câu hỏi: ${esc(sq.id)} (v${esc(sq.version || 1)})` : 'Thêm câu hỏi mới vào Ngân hàng đề'}</h2>
      <form id="qbankForm">
        <input type="hidden" name="is_update" value="${sq ? '1' : ''}">
        <div class="two">
          <div class="field">
            <label>Mã câu hỏi</label>
            <input name="id" required placeholder="Ví dụ: qb-toan-01">
          </div>
          <div class="field">
            <label>Chủ đề</label>
            <input name="topic" required value="Kiến thức chung">
          </div>
          <div class="field">
            <label>Độ khó</label>
            <select name="difficulty">
              <option value="easy">Dễ (Easy)</option>
              <option value="medium" selected>Trung bình (Medium)</option>
              <option value="hard">Khó (Hard)</option>
            </select>
          </div>
          <div class="field">
            <label>Loại câu hỏi</label>
            <select name="type">
              <option value="mcq">Trắc nghiệm 1 lựa chọn (mcq)</option>
              <option value="multi">Trắc nghiệm nhiều lựa chọn (multi)</option>
              <option value="truefalse">Đúng / Sai (truefalse)</option>
              <option value="short">Trả lời ngắn (short)</option>
              <option value="numeric">Số học có sai số (numeric)</option>
              <option value="essay">Tự luận (essay)</option>
            </select>
          </div>
          <div class="field">
            <label>Điểm số</label>
            <input name="points" type="number" step="0.25" min="0" value="1" required>
          </div>
          <div class="field">
            <label>Đáp án đúng (Với tự luận có thể để trống)</label>
            <input name="answer" placeholder="Nhập đáp án đúng">
          </div>
        </div>
        <div class="field">
          <label>Nội dung câu hỏi</label>
          <textarea name="question" required style="min-height:90px" placeholder="Nhập nội dung câu hỏi…"></textarea>
        </div>
        <div class="field">
          <label>Các phương án lựa chọn (Mỗi dòng 1 phương án cho câu hỏi trắc nghiệm)</label>
          <textarea name="options_lines" style="min-height:90px" placeholder="Phương án A&#10;Phương án B&#10;Phương án C&#10;Phương án D"></textarea>
        </div>
        <div class="field">
          <label>Giải thích đáp án (Hiển thị khi kỳ thi cho phép xem lại)</label>
          <input name="explanation" placeholder="Giải thích chi tiết…">
        </div>
        <button type="submit" class="btn primary">Lưu vào Ngân hàng câu hỏi</button>
      </form>
    </section>
  `;
}

function renderCandidatesTab() {
  const { enrollments } = adminState.candidates;
  return `
    <section class="admin-section">
      <h2>Ghi danh Thí sinh & Cấp liên kết dự thi trực tiếp</h2>
      <div class="two">
        <form id="enrollForm" class="admin-subform">
          <h3>1. Ghi danh thí sinh vào kỳ thi</h3>
          <div class="field">
            <label>Mã kỳ thi (Exam ID)</label>
            <input name="exam_id" required placeholder="Nhập mã kỳ thi" value="${esc(adminState.exams[0]?.id || '')}">
          </div>
          <div class="field">
            <label>Họ và tên thí sinh</label>
            <input name="full_name" required placeholder="Nguyễn Văn A">
          </div>
          <div class="field">
            <label>Email thí sinh</label>
            <input name="email" type="email" required placeholder="thisinh@example.com">
          </div>
          <div class="field">
            <label>Mã học viên / Mã dự thi</label>
            <input name="candidate_code" required placeholder="SFN-2026-001">
          </div>
          <div class="field">
            <label>Lớp / Đơn vị</label>
            <input name="class_name" placeholder="Lớp Khảo thí K1">
          </div>
          <div class="field">
            <label>Trạng thái quyền dự thi</label>
            <select name="status">
              <option value="active">Đủ điều kiện dự thi (active)</option>
              <option value="locked">Tạm khóa quyền dự thi (locked)</option>
              <option value="revoked">Thu hồi quyền dự thi (revoked)</option>
            </select>
          </div>
          <button type="submit" class="btn primary">Lưu ghi danh thí sinh</button>
        </form>

        <form id="issueLaunchForm" class="admin-subform">
          <h3>2. Cấp mã khởi chạy một lần (Launch Token)</h3>
          <p class="footnote">Dành cho thí sinh nội bộ vào thẳng phòng thi qua liên kết <code>/?launch=...</code> không phụ thuộc SLC.</p>
          <div class="field">
            <label>Mã kỳ thi đang mở (Published Exam ID)</label>
            <input name="exam_id" required placeholder="Nhập mã kỳ thi" value="${esc(adminState.exams[0]?.id || '')}">
          </div>
          <div class="field">
            <label>Họ và tên thí sinh</label>
            <input name="full_name" required placeholder="Trần Thị B">
          </div>
          <div class="field">
            <label>Email thí sinh</label>
            <input name="email" type="email" required placeholder="tranthib@example.com">
          </div>
          <div class="field">
            <label>Mã thí sinh (SFN ID)</label>
            <input name="candidate_code" required placeholder="SFN-2026-002">
          </div>
          <button type="submit" class="btn primary">Tạo Launch Token độc lập</button>
          <div id="launchResultBox" class="notice" hidden></div>
        </form>
      </div>
    </section>

    <section class="admin-section">
      <h2>Danh sách Ghi danh Kỳ thi (${enrollments.length})</h2>
      <div class="table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Kỳ thi</th>
              <th>Họ tên & Mã thí sinh</th>
              <th>Email</th>
              <th>Đơn vị</th>
              <th>Trạng thái</th>
              <th>Xác minh email</th>
            </tr>
          </thead>
          <tbody>
            ${enrollments.length ? enrollments.map(en => `
              <tr>
                <td><b>${esc(en.exam_id)}</b></td>
                <td><b>${esc(en.full_name)}</b><br><small>${esc(en.candidate_code)}</small></td>
                <td>${esc(en.email)}</td>
                <td>${esc(en.class_name || '—')}</td>
                <td><span class="status-badge status-${esc(en.status)}">${esc(en.status)}</span></td>
                <td>${en.verified_at ? fmtDate(en.verified_at) : 'Chưa xác minh'}</td>
              </tr>
            `).join('') : `<tr><td colspan="6">Chưa có bản ghi ghi danh nào.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderMonitorTab() {
  const { attempts = [], support_requests = [], disclaimer = '' } = adminState.monitor || {};
  return `
    <section class="admin-section">
      <div class="section-head">
        <div>
          <div class="ey">GIÁM SÁT PHÒNG THI TRỰC TIẾP</div>
          <h2>Phiên thi (${attempts.length})</h2>
        </div>
        <button type="button" class="btn" id="btnRefreshMonitor">Làm mới giám sát</button>
      </div>
      <div class="notice">${esc(disclaimer)}</div>
      <div class="table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Mã phiên / Kỳ thi</th>
              <th>Thí sinh</th>
              <th>Trạng thái</th>
              <th>Lần lưu gần nhất (Rev)</th>
              <th>Tín hiệu trình duyệt</th>
              <th>Thao tác Cán bộ coi thi (Có kiểm toán)</th>
            </tr>
          </thead>
          <tbody>
            ${attempts.length ? attempts.map(a => `
              <tr>
                <td>
                  <b>${esc(a.id.slice(0, 12))}…</b>
                  <br><small>${esc(a.exam_title)} (${esc(a.source)})</small>
                </td>
                <td>
                  <b>${esc(a.full_name || 'Thí sinh')}</b>
                  <br><small>${esc(a.candidate_code || '')} ${a.class_name ? `· ${esc(a.class_name)}` : ''}</small>
                </td>
                <td>
                  <span class="status-badge status-${esc(a.status)}">${esc(a.status)}</span>
                  ${a.extra_time_minutes ? `<br><small>+${esc(a.extra_time_minutes)} phút</small>` : ''}
                </td>
                <td>
                  ${fmtDate(a.last_saved_at)}
                  <br><small>Revision: ${esc(a.answer_revision)}</small>
                </td>
                <td>
                  <b>${esc(a.observed_signal_count)} sự kiện</b>
                  ${(a.recent_signals || []).length ? `<br><small>${esc(a.recent_signals.map(s => s.type).join(', '))}</small>` : ''}
                </td>
                <td>
                  <div class="row-actions">
                    ${a.status === 'in_progress' ? `<button type="button" class="btn btn-sm" data-proctor-action="lock" data-attempt-id="${esc(a.id)}">Khóa bài</button>` : ''}
                    ${a.status === 'locked' ? `<button type="button" class="btn btn-sm primary" data-proctor-action="unlock" data-attempt-id="${esc(a.id)}">Mở khóa</button>` : ''}
                    ${['in_progress', 'locked'].includes(a.status) ? `<button type="button" class="btn btn-sm" data-proctor-action="add_time" data-attempt-id="${esc(a.id)}">+5 phút</button><button type="button" class="btn btn-sm" data-proctor-action="release_lease" data-attempt-id="${esc(a.id)}">Đổi thiết bị</button>` : ''}
                    ${a.status === 'submitted' ? `<button type="button" class="btn btn-sm primary" data-open-grading="${esc(a.id)}">Chấm / Duyệt</button>` : ''}
                  </div>
                </td>
              </tr>
            `).join('') : `<tr><td colspan="6">Hiện chưa có phiên thi nào.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>

    <section class="admin-section">
      <h2>Yêu cầu hỗ trợ từ thí sinh (${support_requests.length})</h2>
      <div class="table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Thí sinh</th>
              <th>Kỳ thi / Phiên</th>
              <th>Loại sự cố</th>
              <th>Nội dung</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            ${support_requests.length ? support_requests.map(sr => `
              <tr>
                <td>${fmtDate(sr.created_at)}</td>
                <td><b>${esc(sr.candidate_name)}</b><br><small>${esc(sr.candidate_code || '')} · ${esc(sr.candidate_email || '')}</small></td>
                <td>${esc(sr.exam_id || '—')}<br><small>${esc(sr.attempt_id || '')}</small></td>
                <td>${esc(sr.issue_type)}</td>
                <td>${esc(sr.message)}</td>
                <td>
                  <span class="status-badge status-${esc(sr.status)}">${esc(sr.status)}</span>
                  ${sr.resolution_note ? `<br><small>Xử lý: ${esc(sr.resolution_note)}</small>` : ''}
                  ${sr.status === 'open' ? `
                    <form class="support-resolve-form" data-support-id="${esc(sr.id)}" style="margin-top:6px;display:flex;gap:6px">
                      <input name="resolution_note" required placeholder="Ghi chú xử lý…" style="min-height:32px;padding:4px 8px;font-size:12px">
                      <button type="submit" class="btn btn-sm primary">Đóng sự cố</button>
                    </form>
                  ` : ''}
                </td>
              </tr>
            `).join('') : `<tr><td colspan="6">Không có yêu cầu hỗ trợ nào đang chờ.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderGradingTab() {
  const submitted = (adminState.monitor?.attempts || []).filter(a => a.status === 'submitted');
  const g = adminState.gradingAttempt;

  return `
    <section class="admin-section">
      <h2>Danh sách Bài thi đã nộp cần Chấm điểm / Duyệt / Công bố (${submitted.length})</h2>
      <div class="table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Mã phiên</th>
              <th>Kỳ thi</th>
              <th>Thí sinh</th>
              <th>Thời điểm nộp</th>
              <th>Điểm hiện tại</th>
              <th>Thao tác Chấm & Công bố</th>
            </tr>
          </thead>
          <tbody>
            ${submitted.length ? submitted.map(a => `
              <tr>
                <td><b>${esc(a.id.slice(0, 12))}…</b></td>
                <td>${esc(a.exam_title)}</td>
                <td><b>${esc(a.full_name)}</b> (${esc(a.candidate_code)})</td>
                <td>${fmtDate(a.submitted_at)}</td>
                <td><b>${a.score ?? 'Chưa xong'} / ${a.max_score ?? '—'}</b></td>
                <td>
                  <div class="row-actions">
                    <button type="button" class="btn btn-sm primary" data-open-grading="${esc(a.id)}">Chi tiết & Chấm tự luận</button>
                    <button type="button" class="btn btn-sm" data-workflow-action="approve" data-attempt-id="${esc(a.id)}">Duyệt điểm</button>
                    <button type="button" class="btn btn-sm primary" data-workflow-action="publish" data-attempt-id="${esc(a.id)}">Công bố kết quả</button>
                    <button type="button" class="btn btn-sm" data-workflow-action="revoke" data-attempt-id="${esc(a.id)}">Thu hồi công bố</button>
                  </div>
                </td>
              </tr>
            `).join('') : `<tr><td colspan="6">Chưa có bài thi nào ở trạng thái đã nộp.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>

    ${g ? `
      <section class="admin-section">
        <div class="section-head">
          <div>
            <div class="ey">CHI TIẾT BÀI LÀM & CHẤM TỰ LUẬN</div>
            <h2>Bài thi: ${esc(g.full_name)} (${esc(g.candidate_code)}) — Trạng thái: ${esc(g.workflow_state)}</h2>
          </div>
          <div><b>Tổng điểm: ${esc(g.score ?? 0)} / ${esc(g.max_score ?? 0)}</b></div>
        </div>
        ${(g.questions || []).map((q, idx) => {
          const ans = g.answers?.[q.id];
          const mg = (g.manual_grades || []).find(m => String(m.question_id) === String(q.id));
          return `
            <article class="review-question">
              <small>CÂU ${idx + 1} · LOẠI: ${esc(q.type.toUpperCase())} · TỐI ĐA: ${esc(q.points ?? 1)} ĐIỂM</small>
              <h3>${esc(q.question)}</h3>
              <p><b>Bài làm của thí sinh:</b> ${esc(typeof ans === 'object' ? JSON.stringify(ans) : (ans ?? 'Không trả lời'))}</p>
              ${ans?.file_id ? `<p><a class="btn btn-sm" href="/api/admin/files/${encodeURIComponent(ans.file_id)}" target="_blank" rel="noopener">Tải tệp đính kèm (${esc(ans.name || ans.file_id)})</a></p>` : ''}
              ${q.answer !== undefined && q.answer !== null ? `<p><b>Đáp án chuẩn:</b> <code>${esc(typeof q.answer === 'object' ? JSON.stringify(q.answer) : q.answer)}</code></p>` : ''}
              <form class="manual-grade-form" data-grade-attempt="${esc(g.id)}" data-grade-question="${esc(q.id)}">
                <div class="two">
                  <div class="field">
                    <label>Điểm chấm cho câu này (0 – ${esc(q.points ?? 1)})</label>
                    <input name="score" type="number" step="0.25" min="0" max="${esc(q.points ?? 1)}" required value="${esc(mg?.score ?? '')}">
                  </div>
                  <div class="field">
                    <label>Lý do chấm / điều chỉnh điểm (Lưu kiểm toán)</label>
                    <input name="reason" required value="Chấm điểm theo biểu điểm chuẩn">
                  </div>
                </div>
                <div class="field">
                  <label>Nhận xét của cán bộ chấm thi</label>
                  <input name="feedback" value="${esc(mg?.feedback || '')}" placeholder="Nhận xét chi tiết…">
                </div>
                <button type="submit" class="btn btn-sm primary">Lưu điểm câu ${idx + 1}</button>
                ${mg?.status ? `<small style="margin-left:10px">Trạng thái: <b>${esc(mg.status)}</b></small>` : ''}
              </form>
            </article>
          `;
        }).join('')}
      </section>
    ` : ''}
  `;
}

function renderAppealsTab() {
  const appeals = adminState.appeals || [];
  return `
    <section class="admin-section">
      <h2>Quản lý Đơn phúc khảo (${appeals.length})</h2>
      <div class="table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Mã đơn / Thời gian</th>
              <th>Kỳ thi / Phiên thi</th>
              <th>Mã thí sinh</th>
              <th>Lý do phúc khảo</th>
              <th>Điểm trước / sau</th>
              <th>Trạng thái & Xử lý</th>
            </tr>
          </thead>
          <tbody>
            ${appeals.length ? appeals.map(ap => `
              <tr>
                <td><b>${esc(ap.id.slice(0, 8))}</b><br><small>${fmtDate(ap.created_at)}</small></td>
                <td>${esc(ap.exam_id)}<br><small>${esc(ap.attempt_id.slice(0, 10))}</small></td>
                <td><b>${esc(ap.candidate_code)}</b><br><small>${esc(ap.candidate_email || '')}</small></td>
                <td>${esc(ap.reason)}</td>
                <td>${esc(ap.score_before ?? '—')} → <b>${esc(ap.score_after ?? '—')}</b></td>
                <td>
                  <span class="status-badge status-${esc(ap.status)}">${esc(ap.status)}</span>
                  ${ap.resolution_note ? `<br><small>Kết luận: ${esc(ap.resolution_note)}</small>` : ''}
                  ${ap.status === 'pending' || ap.status === 'reviewing' ? `
                    <form class="appeal-resolve-form" data-appeal-id="${esc(ap.id)}" style="margin-top:8px">
                      <input name="score_after" type="number" step="0.25" placeholder="Điểm mới (tùy chọn)" value="${esc(ap.score_before ?? '')}" style="margin-bottom:4px">
                      <input name="resolution_note" required placeholder="Kết luận phúc khảo…" style="margin-bottom:4px">
                      <select name="status" style="margin-bottom:4px">
                        <option value="resolved">Chấp nhận / Đã giải quyết</option>
                        <option value="rejected">Giữ nguyên điểm / Từ chối</option>
                      </select>
                      <button type="submit" class="btn btn-sm primary">Lưu kết luận</button>
                    </form>
                  ` : ''}
                </td>
              </tr>
            `).join('') : `<tr><td colspan="6">Hiện không có đơn phúc khảo nào.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderUsersTab() {
  const users = adminState.candidates?.users || [];
  const allRoles = [
    ['system_admin', 'Quản trị hệ thống (Toàn quyền)'],
    ['exam_admin', 'Quản trị kỳ thi'],
    ['question_bank_manager', 'Quản lý ngân hàng câu hỏi'],
    ['exam_author', 'Cán bộ ra đề'],
    ['proctor', 'Cán bộ coi thi / Giám sát'],
    ['grader', 'Cán bộ chấm thi'],
    ['result_approver', 'Người duyệt và công bố kết quả'],
    ['appeal_officer', 'Cán bộ xử lý phúc khảo'],
    ['report_viewer', 'Người xem báo cáo'],
    ['account_admin', 'Quản trị tài khoản'],
    ['candidate', 'Thí sinh (Không có quyền /admin)']
  ];

  return `
    <section class="admin-section">
      <h2>Cấp quyền & Thu hồi quyền Quản trị (RBAC)</h2>
      <p class="footnote">Khi thu hồi quyền hoặc khóa tài khoản, mọi phiên đăng nhập quản trị đang hoạt động của tài khoản đó sẽ bị vô hiệu hóa ngay lập tức.</p>
      <form id="userRoleForm">
        <div class="two">
          <div class="field">
            <label>Email tài khoản</label>
            <input name="email" type="email" required placeholder="canbo@skyfirst.io.vn">
          </div>
          <div class="field">
            <label>Họ và tên</label>
            <input name="full_name" required placeholder="Họ và tên cán bộ">
          </div>
          <div class="field">
            <label>Trạng thái tài khoản</label>
            <select name="status">
              <option value="active">Đang hoạt động (active)</option>
              <option value="revoked">Thu hồi quyền (revoked)</option>
              <option value="locked">Khóa tài khoản (locked)</option>
            </select>
          </div>
          <div class="field">
            <label>Lý do cấp / thay đổi quyền (Lưu kiểm toán)</label>
            <input name="reason" required value="Phân công nhiệm vụ Hội đồng khảo thí">
          </div>
        </div>
        <div class="field">
          <label>Chọn các vai trò (Roles)</label>
          <div class="checkbox-grid">
            ${allRoles.map(([code, label]) => `
              <label class="consent"><input type="checkbox" name="role_item" value="${esc(code)}" ${code === 'exam_admin' ? 'checked' : ''}> ${esc(label)} (<code>${esc(code)}</code>)</label>
            `).join('')}
          </div>
        </div>
        <button type="submit" class="btn primary">Cập nhật phân quyền tài khoản</button>
      </form>
    </section>

    <section class="admin-section">
      <h2>Danh sách Tài khoản trên hệ thống (${users.length})</h2>
      <div class="table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Mã tài khoản</th>
              <th>Họ và tên</th>
              <th>Email</th>
              <th>Vai trò (Roles)</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            ${users.map(u => `
              <tr>
                <td><b>${esc(u.id)}</b><br><small>${esc(u.sfn_id || '')}</small></td>
                <td>${esc(u.full_name)}</td>
                <td>${esc(u.email)}</td>
                <td><code>${esc(u.roles_json || u.role || 'candidate')}</code></td>
                <td><span class="status-badge status-${esc(u.status)}">${esc(u.status)}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderAuditTab() {
  const logs = adminState.auditLogs || [];
  return `
    <section class="admin-section">
      <div class="section-head">
        <div>
          <div class="ey">NHẬT KÝ KIỂM TOÁN BẤT BIẾN</div>
          <h2>Nhật ký Kiểm toán Hệ thống (${logs.length})</h2>
        </div>
        <button type="button" class="btn" id="btnExportAudit">Xuất JSON kiểm toán</button>
      </div>
      <div class="table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Mã sự kiện</th>
              <th>Loại sự kiện</th>
              <th>Kỳ thi / Phiên thi</th>
              <th>Chủ thể</th>
              <th>Chi tiết (Không lưu OTP/Bí mật)</th>
            </tr>
          </thead>
          <tbody>
            ${logs.length ? logs.map(l => `
              <tr>
                <td><small>${esc(l.id.slice(0, 8))}</small></td>
                <td><b>${esc(l.event_type)}</b></td>
                <td>${esc(l.exam_id || '—')} ${l.attempt_id ? `<br><small>${esc(l.attempt_id.slice(0, 10))}</small>` : ''}</td>
                <td>${esc(l.actor_user_id || 'Hệ thống / Thí sinh')}</td>
                <td><code>${esc(JSON.stringify(l.detail || {}))}</code></td>
              </tr>
            `).join('') : `<tr><td colspan="5">Chưa có bản ghi kiểm toán nào.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function bindAdminEvents(appEl) {
  appEl.querySelectorAll('[data-admin-tab]').forEach(btn => {
    btn.addEventListener('click', async () => {
      adminState.tab = btn.dataset.adminTab;
      history.replaceState({}, '', `/admin/${adminState.tab}`);
      await loadTabData(adminState.tab);
      renderAdminShell(appEl);
    });
  });

  appEl.querySelector('#btnAdminLogout')?.addEventListener('click', async () => {
    try { await adminReq('/api/admin/auth/logout', { method: 'POST' }); } catch {}
    clearAdminSession();
    adminState.token = '';
    adminState.csrf = '';
    adminState.user = null;
    history.replaceState({}, '', '/admin');
    renderAdminLogin(appEl);
  });

  appEl.querySelector('#btnRefreshDashboard')?.addEventListener('click', async () => {
    await loadTabData('dashboard');
    renderAdminShell(appEl);
  });

  appEl.querySelector('#btnRefreshMonitor')?.addEventListener('click', async () => {
    await loadTabData('monitor');
    renderAdminShell(appEl);
  });

  appEl.querySelector('#btnNewExam')?.addEventListener('click', () => {
    adminState.selectedExam = null;
    renderAdminShell(appEl);
    document.querySelector('#examEditorSection')?.scrollIntoView({ behavior: 'smooth' });
  });

  appEl.querySelector('#btnCancelEditExam')?.addEventListener('click', () => {
    adminState.selectedExam = null;
    renderAdminShell(appEl);
  });

  appEl.querySelectorAll('[data-edit-exam]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const r = await adminReq(`/api/admin/exams/${encodeURIComponent(btn.dataset.editExam)}`);
        adminState.selectedExam = r.exam;
        renderAdminShell(appEl);
        document.querySelector('#examEditorSection')?.scrollIntoView({ behavior: 'smooth' });
      } catch (err) {
        showAdminToast(err.message, true);
      }
    });
  });

  appEl.querySelectorAll('[data-lifecycle-exam]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const examId = btn.dataset.lifecycleExam;
      const status = btn.dataset.nextStatus;
      try {
        await adminReq(`/api/admin/exams/${encodeURIComponent(examId)}/lifecycle`, {
          method: 'POST',
          body: JSON.stringify({ status, reason: `Chuyển trạng thái sang ${status} từ bảng điều khiển quản trị` })
        });
        showAdminToast(`Đã chuyển trạng thái kỳ thi ${examId} sang ${status}.`);
        await loadTabData('exams');
        renderAdminShell(appEl);
      } catch (err) {
        showAdminToast(err.message, true);
      }
    });
  });

  appEl.querySelector('#examForm')?.addEventListener('submit', async ev => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const fd = new FormData(form);
    const isUpdate = fd.get('is_update') === '1';
    const examId = String(fd.get('id') || '').trim();
    let questions = [];
    try {
      questions = JSON.parse(String(fd.get('questions_json') || '[]'));
    } catch {
      showAdminToast('JSON danh sách câu hỏi không hợp lệ. Vui lòng kiểm tra cú pháp JSON.', true);
      return;
    }
    const payload = {
      id: examId,
      public_token: String(fd.get('public_token') || '').trim(),
      title: String(fd.get('title') || '').trim(),
      assessment_label: String(fd.get('assessment_label') || '').trim(),
      duration_minutes: Number(fd.get('duration_minutes') || 60),
      max_attempts: Number(fd.get('max_attempts') || 1),
      passing_score: Number(fd.get('passing_score') || 0),
      result_policy: String(fd.get('result_policy') || 'score_after_submit'),
      opens_at: String(fd.get('opens_at') || '').trim() || null,
      closes_at: String(fd.get('closes_at') || '').trim() || null,
      security_profile: String(fd.get('security_profile') || 'STANDARD'),
      violation_threshold: Number(fd.get('violation_threshold') || 0),
      time_limit_enabled: form.elements.time_limit_enabled.checked,
      strict_mode: form.elements.strict_mode.checked,
      fullscreen_required: form.elements.fullscreen_required.checked,
      require_email_verify: form.elements.require_email_verify.checked,
      public_access: form.elements.public_access.checked,
      show_score: form.elements.show_score.checked,
      randomize_questions: form.elements.randomize_questions.checked,
      randomize_options: form.elements.randomize_options.checked,
      instructions: String(fd.get('instructions') || ''),
      questions
    };
    try {
      const r = await adminReq(isUpdate ? `/api/admin/exams/${encodeURIComponent(examId)}` : '/api/admin/exams', {
        method: isUpdate ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      });
      adminState.selectedExam = r.exam;
      showAdminToast(isUpdate ? 'Đã cập nhật kỳ thi thành công.' : 'Đã tạo kỳ thi mới thành công.');
      await loadTabData('exams');
      renderAdminShell(appEl);
    } catch (err) {
      showAdminToast(err.message, true);
    }
  });

  appEl.querySelector('#qbankSearchInput')?.addEventListener('input', ev => {
    adminState.qSearch = ev.currentTarget.value;
    renderAdminShell(appEl);
    const input = appEl.querySelector('#qbankSearchInput');
    if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  });

  appEl.querySelector('#btnExportQbank')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ questions: adminState.questions || [] }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SkyFirst-EXAM-QuestionBank-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  appEl.querySelectorAll('[data-edit-question]').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = (adminState.questions || []).find(x => String(x.id) === btn.dataset.editQuestion);
      if (!q) return;
      adminState.selectedQuestion = q;
      renderAdminShell(appEl);
      const form = appEl.querySelector('#qbankForm');
      if (form) {
        form.elements.id.value = q.id;
        form.elements.topic.value = q.topic || 'Chung';
        form.elements.difficulty.value = q.difficulty || 'medium';
        form.elements.type.value = q.type || 'mcq';
        form.elements.points.value = q.points ?? 1;
        form.elements.answer.value = typeof q.answer === 'object' ? JSON.stringify(q.answer) : (q.answer ?? '');
        form.elements.question.value = q.question || '';
        form.elements.options_lines.value = Array.isArray(q.options) ? q.options.join('\n') : '';
        form.elements.explanation.value = q.explanation || '';
      }
      document.querySelector('#qbankEditorSection')?.scrollIntoView({ behavior: 'smooth' });
    });
  });

  appEl.querySelectorAll('[data-delete-question]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const qId = btn.dataset.deleteQuestion;
      try {
        await adminReq(`/api/admin/questions/${encodeURIComponent(qId)}`, { method: 'DELETE' });
        showAdminToast(`Đã lưu trữ/xóa câu hỏi ${qId}.`);
        await loadTabData('questions');
        renderAdminShell(appEl);
      } catch (err) {
        showAdminToast(err.message, true);
      }
    });
  });

  appEl.querySelectorAll('.support-resolve-form').forEach(form => {
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const supportId = form.dataset.supportId;
      const fd = new FormData(form);
      try {
        await adminReq(`/api/admin/support/${encodeURIComponent(supportId)}/resolve`, {
          method: 'POST',
          body: JSON.stringify({ resolution_note: String(fd.get('resolution_note') || '') })
        });
        showAdminToast('Đã đóng yêu cầu hỗ trợ kỹ thuật.');
        await loadTabData('monitor');
        renderAdminShell(appEl);
      } catch (err) {
        showAdminToast(err.message, true);
      }
    });
  });

  appEl.querySelector('#qbankForm')?.addEventListener('submit', async ev => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const isUpdate = fd.get('is_update') === '1';
    const qId = String(fd.get('id') || '').trim();
    const options = String(fd.get('options_lines') || '').split('\n').map(s => s.trim()).filter(Boolean);
    const payload = {
      id: qId,
      topic: String(fd.get('topic') || 'Chung').trim(),
      difficulty: String(fd.get('difficulty') || 'medium'),
      type: String(fd.get('type') || 'mcq'),
      points: Number(fd.get('points') || 1),
      question: String(fd.get('question') || '').trim(),
      options,
      answer: String(fd.get('answer') || '').trim() || null,
      explanation: String(fd.get('explanation') || '').trim()
    };
    try {
      await adminReq(isUpdate ? `/api/admin/questions/${encodeURIComponent(qId)}` : '/api/admin/questions', {
        method: isUpdate ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      });
      adminState.selectedQuestion = null;
      showAdminToast(isUpdate ? 'Đã cập nhật phiên bản câu hỏi.' : 'Đã lưu câu hỏi vào ngân hàng đề.');
      await loadTabData('questions');
      renderAdminShell(appEl);
    } catch (err) {
      showAdminToast(err.message, true);
    }
  });

  appEl.querySelector('#enrollForm')?.addEventListener('submit', async ev => {
    ev.preventDefault();
    const payload = Object.fromEntries(new FormData(ev.currentTarget));
    try {
      await adminReq('/api/admin/candidates/enroll', { method: 'POST', body: JSON.stringify(payload) });
      showAdminToast('Đã lưu thông tin ghi danh thí sinh.');
      await loadTabData('candidates');
      renderAdminShell(appEl);
    } catch (err) {
      showAdminToast(err.message, true);
    }
  });

  appEl.querySelector('#issueLaunchForm')?.addEventListener('submit', async ev => {
    ev.preventDefault();
    const payload = Object.fromEntries(new FormData(ev.currentTarget));
    const box = appEl.querySelector('#launchResultBox');
    try {
      const r = await adminReq('/api/admin/candidates/launch', { method: 'POST', body: JSON.stringify(payload) });
      box.hidden = false;
      box.innerHTML = `<b>Đã tạo liên kết khởi chạy độc lập:</b><br><a href="${esc(r.launch_path)}">${esc(location.origin + r.launch_path)}</a>`;
      showAdminToast('Đã cấp Launch Token thành công.');
    } catch (err) {
      showAdminToast(err.message, true);
    }
  });

  appEl.querySelectorAll('[data-proctor-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.proctorAction;
      const attemptId = btn.dataset.attemptId;
      const payload = {
        action,
        extra_minutes: action === 'add_time' ? 5 : undefined,
        reason: `Cán bộ coi thi thực hiện thao tác ${action} trên bảng giám sát`
      };
      try {
        await adminReq(`/api/admin/monitor/${encodeURIComponent(attemptId)}/action`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        showAdminToast(`Đã thực hiện thao tác ${action} cho phiên thi.`);
        await loadTabData('monitor');
        renderAdminShell(appEl);
      } catch (err) {
        showAdminToast(err.message, true);
      }
    });
  });

  appEl.querySelectorAll('[data-open-grading]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const attemptId = btn.dataset.openGrading;
      try {
        const r = await adminReq(`/api/admin/grading/${encodeURIComponent(attemptId)}`);
        adminState.gradingAttempt = r.attempt;
        adminState.tab = 'grading';
        await loadTabData('grading');
        renderAdminShell(appEl);
      } catch (err) {
        showAdminToast(err.message, true);
      }
    });
  });

  appEl.querySelectorAll('.manual-grade-form').forEach(form => {
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const attemptId = form.dataset.gradeAttempt;
      const questionId = form.dataset.gradeQuestion;
      const fd = new FormData(form);
      try {
        await adminReq(`/api/admin/grading/${encodeURIComponent(attemptId)}/grade`, {
          method: 'POST',
          body: JSON.stringify({
            question_id: questionId,
            score: Number(fd.get('score')),
            feedback: String(fd.get('feedback') || ''),
            reason: String(fd.get('reason') || 'Chấm tự luận')
          })
        });
        showAdminToast('Đã lưu điểm câu hỏi và cập nhật tổng điểm.');
        const r = await adminReq(`/api/admin/grading/${encodeURIComponent(attemptId)}`);
        adminState.gradingAttempt = r.attempt;
        await loadTabData('grading');
        renderAdminShell(appEl);
      } catch (err) {
        showAdminToast(err.message, true);
      }
    });
  });

  appEl.querySelectorAll('[data-workflow-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.workflowAction;
      const attemptId = btn.dataset.attemptId;
      try {
        await adminReq(`/api/admin/grading/${encodeURIComponent(attemptId)}/workflow`, {
          method: 'POST',
          body: JSON.stringify({
            action,
            reason: `Thực hiện ${action} kết quả từ phân hệ Chấm điểm & Công bố`
          })
        });
        showAdminToast(`Đã thực hiện ${action} kết quả bài thi.`);
        if (adminState.gradingAttempt?.id === attemptId) {
          const r = await adminReq(`/api/admin/grading/${encodeURIComponent(attemptId)}`);
          adminState.gradingAttempt = r.attempt;
        }
        await loadTabData('grading');
        renderAdminShell(appEl);
      } catch (err) {
        showAdminToast(err.message, true);
      }
    });
  });

  appEl.querySelectorAll('.appeal-resolve-form').forEach(form => {
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const appealId = form.dataset.appealId;
      const fd = new FormData(form);
      try {
        await adminReq(`/api/admin/appeals/${encodeURIComponent(appealId)}/resolve`, {
          method: 'POST',
          body: JSON.stringify({
            status: String(fd.get('status') || 'resolved'),
            score_after: fd.get('score_after') !== '' ? Number(fd.get('score_after')) : undefined,
            resolution_note: String(fd.get('resolution_note') || '')
          })
        });
        showAdminToast('Đã cập nhật kết quả giải quyết phúc khảo.');
        await loadTabData('appeals');
        renderAdminShell(appEl);
      } catch (err) {
        showAdminToast(err.message, true);
      }
    });
  });

  appEl.querySelector('#userRoleForm')?.addEventListener('submit', async ev => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const fd = new FormData(form);
    const roles = [...form.querySelectorAll('input[name="role_item"]:checked')].map(c => c.value);
    try {
      await adminReq('/api/admin/users/role', {
        method: 'POST',
        body: JSON.stringify({
          email: String(fd.get('email') || '').trim(),
          full_name: String(fd.get('full_name') || '').trim(),
          status: String(fd.get('status') || 'active'),
          reason: String(fd.get('reason') || ''),
          roles
        })
      });
      showAdminToast('Đã cập nhật phân quyền RBAC.');
      await loadTabData('users');
      renderAdminShell(appEl);
    } catch (err) {
      showAdminToast(err.message, true);
    }
  });

  appEl.querySelector('#btnExportAudit')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(adminState.auditLogs || [], null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SkyFirst-EXAM-AuditLog-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
