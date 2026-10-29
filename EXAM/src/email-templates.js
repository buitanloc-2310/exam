// Email template registry for Sky First EXAM. Sender addresses are server-controlled.
export const BRAND_UNIT_NAME = 'Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First';
export const BRAND_SYSTEM_NAME = 'Hệ Thống Khảo Thí Và Đánh Giá Sky First';
export const EMAIL_SENDERS = Object.freeze({
  EXAM: 'exam@skyfirst.io.vn',
  NOREPLY: 'noreply@skyfirst.io.vn',
  SUPPORT: 'support@skyfirst.io.vn'
});
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const get = (data, key, fallback = '—') => {
  const v = data?.[key];
  return v === undefined || v === null || String(v).trim() === '' ? fallback : String(v);
};
const definitions = {
  exam_result: { file:'exam-result.html', group:'exam', from:EMAIL_SENDERS.EXAM, subject:'Kết quả thi của bạn', title:'Thông báo kết quả thi', lead:'Kết quả đã được hệ thống ghi nhận. Vui lòng xem trạng thái công bố và hướng dẫn tra cứu bên dưới.' },
  appeal_received: { file:'appeal-received.html', group:'exam', from:EMAIL_SENDERS.EXAM, subject:'Đã tiếp nhận yêu cầu phúc khảo', title:'Xác nhận tiếp nhận phúc khảo', lead:'Hệ thống đã tiếp nhận yêu cầu phúc khảo của bạn. Hãy lưu mã yêu cầu để theo dõi tiến độ xử lý.' },
  appeal_update: { file:'appeal-update.html', group:'exam', from:EMAIL_SENDERS.EXAM, subject:'Cập nhật tiến độ phúc khảo', title:'Cập nhật yêu cầu phúc khảo', lead:'Yêu cầu phúc khảo của bạn đã được cập nhật. Hãy xem trạng thái và nội dung phản hồi trong thư này.' },
  appeal_result: { file:'appeal-result.html', group:'exam', from:EMAIL_SENDERS.EXAM, subject:'Kết quả giải quyết phúc khảo', title:'Kết quả phúc khảo', lead:'Kết quả xử lý phản ánh quyết định đã được ghi nhận bởi bộ phận có thẩm quyền.' },
  exam_announcement: { file:'exam-announcement.html', group:'exam', from:EMAIL_SENDERS.EXAM, subject:'Thông báo nghiệp vụ khảo thí', title:'Thông báo kỳ thi', lead:'Bạn có một thông báo liên quan đến kỳ thi. Vui lòng đọc nội dung và thực hiện hướng dẫn nếu có.' },
  email_verification: { file:'email-verification.html', group:'noreply', from:EMAIL_SENDERS.NOREPLY, subject:'Mã xác minh email dự thi', title:'Xác minh địa chỉ email', lead:'Sử dụng mã xác minh bên dưới để hoàn tất bước xác minh email. Không chia sẻ mã này với người khác.' },
  login_verification_code: { file:'login-verification-code.html', group:'noreply', from:EMAIL_SENDERS.NOREPLY, subject:'Mã xác minh đăng nhập một lần', title:'Xác minh đăng nhập', lead:'Nhập mã xác minh trong thời hạn hiệu lực. Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua thư.' },
  exam_entry: { file:'exam-entry.html', group:'noreply', from:EMAIL_SENDERS.NOREPLY, subject:'Xác nhận bắt đầu phiên thi', title:'Phiên thi đã bắt đầu', lead:'Hệ thống ghi nhận phiên làm bài đã bắt đầu. Hãy tuân thủ quy chế và kiểm tra trạng thái lưu bài.' },
  exam_session_ended: { file:'exam-session-ended.html', group:'noreply', from:EMAIL_SENDERS.NOREPLY, subject:'Thông báo kết thúc phiên thi', title:'Phiên thi đã kết thúc', lead:'Hệ thống đã ghi nhận trạng thái kết thúc phiên thi. Thông tin biên nhận hoặc trạng thái nộp bài được hiển thị bên dưới nếu có.' },
  exam_session_cancelled: { file:'exam-session-cancelled.html', group:'noreply', from:EMAIL_SENDERS.NOREPLY, subject:'Thông báo phiên thi bị hủy', title:'Phiên thi đã bị hủy', lead:'Hệ thống ghi nhận phiên thi đã bị hủy. Vui lòng đọc lý do và hướng dẫn tiếp theo đã được xác nhận.' },
  integrity_warning: { file:'integrity-warning.html', group:'noreply', from:EMAIL_SENDERS.NOREPLY, subject:'Thông báo về tín hiệu phiên thi', title:'Thông báo về phiên thi', lead:'Hệ thống ghi nhận một sự kiện liên quan đến việc tuân thủ quy chế. Thông báo này không tự động thay thế quyết định xử lý chính thức.' },
  fraud_report: { file:'fraud-report.html', group:'noreply', from:EMAIL_SENDERS.NOREPLY, subject:'Xác nhận tiếp nhận phản ánh', title:'Đã tiếp nhận phản ánh', lead:'Hệ thống đã tiếp nhận phản ánh để xem xét. Việc tiếp nhận không đồng nghĩa với kết luận vi phạm.' },
  exam_ban_notice: { file:'exam-ban-notice.html', group:'noreply', from:EMAIL_SENDERS.NOREPLY, subject:'Thông báo quyết định xử lý kỳ thi', title:'Thông báo quyết định xử lý', lead:'Thông báo này được gửi căn cứ vào quyết định xử lý đã được ghi nhận trong hệ thống.' },
  system_notification: { file:'system-notification.html', group:'noreply', from:EMAIL_SENDERS.NOREPLY, subject:'Thông báo từ hệ thống khảo thí', title:'Thông báo hệ thống', lead:'Đây là thông báo tự động từ Hệ Thống Khảo Thí Và Đánh Giá Sky First.' },
  support_request_received: { file:'support-request-received.html', group:'support', from:EMAIL_SENDERS.SUPPORT, subject:'Đã tiếp nhận yêu cầu hỗ trợ', title:'Xác nhận tiếp nhận hỗ trợ', lead:'Hệ thống đã tiếp nhận yêu cầu hỗ trợ của bạn. Hãy lưu mã yêu cầu để theo dõi tiến độ xử lý.' },
  support_request_update: { file:'support-request-update.html', group:'support', from:EMAIL_SENDERS.SUPPORT, subject:'Cập nhật yêu cầu hỗ trợ', title:'Cập nhật hỗ trợ', lead:'Yêu cầu hỗ trợ của bạn đã được cập nhật. Nội dung và trạng thái mới được trình bày bên dưới.' },
  support_request_resolved: { file:'support-request-resolved.html', group:'support', from:EMAIL_SENDERS.SUPPORT, subject:'Kết quả xử lý yêu cầu hỗ trợ', title:'Kết quả hỗ trợ', lead:'Yêu cầu hỗ trợ đã được cập nhật trạng thái xử lý. Vui lòng xem kết quả và hướng dẫn tiếp theo.' },
  technical_incident: { file:'technical-incident.html', group:'support', from:EMAIL_SENDERS.SUPPORT, subject:'Tiếp nhận thông tin sự cố kỹ thuật', title:'Thông tin sự cố kỹ thuật', lead:'Hệ thống đã ghi nhận thông tin sự cố kỹ thuật. Nếu sự cố vẫn tiếp diễn, vui lòng sử dụng kênh hỗ trợ phù hợp.' }
};
export const EMAIL_TEMPLATES = Object.freeze(Object.fromEntries(Object.entries(definitions).map(([key, item]) => [key, Object.freeze({ template_file:item.file, sender:item.from, group:item.group, subject:item.subject })])));
export function renderEmailTemplate(eventType, data = {}) {
  const key = Object.prototype.hasOwnProperty.call(definitions, eventType) ? eventType : 'system_notification';
  const item = definitions[key];
  const fields = {
    recipient_name: get(data, 'recipient_name', get(data, 'full_name', get(data, 'candidate_name', 'bạn'))),
    exam_title: get(data, 'exam_title', get(data, 'title')),
    candidate_code: get(data, 'candidate_code'),
    request_code: get(data, 'request_code', get(data, 'receipt_code')),
    status: get(data, 'status', get(data, 'status_label', get(data, 'result_status_label'))),
    event_time: get(data, 'event_time', get(data, 'submitted_at')),
    message: get(data, 'message', get(data, 'resolution_note', get(data, 'reason', 'Vui lòng liên hệ đúng bộ phận phụ trách nếu cần thêm thông tin.')))
  };
  const otp = ['email_verification', 'login_verification_code'].includes(key) && (data.otp || data.otp_code) ? `<div style="font-size:30px;letter-spacing:7px;font-weight:700;color:#0d2a4a;margin:12px 0 20px">${escapeHtml(data.otp || data.otp_code)}</div><p>Mã có hiệu lực trong ${escapeHtml(data.expires_minutes || 10)} phút.</p>` : '';
  const score = key === 'exam_result' && data.score !== undefined && data.score !== null ? `<p style="font-size:20px;font-weight:700">Điểm số: ${escapeHtml(data.score)}</p>` : '';
  const footer = item.group === 'noreply' ? 'Đây là thư được gửi tự động. Hộp thư này không tiếp nhận thư trả lời.' : item.group === 'exam' ? 'Hộp thư nghiệp vụ khảo thí.' : 'Bộ phận hỗ trợ kỹ thuật Sky First.';
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(item.title)}</title></head><body style="margin:0;padding:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#18324b"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6fa;padding:28px 10px"><tr><td align="center"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden"><tr><td style="padding:24px 28px;background:#0d2a4a;color:#fff"><div style="font-size:12px;line-height:1.6">${BRAND_UNIT_NAME}</div><div style="font-size:20px;font-weight:700;line-height:1.4;margin-top:6px">${BRAND_SYSTEM_NAME}</div></td></tr><tr><td style="padding:28px"><p style="font-size:14px;line-height:1.7">Kính gửi ${escapeHtml(fields.recipient_name)},</p><h1 style="font-size:22px;line-height:1.4;color:#12385b">${escapeHtml(item.title)}</h1><p style="font-size:15px;line-height:1.8">${escapeHtml(item.lead)}</p>${otp}${score}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f8fc;border:1px solid #e1e9f2"><tr><td style="padding:16px 18px;font-size:14px;line-height:1.9"><div><strong>Kỳ thi:</strong> ${escapeHtml(fields.exam_title)}</div><div><strong>Mã thí sinh:</strong> ${escapeHtml(fields.candidate_code)}</div><div><strong>Mã yêu cầu / biên nhận:</strong> ${escapeHtml(fields.request_code)}</div><div><strong>Trạng thái:</strong> ${escapeHtml(fields.status)}</div><div><strong>Thời điểm:</strong> ${escapeHtml(fields.event_time)}</div></td></tr></table><div style="font-size:14px;line-height:1.8;margin-top:18px;white-space:pre-line">${escapeHtml(fields.message)}</div><p style="font-size:14px;line-height:1.8">Nếu cần hỗ trợ, vui lòng truy cập <a href="https://exam.skyfirst.io.vn/ho-tro" style="color:#0866c6">Hệ Thống Khảo Thí Và Đánh Giá Sky First</a>.</p></td></tr><tr><td style="padding:18px 28px;border-top:1px solid #e4ebf3;color:#52677b;font-size:12px;line-height:1.7"><strong>${BRAND_UNIT_NAME}</strong><br>${footer}<br>${item.from}</td></tr></table></td></tr></table></body></html>`;
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  return { event_type:key, from:item.from, group:item.group, subject:item.subject, template_file:item.file, html, text };
}
