// =============================================================================
// SKY FIRST EXAM 2026 — PUBLIC LOOKUP & BUSINESS WORKFLOWS SERVICE
// (src/business-service.js)
// Implements Part 1 Sections V & VI and Part 2 Sections IV & VI:
//  - /tra-cuu & /tra-cuu-ket-qua: Real D1 result lookup, published-only score
//    visibility, 5 official workflow states (Chưa có kết quả, Đang chấm thi,
//    Chờ phê duyệt, Đã công bố, Đã điều chỉnh theo quy trình được cấp quyền)
//  - /phuc-khao: Appeals submission & tracking (PK-...)
//  - /ho-tro: Candidate support requests & tracking (HT-...)
//  - /bao-loi: System bug reports with R2 file validation (BL-...)
//  - /su-co-khan-cap: Live exam emergency incident reporting (KC-...)
//  - /to-cao-gian-lan: Confidential fraud reporting with evidence & privacy (TC-...)
// =============================================================================

import { ensureAdditiveSchema } from './repository.js';
import { dispatchEventEmail, evidenceFileAllowed, safeName, sha256Hex } from './adapters.js';
import { bad, checkRateLimit, httpError, nowIso, ok, readJsonBody, recordAudit, safeJson, str } from './auth-service.js';

const MAX_SERVICE_FILE_BYTES = 15 * 1024 * 1024;

export function generateRequestCode(prefix = 'YC') {
  const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const randPart = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
  return `${prefix}-${datePart}-${randPart}`;
}

export async function storeServiceEvidenceFile(env, file, serviceType, uploadedByEmail = '') {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw httpError('Tệp đính kèm không hợp lệ.', 400, { code: 'INVALID_FILE' });
  }
  const size = Number(file.size || 0);
  if (size <= 0) throw httpError('Tệp đính kèm rỗng.', 400, { code: 'EMPTY_FILE' });
  if (size > MAX_SERVICE_FILE_BYTES) {
    throw httpError('Tệp đính kèm vượt quá dung lượng tối đa cho phép (15MB).', 413, { code: 'FILE_TOO_LARGE' });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_SERVICE_FILE_BYTES) {
    throw httpError('Tệp đính kèm vượt quá dung lượng tối đa cho phép (15MB).', 413, { code: 'FILE_TOO_LARGE' });
  }
  if (!evidenceFileAllowed(file, bytes)) {
    throw httpError('Định dạng hoặc chữ ký tệp đính kèm không nằm trong danh mục an toàn (PNG, JPG, WEBP, PDF, DOCX, XLSX, ZIP, TXT).', 415, { code: 'UNSUPPORTED_EVIDENCE_FILE' });
  }
  const fileId = crypto.randomUUID();
  const cleanFileName = safeName(file.name || 'minh-chung');
  const r2Key = `service-evidence/${serviceType}/${new Date().toISOString().slice(0, 10)}/${fileId}-${cleanFileName}`;
  const digest = await sha256Hex(bytes);
  const mime = str(file.type || 'application/octet-stream').slice(0, 120);

  if (env?.FILES?.put) {
    await env.FILES.put(r2Key, bytes, {
      httpMetadata: { contentType: mime },
      customMetadata: { serviceType, uploadedByEmail: str(uploadedByEmail).slice(0, 160), sha256: digest }
    });
  }

  await ensureAdditiveSchema(env);
  await env.DB.prepare(
    `INSERT INTO exam_service_files(id,service_type,request_id,r2_key,original_name,safe_name,mime_type,byte_size,sha256,uploaded_by_email,status,created_at) VALUES(?,?,NULL,?,?,?,?,?,?,?,'active',CURRENT_TIMESTAMP)`
  ).bind(fileId, serviceType, r2Key, String(file.name || cleanFileName).slice(0, 200), cleanFileName, mime, bytes.byteLength, digest, str(uploadedByEmail).toLowerCase().slice(0, 200)).run();

  return {
    file_id: fileId,
    name: String(file.name || cleanFileName).slice(0, 200),
    safe_name: cleanFileName,
    mime_type: mime,
    byte_size: bytes.byteLength,
    sha256: digest
  };
}

export async function parseServicePayloadAndFiles(env, request, serviceType) {
  const ct = String(request.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('multipart/form-data')) {
    let form;
    try { form = await request.formData(); } catch { throw httpError('Không thể đọc dữ liệu biểu mẫu đa phần (multipart).', 400); }
    const body = {};
    const uploadedFiles = [];
    for (const [key, value] of form.entries()) {
      if (value && typeof value === 'object' && typeof value.arrayBuffer === 'function') {
        if (Number(value.size || 0) > 0) {
          if (uploadedFiles.length >= 5) throw httpError('Tối đa 5 tệp minh chứng cho mỗi yêu cầu.', 400);
          const stored = await storeServiceEvidenceFile(env, value, serviceType, str(form.get('email') || form.get('reporter_email')));
          uploadedFiles.push(stored);
        }
      } else {
        body[key] = String(value ?? '');
      }
    }
    return { body, uploadedFiles };
  }
  const body = await readJsonBody(request, 65_536);
  const uploadedFiles = [];
  if (Array.isArray(body.evidence_file_ids) && body.evidence_file_ids.length) {
    await ensureAdditiveSchema(env);
    for (const rawId of body.evidence_file_ids.slice(0, 5)) {
      const fId = str(rawId);
      if (!fId) continue;
      const row = await env.DB.prepare(`SELECT id file_id, original_name name, safe_name, mime_type, byte_size, sha256 FROM exam_service_files WHERE id=? AND status='active'`).bind(fId).first();
      if (row) uploadedFiles.push(row);
    }
  }
  return { body, uploadedFiles };
}

export async function linkServiceFilesToRequest(env, uploadedFiles, requestId) {
  if (!Array.isArray(uploadedFiles) || !uploadedFiles.length || !requestId) return;
  for (const f of uploadedFiles) {
    if (f?.file_id) {
      await env.DB.prepare(`UPDATE exam_service_files SET request_id=? WHERE id=?`).bind(requestId, f.file_id).run().catch(() => {});
    }
  }
}

export async function uploadPublicServiceFile(env, request) {
  await ensureAdditiveSchema(env);
  let form;
  try { form = await request.formData(); } catch { return bad('Không thể đọc tệp tải lên.', 400); }
  const file = form.get('file');
  const serviceType = ['appeal', 'support', 'bug_report', 'emergency', 'fraud_report'].includes(str(form.get('service_type')))
    ? str(form.get('service_type'))
    : 'support';
  const email = str(form.get('email')).toLowerCase();
  await checkRateLimit(env, `svc_upload:${serviceType}:${email || 'anon'}`, 10, 300_000);
  const stored = await storeServiceEvidenceFile(env, file, serviceType, email);
  return ok({ file: stored });
}

export function describeResultWorkflowStatus(workflowState, showScore, pendingManual, hasResolvedAppeal = false) {
  if (workflowState === 'revoked') {
    return { code: 'revoked', label: 'Tạm thu hồi để rà soát theo quy chế' };
  }
  if (workflowState === 'in_progress' || workflowState === 'not_submitted') {
    return { code: 'no_result_yet', label: 'Chưa có kết quả (Bài thi chưa hoàn tất nộp)' };
  }
  if (pendingManual > 0 || workflowState === 'marking' || workflowState === 'pending_grading') {
    return { code: 'pending_grading', label: 'Đang chấm thi (Chờ chấm câu hỏi tự luận)' };
  }
  if (workflowState === 'graded_pending_approval') {
    return { code: 'awaiting_approval', label: 'Chờ phê duyệt kết quả' };
  }
  if (!showScore) {
    return { code: 'awaiting_publication', label: 'Chờ phê duyệt / Chờ công bố chính thức' };
  }
  if (hasResolvedAppeal) {
    return { code: 'adjusted_after_appeal', label: 'Đã điều chỉnh theo quy trình được cấp quyền (Sau phúc khảo)' };
  }
  if (workflowState === 'published' || workflowState === 'approved') {
    return { code: 'published', label: 'Đã công bố kết quả chính thức' };
  }
  return { code: 'graded', label: 'Đã công bố điểm bài thi' };
}

export async function lookupPublicResult(env, request, computeFinalResponse) {
  await ensureAdditiveSchema(env);
  const body = await readJsonBody(request, 16_384);
  const receiptCode = str(body.receipt_code).toUpperCase();
  const candidateCode = str(body.candidate_code);
  if (!receiptCode || !candidateCode) {
    return bad('Vui lòng nhập đầy đủ Mã biên nhận dự thi và Mã thí sinh để tra cứu kết quả.', 400, { code: 'LOOKUP_FIELDS_REQUIRED' });
  }
  await checkRateLimit(env, `result_lookup:${receiptCode}`, 15, 60_000);

  const rec = await env.DB.prepare(`SELECT * FROM assessment_receipts WHERE UPPER(receipt_code)=?`).bind(receiptCode).first();
  if (!rec) {
    return bad('Không tìm thấy kết quả phù hợp với Mã biên nhận và Mã thí sinh đã nhập. Vui lòng kiểm tra lại hoặc liên hệ bộ phận hỗ trợ (/ho-tro).', 404, { code: 'RESULT_NOT_FOUND' });
  }

  let attempt = await env.DB.prepare(
    `SELECT a.*, e.title, e.show_score, e.result_policy, e.result_release_at, e.closes_at, e.status exam_status, e.passing_score, COALESCE(a.question_snapshot_json, e.question_json) question_json, 'guest' source FROM exam_guest_attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=? AND LOWER(a.candidate_code)=LOWER(?)`
  ).bind(rec.attempt_id, candidateCode).first();

  if (!attempt) {
    attempt = await env.DB.prepare(
      `SELECT a.*, u.full_name, u.sfn_id candidate_code, c.name class_name, e.title, e.show_score, e.result_policy, e.result_release_at, e.closes_at, e.status exam_status, e.passing_score, COALESCE(a.question_snapshot_json, e.question_json) question_json, 'internal' source FROM exam_attempts a JOIN users u ON u.id=a.user_id JOIN exams e ON e.id=a.exam_id LEFT JOIN classes c ON c.id=e.class_id WHERE a.id=? AND LOWER(u.sfn_id)=LOWER(?)`
    ).bind(rec.attempt_id, candidateCode).first();
  }
  if (!attempt) {
    return bad('Không tìm thấy kết quả phù hợp với Mã biên nhận và Mã thí sinh đã nhập.', 404, { code: 'RESULT_NOT_FOUND' });
  }

  const f = await computeFinalResponse(env, attempt);
  const resolvedAppeal = await env.DB.prepare(
    `SELECT id, request_code, score_before, score_after, resolved_at FROM exam_appeals WHERE attempt_id=? AND status='resolved' AND score_after IS NOT NULL ORDER BY resolved_at DESC LIMIT 1`
  ).bind(attempt.id).first().catch(() => null);

  const hasAdjustedScore = Boolean(resolvedAppeal && resolvedAppeal.score_after !== null && resolvedAppeal.score_after !== resolvedAppeal.score_before);
  const passed = f.show_score && f.score != null && Number(attempt.passing_score || 0) > 0
    ? Number(f.score) >= Number(attempt.passing_score)
    : null;
  const statusInfo = describeResultWorkflowStatus(f.workflow_state, f.show_score, f.pending_manual, hasAdjustedScore);

  return ok({
    result: {
      receipt_code: rec.receipt_code,
      attempt_id: attempt.id,
      exam_id: attempt.exam_id,
      exam_title: attempt.title,
      candidate_name: attempt.full_name,
      candidate_code: attempt.candidate_code,
      class_name: attempt.class_name || '',
      submitted_at: attempt.submitted_at,
      workflow_state: f.workflow_state,
      result_status_code: statusInfo.code,
      result_status_label: statusInfo.label,
      show_score: f.show_score,
      score: f.show_score ? f.score : null,
      max_score: f.show_score ? f.max_score : null,
      passing_score: attempt.passing_score || 0,
      passed,
      pending_manual: f.pending_manual,
      adjusted_after_appeal: hasAdjustedScore,
      appeal_available: true,
      appeal_url: `/phuc-khao?receipt_code=${encodeURIComponent(rec.receipt_code)}&candidate_code=${encodeURIComponent(attempt.candidate_code)}&exam_title=${encodeURIComponent(attempt.title)}`,
      support_url: '/ho-tro',
      appeal_guide: 'Nếu có thắc mắc về kết quả chấm thi, thí sinh có thể gửi yêu cầu phúc khảo tại trang Phúc khảo (/phuc-khao) hoặc liên hệ Hỗ trợ (/ho-tro).'
    }
  });
}

export async function submitPublicAppeal(env, request) {
  await ensureAdditiveSchema(env);
  const { body, uploadedFiles } = await parseServicePayloadAndFiles(env, request, 'appeal');
  const receiptCode = str(body.receipt_code).toUpperCase();
  const candidateCode = str(body.candidate_code).slice(0, 100);
  const candidateEmail = str(body.email).toLowerCase().slice(0, 220);
  const reason = str(body.reason).slice(0, 4000);
  const isStrictForm = Boolean(body.strict_form === '1' || body.strict_form === true || body.phone !== undefined);

  if (!candidateCode || !candidateEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail) || !reason || reason.length < 10) {
    return bad('Vui lòng nhập đầy đủ Email hợp lệ, Mã thí sinh và Nội dung lý do phúc khảo (tối thiểu 10 ký tự).', 400, { code: 'INVALID_APPEAL_INPUT' });
  }
  if (isStrictForm) {
    if (!str(body.full_name) || !str(body.phone) || !str(body.class_name) || !str(body.exam_title) || !str(body.exam_date)) {
      return bad('Vui lòng điền đầy đủ các trường bắt buộc: Họ và tên, Số điện thoại, Địa chỉ email, Mã lớp, Mã thí sinh, Tên kỳ thi, Ngày dự thi và Lý do phúc khảo.', 400, { code: 'MISSING_REQUIRED_FIELDS' });
    }
  }

  await checkRateLimit(env, `appeal:${receiptCode || candidateCode}`, 5, 300_000);

  let attempt = null;
  if (receiptCode) {
    const rec = await env.DB.prepare(`SELECT * FROM assessment_receipts WHERE UPPER(receipt_code)=?`).bind(receiptCode).first();
    if (!rec) return bad('Thông tin biên nhận không hợp lệ.', 404, { code: 'RECEIPT_NOT_FOUND' });
    attempt = await env.DB.prepare(
      `SELECT a.id, a.exam_id, a.score, a.candidate_code, a.full_name, a.class_name, a.submitted_at, e.title exam_title FROM exam_guest_attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=? AND LOWER(a.candidate_code)=LOWER(?)`
    ).bind(rec.attempt_id, candidateCode).first();
    if (!attempt) {
      attempt = await env.DB.prepare(
        `SELECT a.id, a.exam_id, a.score, u.sfn_id candidate_code, u.full_name, c.name class_name, a.submitted_at, e.title exam_title FROM exam_attempts a JOIN users u ON u.id=a.user_id JOIN exams e ON e.id=a.exam_id LEFT JOIN classes c ON c.id=e.class_id WHERE a.id=? AND LOWER(u.sfn_id)=LOWER(?)`
      ).bind(rec.attempt_id, candidateCode).first();
    }
    if (!attempt) return bad('Thông tin biên nhận và mã thí sinh không khớp.', 404, { code: 'CANDIDATE_MISMATCH' });
  } else {
    attempt = await env.DB.prepare(
      `SELECT a.id, a.exam_id, a.score, a.candidate_code, a.full_name, a.class_name, a.submitted_at, e.title exam_title FROM exam_guest_attempts a JOIN exams e ON e.id=a.exam_id WHERE LOWER(a.candidate_code)=LOWER(?) ORDER BY a.submitted_at DESC LIMIT 1`
    ).bind(candidateCode).first();
    if (!attempt) {
      return bad('Vui lòng cung cấp Mã biên nhận hợp lệ hoặc Mã thí sinh có bài thi đã nộp trên hệ thống.', 404, { code: 'ATTEMPT_NOT_FOUND' });
    }
  }

  const existing = await env.DB.prepare(`SELECT id, request_code FROM exam_appeals WHERE attempt_id=? AND status IN ('pending','received','reviewing','need_more_info')`).bind(attempt.id).first();
  if (existing) return bad('Yêu cầu phúc khảo cho bài thi này đang được xử lý.', 409, { code: 'APPEAL_ALREADY_EXISTS', request_code: existing.request_code || existing.id });

  const id = crypto.randomUUID();
  const requestCode = generateRequestCode('PK');
  const fullName = str(body.full_name || attempt.full_name || '').slice(0, 160);
  const phone = str(body.phone || '').slice(0, 40);
  const className = str(body.class_name || attempt.class_name || '').slice(0, 160);
  const examTitle = str(body.exam_title || attempt.exam_title || '').slice(0, 240);
  const examDate = str(body.exam_date || attempt.submitted_at || '').slice(0, 80);
  const history = [{ status: 'received', label: 'Đã tiếp nhận', at: nowIso(), by: 'system' }];

  await env.DB.prepare(
    `INSERT INTO exam_appeals(id,request_code,attempt_id,exam_id,full_name,phone,candidate_email,class_name,candidate_code,exam_title,exam_date,receipt_code,reason,evidence_files_json,status,score_before,history_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
  ).bind(
    id, requestCode, attempt.id, attempt.exam_id, fullName, phone, candidateEmail, className,
    candidateCode, examTitle, examDate, receiptCode, reason, JSON.stringify(uploadedFiles),
    attempt.score, JSON.stringify(history)
  ).run();

  await linkServiceFilesToRequest(env, uploadedFiles, id);
  await recordAudit(env, {
    examId: attempt.exam_id,
    attemptId: attempt.id,
    eventType: 'appeal.submitted',
    detail: { appeal_id: id, request_code: requestCode, candidate_code: candidateCode, evidence_count: uploadedFiles.length }
  });

  let emailStatus = { delivered: false, status: 'skipped' };
  if (env?.SEND_LIFECYCLE_EMAILS === '1' || env?.EMAIL_API_URL || typeof env?.EMAIL_DISPATCHER === 'function' || isStrictForm) {
    emailStatus = await dispatchEventEmail(env, 'appeal_received', {
      to: candidateEmail,
      examId: attempt.exam_id,
      attemptId: attempt.id,
      requestId: id,
      idempotencyKey: `appeal-received:${id}`,
      throwOnProviderError: false,
      data: {
        recipient_name: fullName || candidateCode,
        request_code: requestCode,
        receipt_code: receiptCode,
        exam_title: examTitle,
        candidate_code: candidateCode,
        class_name: className,
        exam_date: examDate,
        status_label: 'Đã tiếp nhận',
        reason
      }
    });
  }

  return ok({
    appeal_id: id,
    request_code: requestCode,
    status: 'pending',
    status_label: 'Đã tiếp nhận',
    email_sent: emailStatus.delivered,
    email_status: emailStatus.status,
    message: `Đã tiếp nhận yêu cầu phúc khảo của bạn. Mã yêu cầu: ${requestCode}.`
  });
}

export async function trackPublicAppeal(env, request) {
  await ensureAdditiveSchema(env);
  const body = await readJsonBody(request, 16_384);
  const requestCode = str(body.request_code || body.appeal_id).toUpperCase();
  const candidateCode = str(body.candidate_code);
  const email = str(body.email).toLowerCase();
  if (!requestCode || (!candidateCode && !email)) {
    return bad('Vui lòng nhập Mã yêu cầu phúc khảo và Mã thí sinh (hoặc Email) để tra cứu.', 400);
  }
  await checkRateLimit(env, `appeal_track:${requestCode}`, 15, 60_000);

  const row = await env.DB.prepare(
    `SELECT * FROM exam_appeals WHERE (UPPER(request_code)=? OR UPPER(id)=?) LIMIT 1`
  ).bind(requestCode, requestCode).first();

  if (!row) return bad('Không tìm thấy yêu cầu phúc khảo phù hợp.', 404);
  const matchCandidate = candidateCode && str(row.candidate_code).toLowerCase() === candidateCode.toLowerCase();
  const matchEmail = email && str(row.candidate_email).toLowerCase() === email.toLowerCase();
  if (!matchCandidate && !matchEmail) {
    return bad('Thông tin xác minh không khớp với hồ sơ phúc khảo.', 404);
  }

  const statusMap = {
    pending: 'Đã tiếp nhận / Đang chờ xử lý',
    received: 'Đã tiếp nhận',
    reviewing: 'Đang chấm thẩm định phúc khảo',
    need_more_info: 'Cần bổ sung thông tin',
    resolved: 'Đã có kết quả phúc khảo',
    rejected: 'Từ chối phúc khảo (Đã có kết luận)'
  };

  return ok({
    appeal: {
      appeal_id: row.id,
      request_code: row.request_code || row.id,
      exam_title: row.exam_title || row.exam_id,
      candidate_code: row.candidate_code,
      status: row.status,
      status_label: statusMap[row.status] || row.status,
      score_before: row.score_before,
      score_after: row.status === 'resolved' ? row.score_after : null,
      resolution_note: row.resolution_note || '',
      created_at: row.created_at,
      updated_at: row.updated_at,
      resolved_at: row.resolved_at || null,
      history: safeJson(row.history_json, [])
    }
  });
}

export async function submitSupportRequest(env, request) {
  await ensureAdditiveSchema(env);
  const { body, uploadedFiles } = await parseServicePayloadAndFiles(env, request, 'support');
  const name = str(body.full_name || body.candidate_name).slice(0, 160);
  const phone = str(body.phone).slice(0, 40);
  const email = str(body.email).toLowerCase().slice(0, 220);
  const className = str(body.class_name).slice(0, 160);
  const code = str(body.candidate_code).slice(0, 100);
  const examId = str(body.exam_id).slice(0, 120) || null;
  const examTitle = str(body.exam_title || body.exam_id || 'Hỗ trợ chung').slice(0, 240);
  const examDate = str(body.exam_date).slice(0, 80);
  const attemptId = str(body.attempt_id).slice(0, 120) || null;
  const issueType = str(body.issue_type || 'general').slice(0, 80);
  const message = str(body.message).slice(0, 3000);
  const isStrictForm = Boolean(body.strict_form === '1' || body.strict_form === true || body.phone !== undefined);

  if (!name || !message || message.length < 5) {
    return bad('Vui lòng nhập Họ và tên cùng Nội dung cần hỗ trợ (tối thiểu 5 ký tự).', 400);
  }
  if (isStrictForm && (!phone || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !className || !code)) {
    return bad('Vui lòng nhập đầy đủ Họ và tên, Số điện thoại, Email hợp lệ, Mã lớp, Mã thí sinh và Nội dung câu hỏi hỗ trợ.', 400);
  }

  await checkRateLimit(env, `support:${code || email || name}`, 6, 300_000);
  const id = crypto.randomUUID();
  const requestCode = generateRequestCode('HT');
  const history = [{ status: 'open', label: 'Đã tiếp nhận yêu cầu hỗ trợ', at: nowIso(), by: 'system' }];

  await env.DB.prepare(
    `INSERT INTO exam_support_requests(id,request_code,exam_id,attempt_id,candidate_name,phone,candidate_email,class_name,candidate_code,exam_title,exam_date,category,issue_type,priority,message,evidence_files_json,history_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'support',?,'normal',?,?,?,'open',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
  ).bind(id, requestCode, examId, attemptId, name, phone, email, className, code, examTitle, examDate, issueType, message, JSON.stringify(uploadedFiles), JSON.stringify(history)).run();

  await linkServiceFilesToRequest(env, uploadedFiles, id);
  await recordAudit(env, { examId, attemptId, eventType: 'support.submitted', detail: { support_id: id, request_code: requestCode, category: 'support', issue_type: issueType } });

  let emailStatus = { delivered: false, status: 'skipped' };
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && (env?.SEND_LIFECYCLE_EMAILS === '1' || env?.EMAIL_API_URL || typeof env?.EMAIL_DISPATCHER === 'function' || isStrictForm)) {
    emailStatus = await dispatchEventEmail(env, 'support_request_received', {
      to: email,
      examId,
      attemptId,
      requestId: id,
      idempotencyKey: `support-received:${id}`,
      throwOnProviderError: false,
      data: {
        recipient_name: name,
        request_code: requestCode,
        exam_title: examTitle,
        candidate_code: code,
        class_name: className,
        status_label: 'Đã tiếp nhận',
        message
      }
    });
  }

  return ok({
    support_id: id,
    request_code: requestCode,
    status: 'open',
    status_label: 'Đã tiếp nhận',
    email_sent: emailStatus.delivered,
    message: `Yêu cầu hỗ trợ đã được tiếp nhận. Mã yêu cầu: ${requestCode}.`
  });
}

export async function submitBugReport(env, request) {
  await ensureAdditiveSchema(env);
  const { body, uploadedFiles } = await parseServicePayloadAndFiles(env, request, 'bug_report');
  const name = str(body.full_name || body.candidate_name).slice(0, 160);
  const phone = str(body.phone).slice(0, 40);
  const email = str(body.email).toLowerCase().slice(0, 220);
  const className = str(body.class_name).slice(0, 160);
  const code = str(body.candidate_code).slice(0, 100);
  const examId = str(body.exam_id).slice(0, 120) || null;
  const examTitle = str(body.exam_title || body.exam_id || 'Hệ thống Khảo thí Sky First').slice(0, 240);
  const examDate = str(body.exam_date).slice(0, 80);
  const occurredAt = str(body.occurred_at || nowIso()).slice(0, 80);
  const issueType = str(body.issue_type || 'bug_report').slice(0, 80);
  const steps = str(body.steps_to_reproduce || '').slice(0, 2000);
  const message = str(body.message || body.description).slice(0, 4000);

  if (!name || !phone || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !className || !code || !examTitle || !message || message.length < 10) {
    return bad('Vui lòng điền đầy đủ Họ và tên, Số điện thoại, Email hợp lệ, Mã lớp, Mã thí sinh, Tên kỳ thi và Mô tả lỗi kỹ thuật (tối thiểu 10 ký tự).', 400);
  }

  await checkRateLimit(env, `bug_report:${code || email}`, 6, 300_000);
  const id = crypto.randomUUID();
  const requestCode = generateRequestCode('BL');
  const techMeta = {
    page_path: str(body.page_path).slice(0, 200),
    browser_summary: str(body.browser_summary).slice(0, 200),
    steps_to_reproduce: steps,
    occurred_at: occurredAt
  };
  const history = [{ status: 'open', label: 'Đã tiếp nhận báo lỗi kỹ thuật', at: nowIso(), by: 'system' }];

  await env.DB.prepare(
    `INSERT INTO exam_support_requests(id,request_code,exam_id,attempt_id,candidate_name,phone,candidate_email,class_name,candidate_code,exam_title,exam_date,occurred_at,category,issue_type,priority,message,steps_to_reproduce,technical_meta_json,evidence_files_json,history_json,status,created_at,updated_at) VALUES(?,?,?,NULL,?,?,?,?,?,?,?,?,'bug_report',?,'normal',?,?,?,?,?,'open',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
  ).bind(id, requestCode, examId, name, phone, email, className, code, examTitle, examDate, occurredAt, issueType, message, steps, JSON.stringify(techMeta), JSON.stringify(uploadedFiles), JSON.stringify(history)).run();

  await linkServiceFilesToRequest(env, uploadedFiles, id);
  await recordAudit(env, { examId, eventType: 'bug_report.submitted', detail: { report_id: id, request_code: requestCode, evidence_count: uploadedFiles.length } });

  const emailStatus = await dispatchEventEmail(env, 'technical_incident', {
    to: email,
    examId,
    requestId: id,
    idempotencyKey: `bug-report:${id}`,
    throwOnProviderError: false,
    data: {
      recipient_name: name,
      request_code: requestCode,
      exam_title: examTitle,
      candidate_code: code,
      class_name: className,
      occurred_at: occurredAt,
      status_label: 'Đã tiếp nhận báo lỗi kỹ thuật',
      message
    }
  });

  return ok({
    report_id: id,
    request_code: requestCode,
    status: 'open',
    status_label: 'Đã tiếp nhận',
    email_sent: emailStatus.delivered,
    message: `Đã ghi nhận báo cáo lỗi kỹ thuật. Mã yêu cầu: ${requestCode}.`
  });
}

export async function submitEmergencyIncident(env, request) {
  await ensureAdditiveSchema(env);
  const { body, uploadedFiles } = await parseServicePayloadAndFiles(env, request, 'emergency');
  const name = str(body.full_name || body.candidate_name).slice(0, 160);
  const phone = str(body.phone).slice(0, 40);
  const email = str(body.email).toLowerCase().slice(0, 220);
  const className = str(body.class_name).slice(0, 160);
  const code = str(body.candidate_code).slice(0, 100);
  const examId = str(body.exam_id).slice(0, 120) || null;
  const examTitle = str(body.exam_title || body.exam_id || 'Kỳ thi đang diễn ra').slice(0, 240);
  const examDate = str(body.exam_date || new Date().toISOString().slice(0, 10)).slice(0, 80);
  const occurredAt = str(body.occurred_at || nowIso()).slice(0, 80);
  const attemptId = str(body.attempt_id).slice(0, 120) || null;
  const issueType = str(body.issue_type || 'emergency_incident').slice(0, 80);
  const message = str(body.message || body.description).slice(0, 4000);

  if (!name || !phone || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !className || !code || !examTitle || !message || message.length < 5) {
    return bad('Vui lòng nhập đầy đủ Họ và tên, Số điện thoại, Email, Mã lớp, Mã thí sinh, Kỳ thi và Mô tả sự cố khẩn cấp.', 400);
  }

  await checkRateLimit(env, `emergency:${code || email}`, 10, 300_000);
  const id = crypto.randomUUID();
  const requestCode = generateRequestCode('KC');
  const techMeta = { emergency: true, priority: 'urgent', occurred_at: occurredAt, attempt_id: attemptId };
  const history = [{ status: 'open', label: 'Tiếp nhận sự cố khẩn cấp trong kỳ thi', at: nowIso(), by: 'system' }];

  await env.DB.prepare(
    `INSERT INTO exam_support_requests(id,request_code,exam_id,attempt_id,candidate_name,phone,candidate_email,class_name,candidate_code,exam_title,exam_date,occurred_at,category,issue_type,priority,message,technical_meta_json,evidence_files_json,history_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'emergency',?,'urgent',?,?,?,?,'open',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
  ).bind(id, requestCode, examId, attemptId, name, phone, email, className, code, examTitle, examDate, occurredAt, issueType, message, JSON.stringify(techMeta), JSON.stringify(uploadedFiles), JSON.stringify(history)).run();

  await linkServiceFilesToRequest(env, uploadedFiles, id);
  await recordAudit(env, { examId, attemptId, eventType: 'emergency_incident.submitted', detail: { incident_id: id, request_code: requestCode, candidate_code: code } });

  const emailStatus = await dispatchEventEmail(env, 'technical_incident', {
    to: email,
    examId,
    attemptId,
    requestId: id,
    idempotencyKey: `emergency-incident:${id}`,
    throwOnProviderError: false,
    data: {
      recipient_name: name,
      request_code: requestCode,
      exam_title: examTitle,
      candidate_code: code,
      class_name: className,
      occurred_at: occurredAt,
      status_label: 'Khẩn cấp — Đã chuyển bộ phận trực kỳ thi',
      message
    }
  });

  return ok({
    incident_id: id,
    request_code: requestCode,
    status: 'open',
    priority: 'urgent',
    status_label: 'Đã tiếp nhận khẩn cấp',
    email_sent: emailStatus.delivered,
    message: `Báo cáo sự cố khẩn cấp đã được chuyển tới bộ phận trực kỳ thi. Mã tiếp nhận: ${requestCode}.`
  });
}

export async function trackPublicSupportRequest(env, request) {
  await ensureAdditiveSchema(env);
  const body = await readJsonBody(request, 16_384);
  const requestCode = str(body.request_code || body.support_id).toUpperCase();
  const candidateCode = str(body.candidate_code);
  const email = str(body.email).toLowerCase();
  if (!requestCode || (!candidateCode && !email)) {
    return bad('Vui lòng nhập Mã yêu cầu (HT-... / BL-... / KC-...) và Mã thí sinh (hoặc Email) để tra cứu.', 400);
  }
  await checkRateLimit(env, `support_track:${requestCode}`, 15, 60_000);

  const row = await env.DB.prepare(
    `SELECT * FROM exam_support_requests WHERE (UPPER(request_code)=? OR UPPER(id)=?) LIMIT 1`
  ).bind(requestCode, requestCode).first();
  if (!row) return bad('Không tìm thấy yêu cầu hỗ trợ / báo cáo kỹ thuật phù hợp.', 404);

  const matchCode = candidateCode && str(row.candidate_code).toLowerCase() === candidateCode.toLowerCase();
  const matchEmail = email && str(row.candidate_email).toLowerCase() === email.toLowerCase();
  if (!matchCode && !matchEmail) {
    return bad('Thông tin xác minh không khớp với yêu cầu đã gửi.', 404);
  }

  const statusLabels = {
    open: 'Đã tiếp nhận',
    in_progress: 'Đang xử lý',
    need_more_info: 'Cần bổ sung thông tin',
    resolved: 'Đã giải quyết'
  };

  return ok({
    ticket: {
      id: row.id,
      request_code: row.request_code || row.id,
      category: row.category || 'support',
      issue_type: row.issue_type,
      exam_title: row.exam_title || row.exam_id || '',
      candidate_code: row.candidate_code || '',
      status: row.status,
      status_label: statusLabels[row.status] || row.status,
      resolution_note: row.resolution_note || '',
      created_at: row.created_at,
      updated_at: row.updated_at,
      history: safeJson(row.history_json, [])
    }
  });
}

export async function submitFraudReport(env, request) {
  await ensureAdditiveSchema(env);
  const { body, uploadedFiles } = await parseServicePayloadAndFiles(env, request, 'fraud_report');
  const reporterName = str(body.reporter_name || body.full_name).slice(0, 160);
  const reporterPhone = str(body.reporter_phone || body.phone).slice(0, 40);
  const reporterEmail = str(body.reporter_email || body.email).toLowerCase().slice(0, 220);
  const className = str(body.class_name).slice(0, 160);
  const examId = str(body.exam_id).slice(0, 120) || null;
  const examTitle = str(body.exam_title || body.exam_id).slice(0, 240);
  const examDate = str(body.exam_date).slice(0, 80);
  const reportedCandidateCode = str(body.reported_candidate_code || body.candidate_code).slice(0, 100);
  const reportedInfo = str(body.reported_info).slice(0, 500);
  const content = str(body.content || body.message).slice(0, 5000);
  const evidenceUrl = str(body.evidence_url).slice(0, 1000);

  if (!reporterName || !reporterPhone || !reporterEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reporterEmail) || !className || !examTitle || !examDate || !content || content.length < 15) {
    return bad('Vui lòng điền đầy đủ Họ và tên người báo cáo, Số điện thoại, Email hợp lệ, Mã lớp, Tên kỳ thi, Ngày thi và Nội dung phản ánh chi tiết (tối thiểu 15 ký tự).', 400);
  }

  let validUrl = '';
  if (evidenceUrl) {
    try {
      const parsed = new URL(evidenceUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return bad('Đường dẫn minh chứng chỉ chấp nhận giao thức http:// hoặc https://.', 400);
      }
      validUrl = parsed.href;
    } catch {
      return bad('Đường dẫn minh chứng không đúng định dạng URL hợp lệ.', 400);
    }
  }

  if (uploadedFiles.length === 0 && !validUrl) {
    return bad('Báo cáo tố cáo gian lận bắt buộc phải đính kèm ít nhất 01 tệp minh chứng hoặc 01 đường dẫn minh chứng hợp lệ.', 400, { code: 'EVIDENCE_REQUIRED' });
  }

  await checkRateLimit(env, `fraud_report:${reporterEmail}`, 4, 300_000);
  const id = crypto.randomUUID();
  const requestCode = generateRequestCode('TC');
  const history = [{ status: 'received', label: 'Đã tiếp nhận phản ánh bảo mật', at: nowIso(), by: 'system' }];

  await env.DB.prepare(
    `INSERT INTO exam_fraud_reports(id,request_code,reporter_name,reporter_phone,reporter_email,class_name,exam_id,exam_title,exam_date,reported_candidate_code,reported_info,content,evidence_url,evidence_files_json,status,history_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'received',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
  ).bind(
    id, requestCode, reporterName, reporterPhone, reporterEmail, className,
    examId, examTitle, examDate, reportedCandidateCode, reportedInfo, content,
    validUrl, JSON.stringify(uploadedFiles), JSON.stringify(history)
  ).run();

  await linkServiceFilesToRequest(env, uploadedFiles, id);
  await recordAudit(env, {
    examId,
    eventType: 'fraud_report.submitted',
    detail: { report_id: id, request_code: requestCode, evidence_files: uploadedFiles.length, has_evidence_url: Boolean(validUrl) }
  });

  const emailStatus = await dispatchEventEmail(env, 'fraud_report', {
    to: reporterEmail,
    examId,
    requestId: id,
    idempotencyKey: `fraud-report:${id}`,
    throwOnProviderError: false,
    data: {
      recipient_name: reporterName,
      request_code: requestCode,
      exam_title: examTitle,
      exam_date: examDate,
      status_label: 'Đã tiếp nhận và bảo mật thông tin'
    }
  });

  return ok({
    report_id: id,
    request_code: requestCode,
    status: 'received',
    status_label: 'Đã tiếp nhận bảo mật',
    email_sent: emailStatus.delivered,
    message: `Hệ thống đã tiếp nhận phản ánh của bạn theo chế độ bảo mật. Mã hồ sơ: ${requestCode}.`
  });
}

export async function trackPublicFraudReport(env, request) {
  await ensureAdditiveSchema(env);
  const body = await readJsonBody(request, 16_384);
  const requestCode = str(body.request_code).toUpperCase();
  const email = str(body.email || body.reporter_email).toLowerCase();
  if (!requestCode || !email) {
    return bad('Vui lòng nhập Mã hồ sơ phản ánh (TC-...) và Email người gửi để tra cứu trạng thái.', 400);
  }
  await checkRateLimit(env, `fraud_track:${requestCode}`, 10, 60_000);

  const row = await env.DB.prepare(
    `SELECT id, request_code, exam_title, exam_date, status, resolution_note, created_at, updated_at, resolved_at, history_json, reporter_email FROM exam_fraud_reports WHERE UPPER(request_code)=? LIMIT 1`
  ).bind(requestCode).first();

  if (!row || str(row.reporter_email).toLowerCase() !== email) {
    return bad('Không tìm thấy hồ sơ phản ánh khớp với thông tin xác minh.', 404);
  }

  const labels = {
    received: 'Đã tiếp nhận',
    verifying: 'Đang xác minh độc lập',
    need_more_info: 'Cần bổ sung minh chứng',
    resolved: 'Đã có kết luận xử lý theo quy chế',
    archived: 'Đã lưu trữ hồ sơ'
  };

  return ok({
    report: {
      request_code: row.request_code,
      exam_title: row.exam_title,
      exam_date: row.exam_date,
      status: row.status,
      status_label: labels[row.status] || row.status,
      resolution_note: row.resolution_note || 'Hồ sơ đang được bộ phận thẩm quyền rà soát bảo mật theo quy chế.',
      created_at: row.created_at,
      updated_at: row.updated_at,
      resolved_at: row.resolved_at || null
    }
  });
}
