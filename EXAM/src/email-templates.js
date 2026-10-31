// =============================================================================
// SKY FIRST EXAM 2026 — EMAIL TEMPLATE REGISTRY & DISTINCT HTML RENDERER
// Maps 18 dedicated HTML files in src/emails/*.html + 24 business email events
// across the 3 strictly separated sender channels.
// =============================================================================

export const BRAND_UNIT_NAME = "Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First";
export const BRAND_SYSTEM_NAME = "Hệ Thống Khảo Thí Và Đánh Giá Sky First";

export const EMAIL_SENDERS = Object.freeze({
  EXAM: 'exam@skyfirst.io.vn',
  NOREPLY: 'noreply@skyfirst.io.vn',
  SUPPORT: 'support@skyfirst.io.vn'
});

const escapeHtml = value =>
  String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

const getField = (data, key, fallback = '—') => {
  const v = data?.[key];
  return v === undefined || v === null || String(v).trim() === '' ? fallback : String(v);
};

const DEFINITIONS = {
  "login_verification_code": {
    "file": "login-verification-code.html",
    "group": "noreply",
    "from": "noreply@skyfirst.io.vn",
    "subject": "Mã xác minh đăng nhập một lần (OTP) — Sky First Exam",
    "title": "Mã Xác Thực Đăng Nhập Hệ Thống (OTP)",
    "badge": "BẢO MẬT ĐĂNG NHẬP · NOREPLY",
    "accent": "#0d2a4a",
    "lead": "Hệ thống nhận được yêu cầu đăng nhập bằng email công vụ đã được cấp quyền trên Hệ Thống Khảo Thí Và Đánh Giá Sky First.",
    "customBlock": "<div style=\"background:#f0f6ff;border:2px dashed #0866c6;border-radius:10px;padding:18px;text-align:center;margin:18px 0\">\n      <div style=\"font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#3b5875\">Mã xác thực OTP (6 chữ số)</div>\n      <div style=\"font-size:32px;letter-spacing:8px;font-weight:700;color:#0d2a4a;margin:10px 0\">{{otp_code}}</div>\n      <div style=\"font-size:13px;color:#415a77\">Thời hạn hiệu lực: <strong>{{expires_minutes}} phút</strong> (Chỉ sử dụng 01 lần duy nhất)</div>\n    </div>\n    <div style=\"background:#fff8e6;border-left:4px solid #d97706;padding:12px 14px;font-size:13px;line-height:1.6;margin:14px 0;color:#78350f\">\n      <strong>Cảnh báo bảo mật:</strong> Tuyệt đối không chia sẻ mã OTP này cho bất kỳ ai. Cán bộ quản trị Sky First không bao giờ yêu cầu bạn cung cấp mã OTP. Nếu bạn không thực hiện yêu cầu đăng nhập này, vui lòng bỏ qua email hoặc báo ngay cho bộ phận quản trị hệ thống.\n    </div>",
    "rows": [
      [
        "Tài khoản yêu cầu",
        "{{recipient_name}}"
      ],
      [
        "Phân hệ truy cập",
        "{{exam_title}}"
      ],
      [
        "Trạng thái xác thực",
        "{{status}}"
      ],
      [
        "Thời điểm cấp mã",
        "{{event_time}}"
      ]
    ]
  },
  "email_verification": {
    "file": "email-verification.html",
    "group": "noreply",
    "from": "noreply@skyfirst.io.vn",
    "subject": "Mã xác minh email dự thi (OTP) — Sky First Exam",
    "title": "Xác Minh Danh Tính Thí Sinh Trước Khi Vào Thi",
    "badge": "XÁC MINH DỰ THI · NOREPLY",
    "accent": "#0f3d68",
    "lead": "Sử dụng mã OTP 6 chữ số dưới đây để hoàn tất bước xác minh danh tính trước khi bắt đầu phiên làm bài thi trực tuyến.",
    "customBlock": "<div style=\"background:#eef7ff;border:2px solid #1d4ed8;border-radius:10px;padding:18px;text-align:center;margin:18px 0\">\n      <div style=\"font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#1e3a8a\">Mã OTP xác minh dự thi</div>\n      <div style=\"font-size:32px;letter-spacing:8px;font-weight:700;color:#0d2a4a;margin:10px 0\">{{otp_code}}</div>\n      <div style=\"font-size:13px;color:#1e40af\">Hiệu lực trong <strong>{{expires_minutes}} phút</strong> · Chỉ áp dụng cho đúng email đã đăng ký</div>\n    </div>\n    <p style=\"font-size:13px;line-height:1.6;color:#475569\">Lưu ý: Không chia sẻ mã xác minh cho người khác. Nếu bạn không thực hiện thao tác vào phòng thi, vui lòng bỏ qua thư này.</p>",
    "rows": [
      [
        "Kỳ thi",
        "{{exam_title}}"
      ],
      [
        "Mã thí sinh",
        "{{candidate_code}}"
      ],
      [
        "Trạng thái hồ sơ",
        "{{status}}"
      ],
      [
        "Thời điểm yêu cầu",
        "{{event_time}}"
      ]
    ]
  },
  "exam_result": {
    "file": "exam-result.html",
    "group": "exam",
    "from": "exam@skyfirst.io.vn",
    "subject": "Thông báo công bố kết quả kỳ thi — Sky First Exam",
    "title": "Thông Báo Kết Quả Thi Chính Thức",
    "badge": "NGHIỆP VỤ KHẢO THÍ · KẾT QUẢ THI",
    "accent": "#0b4f6c",
    "lead": "Hội đồng khảo thí thông báo kết quả bài thi của bạn đã được phê duyệt và công bố chính thức trên hệ thống.",
    "customBlock": "<div style=\"background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:16px 20px;margin:16px 0\">\n      <div style=\"font-size:13px;color:#166534;font-weight:700\">ĐIỂM SỐ CHÍNH THỨC ĐÃ CÔNG BỐ</div>\n      <div style=\"font-size:26px;font-weight:700;color:#14532d;margin-top:6px\">{{score_display}}</div>\n    </div>\n    <p style=\"font-size:14px;line-height:1.7\">Thí sinh có thể tra cứu chi tiết tại <a href=\"https://exam.skyfirst.io.vn/tra-cuu-ket-qua\" style=\"color:#0866c6;font-weight:600\">Trang Tra cứu kết quả thi (/tra-cuu-ket-qua)</a> hoặc gửi yêu cầu xem xét lại tại <a href=\"https://exam.skyfirst.io.vn/phuc-khao\" style=\"color:#0866c6;font-weight:600\">Trang Phúc khảo (/phuc-khao)</a>.</p>",
    "rows": [
      [
        "Kỳ thi",
        "{{exam_title}}"
      ],
      [
        "Mã thí sinh",
        "{{candidate_code}}"
      ],
      [
        "Mã biên nhận bài thi",
        "{{request_code}}"
      ],
      [
        "Trạng thái công bố",
        "{{status}}"
      ],
      [
        "Thời điểm công bố",
        "{{event_time}}"
      ]
    ]
  },
  "appeal_received": {
    "file": "appeal-received.html",
    "group": "exam",
    "from": "exam@skyfirst.io.vn",
    "subject": "Xác nhận tiếp nhận hồ sơ phúc khảo — Sky First Exam",
    "title": "Xác Nhận Tiếp Nhận Đơn Phúc Khảo Kết Quả Thi",
    "badge": "NGHIỆP VỤ KHẢO THÍ · PHÚC KHẢO",
    "accent": "#1e3a5f",
    "lead": "Hệ thống đã ghi nhận hồ sơ đề nghị phúc khảo kết quả bài thi của bạn và chuyển tới Ban Phúc khảo để thẩm định theo quy chế.",
    "customBlock": "<div style=\"background:#f8fafc;border-left:4px solid #0866c6;padding:12px 16px;margin:14px 0;font-size:13px;line-height:1.7\">\n      Vui lòng lưu giữ <strong>Mã hồ sơ phúc khảo ({{request_code}})</strong> để tra cứu tiến độ giải quyết tại đường dẫn <a href=\"https://exam.skyfirst.io.vn/phuc-khao\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn/phuc-khao</a>.\n    </div>",
    "rows": [
      [
        "Mã hồ sơ phúc khảo",
        "{{request_code}}"
      ],
      [
        "Kỳ thi đề nghị phúc khảo",
        "{{exam_title}}"
      ],
      [
        "Mã thí sinh",
        "{{candidate_code}}"
      ],
      [
        "Trạng thái xử lý",
        "{{status}}"
      ],
      [
        "Thời gian tiếp nhận",
        "{{event_time}}"
      ]
    ]
  },
  "appeal_update": {
    "file": "appeal-update.html",
    "group": "exam",
    "from": "exam@skyfirst.io.vn",
    "subject": "Cập nhật tiến độ xử lý hồ sơ phúc khảo — Sky First Exam",
    "title": "Thông Báo Cập Nhật Tiến Độ Thẩm Định Phúc Khảo",
    "badge": "NGHIỆP VỤ KHẢO THÍ · CẬP NHẬT PHÚC KHẢO",
    "accent": "#1e3a5f",
    "lead": "Hồ sơ đề nghị phúc khảo kết quả thi của bạn vừa được cán bộ chuyên trách cập nhật trạng thái xử lý mới.",
    "customBlock": "<p style=\"font-size:13px;color:#334155\">Bạn có thể theo dõi chi tiết hoặc bổ sung minh chứng (nếu được yêu cầu) tại <a href=\"https://exam.skyfirst.io.vn/phuc-khao\" style=\"color:#0866c6\">Trang Phúc khảo (/phuc-khao)</a>.</p>",
    "rows": [
      [
        "Mã hồ sơ phúc khảo",
        "{{request_code}}"
      ],
      [
        "Kỳ thi",
        "{{exam_title}}"
      ],
      [
        "Mã thí sinh",
        "{{candidate_code}}"
      ],
      [
        "Trạng thái hiện tại",
        "{{status}}"
      ],
      [
        "Thời điểm cập nhật",
        "{{event_time}}"
      ]
    ]
  },
  "appeal_result": {
    "file": "appeal-result.html",
    "group": "exam",
    "from": "exam@skyfirst.io.vn",
    "subject": "Thông báo kết quả giải quyết phúc khảo — Sky First Exam",
    "title": "Quyết Định Giải Quyết Phúc Khảo Bài Thi",
    "badge": "NGHIỆP VỤ KHẢO THÍ · KẾT QUẢ PHÚC KHẢO",
    "accent": "#0f5132",
    "lead": "Hội đồng phúc khảo đã hoàn tất việc chấm thẩm định và công bố kết luận chính thức đối với đơn phúc khảo của bạn.",
    "customBlock": "<div style=\"background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 18px;margin:14px 0;font-size:14px\">\n      <strong>Kết quả điểm sau phúc khảo:</strong> {{score_display}}\n    </div>",
    "rows": [
      [
        "Mã hồ sơ phúc khảo",
        "{{request_code}}"
      ],
      [
        "Kỳ thi",
        "{{exam_title}}"
      ],
      [
        "Mã thí sinh",
        "{{candidate_code}}"
      ],
      [
        "Trạng thái kết luận",
        "{{status}}"
      ],
      [
        "Thời điểm ban hành",
        "{{event_time}}"
      ]
    ]
  },
  "exam_announcement": {
    "file": "exam-announcement.html",
    "group": "exam",
    "from": "exam@skyfirst.io.vn",
    "subject": "Thông báo nghiệp vụ và lịch thi — Sky First Exam",
    "title": "Thông Báo Lịch Thi & Hướng Dẫn Tham Gia Kỳ Thi",
    "badge": "NGHIỆP VỤ KHẢO THÍ · THÔNG BÁO KỲ THI",
    "accent": "#0d2a4a",
    "lead": "Ban tổ chức gửi tới bạn thông tin chính thức về lịch thi, mã truy cập kỳ thi và các yêu cầu chuẩn bị thiết bị trước giờ dự thi.",
    "customBlock": "<div style=\"background:#f1f5f9;border-radius:8px;padding:14px 18px;margin:14px 0;font-size:13px;line-height:1.7\">\n      <strong>Hướng dẫn trước giờ thi:</strong> Thí sinh vui lòng kiểm tra kết nối mạng, trình duyệt hỗ trợ chế độ toàn màn hình và truy cập <a href=\"https://exam.skyfirst.io.vn/\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn/</a> trước giờ mở đề ít nhất 15 phút.\n    </div>",
    "rows": [
      [
        "Kỳ thi / Đợt đánh giá",
        "{{exam_title}}"
      ],
      [
        "Mã thí sinh / Mã dự thi",
        "{{candidate_code}}"
      ],
      [
        "Mã thông báo / Tham chiếu",
        "{{request_code}}"
      ],
      [
        "Trạng thái kỳ thi",
        "{{status}}"
      ],
      [
        "Thời gian áp dụng",
        "{{event_time}}"
      ]
    ]
  },
  "exam_entry": {
    "file": "exam-entry.html",
    "group": "noreply",
    "from": "noreply@skyfirst.io.vn",
    "subject": "Xác nhận bắt đầu phiên làm bài thi — Sky First Exam",
    "title": "Ghi Nhận Bắt Đầu Phiên Làm Bài Thi Trực Tuyến",
    "badge": "GIÁM SÁT PHIÊN THI · NOREPLY",
    "accent": "#0d2a4a",
    "lead": "Hệ thống đã khởi tạo phiên làm bài riêng biệt và kích hoạt đồng hồ tính giờ phía máy chủ cho lượt dự thi của bạn.",
    "customBlock": "<p style=\"font-size:13px;color:#475569\">Trong suốt quá trình làm bài, hệ thống tự động lưu đáp án theo revision và ghi nhận các sự kiện tuân thủ quy chế phòng thi (không chụp ảnh hay quay video màn hình).</p>",
    "rows": [
      [
        "Kỳ thi",
        "{{exam_title}}"
      ],
      [
        "Mã thí sinh",
        "{{candidate_code}}"
      ],
      [
        "Mã phiên dự thi",
        "{{request_code}}"
      ],
      [
        "Trạng thái phiên",
        "{{status}}"
      ],
      [
        "Thời điểm bắt đầu (Server UTC)",
        "{{event_time}}"
      ]
    ]
  },
  "exam_session_ended": {
    "file": "exam-session-ended.html",
    "group": "noreply",
    "from": "noreply@skyfirst.io.vn",
    "subject": "Biên nhận hoàn thành và nộp bài thi — Sky First Exam",
    "title": "Xác Nhận Đã Nộp Bài Thi & Cấp Mã Biên Nhận",
    "badge": "BIÊN NHẬN NỘP BÀI · NOREPLY",
    "accent": "#0f5132",
    "lead": "Máy chủ khảo thí đã xác nhận lưu trữ an toàn bài làm của bạn và cấp mã biên nhận điện tử để đối chiếu, tra cứu kết quả.",
    "customBlock": "<div style=\"background:#ecfdf5;border:1px solid #6ee7b7;border-radius:8px;padding:14px 18px;margin:14px 0;text-align:center\">\n      <div style=\"font-size:12px;color:#065f46;text-transform:uppercase\">Mã biên nhận nộp bài chính thức</div>\n      <div style=\"font-size:22px;font-weight:700;color:#064e3b;margin-top:4px\">{{request_code}}</div>\n    </div>\n    <p style=\"font-size:13px;line-height:1.6\">Hãy lưu giữ Mã biên nhận này cùng Mã thí sinh để tra cứu điểm tại <a href=\"https://exam.skyfirst.io.vn/tra-cuu-ket-qua\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn/tra-cuu-ket-qua</a>.</p>",
    "rows": [
      [
        "Kỳ thi",
        "{{exam_title}}"
      ],
      [
        "Mã thí sinh",
        "{{candidate_code}}"
      ],
      [
        "Mã biên nhận",
        "{{request_code}}"
      ],
      [
        "Trạng thái bài làm",
        "{{status}}"
      ],
      [
        "Thời điểm nộp bài",
        "{{event_time}}"
      ]
    ]
  },
  "exam_session_cancelled": {
    "file": "exam-session-cancelled.html",
    "group": "noreply",
    "from": "noreply@skyfirst.io.vn",
    "subject": "Thông báo hủy phiên thi hoặc điều chỉnh trạng thái — Sky First Exam",
    "title": "Thông Báo Hủy Phiên Thi / Thu Hồi Trạng Thái",
    "badge": "QUẢN LÝ PHIÊN THI · NOREPLY",
    "accent": "#991b1b",
    "lead": "Hệ thống ghi nhận phiên dự thi hoặc trạng thái kết quả liên quan đã được tạm dừng, hủy hoặc thu hồi để rà soát theo quy định.",
    "customBlock": "<p style=\"font-size:13px;color:#7f1d1d\">Nếu bạn cần làm rõ nguyên nhân hoặc đăng ký lịch thi bổ sung, vui lòng liên hệ thông qua trang <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0866c6\">Hỗ trợ thí sinh (/ho-tro)</a>.</p>",
    "rows": [
      [
        "Kỳ thi",
        "{{exam_title}}"
      ],
      [
        "Mã thí sinh",
        "{{candidate_code}}"
      ],
      [
        "Mã phiên / Mã tham chiếu",
        "{{request_code}}"
      ],
      [
        "Trạng thái cập nhật",
        "{{status}}"
      ],
      [
        "Thời điểm ghi nhận",
        "{{event_time}}"
      ]
    ]
  },
  "integrity_warning": {
    "file": "integrity-warning.html",
    "group": "noreply",
    "from": "noreply@skyfirst.io.vn",
    "subject": "Cảnh báo tín hiệu bảo mật phiên thi — Sky First Exam",
    "title": "Ghi Nhận Cảnh Báo Tín Hiệu Giám Sát Phòng Thi",
    "badge": "AN NINH KHẢO THÍ · NOREPLY",
    "accent": "#b45309",
    "lead": "Hệ thống bảo mật kỳ thi vừa ghi nhận tín hiệu bất thường trên trình duyệt dự thi của bạn vượt ngưỡng cảnh báo cấu hình.",
    "customBlock": "<div style=\"background:#fffbeb;border-left:4px solid #f59e0b;padding:12px 16px;margin:14px 0;font-size:13px;line-height:1.6;color:#78350f\">\n      <strong>Lưu ý quan trọng:</strong> Cảnh báo kỹ thuật này được ghi vào nhật ký để cán bộ coi thi xem xét và <strong>không tự động đồng nghĩa với kết luận gian lận</strong>. Nếu do sự cố khách quan (mất mạng, thông báo hệ điều hành), bạn có thể gửi giải trình hoặc báo ngay tại <a href=\"https://exam.skyfirst.io.vn/su-co-khan-cap\" style=\"color:#b45309;font-weight:700\">/su-co-khan-cap</a>.\n    </div>",
    "rows": [
      [
        "Kỳ thi",
        "{{exam_title}}"
      ],
      [
        "Mã thí sinh",
        "{{candidate_code}}"
      ],
      [
        "Mã phiên dự thi",
        "{{request_code}}"
      ],
      [
        "Mức phân loại tín hiệu",
        "{{status}}"
      ],
      [
        "Thời điểm phát hiện",
        "{{event_time}}"
      ]
    ]
  },
  "fraud_report": {
    "file": "fraud-report.html",
    "group": "noreply",
    "from": "noreply@skyfirst.io.vn",
    "subject": "Xác nhận tiếp nhận hồ sơ tố cáo gian lận (Bảo mật) — Sky First Exam",
    "title": "Xác Nhận Tiếp Nhận Phản Ánh Vi Phạm Quy Chế Thi",
    "badge": "BẢO MẬT TỐ CÁO · NOREPLY",
    "accent": "#312e81",
    "lead": "Hệ thống đã tiếp nhận hồ sơ phản ánh dấu hiệu gian lận hoặc vi phạm quy chế khảo thí và lưu trữ theo chế độ bảo mật nghiêm ngặt.",
    "customBlock": "<div style=\"background:#eef2ff;border-left:4px solid #4338ca;padding:12px 16px;margin:14px 0;font-size:13px;line-height:1.6;color:#1e1b4b\">\n      <strong>Cam kết bảo vệ người gửi:</strong> Để bảo mật tuyệt đối danh tính người phản ánh và tính toàn vẹn của hồ sơ xác minh, thư tự động này không đính kèm lại nội dung chi tiết vụ việc hay tệp bằng chứng nhạy cảm. Chỉ cán bộ được phân quyền thẩm tra mới có quyền truy cập hồ sơ có kiểm toán.\n    </div>",
    "rows": [
      [
        "Mã hồ sơ bảo mật",
        "{{request_code}}"
      ],
      [
        "Kỳ thi liên quan",
        "{{exam_title}}"
      ],
      [
        "Trạng thái hồ sơ",
        "{{status}}"
      ],
      [
        "Thời điểm tiếp nhận",
        "{{event_time}}"
      ]
    ]
  },
  "exam_ban_notice": {
    "file": "exam-ban-notice.html",
    "group": "noreply",
    "from": "noreply@skyfirst.io.vn",
    "subject": "Thông báo quyết định xử lý vi phạm quy chế — Sky First Exam",
    "title": "Thông Báo Quyết Định Xử Lý Vi Phạm Quy Chế Khảo Thí",
    "badge": "HỘI ĐỒNG KỶ LUẬT · NOREPLY",
    "accent": "#7f1d1d",
    "lead": "Sau khi cán bộ có thẩm quyền rà soát biên bản và nhật ký kỳ thi, Hội đồng khảo thí thông báo quyết định xử lý theo quy chế.",
    "customBlock": "<p style=\"font-size:13px;color:#475569\">Thí sinh có quyền gửi văn bản giải trình hoặc đề nghị xem xét lại quyết định xử lý thông qua trang <a href=\"https://exam.skyfirst.io.vn/phuc-khao\" style=\"color:#0866c6\">Phúc khảo & Khiếu nại (/phuc-khao)</a> trong thời hạn quy định.</p>",
    "rows": [
      [
        "Kỳ thi",
        "{{exam_title}}"
      ],
      [
        "Mã thí sinh",
        "{{candidate_code}}"
      ],
      [
        "Mã biên bản / Hồ sơ",
        "{{request_code}}"
      ],
      [
        "Hình thức xử lý",
        "{{status}}"
      ],
      [
        "Thời điểm ban hành",
        "{{event_time}}"
      ]
    ]
  },
  "system_notification": {
    "file": "system-notification.html",
    "group": "noreply",
    "from": "noreply@skyfirst.io.vn",
    "subject": "Thông báo tài khoản và vận hành hệ thống — Sky First Exam",
    "title": "Thông Báo Tự Động Về Tài Khoản & Hệ Thống Khảo Thí",
    "badge": "HỆ THỐNG TỰ ĐỘNG · NOREPLY",
    "accent": "#0d2a4a",
    "lead": "Đây là thông báo quản trị tự động liên quan đến trạng thái tài khoản, phân quyền truy cập hoặc lịch bảo trì trên Hệ Thống Khảo Thí Và Đánh Giá Sky First.",
    "customBlock": "<p style=\"font-size:13px;color:#475569\">Nếu bạn nhận thấy thông tin thay đổi tài khoản không đúng với yêu cầu công tác, vui lòng liên hệ ngay Quản trị viên hệ thống.</p>",
    "rows": [
      [
        "Hạng mục thông báo",
        "{{exam_title}}"
      ],
      [
        "Mã định danh / Tài khoản",
        "{{candidate_code}}"
      ],
      [
        "Mã tham chiếu sự kiện",
        "{{request_code}}"
      ],
      [
        "Trạng thái áp dụng",
        "{{status}}"
      ],
      [
        "Thời điểm ghi nhận",
        "{{event_time}}"
      ]
    ]
  },
  "support_request_received": {
    "file": "support-request-received.html",
    "group": "support",
    "from": "support@skyfirst.io.vn",
    "subject": "Xác nhận tiếp nhận yêu cầu hỗ trợ thí sinh — Sky First Support",
    "title": "Đã Tiếp Nhận Yêu Cầu Hỗ Trợ Thí Sinh",
    "badge": "HỖ TRỢ THÍ SINH · SUPPORT",
    "accent": "#0369a1",
    "lead": "Bộ phận Hỗ trợ thí sinh Sky First đã tiếp nhận câu hỏi / yêu cầu hỗ trợ của bạn và phân luồng tới cán bộ phụ trách.",
    "customBlock": "<div style=\"background:#f0f9ff;border-left:4px solid #0284c7;padding:12px 16px;margin:14px 0;font-size:13px;line-height:1.6\">\n      Sử dụng <strong>Mã tiếp nhận hỗ trợ ({{request_code}})</strong> cùng địa chỉ email của bạn để kiểm tra phản hồi tại <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0284c7;font-weight:700\">https://exam.skyfirst.io.vn/ho-tro</a>.\n    </div>",
    "rows": [
      [
        "Mã phiếu hỗ trợ",
        "{{request_code}}"
      ],
      [
        "Kỳ thi liên quan",
        "{{exam_title}}"
      ],
      [
        "Mã thí sinh",
        "{{candidate_code}}"
      ],
      [
        "Trạng thái xử lý",
        "{{status}}"
      ],
      [
        "Thời điểm tiếp nhận",
        "{{event_time}}"
      ]
    ]
  },
  "support_request_update": {
    "file": "support-request-update.html",
    "group": "support",
    "from": "support@skyfirst.io.vn",
    "subject": "Cập nhật tiến độ xử lý yêu cầu hỗ trợ — Sky First Support",
    "title": "Cập Nhật Phản Hồi Yêu Cầu Hỗ Trợ Thí Sinh",
    "badge": "HỖ TRỢ THÍ SINH · CẬP NHẬT",
    "accent": "#0369a1",
    "lead": "Cán bộ hỗ trợ vừa cập nhật thông tin hướng dẫn hoặc yêu cầu làm rõ thêm đối với phiếu hỗ trợ của bạn.",
    "customBlock": "<p style=\"font-size:13px;color:#334155\">Xem chi tiết tiến độ xử lý tại <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn/ho-tro</a>.</p>",
    "rows": [
      [
        "Mã phiếu hỗ trợ",
        "{{request_code}}"
      ],
      [
        "Kỳ thi liên quan",
        "{{exam_title}}"
      ],
      [
        "Mã thí sinh",
        "{{candidate_code}}"
      ],
      [
        "Trạng thái hiện tại",
        "{{status}}"
      ],
      [
        "Thời điểm cập nhật",
        "{{event_time}}"
      ]
    ]
  },
  "support_request_resolved": {
    "file": "support-request-resolved.html",
    "group": "support",
    "from": "support@skyfirst.io.vn",
    "subject": "Hoàn tất giải quyết yêu cầu hỗ trợ — Sky First Support",
    "title": "Thông Báo Kết Quả Giải Quyết Yêu Cầu Hỗ Trợ",
    "badge": "HỖ TRỢ THÍ SINH · HOÀN TẤT",
    "accent": "#0f5132",
    "lead": "Yêu cầu hỗ trợ hoặc báo cáo kỹ thuật của bạn đã được bộ phận chuyên môn xử lý hoàn tất.",
    "customBlock": "<p style=\"font-size:13px;color:#334155\">Cảm ơn bạn đã phối hợp cùng Bộ phận Hỗ trợ Kỹ thuật & Khảo thí Sky First.</p>",
    "rows": [
      [
        "Mã phiếu hỗ trợ",
        "{{request_code}}"
      ],
      [
        "Kỳ thi liên quan",
        "{{exam_title}}"
      ],
      [
        "Mã thí sinh",
        "{{candidate_code}}"
      ],
      [
        "Trạng thái kết thúc",
        "{{status}}"
      ],
      [
        "Thời điểm hoàn tất",
        "{{event_time}}"
      ]
    ]
  },
  "technical_incident": {
    "file": "technical-incident.html",
    "group": "support",
    "from": "support@skyfirst.io.vn",
    "subject": "Xác nhận tiếp nhận báo lỗi / sự cố kỹ thuật — Sky First Support",
    "title": "Xác Nhận Tiếp Nhận Báo Lỗi Hệ Thống & Sự Cố Khẩn Cấp",
    "badge": "KỸ THUẬT & SỰ CỐ KHẨN CẤP · SUPPORT",
    "accent": "#9a3412",
    "lead": "Hệ thống kỹ thuật đã ghi nhận báo cáo lỗi hoặc sự cố khẩn cấp trong quá trình dự thi của bạn kèm dấu thời gian máy chủ.",
    "customBlock": "<div style=\"background:#fff7ed;border-left:4px solid #ea580c;padding:12px 16px;margin:14px 0;font-size:13px;line-height:1.6;color:#7c2d12\">\n      <strong>Hướng dẫn xử lý tình huống:</strong> Dữ liệu câu trả lời đã lưu trên máy chủ và bản nháp cục bộ trên trình duyệt của bạn được bảo toàn theo cơ chế revision. Bạn có thể theo dõi trạng thái phiếu bằng mã <strong>{{request_code}}</strong> tại <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#c2410c;font-weight:700\">/ho-tro</a>.\n    </div>",
    "rows": [
      [
        "Mã biên nhận sự cố / báo lỗi",
        "{{request_code}}"
      ],
      [
        "Kỳ thi / Phân hệ",
        "{{exam_title}}"
      ],
      [
        "Mã thí sinh",
        "{{candidate_code}}"
      ],
      [
        "Mức độ & Trạng thái",
        "{{status}}"
      ],
      [
        "Thời điểm ghi nhận",
        "{{event_time}}"
      ]
    ]
  }
};

const RAW_HTML_TEMPLATES = {
  "login_verification_code": "<!doctype html>\n<html lang=\"vi\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n  <meta name=\"x-skyfirst-template\" content=\"login-verification-code.html\">\n  <title>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First · Mã Xác Thực Đăng Nhập Hệ Thống (OTP)</title>\n</head>\n<body style=\"margin:0;padding:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#18324b\">\n  <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f3f6fa;padding:26px 10px\">\n    <tr>\n      <td align=\"center\">\n        <table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:600px;width:100%;background:#ffffff;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden\">\n          <tr>\n            <td style=\"padding:22px 28px;background:#0d2a4a;color:#ffffff\">\n              <div style=\"font-size:11px;letter-spacing:0.8px;text-transform:uppercase;opacity:0.92\">MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST</div>\n              <div style=\"font-size:13px;line-height:1.5;margin-top:2px\">Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First</div>\n              <div style=\"font-size:19px;font-weight:700;line-height:1.35;margin-top:6px\">HỆ THỐNG KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST</div>\n              <div style=\"font-size:12px;opacity:0.9;margin-top:2px\">Hệ Thống Khảo Thí Và Đánh Giá Sky First · Mã mẫu: login-verification-code.html</div>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:26px 28px\">\n              <div style=\"display:inline-block;padding:4px 10px;background:#eef2f6;color:#1e3a5f;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:12px\">BẢO MẬT ĐĂNG NHẬP · NOREPLY</div>\n              <p style=\"font-size:14px;line-height:1.7;margin:0 0 10px\">Kính gửi <strong>{{recipient_name}}</strong>,</p>\n              <h1 style=\"font-size:21px;line-height:1.35;color:#12385b;margin:0 0 12px\">Mã Xác Thực Đăng Nhập Hệ Thống (OTP)</h1>\n              <p style=\"font-size:14px;line-height:1.75;color:#2c445e;margin:0 0 16px\">Hệ thống nhận được yêu cầu đăng nhập bằng email công vụ đã được cấp quyền trên Hệ Thống Khảo Thí Và Đánh Giá Sky First.</p>\n              <div style=\"background:#f0f6ff;border:2px dashed #0866c6;border-radius:10px;padding:18px;text-align:center;margin:18px 0\">\n      <div style=\"font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#3b5875\">Mã xác thực OTP (6 chữ số)</div>\n      <div style=\"font-size:32px;letter-spacing:8px;font-weight:700;color:#0d2a4a;margin:10px 0\">{{otp_code}}</div>\n      <div style=\"font-size:13px;color:#415a77\">Thời hạn hiệu lực: <strong>{{expires_minutes}} phút</strong> (Chỉ sử dụng 01 lần duy nhất)</div>\n    </div>\n    <div style=\"background:#fff8e6;border-left:4px solid #d97706;padding:12px 14px;font-size:13px;line-height:1.6;margin:14px 0;color:#78350f\">\n      <strong>Cảnh báo bảo mật:</strong> Tuyệt đối không chia sẻ mã OTP này cho bất kỳ ai. Cán bộ quản trị Sky First không bao giờ yêu cầu bạn cung cấp mã OTP. Nếu bạn không thực hiện yêu cầu đăng nhập này, vui lòng bỏ qua email hoặc báo ngay cho bộ phận quản trị hệ thống.\n    </div>\n              <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:16px 0\">\n                <tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Tài khoản yêu cầu:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{recipient_name}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Phân hệ truy cập:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{exam_title}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Trạng thái xác thực:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{status}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Thời điểm cấp mã:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{event_time}}</td></tr>\n              </table>\n              <div style=\"font-size:14px;line-height:1.75;margin-top:16px;padding:14px 16px;background:#f9fbfd;border:1px solid #e5edf5;border-radius:8px;white-space:pre-line;color:#1e293b\">{{message}}</div>\n              <p style=\"font-size:13px;line-height:1.7;margin-top:18px;color:#475569\">\n                Cổng thông tin chính thức: <a href=\"https://exam.skyfirst.io.vn/\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn</a> |\n                Tra cứu kết quả: <a href=\"https://exam.skyfirst.io.vn/tra-cuu-ket-qua\" style=\"color:#0866c6\">/tra-cuu-ket-qua</a> |\n                Hỗ trợ: <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0866c6\">/ho-tro</a>\n              </p>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:16px 28px;background:#f8fafc;border-top:1px solid #e4ebf3;color:#52677b;font-size:12px;line-height:1.65\">\n              <strong>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First</strong><br>\n              Đây là email tự động từ hệ thống (noreply@skyfirst.io.vn). Vui lòng không trả lời trực tiếp thư này.<br>\n              Địa chỉ gửi định danh: <strong>noreply@skyfirst.io.vn</strong>\n            </td>\n          </tr>\n        </table>\n      </td>\n    </tr>\n  </table>\n</body>\n</html>\n",
  "email_verification": "<!doctype html>\n<html lang=\"vi\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n  <meta name=\"x-skyfirst-template\" content=\"email-verification.html\">\n  <title>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First · Xác Minh Danh Tính Thí Sinh Trước Khi Vào Thi</title>\n</head>\n<body style=\"margin:0;padding:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#18324b\">\n  <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f3f6fa;padding:26px 10px\">\n    <tr>\n      <td align=\"center\">\n        <table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:600px;width:100%;background:#ffffff;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden\">\n          <tr>\n            <td style=\"padding:22px 28px;background:#0f3d68;color:#ffffff\">\n              <div style=\"font-size:11px;letter-spacing:0.8px;text-transform:uppercase;opacity:0.92\">MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST</div>\n              <div style=\"font-size:13px;line-height:1.5;margin-top:2px\">Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First</div>\n              <div style=\"font-size:19px;font-weight:700;line-height:1.35;margin-top:6px\">HỆ THỐNG KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST</div>\n              <div style=\"font-size:12px;opacity:0.9;margin-top:2px\">Hệ Thống Khảo Thí Và Đánh Giá Sky First · Mã mẫu: email-verification.html</div>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:26px 28px\">\n              <div style=\"display:inline-block;padding:4px 10px;background:#eef2f6;color:#1e3a5f;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:12px\">XÁC MINH DỰ THI · NOREPLY</div>\n              <p style=\"font-size:14px;line-height:1.7;margin:0 0 10px\">Kính gửi <strong>{{recipient_name}}</strong>,</p>\n              <h1 style=\"font-size:21px;line-height:1.35;color:#12385b;margin:0 0 12px\">Xác Minh Danh Tính Thí Sinh Trước Khi Vào Thi</h1>\n              <p style=\"font-size:14px;line-height:1.75;color:#2c445e;margin:0 0 16px\">Sử dụng mã OTP 6 chữ số dưới đây để hoàn tất bước xác minh danh tính trước khi bắt đầu phiên làm bài thi trực tuyến.</p>\n              <div style=\"background:#eef7ff;border:2px solid #1d4ed8;border-radius:10px;padding:18px;text-align:center;margin:18px 0\">\n      <div style=\"font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#1e3a8a\">Mã OTP xác minh dự thi</div>\n      <div style=\"font-size:32px;letter-spacing:8px;font-weight:700;color:#0d2a4a;margin:10px 0\">{{otp_code}}</div>\n      <div style=\"font-size:13px;color:#1e40af\">Hiệu lực trong <strong>{{expires_minutes}} phút</strong> · Chỉ áp dụng cho đúng email đã đăng ký</div>\n    </div>\n    <p style=\"font-size:13px;line-height:1.6;color:#475569\">Lưu ý: Không chia sẻ mã xác minh cho người khác. Nếu bạn không thực hiện thao tác vào phòng thi, vui lòng bỏ qua thư này.</p>\n              <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:16px 0\">\n                <tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Kỳ thi:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{exam_title}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã thí sinh:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{candidate_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Trạng thái hồ sơ:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{status}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Thời điểm yêu cầu:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{event_time}}</td></tr>\n              </table>\n              <div style=\"font-size:14px;line-height:1.75;margin-top:16px;padding:14px 16px;background:#f9fbfd;border:1px solid #e5edf5;border-radius:8px;white-space:pre-line;color:#1e293b\">{{message}}</div>\n              <p style=\"font-size:13px;line-height:1.7;margin-top:18px;color:#475569\">\n                Cổng thông tin chính thức: <a href=\"https://exam.skyfirst.io.vn/\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn</a> |\n                Tra cứu kết quả: <a href=\"https://exam.skyfirst.io.vn/tra-cuu-ket-qua\" style=\"color:#0866c6\">/tra-cuu-ket-qua</a> |\n                Hỗ trợ: <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0866c6\">/ho-tro</a>\n              </p>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:16px 28px;background:#f8fafc;border-top:1px solid #e4ebf3;color:#52677b;font-size:12px;line-height:1.65\">\n              <strong>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First</strong><br>\n              Đây là email tự động từ hệ thống (noreply@skyfirst.io.vn). Vui lòng không trả lời trực tiếp thư này.<br>\n              Địa chỉ gửi định danh: <strong>noreply@skyfirst.io.vn</strong>\n            </td>\n          </tr>\n        </table>\n      </td>\n    </tr>\n  </table>\n</body>\n</html>\n",
  "exam_result": "<!doctype html>\n<html lang=\"vi\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n  <meta name=\"x-skyfirst-template\" content=\"exam-result.html\">\n  <title>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First · Thông Báo Kết Quả Thi Chính Thức</title>\n</head>\n<body style=\"margin:0;padding:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#18324b\">\n  <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f3f6fa;padding:26px 10px\">\n    <tr>\n      <td align=\"center\">\n        <table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:600px;width:100%;background:#ffffff;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden\">\n          <tr>\n            <td style=\"padding:22px 28px;background:#0b4f6c;color:#ffffff\">\n              <div style=\"font-size:11px;letter-spacing:0.8px;text-transform:uppercase;opacity:0.92\">MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST</div>\n              <div style=\"font-size:13px;line-height:1.5;margin-top:2px\">Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First</div>\n              <div style=\"font-size:19px;font-weight:700;line-height:1.35;margin-top:6px\">HỆ THỐNG KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST</div>\n              <div style=\"font-size:12px;opacity:0.9;margin-top:2px\">Hệ Thống Khảo Thí Và Đánh Giá Sky First · Mã mẫu: exam-result.html</div>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:26px 28px\">\n              <div style=\"display:inline-block;padding:4px 10px;background:#eef2f6;color:#1e3a5f;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:12px\">NGHIỆP VỤ KHẢO THÍ · KẾT QUẢ THI</div>\n              <p style=\"font-size:14px;line-height:1.7;margin:0 0 10px\">Kính gửi <strong>{{recipient_name}}</strong>,</p>\n              <h1 style=\"font-size:21px;line-height:1.35;color:#12385b;margin:0 0 12px\">Thông Báo Kết Quả Thi Chính Thức</h1>\n              <p style=\"font-size:14px;line-height:1.75;color:#2c445e;margin:0 0 16px\">Hội đồng khảo thí thông báo kết quả bài thi của bạn đã được phê duyệt và công bố chính thức trên hệ thống.</p>\n              <div style=\"background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:16px 20px;margin:16px 0\">\n      <div style=\"font-size:13px;color:#166534;font-weight:700\">ĐIỂM SỐ CHÍNH THỨC ĐÃ CÔNG BỐ</div>\n      <div style=\"font-size:26px;font-weight:700;color:#14532d;margin-top:6px\">{{score_display}}</div>\n    </div>\n    <p style=\"font-size:14px;line-height:1.7\">Thí sinh có thể tra cứu chi tiết tại <a href=\"https://exam.skyfirst.io.vn/tra-cuu-ket-qua\" style=\"color:#0866c6;font-weight:600\">Trang Tra cứu kết quả thi (/tra-cuu-ket-qua)</a> hoặc gửi yêu cầu xem xét lại tại <a href=\"https://exam.skyfirst.io.vn/phuc-khao\" style=\"color:#0866c6;font-weight:600\">Trang Phúc khảo (/phuc-khao)</a>.</p>\n              <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:16px 0\">\n                <tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Kỳ thi:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{exam_title}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã thí sinh:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{candidate_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã biên nhận bài thi:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{request_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Trạng thái công bố:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{status}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Thời điểm công bố:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{event_time}}</td></tr>\n              </table>\n              <div style=\"font-size:14px;line-height:1.75;margin-top:16px;padding:14px 16px;background:#f9fbfd;border:1px solid #e5edf5;border-radius:8px;white-space:pre-line;color:#1e293b\">{{message}}</div>\n              <p style=\"font-size:13px;line-height:1.7;margin-top:18px;color:#475569\">\n                Cổng thông tin chính thức: <a href=\"https://exam.skyfirst.io.vn/\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn</a> |\n                Tra cứu kết quả: <a href=\"https://exam.skyfirst.io.vn/tra-cuu-ket-qua\" style=\"color:#0866c6\">/tra-cuu-ket-qua</a> |\n                Hỗ trợ: <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0866c6\">/ho-tro</a>\n              </p>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:16px 28px;background:#f8fafc;border-top:1px solid #e4ebf3;color:#52677b;font-size:12px;line-height:1.65\">\n              <strong>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First</strong><br>\n              Hộp thư Nghiệp vụ Khảo thí & Phúc khảo chính thức (exam@skyfirst.io.vn).<br>\n              Địa chỉ gửi định danh: <strong>exam@skyfirst.io.vn</strong>\n            </td>\n          </tr>\n        </table>\n      </td>\n    </tr>\n  </table>\n</body>\n</html>\n",
  "appeal_received": "<!doctype html>\n<html lang=\"vi\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n  <meta name=\"x-skyfirst-template\" content=\"appeal-received.html\">\n  <title>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First · Xác Nhận Tiếp Nhận Đơn Phúc Khảo Kết Quả Thi</title>\n</head>\n<body style=\"margin:0;padding:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#18324b\">\n  <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f3f6fa;padding:26px 10px\">\n    <tr>\n      <td align=\"center\">\n        <table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:600px;width:100%;background:#ffffff;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden\">\n          <tr>\n            <td style=\"padding:22px 28px;background:#1e3a5f;color:#ffffff\">\n              <div style=\"font-size:11px;letter-spacing:0.8px;text-transform:uppercase;opacity:0.92\">MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST</div>\n              <div style=\"font-size:13px;line-height:1.5;margin-top:2px\">Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First</div>\n              <div style=\"font-size:19px;font-weight:700;line-height:1.35;margin-top:6px\">HỆ THỐNG KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST</div>\n              <div style=\"font-size:12px;opacity:0.9;margin-top:2px\">Hệ Thống Khảo Thí Và Đánh Giá Sky First · Mã mẫu: appeal-received.html</div>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:26px 28px\">\n              <div style=\"display:inline-block;padding:4px 10px;background:#eef2f6;color:#1e3a5f;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:12px\">NGHIỆP VỤ KHẢO THÍ · PHÚC KHẢO</div>\n              <p style=\"font-size:14px;line-height:1.7;margin:0 0 10px\">Kính gửi <strong>{{recipient_name}}</strong>,</p>\n              <h1 style=\"font-size:21px;line-height:1.35;color:#12385b;margin:0 0 12px\">Xác Nhận Tiếp Nhận Đơn Phúc Khảo Kết Quả Thi</h1>\n              <p style=\"font-size:14px;line-height:1.75;color:#2c445e;margin:0 0 16px\">Hệ thống đã ghi nhận hồ sơ đề nghị phúc khảo kết quả bài thi của bạn và chuyển tới Ban Phúc khảo để thẩm định theo quy chế.</p>\n              <div style=\"background:#f8fafc;border-left:4px solid #0866c6;padding:12px 16px;margin:14px 0;font-size:13px;line-height:1.7\">\n      Vui lòng lưu giữ <strong>Mã hồ sơ phúc khảo ({{request_code}})</strong> để tra cứu tiến độ giải quyết tại đường dẫn <a href=\"https://exam.skyfirst.io.vn/phuc-khao\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn/phuc-khao</a>.\n    </div>\n              <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:16px 0\">\n                <tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã hồ sơ phúc khảo:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{request_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Kỳ thi đề nghị phúc khảo:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{exam_title}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã thí sinh:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{candidate_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Trạng thái xử lý:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{status}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Thời gian tiếp nhận:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{event_time}}</td></tr>\n              </table>\n              <div style=\"font-size:14px;line-height:1.75;margin-top:16px;padding:14px 16px;background:#f9fbfd;border:1px solid #e5edf5;border-radius:8px;white-space:pre-line;color:#1e293b\">{{message}}</div>\n              <p style=\"font-size:13px;line-height:1.7;margin-top:18px;color:#475569\">\n                Cổng thông tin chính thức: <a href=\"https://exam.skyfirst.io.vn/\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn</a> |\n                Tra cứu kết quả: <a href=\"https://exam.skyfirst.io.vn/tra-cuu-ket-qua\" style=\"color:#0866c6\">/tra-cuu-ket-qua</a> |\n                Hỗ trợ: <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0866c6\">/ho-tro</a>\n              </p>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:16px 28px;background:#f8fafc;border-top:1px solid #e4ebf3;color:#52677b;font-size:12px;line-height:1.65\">\n              <strong>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First</strong><br>\n              Hộp thư Nghiệp vụ Khảo thí & Phúc khảo chính thức (exam@skyfirst.io.vn).<br>\n              Địa chỉ gửi định danh: <strong>exam@skyfirst.io.vn</strong>\n            </td>\n          </tr>\n        </table>\n      </td>\n    </tr>\n  </table>\n</body>\n</html>\n",
  "appeal_update": "<!doctype html>\n<html lang=\"vi\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n  <meta name=\"x-skyfirst-template\" content=\"appeal-update.html\">\n  <title>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First · Thông Báo Cập Nhật Tiến Độ Thẩm Định Phúc Khảo</title>\n</head>\n<body style=\"margin:0;padding:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#18324b\">\n  <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f3f6fa;padding:26px 10px\">\n    <tr>\n      <td align=\"center\">\n        <table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:600px;width:100%;background:#ffffff;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden\">\n          <tr>\n            <td style=\"padding:22px 28px;background:#1e3a5f;color:#ffffff\">\n              <div style=\"font-size:11px;letter-spacing:0.8px;text-transform:uppercase;opacity:0.92\">MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST</div>\n              <div style=\"font-size:13px;line-height:1.5;margin-top:2px\">Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First</div>\n              <div style=\"font-size:19px;font-weight:700;line-height:1.35;margin-top:6px\">HỆ THỐNG KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST</div>\n              <div style=\"font-size:12px;opacity:0.9;margin-top:2px\">Hệ Thống Khảo Thí Và Đánh Giá Sky First · Mã mẫu: appeal-update.html</div>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:26px 28px\">\n              <div style=\"display:inline-block;padding:4px 10px;background:#eef2f6;color:#1e3a5f;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:12px\">NGHIỆP VỤ KHẢO THÍ · CẬP NHẬT PHÚC KHẢO</div>\n              <p style=\"font-size:14px;line-height:1.7;margin:0 0 10px\">Kính gửi <strong>{{recipient_name}}</strong>,</p>\n              <h1 style=\"font-size:21px;line-height:1.35;color:#12385b;margin:0 0 12px\">Thông Báo Cập Nhật Tiến Độ Thẩm Định Phúc Khảo</h1>\n              <p style=\"font-size:14px;line-height:1.75;color:#2c445e;margin:0 0 16px\">Hồ sơ đề nghị phúc khảo kết quả thi của bạn vừa được cán bộ chuyên trách cập nhật trạng thái xử lý mới.</p>\n              <p style=\"font-size:13px;color:#334155\">Bạn có thể theo dõi chi tiết hoặc bổ sung minh chứng (nếu được yêu cầu) tại <a href=\"https://exam.skyfirst.io.vn/phuc-khao\" style=\"color:#0866c6\">Trang Phúc khảo (/phuc-khao)</a>.</p>\n              <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:16px 0\">\n                <tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã hồ sơ phúc khảo:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{request_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Kỳ thi:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{exam_title}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã thí sinh:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{candidate_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Trạng thái hiện tại:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{status}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Thời điểm cập nhật:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{event_time}}</td></tr>\n              </table>\n              <div style=\"font-size:14px;line-height:1.75;margin-top:16px;padding:14px 16px;background:#f9fbfd;border:1px solid #e5edf5;border-radius:8px;white-space:pre-line;color:#1e293b\">{{message}}</div>\n              <p style=\"font-size:13px;line-height:1.7;margin-top:18px;color:#475569\">\n                Cổng thông tin chính thức: <a href=\"https://exam.skyfirst.io.vn/\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn</a> |\n                Tra cứu kết quả: <a href=\"https://exam.skyfirst.io.vn/tra-cuu-ket-qua\" style=\"color:#0866c6\">/tra-cuu-ket-qua</a> |\n                Hỗ trợ: <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0866c6\">/ho-tro</a>\n              </p>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:16px 28px;background:#f8fafc;border-top:1px solid #e4ebf3;color:#52677b;font-size:12px;line-height:1.65\">\n              <strong>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First</strong><br>\n              Hộp thư Nghiệp vụ Khảo thí & Phúc khảo chính thức (exam@skyfirst.io.vn).<br>\n              Địa chỉ gửi định danh: <strong>exam@skyfirst.io.vn</strong>\n            </td>\n          </tr>\n        </table>\n      </td>\n    </tr>\n  </table>\n</body>\n</html>\n",
  "appeal_result": "<!doctype html>\n<html lang=\"vi\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n  <meta name=\"x-skyfirst-template\" content=\"appeal-result.html\">\n  <title>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First · Quyết Định Giải Quyết Phúc Khảo Bài Thi</title>\n</head>\n<body style=\"margin:0;padding:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#18324b\">\n  <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f3f6fa;padding:26px 10px\">\n    <tr>\n      <td align=\"center\">\n        <table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:600px;width:100%;background:#ffffff;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden\">\n          <tr>\n            <td style=\"padding:22px 28px;background:#0f5132;color:#ffffff\">\n              <div style=\"font-size:11px;letter-spacing:0.8px;text-transform:uppercase;opacity:0.92\">MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST</div>\n              <div style=\"font-size:13px;line-height:1.5;margin-top:2px\">Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First</div>\n              <div style=\"font-size:19px;font-weight:700;line-height:1.35;margin-top:6px\">HỆ THỐNG KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST</div>\n              <div style=\"font-size:12px;opacity:0.9;margin-top:2px\">Hệ Thống Khảo Thí Và Đánh Giá Sky First · Mã mẫu: appeal-result.html</div>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:26px 28px\">\n              <div style=\"display:inline-block;padding:4px 10px;background:#eef2f6;color:#1e3a5f;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:12px\">NGHIỆP VỤ KHẢO THÍ · KẾT QUẢ PHÚC KHẢO</div>\n              <p style=\"font-size:14px;line-height:1.7;margin:0 0 10px\">Kính gửi <strong>{{recipient_name}}</strong>,</p>\n              <h1 style=\"font-size:21px;line-height:1.35;color:#12385b;margin:0 0 12px\">Quyết Định Giải Quyết Phúc Khảo Bài Thi</h1>\n              <p style=\"font-size:14px;line-height:1.75;color:#2c445e;margin:0 0 16px\">Hội đồng phúc khảo đã hoàn tất việc chấm thẩm định và công bố kết luận chính thức đối với đơn phúc khảo của bạn.</p>\n              <div style=\"background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 18px;margin:14px 0;font-size:14px\">\n      <strong>Kết quả điểm sau phúc khảo:</strong> {{score_display}}\n    </div>\n              <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:16px 0\">\n                <tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã hồ sơ phúc khảo:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{request_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Kỳ thi:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{exam_title}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã thí sinh:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{candidate_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Trạng thái kết luận:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{status}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Thời điểm ban hành:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{event_time}}</td></tr>\n              </table>\n              <div style=\"font-size:14px;line-height:1.75;margin-top:16px;padding:14px 16px;background:#f9fbfd;border:1px solid #e5edf5;border-radius:8px;white-space:pre-line;color:#1e293b\">{{message}}</div>\n              <p style=\"font-size:13px;line-height:1.7;margin-top:18px;color:#475569\">\n                Cổng thông tin chính thức: <a href=\"https://exam.skyfirst.io.vn/\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn</a> |\n                Tra cứu kết quả: <a href=\"https://exam.skyfirst.io.vn/tra-cuu-ket-qua\" style=\"color:#0866c6\">/tra-cuu-ket-qua</a> |\n                Hỗ trợ: <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0866c6\">/ho-tro</a>\n              </p>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:16px 28px;background:#f8fafc;border-top:1px solid #e4ebf3;color:#52677b;font-size:12px;line-height:1.65\">\n              <strong>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First</strong><br>\n              Hộp thư Nghiệp vụ Khảo thí & Phúc khảo chính thức (exam@skyfirst.io.vn).<br>\n              Địa chỉ gửi định danh: <strong>exam@skyfirst.io.vn</strong>\n            </td>\n          </tr>\n        </table>\n      </td>\n    </tr>\n  </table>\n</body>\n</html>\n",
  "exam_announcement": "<!doctype html>\n<html lang=\"vi\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n  <meta name=\"x-skyfirst-template\" content=\"exam-announcement.html\">\n  <title>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First · Thông Báo Lịch Thi & Hướng Dẫn Tham Gia Kỳ Thi</title>\n</head>\n<body style=\"margin:0;padding:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#18324b\">\n  <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f3f6fa;padding:26px 10px\">\n    <tr>\n      <td align=\"center\">\n        <table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:600px;width:100%;background:#ffffff;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden\">\n          <tr>\n            <td style=\"padding:22px 28px;background:#0d2a4a;color:#ffffff\">\n              <div style=\"font-size:11px;letter-spacing:0.8px;text-transform:uppercase;opacity:0.92\">MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST</div>\n              <div style=\"font-size:13px;line-height:1.5;margin-top:2px\">Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First</div>\n              <div style=\"font-size:19px;font-weight:700;line-height:1.35;margin-top:6px\">HỆ THỐNG KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST</div>\n              <div style=\"font-size:12px;opacity:0.9;margin-top:2px\">Hệ Thống Khảo Thí Và Đánh Giá Sky First · Mã mẫu: exam-announcement.html</div>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:26px 28px\">\n              <div style=\"display:inline-block;padding:4px 10px;background:#eef2f6;color:#1e3a5f;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:12px\">NGHIỆP VỤ KHẢO THÍ · THÔNG BÁO KỲ THI</div>\n              <p style=\"font-size:14px;line-height:1.7;margin:0 0 10px\">Kính gửi <strong>{{recipient_name}}</strong>,</p>\n              <h1 style=\"font-size:21px;line-height:1.35;color:#12385b;margin:0 0 12px\">Thông Báo Lịch Thi & Hướng Dẫn Tham Gia Kỳ Thi</h1>\n              <p style=\"font-size:14px;line-height:1.75;color:#2c445e;margin:0 0 16px\">Ban tổ chức gửi tới bạn thông tin chính thức về lịch thi, mã truy cập kỳ thi và các yêu cầu chuẩn bị thiết bị trước giờ dự thi.</p>\n              <div style=\"background:#f1f5f9;border-radius:8px;padding:14px 18px;margin:14px 0;font-size:13px;line-height:1.7\">\n      <strong>Hướng dẫn trước giờ thi:</strong> Thí sinh vui lòng kiểm tra kết nối mạng, trình duyệt hỗ trợ chế độ toàn màn hình và truy cập <a href=\"https://exam.skyfirst.io.vn/\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn/</a> trước giờ mở đề ít nhất 15 phút.\n    </div>\n              <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:16px 0\">\n                <tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Kỳ thi / Đợt đánh giá:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{exam_title}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã thí sinh / Mã dự thi:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{candidate_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã thông báo / Tham chiếu:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{request_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Trạng thái kỳ thi:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{status}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Thời gian áp dụng:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{event_time}}</td></tr>\n              </table>\n              <div style=\"font-size:14px;line-height:1.75;margin-top:16px;padding:14px 16px;background:#f9fbfd;border:1px solid #e5edf5;border-radius:8px;white-space:pre-line;color:#1e293b\">{{message}}</div>\n              <p style=\"font-size:13px;line-height:1.7;margin-top:18px;color:#475569\">\n                Cổng thông tin chính thức: <a href=\"https://exam.skyfirst.io.vn/\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn</a> |\n                Tra cứu kết quả: <a href=\"https://exam.skyfirst.io.vn/tra-cuu-ket-qua\" style=\"color:#0866c6\">/tra-cuu-ket-qua</a> |\n                Hỗ trợ: <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0866c6\">/ho-tro</a>\n              </p>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:16px 28px;background:#f8fafc;border-top:1px solid #e4ebf3;color:#52677b;font-size:12px;line-height:1.65\">\n              <strong>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First</strong><br>\n              Hộp thư Nghiệp vụ Khảo thí & Phúc khảo chính thức (exam@skyfirst.io.vn).<br>\n              Địa chỉ gửi định danh: <strong>exam@skyfirst.io.vn</strong>\n            </td>\n          </tr>\n        </table>\n      </td>\n    </tr>\n  </table>\n</body>\n</html>\n",
  "exam_entry": "<!doctype html>\n<html lang=\"vi\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n  <meta name=\"x-skyfirst-template\" content=\"exam-entry.html\">\n  <title>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First · Ghi Nhận Bắt Đầu Phiên Làm Bài Thi Trực Tuyến</title>\n</head>\n<body style=\"margin:0;padding:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#18324b\">\n  <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f3f6fa;padding:26px 10px\">\n    <tr>\n      <td align=\"center\">\n        <table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:600px;width:100%;background:#ffffff;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden\">\n          <tr>\n            <td style=\"padding:22px 28px;background:#0d2a4a;color:#ffffff\">\n              <div style=\"font-size:11px;letter-spacing:0.8px;text-transform:uppercase;opacity:0.92\">MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST</div>\n              <div style=\"font-size:13px;line-height:1.5;margin-top:2px\">Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First</div>\n              <div style=\"font-size:19px;font-weight:700;line-height:1.35;margin-top:6px\">HỆ THỐNG KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST</div>\n              <div style=\"font-size:12px;opacity:0.9;margin-top:2px\">Hệ Thống Khảo Thí Và Đánh Giá Sky First · Mã mẫu: exam-entry.html</div>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:26px 28px\">\n              <div style=\"display:inline-block;padding:4px 10px;background:#eef2f6;color:#1e3a5f;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:12px\">GIÁM SÁT PHIÊN THI · NOREPLY</div>\n              <p style=\"font-size:14px;line-height:1.7;margin:0 0 10px\">Kính gửi <strong>{{recipient_name}}</strong>,</p>\n              <h1 style=\"font-size:21px;line-height:1.35;color:#12385b;margin:0 0 12px\">Ghi Nhận Bắt Đầu Phiên Làm Bài Thi Trực Tuyến</h1>\n              <p style=\"font-size:14px;line-height:1.75;color:#2c445e;margin:0 0 16px\">Hệ thống đã khởi tạo phiên làm bài riêng biệt và kích hoạt đồng hồ tính giờ phía máy chủ cho lượt dự thi của bạn.</p>\n              <p style=\"font-size:13px;color:#475569\">Trong suốt quá trình làm bài, hệ thống tự động lưu đáp án theo revision và ghi nhận các sự kiện tuân thủ quy chế phòng thi (không chụp ảnh hay quay video màn hình).</p>\n              <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:16px 0\">\n                <tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Kỳ thi:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{exam_title}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã thí sinh:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{candidate_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã phiên dự thi:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{request_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Trạng thái phiên:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{status}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Thời điểm bắt đầu (Server UTC):</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{event_time}}</td></tr>\n              </table>\n              <div style=\"font-size:14px;line-height:1.75;margin-top:16px;padding:14px 16px;background:#f9fbfd;border:1px solid #e5edf5;border-radius:8px;white-space:pre-line;color:#1e293b\">{{message}}</div>\n              <p style=\"font-size:13px;line-height:1.7;margin-top:18px;color:#475569\">\n                Cổng thông tin chính thức: <a href=\"https://exam.skyfirst.io.vn/\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn</a> |\n                Tra cứu kết quả: <a href=\"https://exam.skyfirst.io.vn/tra-cuu-ket-qua\" style=\"color:#0866c6\">/tra-cuu-ket-qua</a> |\n                Hỗ trợ: <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0866c6\">/ho-tro</a>\n              </p>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:16px 28px;background:#f8fafc;border-top:1px solid #e4ebf3;color:#52677b;font-size:12px;line-height:1.65\">\n              <strong>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First</strong><br>\n              Đây là email tự động từ hệ thống (noreply@skyfirst.io.vn). Vui lòng không trả lời trực tiếp thư này.<br>\n              Địa chỉ gửi định danh: <strong>noreply@skyfirst.io.vn</strong>\n            </td>\n          </tr>\n        </table>\n      </td>\n    </tr>\n  </table>\n</body>\n</html>\n",
  "exam_session_ended": "<!doctype html>\n<html lang=\"vi\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n  <meta name=\"x-skyfirst-template\" content=\"exam-session-ended.html\">\n  <title>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First · Xác Nhận Đã Nộp Bài Thi & Cấp Mã Biên Nhận</title>\n</head>\n<body style=\"margin:0;padding:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#18324b\">\n  <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f3f6fa;padding:26px 10px\">\n    <tr>\n      <td align=\"center\">\n        <table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:600px;width:100%;background:#ffffff;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden\">\n          <tr>\n            <td style=\"padding:22px 28px;background:#0f5132;color:#ffffff\">\n              <div style=\"font-size:11px;letter-spacing:0.8px;text-transform:uppercase;opacity:0.92\">MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST</div>\n              <div style=\"font-size:13px;line-height:1.5;margin-top:2px\">Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First</div>\n              <div style=\"font-size:19px;font-weight:700;line-height:1.35;margin-top:6px\">HỆ THỐNG KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST</div>\n              <div style=\"font-size:12px;opacity:0.9;margin-top:2px\">Hệ Thống Khảo Thí Và Đánh Giá Sky First · Mã mẫu: exam-session-ended.html</div>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:26px 28px\">\n              <div style=\"display:inline-block;padding:4px 10px;background:#eef2f6;color:#1e3a5f;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:12px\">BIÊN NHẬN NỘP BÀI · NOREPLY</div>\n              <p style=\"font-size:14px;line-height:1.7;margin:0 0 10px\">Kính gửi <strong>{{recipient_name}}</strong>,</p>\n              <h1 style=\"font-size:21px;line-height:1.35;color:#12385b;margin:0 0 12px\">Xác Nhận Đã Nộp Bài Thi & Cấp Mã Biên Nhận</h1>\n              <p style=\"font-size:14px;line-height:1.75;color:#2c445e;margin:0 0 16px\">Máy chủ khảo thí đã xác nhận lưu trữ an toàn bài làm của bạn và cấp mã biên nhận điện tử để đối chiếu, tra cứu kết quả.</p>\n              <div style=\"background:#ecfdf5;border:1px solid #6ee7b7;border-radius:8px;padding:14px 18px;margin:14px 0;text-align:center\">\n      <div style=\"font-size:12px;color:#065f46;text-transform:uppercase\">Mã biên nhận nộp bài chính thức</div>\n      <div style=\"font-size:22px;font-weight:700;color:#064e3b;margin-top:4px\">{{request_code}}</div>\n    </div>\n    <p style=\"font-size:13px;line-height:1.6\">Hãy lưu giữ Mã biên nhận này cùng Mã thí sinh để tra cứu điểm tại <a href=\"https://exam.skyfirst.io.vn/tra-cuu-ket-qua\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn/tra-cuu-ket-qua</a>.</p>\n              <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:16px 0\">\n                <tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Kỳ thi:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{exam_title}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã thí sinh:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{candidate_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã biên nhận:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{request_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Trạng thái bài làm:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{status}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Thời điểm nộp bài:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{event_time}}</td></tr>\n              </table>\n              <div style=\"font-size:14px;line-height:1.75;margin-top:16px;padding:14px 16px;background:#f9fbfd;border:1px solid #e5edf5;border-radius:8px;white-space:pre-line;color:#1e293b\">{{message}}</div>\n              <p style=\"font-size:13px;line-height:1.7;margin-top:18px;color:#475569\">\n                Cổng thông tin chính thức: <a href=\"https://exam.skyfirst.io.vn/\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn</a> |\n                Tra cứu kết quả: <a href=\"https://exam.skyfirst.io.vn/tra-cuu-ket-qua\" style=\"color:#0866c6\">/tra-cuu-ket-qua</a> |\n                Hỗ trợ: <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0866c6\">/ho-tro</a>\n              </p>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:16px 28px;background:#f8fafc;border-top:1px solid #e4ebf3;color:#52677b;font-size:12px;line-height:1.65\">\n              <strong>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First</strong><br>\n              Đây là email tự động từ hệ thống (noreply@skyfirst.io.vn). Vui lòng không trả lời trực tiếp thư này.<br>\n              Địa chỉ gửi định danh: <strong>noreply@skyfirst.io.vn</strong>\n            </td>\n          </tr>\n        </table>\n      </td>\n    </tr>\n  </table>\n</body>\n</html>\n",
  "exam_session_cancelled": "<!doctype html>\n<html lang=\"vi\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n  <meta name=\"x-skyfirst-template\" content=\"exam-session-cancelled.html\">\n  <title>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First · Thông Báo Hủy Phiên Thi / Thu Hồi Trạng Thái</title>\n</head>\n<body style=\"margin:0;padding:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#18324b\">\n  <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f3f6fa;padding:26px 10px\">\n    <tr>\n      <td align=\"center\">\n        <table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:600px;width:100%;background:#ffffff;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden\">\n          <tr>\n            <td style=\"padding:22px 28px;background:#991b1b;color:#ffffff\">\n              <div style=\"font-size:11px;letter-spacing:0.8px;text-transform:uppercase;opacity:0.92\">MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST</div>\n              <div style=\"font-size:13px;line-height:1.5;margin-top:2px\">Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First</div>\n              <div style=\"font-size:19px;font-weight:700;line-height:1.35;margin-top:6px\">HỆ THỐNG KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST</div>\n              <div style=\"font-size:12px;opacity:0.9;margin-top:2px\">Hệ Thống Khảo Thí Và Đánh Giá Sky First · Mã mẫu: exam-session-cancelled.html</div>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:26px 28px\">\n              <div style=\"display:inline-block;padding:4px 10px;background:#eef2f6;color:#1e3a5f;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:12px\">QUẢN LÝ PHIÊN THI · NOREPLY</div>\n              <p style=\"font-size:14px;line-height:1.7;margin:0 0 10px\">Kính gửi <strong>{{recipient_name}}</strong>,</p>\n              <h1 style=\"font-size:21px;line-height:1.35;color:#12385b;margin:0 0 12px\">Thông Báo Hủy Phiên Thi / Thu Hồi Trạng Thái</h1>\n              <p style=\"font-size:14px;line-height:1.75;color:#2c445e;margin:0 0 16px\">Hệ thống ghi nhận phiên dự thi hoặc trạng thái kết quả liên quan đã được tạm dừng, hủy hoặc thu hồi để rà soát theo quy định.</p>\n              <p style=\"font-size:13px;color:#7f1d1d\">Nếu bạn cần làm rõ nguyên nhân hoặc đăng ký lịch thi bổ sung, vui lòng liên hệ thông qua trang <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0866c6\">Hỗ trợ thí sinh (/ho-tro)</a>.</p>\n              <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:16px 0\">\n                <tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Kỳ thi:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{exam_title}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã thí sinh:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{candidate_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã phiên / Mã tham chiếu:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{request_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Trạng thái cập nhật:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{status}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Thời điểm ghi nhận:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{event_time}}</td></tr>\n              </table>\n              <div style=\"font-size:14px;line-height:1.75;margin-top:16px;padding:14px 16px;background:#f9fbfd;border:1px solid #e5edf5;border-radius:8px;white-space:pre-line;color:#1e293b\">{{message}}</div>\n              <p style=\"font-size:13px;line-height:1.7;margin-top:18px;color:#475569\">\n                Cổng thông tin chính thức: <a href=\"https://exam.skyfirst.io.vn/\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn</a> |\n                Tra cứu kết quả: <a href=\"https://exam.skyfirst.io.vn/tra-cuu-ket-qua\" style=\"color:#0866c6\">/tra-cuu-ket-qua</a> |\n                Hỗ trợ: <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0866c6\">/ho-tro</a>\n              </p>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:16px 28px;background:#f8fafc;border-top:1px solid #e4ebf3;color:#52677b;font-size:12px;line-height:1.65\">\n              <strong>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First</strong><br>\n              Đây là email tự động từ hệ thống (noreply@skyfirst.io.vn). Vui lòng không trả lời trực tiếp thư này.<br>\n              Địa chỉ gửi định danh: <strong>noreply@skyfirst.io.vn</strong>\n            </td>\n          </tr>\n        </table>\n      </td>\n    </tr>\n  </table>\n</body>\n</html>\n",
  "integrity_warning": "<!doctype html>\n<html lang=\"vi\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n  <meta name=\"x-skyfirst-template\" content=\"integrity-warning.html\">\n  <title>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First · Ghi Nhận Cảnh Báo Tín Hiệu Giám Sát Phòng Thi</title>\n</head>\n<body style=\"margin:0;padding:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#18324b\">\n  <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f3f6fa;padding:26px 10px\">\n    <tr>\n      <td align=\"center\">\n        <table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:600px;width:100%;background:#ffffff;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden\">\n          <tr>\n            <td style=\"padding:22px 28px;background:#b45309;color:#ffffff\">\n              <div style=\"font-size:11px;letter-spacing:0.8px;text-transform:uppercase;opacity:0.92\">MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST</div>\n              <div style=\"font-size:13px;line-height:1.5;margin-top:2px\">Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First</div>\n              <div style=\"font-size:19px;font-weight:700;line-height:1.35;margin-top:6px\">HỆ THỐNG KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST</div>\n              <div style=\"font-size:12px;opacity:0.9;margin-top:2px\">Hệ Thống Khảo Thí Và Đánh Giá Sky First · Mã mẫu: integrity-warning.html</div>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:26px 28px\">\n              <div style=\"display:inline-block;padding:4px 10px;background:#eef2f6;color:#1e3a5f;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:12px\">AN NINH KHẢO THÍ · NOREPLY</div>\n              <p style=\"font-size:14px;line-height:1.7;margin:0 0 10px\">Kính gửi <strong>{{recipient_name}}</strong>,</p>\n              <h1 style=\"font-size:21px;line-height:1.35;color:#12385b;margin:0 0 12px\">Ghi Nhận Cảnh Báo Tín Hiệu Giám Sát Phòng Thi</h1>\n              <p style=\"font-size:14px;line-height:1.75;color:#2c445e;margin:0 0 16px\">Hệ thống bảo mật kỳ thi vừa ghi nhận tín hiệu bất thường trên trình duyệt dự thi của bạn vượt ngưỡng cảnh báo cấu hình.</p>\n              <div style=\"background:#fffbeb;border-left:4px solid #f59e0b;padding:12px 16px;margin:14px 0;font-size:13px;line-height:1.6;color:#78350f\">\n      <strong>Lưu ý quan trọng:</strong> Cảnh báo kỹ thuật này được ghi vào nhật ký để cán bộ coi thi xem xét và <strong>không tự động đồng nghĩa với kết luận gian lận</strong>. Nếu do sự cố khách quan (mất mạng, thông báo hệ điều hành), bạn có thể gửi giải trình hoặc báo ngay tại <a href=\"https://exam.skyfirst.io.vn/su-co-khan-cap\" style=\"color:#b45309;font-weight:700\">/su-co-khan-cap</a>.\n    </div>\n              <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:16px 0\">\n                <tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Kỳ thi:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{exam_title}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã thí sinh:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{candidate_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã phiên dự thi:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{request_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mức phân loại tín hiệu:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{status}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Thời điểm phát hiện:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{event_time}}</td></tr>\n              </table>\n              <div style=\"font-size:14px;line-height:1.75;margin-top:16px;padding:14px 16px;background:#f9fbfd;border:1px solid #e5edf5;border-radius:8px;white-space:pre-line;color:#1e293b\">{{message}}</div>\n              <p style=\"font-size:13px;line-height:1.7;margin-top:18px;color:#475569\">\n                Cổng thông tin chính thức: <a href=\"https://exam.skyfirst.io.vn/\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn</a> |\n                Tra cứu kết quả: <a href=\"https://exam.skyfirst.io.vn/tra-cuu-ket-qua\" style=\"color:#0866c6\">/tra-cuu-ket-qua</a> |\n                Hỗ trợ: <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0866c6\">/ho-tro</a>\n              </p>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:16px 28px;background:#f8fafc;border-top:1px solid #e4ebf3;color:#52677b;font-size:12px;line-height:1.65\">\n              <strong>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First</strong><br>\n              Đây là email tự động từ hệ thống (noreply@skyfirst.io.vn). Vui lòng không trả lời trực tiếp thư này.<br>\n              Địa chỉ gửi định danh: <strong>noreply@skyfirst.io.vn</strong>\n            </td>\n          </tr>\n        </table>\n      </td>\n    </tr>\n  </table>\n</body>\n</html>\n",
  "fraud_report": "<!doctype html>\n<html lang=\"vi\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n  <meta name=\"x-skyfirst-template\" content=\"fraud-report.html\">\n  <title>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First · Xác Nhận Tiếp Nhận Phản Ánh Vi Phạm Quy Chế Thi</title>\n</head>\n<body style=\"margin:0;padding:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#18324b\">\n  <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f3f6fa;padding:26px 10px\">\n    <tr>\n      <td align=\"center\">\n        <table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:600px;width:100%;background:#ffffff;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden\">\n          <tr>\n            <td style=\"padding:22px 28px;background:#312e81;color:#ffffff\">\n              <div style=\"font-size:11px;letter-spacing:0.8px;text-transform:uppercase;opacity:0.92\">MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST</div>\n              <div style=\"font-size:13px;line-height:1.5;margin-top:2px\">Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First</div>\n              <div style=\"font-size:19px;font-weight:700;line-height:1.35;margin-top:6px\">HỆ THỐNG KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST</div>\n              <div style=\"font-size:12px;opacity:0.9;margin-top:2px\">Hệ Thống Khảo Thí Và Đánh Giá Sky First · Mã mẫu: fraud-report.html</div>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:26px 28px\">\n              <div style=\"display:inline-block;padding:4px 10px;background:#eef2f6;color:#1e3a5f;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:12px\">BẢO MẬT TỐ CÁO · NOREPLY</div>\n              <p style=\"font-size:14px;line-height:1.7;margin:0 0 10px\">Kính gửi <strong>{{recipient_name}}</strong>,</p>\n              <h1 style=\"font-size:21px;line-height:1.35;color:#12385b;margin:0 0 12px\">Xác Nhận Tiếp Nhận Phản Ánh Vi Phạm Quy Chế Thi</h1>\n              <p style=\"font-size:14px;line-height:1.75;color:#2c445e;margin:0 0 16px\">Hệ thống đã tiếp nhận hồ sơ phản ánh dấu hiệu gian lận hoặc vi phạm quy chế khảo thí và lưu trữ theo chế độ bảo mật nghiêm ngặt.</p>\n              <div style=\"background:#eef2ff;border-left:4px solid #4338ca;padding:12px 16px;margin:14px 0;font-size:13px;line-height:1.6;color:#1e1b4b\">\n      <strong>Cam kết bảo vệ người gửi:</strong> Để bảo mật tuyệt đối danh tính người phản ánh và tính toàn vẹn của hồ sơ xác minh, thư tự động này không đính kèm lại nội dung chi tiết vụ việc hay tệp bằng chứng nhạy cảm. Chỉ cán bộ được phân quyền thẩm tra mới có quyền truy cập hồ sơ có kiểm toán.\n    </div>\n              <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:16px 0\">\n                <tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã hồ sơ bảo mật:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{request_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Kỳ thi liên quan:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{exam_title}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Trạng thái hồ sơ:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{status}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Thời điểm tiếp nhận:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{event_time}}</td></tr>\n              </table>\n              <div style=\"font-size:14px;line-height:1.75;margin-top:16px;padding:14px 16px;background:#f9fbfd;border:1px solid #e5edf5;border-radius:8px;white-space:pre-line;color:#1e293b\">{{message}}</div>\n              <p style=\"font-size:13px;line-height:1.7;margin-top:18px;color:#475569\">\n                Cổng thông tin chính thức: <a href=\"https://exam.skyfirst.io.vn/\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn</a> |\n                Tra cứu kết quả: <a href=\"https://exam.skyfirst.io.vn/tra-cuu-ket-qua\" style=\"color:#0866c6\">/tra-cuu-ket-qua</a> |\n                Hỗ trợ: <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0866c6\">/ho-tro</a>\n              </p>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:16px 28px;background:#f8fafc;border-top:1px solid #e4ebf3;color:#52677b;font-size:12px;line-height:1.65\">\n              <strong>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First</strong><br>\n              Đây là email tự động từ hệ thống (noreply@skyfirst.io.vn). Vui lòng không trả lời trực tiếp thư này.<br>\n              Địa chỉ gửi định danh: <strong>noreply@skyfirst.io.vn</strong>\n            </td>\n          </tr>\n        </table>\n      </td>\n    </tr>\n  </table>\n</body>\n</html>\n",
  "exam_ban_notice": "<!doctype html>\n<html lang=\"vi\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n  <meta name=\"x-skyfirst-template\" content=\"exam-ban-notice.html\">\n  <title>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First · Thông Báo Quyết Định Xử Lý Vi Phạm Quy Chế Khảo Thí</title>\n</head>\n<body style=\"margin:0;padding:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#18324b\">\n  <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f3f6fa;padding:26px 10px\">\n    <tr>\n      <td align=\"center\">\n        <table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:600px;width:100%;background:#ffffff;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden\">\n          <tr>\n            <td style=\"padding:22px 28px;background:#7f1d1d;color:#ffffff\">\n              <div style=\"font-size:11px;letter-spacing:0.8px;text-transform:uppercase;opacity:0.92\">MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST</div>\n              <div style=\"font-size:13px;line-height:1.5;margin-top:2px\">Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First</div>\n              <div style=\"font-size:19px;font-weight:700;line-height:1.35;margin-top:6px\">HỆ THỐNG KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST</div>\n              <div style=\"font-size:12px;opacity:0.9;margin-top:2px\">Hệ Thống Khảo Thí Và Đánh Giá Sky First · Mã mẫu: exam-ban-notice.html</div>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:26px 28px\">\n              <div style=\"display:inline-block;padding:4px 10px;background:#eef2f6;color:#1e3a5f;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:12px\">HỘI ĐỒNG KỶ LUẬT · NOREPLY</div>\n              <p style=\"font-size:14px;line-height:1.7;margin:0 0 10px\">Kính gửi <strong>{{recipient_name}}</strong>,</p>\n              <h1 style=\"font-size:21px;line-height:1.35;color:#12385b;margin:0 0 12px\">Thông Báo Quyết Định Xử Lý Vi Phạm Quy Chế Khảo Thí</h1>\n              <p style=\"font-size:14px;line-height:1.75;color:#2c445e;margin:0 0 16px\">Sau khi cán bộ có thẩm quyền rà soát biên bản và nhật ký kỳ thi, Hội đồng khảo thí thông báo quyết định xử lý theo quy chế.</p>\n              <p style=\"font-size:13px;color:#475569\">Thí sinh có quyền gửi văn bản giải trình hoặc đề nghị xem xét lại quyết định xử lý thông qua trang <a href=\"https://exam.skyfirst.io.vn/phuc-khao\" style=\"color:#0866c6\">Phúc khảo & Khiếu nại (/phuc-khao)</a> trong thời hạn quy định.</p>\n              <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:16px 0\">\n                <tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Kỳ thi:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{exam_title}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã thí sinh:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{candidate_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã biên bản / Hồ sơ:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{request_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Hình thức xử lý:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{status}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Thời điểm ban hành:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{event_time}}</td></tr>\n              </table>\n              <div style=\"font-size:14px;line-height:1.75;margin-top:16px;padding:14px 16px;background:#f9fbfd;border:1px solid #e5edf5;border-radius:8px;white-space:pre-line;color:#1e293b\">{{message}}</div>\n              <p style=\"font-size:13px;line-height:1.7;margin-top:18px;color:#475569\">\n                Cổng thông tin chính thức: <a href=\"https://exam.skyfirst.io.vn/\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn</a> |\n                Tra cứu kết quả: <a href=\"https://exam.skyfirst.io.vn/tra-cuu-ket-qua\" style=\"color:#0866c6\">/tra-cuu-ket-qua</a> |\n                Hỗ trợ: <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0866c6\">/ho-tro</a>\n              </p>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:16px 28px;background:#f8fafc;border-top:1px solid #e4ebf3;color:#52677b;font-size:12px;line-height:1.65\">\n              <strong>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First</strong><br>\n              Đây là email tự động từ hệ thống (noreply@skyfirst.io.vn). Vui lòng không trả lời trực tiếp thư này.<br>\n              Địa chỉ gửi định danh: <strong>noreply@skyfirst.io.vn</strong>\n            </td>\n          </tr>\n        </table>\n      </td>\n    </tr>\n  </table>\n</body>\n</html>\n",
  "system_notification": "<!doctype html>\n<html lang=\"vi\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n  <meta name=\"x-skyfirst-template\" content=\"system-notification.html\">\n  <title>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First · Thông Báo Tự Động Về Tài Khoản & Hệ Thống Khảo Thí</title>\n</head>\n<body style=\"margin:0;padding:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#18324b\">\n  <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f3f6fa;padding:26px 10px\">\n    <tr>\n      <td align=\"center\">\n        <table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:600px;width:100%;background:#ffffff;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden\">\n          <tr>\n            <td style=\"padding:22px 28px;background:#0d2a4a;color:#ffffff\">\n              <div style=\"font-size:11px;letter-spacing:0.8px;text-transform:uppercase;opacity:0.92\">MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST</div>\n              <div style=\"font-size:13px;line-height:1.5;margin-top:2px\">Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First</div>\n              <div style=\"font-size:19px;font-weight:700;line-height:1.35;margin-top:6px\">HỆ THỐNG KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST</div>\n              <div style=\"font-size:12px;opacity:0.9;margin-top:2px\">Hệ Thống Khảo Thí Và Đánh Giá Sky First · Mã mẫu: system-notification.html</div>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:26px 28px\">\n              <div style=\"display:inline-block;padding:4px 10px;background:#eef2f6;color:#1e3a5f;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:12px\">HỆ THỐNG TỰ ĐỘNG · NOREPLY</div>\n              <p style=\"font-size:14px;line-height:1.7;margin:0 0 10px\">Kính gửi <strong>{{recipient_name}}</strong>,</p>\n              <h1 style=\"font-size:21px;line-height:1.35;color:#12385b;margin:0 0 12px\">Thông Báo Tự Động Về Tài Khoản & Hệ Thống Khảo Thí</h1>\n              <p style=\"font-size:14px;line-height:1.75;color:#2c445e;margin:0 0 16px\">Đây là thông báo quản trị tự động liên quan đến trạng thái tài khoản, phân quyền truy cập hoặc lịch bảo trì trên Hệ Thống Khảo Thí Và Đánh Giá Sky First.</p>\n              <p style=\"font-size:13px;color:#475569\">Nếu bạn nhận thấy thông tin thay đổi tài khoản không đúng với yêu cầu công tác, vui lòng liên hệ ngay Quản trị viên hệ thống.</p>\n              <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:16px 0\">\n                <tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Hạng mục thông báo:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{exam_title}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã định danh / Tài khoản:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{candidate_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã tham chiếu sự kiện:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{request_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Trạng thái áp dụng:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{status}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Thời điểm ghi nhận:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{event_time}}</td></tr>\n              </table>\n              <div style=\"font-size:14px;line-height:1.75;margin-top:16px;padding:14px 16px;background:#f9fbfd;border:1px solid #e5edf5;border-radius:8px;white-space:pre-line;color:#1e293b\">{{message}}</div>\n              <p style=\"font-size:13px;line-height:1.7;margin-top:18px;color:#475569\">\n                Cổng thông tin chính thức: <a href=\"https://exam.skyfirst.io.vn/\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn</a> |\n                Tra cứu kết quả: <a href=\"https://exam.skyfirst.io.vn/tra-cuu-ket-qua\" style=\"color:#0866c6\">/tra-cuu-ket-qua</a> |\n                Hỗ trợ: <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0866c6\">/ho-tro</a>\n              </p>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:16px 28px;background:#f8fafc;border-top:1px solid #e4ebf3;color:#52677b;font-size:12px;line-height:1.65\">\n              <strong>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First</strong><br>\n              Đây là email tự động từ hệ thống (noreply@skyfirst.io.vn). Vui lòng không trả lời trực tiếp thư này.<br>\n              Địa chỉ gửi định danh: <strong>noreply@skyfirst.io.vn</strong>\n            </td>\n          </tr>\n        </table>\n      </td>\n    </tr>\n  </table>\n</body>\n</html>\n",
  "support_request_received": "<!doctype html>\n<html lang=\"vi\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n  <meta name=\"x-skyfirst-template\" content=\"support-request-received.html\">\n  <title>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First · Đã Tiếp Nhận Yêu Cầu Hỗ Trợ Thí Sinh</title>\n</head>\n<body style=\"margin:0;padding:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#18324b\">\n  <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f3f6fa;padding:26px 10px\">\n    <tr>\n      <td align=\"center\">\n        <table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:600px;width:100%;background:#ffffff;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden\">\n          <tr>\n            <td style=\"padding:22px 28px;background:#0369a1;color:#ffffff\">\n              <div style=\"font-size:11px;letter-spacing:0.8px;text-transform:uppercase;opacity:0.92\">MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST</div>\n              <div style=\"font-size:13px;line-height:1.5;margin-top:2px\">Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First</div>\n              <div style=\"font-size:19px;font-weight:700;line-height:1.35;margin-top:6px\">HỆ THỐNG KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST</div>\n              <div style=\"font-size:12px;opacity:0.9;margin-top:2px\">Hệ Thống Khảo Thí Và Đánh Giá Sky First · Mã mẫu: support-request-received.html</div>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:26px 28px\">\n              <div style=\"display:inline-block;padding:4px 10px;background:#eef2f6;color:#1e3a5f;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:12px\">HỖ TRỢ THÍ SINH · SUPPORT</div>\n              <p style=\"font-size:14px;line-height:1.7;margin:0 0 10px\">Kính gửi <strong>{{recipient_name}}</strong>,</p>\n              <h1 style=\"font-size:21px;line-height:1.35;color:#12385b;margin:0 0 12px\">Đã Tiếp Nhận Yêu Cầu Hỗ Trợ Thí Sinh</h1>\n              <p style=\"font-size:14px;line-height:1.75;color:#2c445e;margin:0 0 16px\">Bộ phận Hỗ trợ thí sinh Sky First đã tiếp nhận câu hỏi / yêu cầu hỗ trợ của bạn và phân luồng tới cán bộ phụ trách.</p>\n              <div style=\"background:#f0f9ff;border-left:4px solid #0284c7;padding:12px 16px;margin:14px 0;font-size:13px;line-height:1.6\">\n      Sử dụng <strong>Mã tiếp nhận hỗ trợ ({{request_code}})</strong> cùng địa chỉ email của bạn để kiểm tra phản hồi tại <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0284c7;font-weight:700\">https://exam.skyfirst.io.vn/ho-tro</a>.\n    </div>\n              <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:16px 0\">\n                <tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã phiếu hỗ trợ:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{request_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Kỳ thi liên quan:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{exam_title}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã thí sinh:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{candidate_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Trạng thái xử lý:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{status}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Thời điểm tiếp nhận:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{event_time}}</td></tr>\n              </table>\n              <div style=\"font-size:14px;line-height:1.75;margin-top:16px;padding:14px 16px;background:#f9fbfd;border:1px solid #e5edf5;border-radius:8px;white-space:pre-line;color:#1e293b\">{{message}}</div>\n              <p style=\"font-size:13px;line-height:1.7;margin-top:18px;color:#475569\">\n                Cổng thông tin chính thức: <a href=\"https://exam.skyfirst.io.vn/\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn</a> |\n                Tra cứu kết quả: <a href=\"https://exam.skyfirst.io.vn/tra-cuu-ket-qua\" style=\"color:#0866c6\">/tra-cuu-ket-qua</a> |\n                Hỗ trợ: <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0866c6\">/ho-tro</a>\n              </p>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:16px 28px;background:#f8fafc;border-top:1px solid #e4ebf3;color:#52677b;font-size:12px;line-height:1.65\">\n              <strong>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First</strong><br>\n              Bộ phận Hỗ trợ Thí sinh & Xử lý Sự cố Kỹ thuật (support@skyfirst.io.vn).<br>\n              Địa chỉ gửi định danh: <strong>support@skyfirst.io.vn</strong>\n            </td>\n          </tr>\n        </table>\n      </td>\n    </tr>\n  </table>\n</body>\n</html>\n",
  "support_request_update": "<!doctype html>\n<html lang=\"vi\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n  <meta name=\"x-skyfirst-template\" content=\"support-request-update.html\">\n  <title>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First · Cập Nhật Phản Hồi Yêu Cầu Hỗ Trợ Thí Sinh</title>\n</head>\n<body style=\"margin:0;padding:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#18324b\">\n  <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f3f6fa;padding:26px 10px\">\n    <tr>\n      <td align=\"center\">\n        <table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:600px;width:100%;background:#ffffff;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden\">\n          <tr>\n            <td style=\"padding:22px 28px;background:#0369a1;color:#ffffff\">\n              <div style=\"font-size:11px;letter-spacing:0.8px;text-transform:uppercase;opacity:0.92\">MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST</div>\n              <div style=\"font-size:13px;line-height:1.5;margin-top:2px\">Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First</div>\n              <div style=\"font-size:19px;font-weight:700;line-height:1.35;margin-top:6px\">HỆ THỐNG KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST</div>\n              <div style=\"font-size:12px;opacity:0.9;margin-top:2px\">Hệ Thống Khảo Thí Và Đánh Giá Sky First · Mã mẫu: support-request-update.html</div>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:26px 28px\">\n              <div style=\"display:inline-block;padding:4px 10px;background:#eef2f6;color:#1e3a5f;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:12px\">HỖ TRỢ THÍ SINH · CẬP NHẬT</div>\n              <p style=\"font-size:14px;line-height:1.7;margin:0 0 10px\">Kính gửi <strong>{{recipient_name}}</strong>,</p>\n              <h1 style=\"font-size:21px;line-height:1.35;color:#12385b;margin:0 0 12px\">Cập Nhật Phản Hồi Yêu Cầu Hỗ Trợ Thí Sinh</h1>\n              <p style=\"font-size:14px;line-height:1.75;color:#2c445e;margin:0 0 16px\">Cán bộ hỗ trợ vừa cập nhật thông tin hướng dẫn hoặc yêu cầu làm rõ thêm đối với phiếu hỗ trợ của bạn.</p>\n              <p style=\"font-size:13px;color:#334155\">Xem chi tiết tiến độ xử lý tại <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn/ho-tro</a>.</p>\n              <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:16px 0\">\n                <tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã phiếu hỗ trợ:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{request_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Kỳ thi liên quan:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{exam_title}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã thí sinh:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{candidate_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Trạng thái hiện tại:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{status}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Thời điểm cập nhật:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{event_time}}</td></tr>\n              </table>\n              <div style=\"font-size:14px;line-height:1.75;margin-top:16px;padding:14px 16px;background:#f9fbfd;border:1px solid #e5edf5;border-radius:8px;white-space:pre-line;color:#1e293b\">{{message}}</div>\n              <p style=\"font-size:13px;line-height:1.7;margin-top:18px;color:#475569\">\n                Cổng thông tin chính thức: <a href=\"https://exam.skyfirst.io.vn/\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn</a> |\n                Tra cứu kết quả: <a href=\"https://exam.skyfirst.io.vn/tra-cuu-ket-qua\" style=\"color:#0866c6\">/tra-cuu-ket-qua</a> |\n                Hỗ trợ: <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0866c6\">/ho-tro</a>\n              </p>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:16px 28px;background:#f8fafc;border-top:1px solid #e4ebf3;color:#52677b;font-size:12px;line-height:1.65\">\n              <strong>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First</strong><br>\n              Bộ phận Hỗ trợ Thí sinh & Xử lý Sự cố Kỹ thuật (support@skyfirst.io.vn).<br>\n              Địa chỉ gửi định danh: <strong>support@skyfirst.io.vn</strong>\n            </td>\n          </tr>\n        </table>\n      </td>\n    </tr>\n  </table>\n</body>\n</html>\n",
  "support_request_resolved": "<!doctype html>\n<html lang=\"vi\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n  <meta name=\"x-skyfirst-template\" content=\"support-request-resolved.html\">\n  <title>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First · Thông Báo Kết Quả Giải Quyết Yêu Cầu Hỗ Trợ</title>\n</head>\n<body style=\"margin:0;padding:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#18324b\">\n  <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f3f6fa;padding:26px 10px\">\n    <tr>\n      <td align=\"center\">\n        <table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:600px;width:100%;background:#ffffff;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden\">\n          <tr>\n            <td style=\"padding:22px 28px;background:#0f5132;color:#ffffff\">\n              <div style=\"font-size:11px;letter-spacing:0.8px;text-transform:uppercase;opacity:0.92\">MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST</div>\n              <div style=\"font-size:13px;line-height:1.5;margin-top:2px\">Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First</div>\n              <div style=\"font-size:19px;font-weight:700;line-height:1.35;margin-top:6px\">HỆ THỐNG KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST</div>\n              <div style=\"font-size:12px;opacity:0.9;margin-top:2px\">Hệ Thống Khảo Thí Và Đánh Giá Sky First · Mã mẫu: support-request-resolved.html</div>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:26px 28px\">\n              <div style=\"display:inline-block;padding:4px 10px;background:#eef2f6;color:#1e3a5f;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:12px\">HỖ TRỢ THÍ SINH · HOÀN TẤT</div>\n              <p style=\"font-size:14px;line-height:1.7;margin:0 0 10px\">Kính gửi <strong>{{recipient_name}}</strong>,</p>\n              <h1 style=\"font-size:21px;line-height:1.35;color:#12385b;margin:0 0 12px\">Thông Báo Kết Quả Giải Quyết Yêu Cầu Hỗ Trợ</h1>\n              <p style=\"font-size:14px;line-height:1.75;color:#2c445e;margin:0 0 16px\">Yêu cầu hỗ trợ hoặc báo cáo kỹ thuật của bạn đã được bộ phận chuyên môn xử lý hoàn tất.</p>\n              <p style=\"font-size:13px;color:#334155\">Cảm ơn bạn đã phối hợp cùng Bộ phận Hỗ trợ Kỹ thuật & Khảo thí Sky First.</p>\n              <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:16px 0\">\n                <tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã phiếu hỗ trợ:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{request_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Kỳ thi liên quan:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{exam_title}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã thí sinh:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{candidate_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Trạng thái kết thúc:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{status}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Thời điểm hoàn tất:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{event_time}}</td></tr>\n              </table>\n              <div style=\"font-size:14px;line-height:1.75;margin-top:16px;padding:14px 16px;background:#f9fbfd;border:1px solid #e5edf5;border-radius:8px;white-space:pre-line;color:#1e293b\">{{message}}</div>\n              <p style=\"font-size:13px;line-height:1.7;margin-top:18px;color:#475569\">\n                Cổng thông tin chính thức: <a href=\"https://exam.skyfirst.io.vn/\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn</a> |\n                Tra cứu kết quả: <a href=\"https://exam.skyfirst.io.vn/tra-cuu-ket-qua\" style=\"color:#0866c6\">/tra-cuu-ket-qua</a> |\n                Hỗ trợ: <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0866c6\">/ho-tro</a>\n              </p>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:16px 28px;background:#f8fafc;border-top:1px solid #e4ebf3;color:#52677b;font-size:12px;line-height:1.65\">\n              <strong>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First</strong><br>\n              Bộ phận Hỗ trợ Thí sinh & Xử lý Sự cố Kỹ thuật (support@skyfirst.io.vn).<br>\n              Địa chỉ gửi định danh: <strong>support@skyfirst.io.vn</strong>\n            </td>\n          </tr>\n        </table>\n      </td>\n    </tr>\n  </table>\n</body>\n</html>\n",
  "technical_incident": "<!doctype html>\n<html lang=\"vi\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n  <meta name=\"x-skyfirst-template\" content=\"technical-incident.html\">\n  <title>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First · Xác Nhận Tiếp Nhận Báo Lỗi Hệ Thống & Sự Cố Khẩn Cấp</title>\n</head>\n<body style=\"margin:0;padding:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#18324b\">\n  <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f3f6fa;padding:26px 10px\">\n    <tr>\n      <td align=\"center\">\n        <table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:600px;width:100%;background:#ffffff;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden\">\n          <tr>\n            <td style=\"padding:22px 28px;background:#9a3412;color:#ffffff\">\n              <div style=\"font-size:11px;letter-spacing:0.8px;text-transform:uppercase;opacity:0.92\">MẠNG LƯỚI GIÁO DỤC VÀ PHÁT TRIỂN CỘNG ĐỒNG SKY FIRST</div>\n              <div style=\"font-size:13px;line-height:1.5;margin-top:2px\">Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First</div>\n              <div style=\"font-size:19px;font-weight:700;line-height:1.35;margin-top:6px\">HỆ THỐNG KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST</div>\n              <div style=\"font-size:12px;opacity:0.9;margin-top:2px\">Hệ Thống Khảo Thí Và Đánh Giá Sky First · Mã mẫu: technical-incident.html</div>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:26px 28px\">\n              <div style=\"display:inline-block;padding:4px 10px;background:#eef2f6;color:#1e3a5f;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:12px\">KỸ THUẬT & SỰ CỐ KHẨN CẤP · SUPPORT</div>\n              <p style=\"font-size:14px;line-height:1.7;margin:0 0 10px\">Kính gửi <strong>{{recipient_name}}</strong>,</p>\n              <h1 style=\"font-size:21px;line-height:1.35;color:#12385b;margin:0 0 12px\">Xác Nhận Tiếp Nhận Báo Lỗi Hệ Thống & Sự Cố Khẩn Cấp</h1>\n              <p style=\"font-size:14px;line-height:1.75;color:#2c445e;margin:0 0 16px\">Hệ thống kỹ thuật đã ghi nhận báo cáo lỗi hoặc sự cố khẩn cấp trong quá trình dự thi của bạn kèm dấu thời gian máy chủ.</p>\n              <div style=\"background:#fff7ed;border-left:4px solid #ea580c;padding:12px 16px;margin:14px 0;font-size:13px;line-height:1.6;color:#7c2d12\">\n      <strong>Hướng dẫn xử lý tình huống:</strong> Dữ liệu câu trả lời đã lưu trên máy chủ và bản nháp cục bộ trên trình duyệt của bạn được bảo toàn theo cơ chế revision. Bạn có thể theo dõi trạng thái phiếu bằng mã <strong>{{request_code}}</strong> tại <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#c2410c;font-weight:700\">/ho-tro</a>.\n    </div>\n              <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:16px 0\">\n                <tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã biên nhận sự cố / báo lỗi:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{request_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Kỳ thi / Phân hệ:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{exam_title}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mã thí sinh:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{candidate_code}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Mức độ & Trạng thái:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{status}}</td></tr><tr><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;width:42%;font-size:13px\"><strong>Thời điểm ghi nhận:</strong></td><td style=\"padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px\">{{event_time}}</td></tr>\n              </table>\n              <div style=\"font-size:14px;line-height:1.75;margin-top:16px;padding:14px 16px;background:#f9fbfd;border:1px solid #e5edf5;border-radius:8px;white-space:pre-line;color:#1e293b\">{{message}}</div>\n              <p style=\"font-size:13px;line-height:1.7;margin-top:18px;color:#475569\">\n                Cổng thông tin chính thức: <a href=\"https://exam.skyfirst.io.vn/\" style=\"color:#0866c6\">https://exam.skyfirst.io.vn</a> |\n                Tra cứu kết quả: <a href=\"https://exam.skyfirst.io.vn/tra-cuu-ket-qua\" style=\"color:#0866c6\">/tra-cuu-ket-qua</a> |\n                Hỗ trợ: <a href=\"https://exam.skyfirst.io.vn/ho-tro\" style=\"color:#0866c6\">/ho-tro</a>\n              </p>\n            </td>\n          </tr>\n          <tr>\n            <td style=\"padding:16px 28px;background:#f8fafc;border-top:1px solid #e4ebf3;color:#52677b;font-size:12px;line-height:1.65\">\n              <strong>Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First — Hệ Thống Khảo Thí Và Đánh Giá Sky First</strong><br>\n              Bộ phận Hỗ trợ Thí sinh & Xử lý Sự cố Kỹ thuật (support@skyfirst.io.vn).<br>\n              Địa chỉ gửi định danh: <strong>support@skyfirst.io.vn</strong>\n            </td>\n          </tr>\n        </table>\n      </td>\n    </tr>\n  </table>\n</body>\n</html>\n"
};

export const EMAIL_EVENT_ALIASES = Object.freeze({
  "otp_login": {
    "target": "login_verification_code",
    "subject": "Mã OTP đăng nhập Quản trị — Sky First Exam"
  },
  "account_provisioned": {
    "target": "system_notification",
    "subject": "Thông báo cấp quyền tài khoản — Sky First Exam"
  },
  "account_activated": {
    "target": "system_notification",
    "subject": "Thông báo kích hoạt tài khoản — Sky First Exam"
  },
  "account_locked": {
    "target": "system_notification",
    "subject": "Thông báo tạm khóa / thu hồi quyền tài khoản — Sky First Exam"
  },
  "account_updated": {
    "target": "system_notification",
    "subject": "Thông báo cập nhật thông tin tài khoản — Sky First Exam"
  },
  "exam_registration": {
    "target": "exam_announcement",
    "subject": "Xác nhận đăng ký dự thi thành công — Sky First Exam"
  },
  "exam_confirmation": {
    "target": "exam_announcement",
    "subject": "Xác nhận thông tin hồ sơ dự thi — Sky First Exam"
  },
  "exam_schedule": {
    "target": "exam_announcement",
    "subject": "Thông báo lịch thi chính thức — Sky First Exam"
  },
  "exam_schedule_changed": {
    "target": "exam_announcement",
    "subject": "Thông báo điều chỉnh lịch thi — Sky First Exam"
  },
  "exam_reminder": {
    "target": "exam_announcement",
    "subject": "Nhắc lịch dự thi sắp diễn ra — Sky First Exam"
  },
  "exam_access_code": {
    "target": "exam_announcement",
    "subject": "Thông báo cấp mã dự thi & liên kết vào thi — Sky First Exam"
  },
  "exam_started": {
    "target": "exam_entry",
    "subject": "Thông báo bắt đầu phiên làm bài thi — Sky First Exam"
  },
  "exam_submission_receipt": {
    "target": "exam_session_ended",
    "subject": "Xác nhận nộp bài thành công & Mã biên nhận — Sky First Exam"
  },
  "exam_completed": {
    "target": "exam_session_ended",
    "subject": "Thông báo hoàn thành bài thi — Sky First Exam"
  },
  "exam_result_published": {
    "target": "exam_result",
    "subject": "Thông báo công bố kết quả thi — Sky First Exam"
  },
  "appeal_status": {
    "target": "appeal_update",
    "subject": "Thông báo trạng thái xử lý phúc khảo — Sky First Exam"
  },
  "support_received": {
    "target": "support_request_received",
    "subject": "Xác nhận tiếp nhận yêu cầu hỗ trợ — Sky First Support"
  },
  "support_response": {
    "target": "support_request_resolved",
    "subject": "Thông báo kết quả xử lý yêu cầu hỗ trợ — Sky First Support"
  },
  "issue_received": {
    "target": "technical_incident",
    "subject": "Xác nhận tiếp nhận báo lỗi kỹ thuật — Sky First Support"
  },
  "incident_received": {
    "target": "technical_incident",
    "subject": "Xác nhận tiếp nhận báo cáo sự cố kỳ thi — Sky First Support"
  },
  "fraud_report_received": {
    "target": "fraud_report",
    "subject": "Xác nhận tiếp nhận tố cáo gian lận — Sky First Exam"
  },
  "violation_processed": {
    "target": "exam_ban_notice",
    "subject": "Thông báo quyết định xử lý vi phạm quy chế — Sky First Exam"
  },
  "profile_status_changed": {
    "target": "system_notification",
    "subject": "Thông báo thay đổi trạng thái hồ sơ dự thi — Sky First Exam"
  },
  "result_revoked": {
    "target": "exam_session_cancelled",
    "subject": "Thông báo thu hồi hoặc tạm dừng công bố kết quả — Sky First Exam"
  },
  "system_maintenance": {
    "target": "system_notification",
    "subject": "Thông báo vận hành và bảo trì hệ thống — Sky First Exam"
  }
});

export const EMAIL_TEMPLATES = Object.freeze(
  Object.fromEntries(
    Object.entries(DEFINITIONS).map(([key, item]) => [
      key,
      Object.freeze({
        template_file: item.file,
        sender: item.from,
        group: item.group,
        subject: item.subject,
        title: item.title
      })
    ])
  )
);

export function resolveEmailEvent(eventType) {
  const raw = String(eventType || '').trim();
  if (Object.prototype.hasOwnProperty.call(DEFINITIONS, raw)) {
    return { canonicalKey: raw, aliasKey: raw, subjectOverride: null };
  }
  if (Object.prototype.hasOwnProperty.call(EMAIL_EVENT_ALIASES, raw)) {
    const alias = EMAIL_EVENT_ALIASES[raw];
    return { canonicalKey: alias.target, aliasKey: raw, subjectOverride: alias.subject };
  }
  return { canonicalKey: 'system_notification', aliasKey: raw || 'system_notification', subjectOverride: null };
}

export function renderEmailTemplate(eventType, data = {}) {
  const { canonicalKey, aliasKey, subjectOverride } = resolveEmailEvent(eventType);
  const item = DEFINITIONS[canonicalKey];
  const rawTemplate = RAW_HTML_TEMPLATES[canonicalKey];

  const isFraud = canonicalKey === 'fraud_report';
  const safeMessage = isFraud
    ? getField(data, 'public_notice', 'Hồ sơ phản ánh của bạn đã được mã hóa lưu trữ. Nội dung tố cáo chi tiết không hiển thị lại trong email để bảo vệ tuyệt đối thông tin người gửi.')
    : getField(
        data,
        'message',
        getField(
          data,
          'resolution_note',
          getField(data, 'reason', 'Vui lòng thực hiện theo hướng dẫn nghiệp vụ của Hệ Thống Khảo Thí Và Đánh Giá Sky First.')
        )
      );

  const scoreVal = data?.score_after ?? data?.score;
  const maxVal = data?.max_score;
  const scoreDisplay = scoreVal !== undefined && scoreVal !== null
    ? (maxVal ? `${scoreVal} / ${maxVal} điểm` : `${scoreVal} điểm`)
    : getField(data, 'status_label', 'Theo thông báo chính thức trên cổng tra cứu');

  const vars = {
    recipient_name: escapeHtml(getField(data, 'recipient_name', getField(data, 'full_name', getField(data, 'candidate_name', 'Quý Thí sinh / Cán bộ')))),
    exam_title: escapeHtml(getField(data, 'exam_title', getField(data, 'title', 'Hệ Thống Khảo Thí Và Đánh Giá Sky First'))),
    candidate_code: escapeHtml(getField(data, 'candidate_code', getField(data, 'sfn_id', '—'))),
    request_code: escapeHtml(getField(data, 'request_code', getField(data, 'receipt_code', getField(data, 'attempt_id', '—')))),
    status: escapeHtml(getField(data, 'status', getField(data, 'status_label', getField(data, 'result_status_label', 'Đã ghi nhận')))),
    event_time: escapeHtml(getField(data, 'event_time', getField(data, 'submitted_at', new Date().toISOString()))),
    otp_code: escapeHtml(getField(data, 'otp_code', getField(data, 'otp', '------'))),
    expires_minutes: escapeHtml(getField(data, 'expires_minutes', '5')),
    score_display: escapeHtml(scoreDisplay),
    message: escapeHtml(safeMessage)
  };

  let html = rawTemplate;
  for (const [k, v] of Object.entries(vars)) {
    html = html.replaceAll(`{{${k}}}`, v);
  }

  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();

  return {
    event_type: canonicalKey,
    requested_event: aliasKey,
    from: item.from,
    group: item.group,
    subject: strOrDefault(data?.subject_override, subjectOverride || item.subject),
    template_file: item.file,
    html,
    text
  };
}

function strOrDefault(v, fallback) {
  return v && String(v).trim() ? String(v).trim() : fallback;
}
