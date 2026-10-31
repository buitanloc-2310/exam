// =============================================================================
// SKY FIRST EXAM 2026 — FRONTEND PROCTORING, DEVICE & MEDIA SECURITY MODULE
// (public/security-client.js)
// Implements Sections 2, 3, 4, 5, 6, 10:
//  - Browser Control: Kiosk/SEB detection, Fullscreen Lock, Focus/Tab/Window
//    switching, URL Whitelist, Clipboard/PrintScreen restriction, DevTools &
//    Extension & DOM Tampering detection
//  - Device/OS Telemetry: Multi-monitor, Display Mirroring, USB/Bluetooth,
//    Virtual Machine (WebGL GPU renderer), Remote Desktop indicators
//  - Camera, Microphone & Secondary Wide-Angle Camera monitoring (configurable
//    per exam, non-blocking evidence upload)
// =============================================================================

import { escapeHtml as esc } from './core.js';

export const FULLSCREEN_FIRST_WARNING_MESSAGE =
  'Bạn đã rời khỏi chế độ toàn màn hình. Vui lòng quay lại chế độ thi để tiếp tục làm bài. Hoạt động này đã được ghi nhận trong nhật ký kỳ thi.';

export const PRIVACY_DISCLOSURE_SUMMARY = Object.freeze({
  law_ref: 'Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15',
  collected: [
    'Trạng thái toàn màn hình, chuyển tab/cửa sổ, thay đổi kích thước cửa sổ, phím tắt bị hạn chế và thao tác copy/cut/paste trong vùng làm bài',
    'Tín hiệu thiết bị & môi trường (màn hình phụ, USB/Bluetooth, dấu hiệu máy ảo/điều khiển từ xa, thay đổi IP/kết nối mạng)',
    'Trạng thái và bằng chứng Camera, Microphone, Camera góc rộng thứ hai (chỉ kích hoạt khi kỳ thi cấu hình yêu cầu và thí sinh xác nhận cấp quyền)'
  ],
  never_collected: [
    'Không tự ý cài đặt driver hay dịch vụ nền trái phép trên hệ điều hành',
    'Không thu thập dữ liệu ngoài phạm vi kỳ thi hoặc khi chưa thông báo rõ quyền truy cập cần thiết',
    'Không tự động hủy bài thi chỉ vì một cảnh báo kỹ thuật đơn lẻ hay gián đoạn mạng/camera tạm thời'
  ]
});

export function evaluateDeviceEnvironment() {
  const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
  const isMobileOrTablet = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua);
  const fullscreenSupported = typeof document !== 'undefined' && Boolean(
    document.documentElement?.requestFullscreen || document.fullscreenEnabled
  );
  const isExtendedDisplay = typeof window !== 'undefined' && Boolean(window.screen?.isExtended);
  const sebActive = typeof window !== 'undefined' && Boolean(window.SafeExamBrowser || /SEB\//i.test(ua));
  const nativeCompanionActive = typeof window !== 'undefined' && Boolean(window.__SKYFIRST_KIOSK_AGENT__ || sebActive);

  let vmSuspected = false;
  let gpuRenderer = '';
  try {
    if (typeof document !== 'undefined' && document.createElement) {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext?.('webgl') || canvas.getContext?.('experimental-webgl');
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        gpuRenderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
        if (/SwiftShader|llvmpipe|VirtualBox|VMware|QEMU|Parallels|Microsoft Basic Render/i.test(gpuRenderer)) {
          vmSuspected = true;
        }
      }
    }
  } catch {}

  const devtoolsOpen = typeof window !== 'undefined' && (
    (window.outerWidth - window.innerWidth > 180) ||
    (window.outerHeight - window.innerHeight > 180)
  );

  return {
    is_mobile_or_tablet: isMobileOrTablet,
    fullscreen_supported: fullscreenSupported,
    screen_extended_api_supported: typeof window !== 'undefined' && 'isExtended' in (window.screen || {}),
    is_extended_display: isExtendedDisplay,
    usb_api_supported: typeof navigator !== 'undefined' && 'usb' in navigator,
    bluetooth_api_supported: typeof navigator !== 'undefined' && 'bluetooth' in navigator,
    camera_supported: typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia),
    microphone_supported: typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia),
    native_companion_active: nativeCompanionActive,
    seb_active: sebActive,
    vm_suspected: vmSuspected,
    gpu_renderer: gpuRenderer,
    devtools_suspected: Boolean(devtoolsOpen && !isMobileOrTablet),
    online: typeof navigator !== 'undefined' ? Boolean(navigator.onLine) : true
  };
}

export function isBenignMobileViewportChange() {
  const env = evaluateDeviceEnvironment();
  if (!env.is_mobile_or_tablet) return false;
  const activeTag = typeof document !== 'undefined' ? String(document.activeElement?.tagName || '').toUpperCase() : '';
  return activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';
}

export function isUrlWhitelisted(rawUrl, whitelist = ['exam.skyfirst.io.vn', 'www.exam.skyfirst.io.vn']) {
  try {
    const base = typeof location !== 'undefined' ? location.origin : 'https://exam.skyfirst.io.vn';
    const parsed = new URL(String(rawUrl || ''), base);
    if (parsed.origin === base) return true;
    const host = parsed.hostname.toLowerCase();
    return whitelist.some(w => host === String(w).toLowerCase() || host.endsWith('.' + String(w).toLowerCase()));
  } catch {
    return false;
  }
}

export function detectBrowserTampering() {
  const tampered = [];
  try {
    if (typeof fetch === 'function' && !Function.prototype.toString.call(fetch).includes('[native code]')) {
      tampered.push('fetch_hooked');
    }
    if (typeof document !== 'undefined') {
      const extNodes = document.querySelectorAll?.('[id^="chrome-extension"], [src^="chrome-extension://"], [src^="moz-extension://"]');
      if (extNodes && extNodes.length > 0) tampered.push('extension_dom_injected');
    }
  } catch {}
  return tampered;
}

export function renderPrivacyDisclosureMarkup(securityConfig = {}) {
  const levelName = esc(securityConfig.level_name || 'Cấp độ bảo mật tiêu chuẩn');
  const camReq = securityConfig.require_camera ? 'Có yêu cầu Camera chính' : 'Không bắt buộc Camera chính';
  const micReq = securityConfig.require_microphone ? 'Có yêu cầu Microphone' : 'Không bắt buộc Microphone';
  const cam2Req = securityConfig.require_secondary_camera ? 'Có yêu cầu Camera góc rộng thứ hai' : 'Không yêu cầu Camera thứ hai';
  return `<details class="rules privacy-disclosure" open>
    <summary>Thông báo Giám sát, Kiểm soát Thiết bị &amp; Quyền truy cập (${levelName})</summary>
    <div style="font-size:14px;line-height:1.65;margin-top:8px">
      <p><b>Cấu hình giám sát kỳ thi này:</b> ${esc(camReq)} · ${esc(micReq)} · ${esc(cam2Req)}.</p>
      <p><b>1. Tín hiệu được phép ghi nhận:</b> ${PRIVACY_DISCLOSURE_SUMMARY.collected.map(esc).join('; ')}.</p>
      <p><b>2. Giới hạn kỹ thuật &amp; Bảo vệ người dùng (${esc(PRIVACY_DISCLOSURE_SUMMARY.law_ref)}):</b> ${PRIVACY_DISCLOSURE_SUMMARY.never_collected.map(esc).join('; ')}.</p>
    </div>
  </details>`;
}

export function renderWatermarkMarkup(candidate = {}, attemptId = '', variantCode = '') {
  const label = [
    candidate.candidate_code || 'SKYFIRST',
    variantCode || 'MĐ-100',
    String(attemptId || '').slice(0, 8).toUpperCase()
  ].filter(Boolean).join(' · ');
  return `<div class="exam-watermark" aria-hidden="true" style="font-size:11px;color:#64748b;opacity:0.75;user-select:none;pointer-events:none;margin-top:6px">Mã định danh phiên bảo mật: ${esc(label)}</div>`;
}
