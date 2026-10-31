// =============================================================================
// SKY FIRST EXAM 2026 — CANDIDATE EXAM ENGINE & ADMIN MANAGEMENT SERVICE
// (src/exam-service.js)
// Combines candidate assessment lifecycle, server-authoritative timing,
// revisioned autosave, third-party identity verification adapter, question bank
// matrix & randomization, live proctoring monitor, anomaly analysis, and admin CRUD.
// =============================================================================

import { EMAIL_SENDERS, EMAIL_TEMPLATES, renderEmailTemplate } from './email-templates.js';
import { ensureAdditiveSchema, sharedCache, upsertCompatibleUser } from './repository.js';
import {
  dispatchBusinessEmail,
  dispatchEventEmail,
  mimeAllowed,
  safeName,
  sha256Hex,
  verifyCandidateIdentityWithAdapter
} from './adapters.js';
import {
  SYSTEM_OWNER_EMAIL,
  SYSTEM_OWNER_ROLE,
  ADMIN_ROLES,
  ROLE_PERMISSIONS,
  SECURITY_HEADERS,
  authorizeAdmin,
  bad,
  bearerToken,
  checkRateLimit,
  clientIpFrom,
  databaseTimeMs,
  examTimeMs,
  hasAdminPermission,
  httpError,
  isAccountExpired,
  json,
  nowIso,
  ok,
  parseUserRoles,
  randomHex,
  randomOtp6,
  readJsonBody,
  recordAudit,
  safeJson,
  sha256Text,
  str
} from './auth-service.js';
import {
  EVENT_CLASSIFICATION_LABELS,
  PRIVACY_COMPLIANCE_POLICY,
  SECURITY_LEVEL_PRESETS,
  analyzeExamAnomalies,
  autoScore,
  buildAttemptQuestionSnapshot,
  cleanEvents,
  drawQuestionsFromMatrix,
  generateVariantCode,
  normalizeSecurityConfig,
  publicQuestions,
  sanitizeAnswers,
  seededShuffle,
  summarizeAndClassifyEvents,
  RISK_LEVEL_LABELS,
  PROCTOR_EVENT_CATALOG,
  evaluateProctoringEventRisk,
  evaluateDevicePreflightCapabilities,
  ATTEMPT_LIFECYCLE_STATES,
  inspectMediaDevicesForSpoofing,
  PLATFORM_CAPABILITY_MATRIX,
  generateExamDnaFingerprint,
  injectExamHoneytokens,
  traceHoneytokenLeak,
  buildCollusionGraph,
  analyzeCognitiveAndBehavioralSignals,
  generateDynamicIntegrityChallenge,
  runAdversarialExamSimulation,
  DEFAULT_THREAT_MEMORY,
  MANUAL_TYPES,
  MAX_ANSWER_BYTES
} from './security-service.js';
const ATTACHMENT_TYPES = new Set(['file', 'image', 'audio']);

const VALID_EXAM_TRANSITIONS = {
  draft: new Set(['review', 'published', 'cancelled', 'archived']),
  review: new Set(['draft', 'approved', 'cancelled']),
  approved: new Set(['review', 'published', 'cancelled']),
  published: new Set(['paused', 'closed', 'cancelled']),
  paused: new Set(['published', 'closed', 'cancelled']),
  closed: new Set(['published', 'archived']),
  cancelled: new Set(['draft', 'archived']),
  archived: new Set([])
};

export function assessmentScoreVisible(exam = {}, workflowState = 'graded', now = Date.now()) {
  if (workflowState === 'revoked' || workflowState === 'marking') return false;
  if (Number(exam.show_score) === 0 && workflowState !== 'published') return false;
  const release = examTimeMs(exam.result_release_at);
  if (release && now < release && workflowState !== 'published') return false;
  const policy = str(exam.result_policy || 'score_after_submit');
  if (policy === 'manual_publish_only') return workflowState === 'published';
  if (policy === 'score_after_submit' || policy === 'score_total_only') return true;
  if (policy === 'full_review_after_close') {
    const close = examTimeMs(exam.closes_at);
    return exam.exam_status === 'closed' || exam.status === 'closed' || workflowState === 'published' || !!(close && now >= close);
  }
  return workflowState === 'published';
}

async function seedManual(env, attemptId, questions = []) {
  for (const q of questions.filter(x => MANUAL_TYPES.has(str(x.type)))) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO assessment_manual_grades(id,attempt_id,question_id,grader_user_id,score,feedback,status,created_at,updated_at) VALUES(?,?,?,'system',NULL,'','draft',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
    ).bind(crypto.randomUUID(), attemptId, str(q.id)).run();
  }
}

function attemptDeadline(a) {
  return Number(a.time_limit_enabled) === 0
    ? null
    : databaseTimeMs(a.started_at) + (Number(a.duration_minutes || 60) + Number(a.extra_time_minutes || 0)) * 60000;
}

function candidateFrom(a, source) {
  return source === 'guest'
    ? { full_name: a.full_name || '', candidate_code: a.candidate_code || '', class_name: a.class_name || '', email: a.email || '' }
    : { full_name: a.full_name || '', candidate_code: a.sfn_id || '', class_name: a.class_name || '', email: a.email || '' };
}

function sessionId(request) {
  const id = str(request.headers.get('x-exam-session'));
  return /^[A-Za-z0-9._~-]{16,160}$/.test(id) ? id : '';
}

function applySealedPackage(row) {
  if (!row) return row;
  const pack = safeJson(row.package_json, null);
  if (!pack || typeof pack !== 'object') return row;
  const timing = pack.timing && typeof pack.timing === 'object' ? pack.timing : {};
  const pol = pack.policies && typeof pack.policies === 'object' ? pack.policies : {};
  const bit = (v, f) => v === undefined ? f : (v ? 1 : 0);
  return {
    ...row,
    duration_minutes: timing.duration_minutes ?? row.duration_minutes,
    time_limit_enabled: bit(timing.time_limit_enabled, row.time_limit_enabled),
    strict_mode: bit(pol.strict_mode, row.strict_mode),
    fullscreen_required: bit(pol.fullscreen_required, row.fullscreen_required),
    allow_clipboard: bit(pol.allow_clipboard, row.allow_clipboard),
    allow_paste: bit(pol.allow_paste, row.allow_paste),
    allow_external_links: bit(pol.allow_external_links, row.allow_external_links),
    security_profile: pol.security_profile || row.security_profile,
    device_policy: pol.device_policy || row.device_policy,
    resume_policy: pol.resume_policy || row.resume_policy,
    calculator_policy: pol.calculator_policy || row.calculator_policy
  };
}

async function claimLease(env, source, attemptId, request) {
  const sid = sessionId(request);
  if (!sid) throw Object.assign(new Error('SESSION_REQUIRED'), { status: 409, detail: { code: 'SESSION_REQUIRED' } });
  await env.DB.prepare(
    `INSERT OR IGNORE INTO assessment_attempt_leases(attempt_id,source,session_id,claimed_at,last_seen_at) VALUES(?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
  ).bind(attemptId, source, sid).run();
  const lease = await env.DB.prepare(
    `SELECT session_id FROM assessment_attempt_leases WHERE attempt_id=? AND source=?`
  ).bind(attemptId, source).first();
  if (!lease || lease.session_id !== sid) {
    throw Object.assign(new Error('SESSION_CONFLICT'), { status: 409, detail: { code: 'SESSION_CONFLICT' } });
  }
  await env.DB.prepare(
    `UPDATE assessment_attempt_leases SET last_seen_at=CURRENT_TIMESTAMP WHERE attempt_id=? AND source=? AND session_id=?`
  ).bind(attemptId, source, sid).run();
  return sid;
}

async function authorize(env, source, attemptId, request) {
  const raw = bearerToken(request);
  if (!raw) throw Object.assign(new Error('AUTH'), { status: 401 });
  if (source === 'guest') {
    const row = await env.DB.prepare(
      `SELECT a.*,e.title,e.instructions,e.duration_minutes,e.time_limit_enabled,e.strict_mode,e.fullscreen_required,e.show_score,e.assessment_type,e.assessment_label,e.center_label,e.result_policy,e.result_release_at,e.closes_at,e.status exam_status,e.security_profile,e.allow_clipboard,e.allow_paste,e.allow_external_links,e.device_policy,e.resume_policy,e.calculator_policy,v.snapshot_json package_json,COALESCE(a.question_snapshot_json,e.question_json) question_json FROM exam_guest_attempts a JOIN exams e ON e.id=a.exam_id LEFT JOIN assessment_exam_versions v ON v.id=COALESCE(a.exam_version_id,e.sealed_version_id) WHERE a.id=? AND a.access_key=?`
    ).bind(attemptId, raw).first();
    if (!row) throw Object.assign(new Error('AUTH'), { status: 401 });
    return applySealedPackage(row);
  }
  const hash = await sha256Text(raw);
  const row = await env.DB.prepare(
    `SELECT a.*,e.title,e.instructions,e.duration_minutes,e.time_limit_enabled,e.strict_mode,e.fullscreen_required,e.show_score,e.assessment_type,e.assessment_label,e.center_label,e.result_policy,e.result_release_at,e.closes_at,e.status exam_status,e.security_profile,e.allow_clipboard,e.allow_paste,e.allow_external_links,e.device_policy,e.resume_policy,e.calculator_policy,v.snapshot_json package_json,COALESCE(a.question_snapshot_json,e.question_json) question_json,u.full_name,u.sfn_id,u.email,c.name class_name FROM exam_access_tokens t JOIN exam_attempts a ON a.id=t.attempt_id AND a.user_id=t.user_id JOIN exams e ON e.id=a.exam_id LEFT JOIN assessment_exam_versions v ON v.id=COALESCE(a.exam_version_id,e.sealed_version_id) JOIN users u ON u.id=a.user_id LEFT JOIN classes c ON c.id=e.class_id WHERE t.token_hash=? AND t.attempt_id=? AND datetime(t.expires_at)>CURRENT_TIMESTAMP AND u.status='active'`
  ).bind(hash, attemptId).first();
  if (!row) throw Object.assign(new Error('AUTH'), { status: 401 });
  return applySealedPackage(row);
}

async function receiptFor(env, a) {
  let r = await env.DB.prepare(`SELECT receipt_code FROM assessment_receipts WHERE attempt_id=? ORDER BY created_at DESC LIMIT 1`).bind(a.id).first();
  if (r?.receipt_code) return r.receipt_code;
  const code = `EXM-${String(a.id).slice(0, 8).toUpperCase()}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO assessment_receipts(id,attempt_id,receipt_code,payload_json,created_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP)`
  ).bind(crypto.randomUUID(), a.id, code, JSON.stringify({ attempt_id: a.id, exam_id: a.exam_id, status: 'submitted' })).run();
  r = await env.DB.prepare(`SELECT receipt_code FROM assessment_receipts WHERE attempt_id=? ORDER BY created_at DESC LIMIT 1`).bind(a.id).first();
  if (!r?.receipt_code) {
    throw httpError('Chưa thể xác nhận biên nhận nộp bài. Vui lòng kiểm tra lại trạng thái phiên thi.', 503, { code: 'RECEIPT_NOT_PERSISTED' });
  }
  return r.receipt_code;
}

async function computeTotalAttemptScore(env, a, questions = []) {
  const manual = questions.filter(q => MANUAL_TYPES.has(str(q.type)));
  let pending = 0;
  let manualScore = 0;
  if (manual.length) {
    try {
      await seedManual(env, a.id, manual);
      const result = await env.DB.prepare(`SELECT question_id, score, status FROM assessment_manual_grades WHERE attempt_id=?`).bind(a.id).all();
      const rows = result?.results || [];
      for (const q of manual) {
        const found = rows.find(r => String(r.question_id) === String(q.id) && r.status === 'published');
        if (!found || found.score == null) {
          pending++;
        } else {
          manualScore += Number(found.score) || 0;
        }
      }
    } catch {
      pending = manual.length;
    }
  }
  let wfState = pending > 0 ? 'marking' : 'graded';
  try {
    const wf = await env.DB.prepare(`SELECT state FROM assessment_result_workflows WHERE attempt_id=?`).bind(a.id).first();
    if (wf?.state) wfState = wf.state;
  } catch {}
  return { pending, manualScore, wfState };
}

async function finalResponse(env, a) {
  const questions = safeJson(a.question_json ?? a.question_snapshot_json ?? '[]', []);
  const { pending, wfState } = await computeTotalAttemptScore(env, a, Array.isArray(questions) ? questions : []);
  const visible = assessmentScoreVisible(a, wfState) && pending === 0;
  const closeMs = examTimeMs(a.closes_at);
  const reviewAvailable = a.result_policy === 'full_review_after_close' && (a.exam_status === 'closed' || wfState === 'published' || !!(closeMs && Date.now() >= closeMs)) && pending === 0;
  return {
    submitted: true,
    status: 'submitted',
    workflow_state: wfState,
    score: visible ? a.score : null,
    max_score: visible ? a.max_score : null,
    show_score: visible,
    pending_manual: pending,
    review_available: reviewAvailable,
    receipt_code: await receiptFor(env, a)
  };
}

async function validateAttachmentAnswers(env, attemptId, qs, answers) {
  for (const q of qs) {
    if (!ATTACHMENT_TYPES.has(str(q.type))) continue;
    const v = answers?.[q.id];
    if (v == null || v === '') continue;
    const fileId = str(v?.file_id);
    if (!fileId) throw Object.assign(new Error('Tệp trả lời không hợp lệ.'), { status: 400 });
    const row = await env.DB.prepare(
      `SELECT 1 ok FROM assessment_response_files WHERE attempt_id=? AND question_id=? AND file_id=? AND status='active'`
    ).bind(attemptId, str(q.id), fileId).first();
    if (!row) throw Object.assign(new Error('Tệp trả lời không thuộc câu hỏi này.'), { status: 403 });
  }
}

async function finalize(env, source, a, body, afterDeadline = false, retries = 0) {
  if (a.status === 'submitted') return finalResponse(env, a);
  if (a.status === 'locked') {
    throw Object.assign(new Error('Phiên thi đang bị tạm khóa do vi phạm quy chế. Vui lòng liên hệ cán bộ coi thi để xem xét mở khóa.'), {
      status: 423,
      detail: { code: 'ATTEMPT_LOCKED', status: 'locked', lock_reason: a.lock_reason || 'Vi phạm quy chế phòng thi' }
    });
  }
  if (a.status !== 'in_progress') throw Object.assign(new Error('Phiên thi không còn hoạt động.'), { status: 409, detail: { status: a.status } });
  const qs = safeJson(a.question_json, []);
  const answers = safeJson(a.answers_json, {}), events = cleanEvents(safeJson(a.event_log_json, []));
  await validateAttachmentAnswers(env, a.id, qs, answers);
  const scored = autoScore(qs, answers), table = source === 'guest' ? 'exam_guest_attempts' : 'exam_attempts', expectedRevision = Number(a.answer_revision || 0);
  const submittedAudit = JSON.stringify({ source, after_deadline: afterDeadline, answer_revision: expectedRevision });
  const change = await env.DB.batch([
    env.DB.prepare(
      `UPDATE ${table} SET answers_json=?,event_log_json=?,score=?,max_score=?,status='submitted',submitted_at=COALESCE(submitted_at,CURRENT_TIMESTAMP),last_saved_at=COALESCE(last_saved_at,CURRENT_TIMESTAMP) WHERE id=? AND status='in_progress' AND COALESCE(answer_revision,0)=?`
    ).bind(JSON.stringify(answers), JSON.stringify(events), scored.score, scored.max, a.id, expectedRevision),
    env.DB.prepare(
      `INSERT INTO exam_audit_log(id,exam_id,attempt_id,actor_user_id,event_type,detail_json) SELECT ?,?,?,?,'attempt.submitted',? WHERE EXISTS(SELECT 1 FROM ${table} WHERE id=? AND status='submitted') AND NOT EXISTS(SELECT 1 FROM exam_audit_log WHERE attempt_id=? AND event_type='attempt.submitted')`
    ).bind(crypto.randomUUID(), a.exam_id, a.id, source === 'guest' ? null : a.user_id, submittedAudit, a.id, a.id),
    env.DB.prepare(
      `INSERT INTO assessment_result_workflows(attempt_id,source,state,updated_at) SELECT ?,?,?,CURRENT_TIMESTAMP WHERE EXISTS(SELECT 1 FROM ${table} WHERE id=? AND status='submitted') ON CONFLICT(attempt_id) DO UPDATE SET source=excluded.source,state=excluded.state,updated_at=CURRENT_TIMESTAMP`
    ).bind(a.id, source, scored.manual.length ? 'marking' : 'graded', a.id)
  ]);
  if (!Number(change?.[0]?.meta?.changes || 0)) {
    const current = await env.DB.prepare(
      `SELECT a.*,COALESCE(a.question_snapshot_json,e.question_json) question_json,e.show_score,e.result_policy,e.result_release_at,e.closes_at,e.status exam_status FROM ${table} a JOIN exams e ON e.id=a.exam_id WHERE a.id=?`
    ).bind(a.id).first();
    if (current?.status === 'submitted') return finalResponse(env, current);
    const currentRevision = Number(current?.answer_revision || 0);
    if (afterDeadline && current?.status === 'in_progress' && currentRevision !== expectedRevision && retries < 3) {
      return finalize(env, source, current, {}, true, retries + 1);
    }
    throw Object.assign(new Error('Phiên thi vừa thay đổi. Vui lòng đồng bộ bài làm rồi thử lại.'), {
      status: 409,
      detail: { code: 'REVISION_CONFLICT', status: current?.status || 'unknown', answer_revision: currentRevision }
    });
  }
  await seedManual(env, a.id, scored.manual);
  const fresh = { ...a, status: 'submitted', answers_json: JSON.stringify(answers), event_log_json: JSON.stringify(events), score: scored.score, max_score: scored.max };
  const finalRes = await finalResponse(env, fresh);
  if (a.email && (env?.SEND_LIFECYCLE_EMAILS === '1' || env?.EMAIL_API_URL)) {
    await dispatchEventEmail(env, 'exam_session_ended', {
      to: a.email,
      examId: a.exam_id,
      attemptId: a.id,
      idempotencyKey: `exam-ended:${a.id}`,
      throwOnProviderError: false,
      data: {
        recipient_name: a.full_name || a.candidate_code || a.email,
        exam_title: a.title || a.exam_id,
        candidate_code: a.candidate_code || a.sfn_id || '',
        class_name: a.class_name || '',
        attempt_id: a.id,
        receipt_code: finalRes.receipt_code || '',
        submitted_at: nowIso(),
        score: finalRes.show_score ? finalRes.score : null,
        max_score: finalRes.show_score ? finalRes.max_score : null,
        show_score: finalRes.show_score,
        status_label: finalRes.pending_manual ? 'Đã nộp bài · Đang chờ chấm tự luận' : 'Đã nộp bài thành công'
      }
    }).catch(() => {});
  }
  return finalRes;
}

async function getAttempt(env, source, attemptId, request) {
  const a = await authorize(env, source, attemptId, request);
  await claimLease(env, source, attemptId, request);
  if (a.status === 'submitted') {
    throw Object.assign(new Error('Phiên thi đã được nộp.'), { status: 409, detail: { ...(await finalResponse(env, a)), status: 'submitted' } });
  }
  if (a.status === 'locked') {
    throw Object.assign(new Error('Phiên thi đang bị tạm khóa theo quy chế giám sát.'), {
      status: 423,
      detail: { code: 'ATTEMPT_LOCKED', status: 'locked', lock_reason: a.lock_reason || 'Phát hiện sự kiện rời màn hình hoặc vi phạm quy chế.' }
    });
  }
  if (a.status !== 'in_progress') {
    throw Object.assign(new Error('Phiên thi đã kết thúc.'), { status: 409, detail: { status: a.status } });
  }
  const deadline = attemptDeadline(a);
  if (deadline && Date.now() >= deadline) {
    const result = await finalize(env, source, a, {}, true);
    throw Object.assign(new Error('Đã hết thời gian. Bài làm đã được khóa và nộp.'), { status: 409, detail: result });
  }
  return ok({
    attempt_id: a.id,
    exam: {
      id: a.exam_id,
      title: a.title,
      instructions: a.instructions,
      duration_minutes: a.duration_minutes,
      time_limit_enabled: Number(a.time_limit_enabled) !== 0,
      strict_mode: Number(a.strict_mode) !== 0,
      fullscreen_required: Number(a.fullscreen_required) !== 0,
      show_score: Number(a.show_score) !== 0,
      assessment_type: a.assessment_type,
      assessment_label: a.assessment_label,
      center_label: a.center_label,
      security_profile: a.security_profile || 'STANDARD',
      allow_clipboard: Number(a.allow_clipboard) !== 0,
      allow_paste: Number(a.allow_paste) !== 0,
      allow_external_links: Number(a.allow_external_links) !== 0,
      device_policy: a.device_policy || 'single_session',
      resume_policy: a.resume_policy || 'same_session',
      calculator_policy: a.calculator_policy || 'disabled',
      security_level: Number(a.security_level || 1),
      security_config: normalizeSecurityConfig(a),
      privacy_policy: PRIVACY_COMPLIANCE_POLICY,
      variant_code: a.variant_code || generateVariantCode(a.exam_id, a.id),
      exam_dna: generateExamDnaFingerprint({ examId: a.exam_id, attemptId: a.id, candidateCode: a.candidate_code || a.sfn_id || '', variantCode: a.variant_code || generateVariantCode(a.exam_id, a.id), issuedAt: a.started_at }),
      honeytoken_canary: injectExamHoneytokens([], a.id, a.candidate_code || a.sfn_id || '').canary_token,
      questions: publicQuestions(a.question_json)
    },
    candidate: candidateFrom(a, source),
    answers: safeJson(a.answers_json, {}),
    events: safeJson(a.event_log_json, []),
    remaining_seconds: deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : null,
    lifecycle_state: a.lifecycle_state || a.status || 'in_progress',
    lifecycle_label: ATTEMPT_LIFECYCLE_STATES[a.lifecycle_state || a.status] || 'Đang thi',
    checkin_photos: safeJson(a.checkin_photos_json, {}),
    proctor_prompt: safeJson(a.proctor_prompt_json, null),
    answer_revision: Number(a.answer_revision || 0),
    last_saved_at: a.last_saved_at || null,
    server_time: nowIso(),
    deadline_at: deadline ? new Date(deadline).toISOString() : null
  });
}

async function saveAttempt(env, source, attemptId, request) {
  const a = await authorize(env, source, attemptId, request);
  await claimLease(env, source, attemptId, request);
  if (a.status === 'submitted') {
    throw Object.assign(new Error('Bài làm đã được nộp.'), { status: 409, detail: { ...(await finalResponse(env, a)), status: 'submitted' } });
  }
  if (a.status === 'locked') {
    throw Object.assign(new Error('Phiên thi đang bị khóa. Không thể ghi thêm câu trả lời cho đến khi được cán bộ coi thi mở khóa.'), {
      status: 423,
      detail: { code: 'ATTEMPT_LOCKED', status: 'locked', lock_reason: a.lock_reason || 'Vi phạm quy chế' }
    });
  }
  if (a.status !== 'in_progress') {
    throw Object.assign(new Error('Phiên thi không còn hoạt động.'), { status: 409, detail: { status: a.status } });
  }
  const deadline = attemptDeadline(a);
  if (deadline && Date.now() >= deadline) {
    const result = await finalize(env, source, a, {}, true);
    throw Object.assign(new Error('Đã hết thời gian. Bài làm đã được khóa và nộp.'), { status: 409, detail: result });
  }
  const body = await readJsonBody(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError('Cấu trúc yêu cầu không hợp lệ.', 400);
  if (!Object.hasOwn(body, 'answers')) throw httpError('Thiếu dữ liệu bài làm.', 400);
  const qs = safeJson(a.question_json, []), answers = sanitizeAnswers(body.answers, qs), answerJson = JSON.stringify(answers);
  if (new TextEncoder().encode(answerJson).byteLength > MAX_ANSWER_BYTES) throw httpError('Dữ liệu bài làm vượt giới hạn an toàn.', 413);
  await validateAttachmentAnswers(env, a.id, qs, answers);
  const clientRev = Number(body.revision ?? a.answer_revision ?? 0);
  if (!Number.isSafeInteger(clientRev) || clientRev < 0) throw httpError('Phiên bản bài làm không hợp lệ.', 400);
  if (clientRev !== Number(a.answer_revision || 0)) {
    throw Object.assign(new Error('Bài làm trên máy chủ đã có phiên bản mới hơn.'), {
      status: 409,
      detail: { code: 'REVISION_CONFLICT', answer_revision: Number(a.answer_revision || 0) }
    });
  }
  const events = cleanEvents(body.events, safeJson(a.event_log_json, [])), eventsJson = JSON.stringify(events), nextRev = Number(a.answer_revision || 0) + 1, table = source === 'guest' ? 'exam_guest_attempts' : 'exam_attempts';
  const wr = await env.DB.batch([
    env.DB.prepare(
      `UPDATE ${table} SET answers_json=?,event_log_json=?,answer_revision=?,last_saved_at=CURRENT_TIMESTAMP WHERE id=? AND status='in_progress' AND COALESCE(answer_revision,0)=? AND NOT EXISTS(SELECT 1 FROM assessment_answer_revisions WHERE attempt_id=? AND revision=?)`
    ).bind(answerJson, eventsJson, nextRev, a.id, Number(a.answer_revision || 0), a.id, nextRev),
    env.DB.prepare(
      `INSERT INTO assessment_answer_revisions(id,attempt_id,source,revision,answers_json,events_json,accepted_at) SELECT ?,?,?,?,?,?,CURRENT_TIMESTAMP WHERE EXISTS(SELECT 1 FROM ${table} WHERE id=? AND status='in_progress' AND COALESCE(answer_revision,0)=?) AND NOT EXISTS(SELECT 1 FROM assessment_answer_revisions WHERE attempt_id=? AND revision=?)`
    ).bind(crypto.randomUUID(), a.id, source, nextRev, answerJson, eventsJson, a.id, nextRev, a.id, nextRev)
  ]);
  if (!Number(wr?.[0]?.meta?.changes || 0)) {
    throw Object.assign(new Error('Bài làm vừa được cập nhật ở phiên khác.'), { status: 409, detail: { code: 'REVISION_CONFLICT' } });
  }
  return ok({ saved_at: nowIso(), answer_revision: nextRev });
}

async function submitAttempt(env, source, attemptId, request) {
  const a = await authorize(env, source, attemptId, request);
  await claimLease(env, source, attemptId, request);
  if (a.status === 'submitted') return ok(await finalResponse(env, a));
  if (a.status === 'locked') {
    throw Object.assign(new Error('Phiên thi đang bị khóa theo quy chế. Vui lòng liên hệ cán bộ coi thi.'), {
      status: 423,
      detail: { code: 'ATTEMPT_LOCKED', status: 'locked', lock_reason: a.lock_reason || 'Vi phạm quy chế' }
    });
  }
  if (a.status !== 'in_progress') {
    throw Object.assign(new Error('Phiên thi không còn hoạt động.'), { status: 409, detail: { status: a.status } });
  }
  const body = await readJsonBody(request), deadline = attemptDeadline(a), afterDeadline = !!(deadline && Date.now() >= deadline);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError('Cấu trúc yêu cầu không hợp lệ.', 400);
  if (!afterDeadline && body.revision != null && (!Number.isSafeInteger(Number(body.revision)) || Number(body.revision) !== Number(a.answer_revision || 0))) {
    throw Object.assign(new Error('Bài làm trên máy chủ đã có phiên bản mới hơn.'), {
      status: 409,
      detail: { code: 'REVISION_CONFLICT', answer_revision: Number(a.answer_revision || 0) }
    });
  }
  return ok(await finalize(env, source, a, body, afterDeadline));
}

async function recordViolation(env, source, attemptId, request) {
  const a = await authorize(env, source, attemptId, request);
  await claimLease(env, source, attemptId, request);
  if (a.status !== 'in_progress') {
    throw Object.assign(new Error('Phiên thi không còn hoạt động.'), { status: 409, detail: { status: a.status } });
  }
  const deadline = attemptDeadline(a);
  if (deadline && Date.now() >= deadline) {
    const result = await finalize(env, source, a, {}, true);
    throw Object.assign(new Error('Đã hết thời gian.'), { status: 409, detail: result });
  }
  const body = await readJsonBody(request, 300_000);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError('Cấu trúc yêu cầu không hợp lệ.', 400);
  const reason = str(body.reason).slice(0, 120) || 'integrity_event';
  const events = cleanEvents(body.events, safeJson(a.event_log_json, []));
  const secSummary = summarizeAndClassifyEvents(events, a.review_classification || 'info', Number(a.violation_threshold || 0));
  const table = source === 'guest' ? 'exam_guest_attempts' : 'exam_attempts';
  const currentRevision = Number(a.answer_revision || 0);

  // Check if exam has strict lock policy (security_profile === 'STRICT_LOCK' or violation_threshold > 0)
  const integrityViolations = events.filter(e => ['visibility_hidden', 'window_blur', 'fullscreen_exit', 'copy_blocked', 'paste_blocked'].includes(e.type)).length;
  let threshold = Number(a.violation_threshold || 0);
  if (!threshold && a.security_profile === 'STRICT_LOCK') threshold = 1;
  const shouldLock = Number(a.strict_mode) !== 0 && threshold > 0 && integrityViolations >= threshold;

  const updated = await env.DB.batch([
    env.DB.prepare(
      `UPDATE ${table} SET event_log_json=?,last_saved_at=COALESCE(last_saved_at,CURRENT_TIMESTAMP)${shouldLock ? `,status='locked'` : ''} WHERE id=? AND status='in_progress' AND COALESCE(answer_revision,0)=?`
    ).bind(JSON.stringify(events), a.id, currentRevision),
    env.DB.prepare(
      `INSERT INTO exam_audit_log(id,exam_id,attempt_id,actor_user_id,event_type,detail_json) SELECT ?,?,?,?,'integrity.signal',? WHERE EXISTS(SELECT 1 FROM ${table} WHERE id=? AND COALESCE(answer_revision,0)=?)`
    ).bind(crypto.randomUUID(), a.exam_id, a.id, source === 'guest' ? null : a.user_id, JSON.stringify({ reason, source, locked: shouldLock, violation_count: integrityViolations }), a.id, currentRevision)
  ]);
  if (!Number(updated?.[0]?.meta?.changes || 0)) {
    throw Object.assign(new Error('Bài làm vừa được cập nhật ở phiên khác.'), { status: 409, detail: { code: 'REVISION_CONFLICT' } });
  }
  if (shouldLock && a.email && (env?.SEND_LIFECYCLE_EMAILS === '1' || env?.EMAIL_API_URL)) {
    await dispatchEventEmail(env, 'integrity_warning', {
      to: a.email,
      examId: a.exam_id,
      attemptId: a.id,
      idempotencyKey: `integrity-lock:${a.id}:${currentRevision}`,
      throwOnProviderError: false,
      data: {
        recipient_name: a.full_name || a.candidate_code || a.email,
        exam_title: a.title || a.exam_id,
        candidate_code: a.candidate_code || a.sfn_id || '',
        attempt_id: a.id,
        event_time: nowIso(),
        status_label: 'Cảnh báo tín hiệu giám sát · Phiên thi tạm khóa để kiểm tra',
        reason: `Ghi nhận ${integrityViolations} tín hiệu (${reason})`
      }
    }).catch(() => {});
  }
  return ok({ recorded: true, terminated: false, locked: shouldLock, violation_count: integrityViolations });
}

async function reviewAttempt(env, source, attemptId, request) {
  const a = await authorize(env, source, attemptId, request);
  if (a.status !== 'submitted') throw httpError('Chỉ có thể xem lại sau khi đã nộp bài.', 403);
  const qs = safeJson(a.question_json, []);
  const { pending, wfState } = await computeTotalAttemptScore(env, a, qs);
  const closeMs = examTimeMs(a.closes_at);
  const allowed = a.result_policy === 'full_review_after_close' && (a.exam_status === 'closed' || wfState === 'published' || !!(closeMs && Date.now() >= closeMs)) && pending === 0;
  if (!allowed) throw httpError('Kỳ thi chưa mở quyền xem chi tiết đáp án và bài làm.', 403);
  const answers = safeJson(a.answers_json, {});
  const manualRes = await env.DB.prepare(`SELECT question_id, score, feedback, status FROM assessment_manual_grades WHERE attempt_id=?`).bind(a.id).all();
  const manualMap = new Map((manualRes?.results || []).map(r => [String(r.question_id), r]));
  return ok({
    title: a.title,
    score: a.score,
    max_score: a.max_score,
    questions: qs.map(q => ({
      id: str(q.id),
      type: str(q.type),
      question: String(q.question ?? ''),
      points: Number(q.points ?? 1),
      user_answer: answers[q.id] ?? null,
      answer: q.answer ?? null,
      explanation: q.explanation ?? '',
      manual_grade: manualMap.get(String(q.id)) || null
    }))
  });
}

async function uploadAttachment(env, source, attemptId, request) {
  if (env?.ALLOW_CANDIDATE_FILE_UPLOAD !== '1') {
    return bad('Theo quy định khảo thí Sky First, thí sinh không được tải tệp lên hệ thống để nộp bài làm. Vui lòng trình bày trực tiếp câu trả lời trên trình soạn thảo của hệ thống.', 403, { code: 'CANDIDATE_FILE_UPLOAD_FORBIDDEN' });
  }
  const a = await authorize(env, source, attemptId, request);
  await claimLease(env, source, attemptId, request);
  if (a.status !== 'in_progress') throw Object.assign(new Error('Phiên thi không còn hoạt động.'), { status: 409, detail: { status: a.status } });
  const deadline = attemptDeadline(a);
  if (deadline && Date.now() >= deadline) {
    const result = await finalize(env, source, a, {}, true);
    throw Object.assign(new Error('Đã hết thời gian.'), { status: 409, detail: result });
  }
  const fd = await request.formData(), file = fd.get('file'), questionId = str(fd.get('question_id'));
  if (!(file instanceof File) || !file.size || !questionId) throw Object.assign(new Error('Thiếu tệp hoặc mã câu hỏi.'), { status: 400 });
  const q = safeJson(a.question_json, []).find(x => String(x.id) === questionId);
  if (!q || !ATTACHMENT_TYPES.has(str(q.type))) throw Object.assign(new Error('Câu hỏi này không nhận tệp đính kèm.'), { status: 400 });
  const max = q.type === 'audio' ? 50 * 1024 * 1024 : 30 * 1024 * 1024;
  if (file.size > max) throw Object.assign(new Error(`Tệp vượt quá ${Math.round(max / 1024 / 1024)}MB.`), { status: 413 });
  const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (!mimeAllowed(file, q.type, bytes)) throw Object.assign(new Error('Định dạng tệp không phù hợp hoặc chữ ký tệp không hợp lệ.'), { status: 415 });
  const id = crypto.randomUUID(), key = `exam-responses/${a.exam_id}/${a.id}/${questionId}/${id}-${safeName(file.name)}`;
  await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
  try {
    await env.DB.batch([
      env.DB.prepare(`UPDATE assessment_response_files SET status='replaced' WHERE attempt_id=? AND question_id=? AND status='active'`).bind(a.id, questionId),
      env.DB.prepare(`INSERT INTO files(id,owner_user_id,r2_key,name,mime,size,visibility,created_at) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).bind(id, source === 'guest' ? null : a.user_id, key, file.name, file.type || '', file.size, 'private'),
      env.DB.prepare(`INSERT INTO assessment_response_files(id,attempt_id,source,question_id,file_id,status,created_at) VALUES(?,?,?,?,?,'active',CURRENT_TIMESTAMP)`).bind(crypto.randomUUID(), a.id, source, questionId, id)
    ]);
  } catch (error) {
    await env.FILES.delete(key).catch(() => {});
    throw error;
  }
  return ok({ file: { file_id: id, name: file.name, mime: file.type || '', size: file.size } });
}

async function redeemLaunch(env, request) {
  const body = await readJsonBody(request, 16_384);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError('Cấu trúc yêu cầu không hợp lệ.', 400);
  const raw = str(body.launch_token);
  if (!raw) return bad('Thiếu mã khởi chạy.', 400);
  if (raw.length > 4096) return bad('Mã khởi chạy không hợp lệ hoặc đã hết hạn.', 401);
  const hash = await sha256Text(raw);
  const row = await env.DB.prepare(`SELECT token_hash,user_id,attempt_id,expires_at,used_at FROM exam_launch_tokens WHERE token_hash=?`).bind(hash).first();
  const expires = databaseTimeMs(row?.expires_at);
  if (!row || row.used_at || !Number.isFinite(expires) || expires <= Date.now()) {
    return bad('Mã khởi chạy không hợp lệ hoặc đã hết hạn.', 401);
  }
  const access = randomHex(32), accessHash = await sha256Text(access), exp = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const batch = await env.DB.batch([
    env.DB.prepare(`UPDATE exam_launch_tokens SET used_at=CURRENT_TIMESTAMP WHERE token_hash=? AND used_at IS NULL AND datetime(expires_at)>CURRENT_TIMESTAMP`).bind(hash),
    env.DB.prepare(`INSERT INTO exam_access_tokens(token_hash,user_id,attempt_id,expires_at,created_at) SELECT ?,?,?,?,CURRENT_TIMESTAMP WHERE changes()=1`).bind(accessHash, row.user_id, row.attempt_id, exp)
  ]);
  if (!Number(batch?.[0]?.meta?.changes || 0)) return bad('Mã khởi chạy đã được sử dụng hoặc hết hạn.', 409);
  if (!Number(batch?.[1]?.meta?.changes || 0)) {
    throw httpError('Không thể tạo phiên truy cập. Vui lòng xin cấp lại liên kết dự thi.', 503, { code: 'ACCESS_TOKEN_NOT_PERSISTED' });
  }
  const candidate = await env.DB.prepare(
    `SELECT u.full_name,u.sfn_id candidate_code,c.name class_name FROM exam_attempts a JOIN users u ON u.id=a.user_id JOIN exams e ON e.id=a.exam_id LEFT JOIN classes c ON c.id=e.class_id WHERE a.id=?`
  ).bind(row.attempt_id).first().catch(() => null);
  return ok({ attempt_id: row.attempt_id, access_token: access, expires_at: exp, candidate: candidate || {} });
}

// =============================================================================
// STANDALONE CANDIDATE PORTAL APIs (Replacing SLC Control-Plane Proxy)
// =============================================================================
async function listPublicCatalog(env) {
  await ensureAdditiveSchema(env);
  try {
    const res = await env.DB.prepare(
      `SELECT id, title, instructions, duration_minutes, time_limit_enabled, strict_mode, fullscreen_required, assessment_type, assessment_label, center_label, opens_at, closes_at, status, public_token, public_access, require_email_verify FROM exams WHERE status='published' AND COALESCE(public_access, 0)=1 ORDER BY rowid DESC LIMIT 50`
    ).all();
    const exams = (res?.results || []).map(e => ({
      id: e.id,
      code: e.public_token || e.id,
      title: e.title,
      assessment_label: e.assessment_label || 'Đánh giá năng lực',
      center_label: e.center_label || 'Hệ Thống Khảo Thí Và Đánh Giá Sky First',
      duration_minutes: e.duration_minutes,
      time_limit_enabled: Number(e.time_limit_enabled) !== 0,
      strict_mode: Number(e.strict_mode) !== 0,
      fullscreen_required: Number(e.fullscreen_required) !== 0,
      require_email_verify: Number(e.require_email_verify) !== 0,
      opens_at: e.opens_at || null,
      closes_at: e.closes_at || null
    }));
    return ok({ exams });
  } catch {
    return ok({ exams: [] });
  }
}

async function resolvePublicExamByCode(env, code) {
  await ensureAdditiveSchema(env);
  const cleanCode = str(code);
  if (!cleanCode) return null;
  let exam = await env.DB.prepare(
    `SELECT * FROM exams WHERE (public_token=? OR id=?) LIMIT 1`
  ).bind(cleanCode, cleanCode).first().catch(() => null);
  if (!exam) {
    exam = await env.DB.prepare(`SELECT * FROM exams WHERE id=? LIMIT 1`).bind(cleanCode).first().catch(() => null);
  }
  return exam;
}

async function getPublicAssessmentInfo(env, code) {
  const e = await resolvePublicExamByCode(env, code);
  if (!e || ['draft', 'cancelled', 'archived'].includes(str(e.status))) {
    return bad('Không tìm thấy kỳ thi hoặc kỳ thi hiện không mở.', 404);
  }
  const now = Date.now();
  const openMs = examTimeMs(e.opens_at);
  const closeMs = examTimeMs(e.closes_at);
  let publicStatus = 'Kỳ thi đang mở tiếp nhận thí sinh';
  if (e.status !== 'published') publicStatus = 'Kỳ thi hiện đang tạm dừng hoặc đã đóng';
  else if (openMs && now < openMs) publicStatus = 'Kỳ thi chưa đến giờ mở';
  else if (closeMs && now >= closeMs) publicStatus = 'Kỳ thi đã hết hạn đăng ký / làm bài';

  return ok({
    exam: {
      id: e.id,
      code: e.public_token || e.id,
      title: e.title,
      instructions: e.instructions || '',
      duration_minutes: e.duration_minutes,
      time_limit_enabled: Number(e.time_limit_enabled) !== 0,
      strict_mode: Number(e.strict_mode) !== 0,
      fullscreen_required: Number(e.fullscreen_required) !== 0,
      assessment_type: e.assessment_type,
      assessment_label: e.assessment_label || 'Đánh giá năng lực',
      center_label: e.center_label || 'Hệ Thống Khảo Thí Và Đánh Giá Sky First',
      require_email_verify: Number(e.require_email_verify) !== 0,
      public_status: publicStatus,
      status: e.status,
      schedule: {
        opens_at: e.opens_at || null,
        closes_at: e.closes_at || null
      }
    }
  });
}

async function requestCandidateVerification(env, code, request) {
  const e = await resolvePublicExamByCode(env, code);
  if (!e || e.status !== 'published') return bad('Kỳ thi hiện không mở.', 403);
  const body = await readJsonBody(request, 16_384);
  const email = str(body.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 220) {
    return bad('Địa chỉ email không hợp lệ.', 400);
  }
  await checkRateLimit(env, `otp:cand:${e.id}:${email}`, 5, 10 * 60 * 1000);

  // No fixed cooldown timer: previous unused OTP is invalidated below before issuing a new OTP

  // Anti-enumeration check: if exam is restricted to enrolled candidates only (public_access === 0),
  // check enrollment silently or return uniform response if not enrolled.
  const enrollmentCountRow = await env.DB.prepare(`SELECT COUNT(*) n FROM exam_enrollments WHERE exam_id=?`).bind(e.id).first().catch(() => ({ n: 0 }));
  const hasEnrollmentList = Number(enrollmentCountRow?.n || 0) > 0 || Number(e.public_access ?? 1) === 0;
  let enrolled = null;
  if (hasEnrollmentList) {
    enrolled = await env.DB.prepare(`SELECT * FROM exam_enrollments WHERE exam_id=? AND LOWER(email)=? AND status='active'`).bind(e.id, email).first();
    if (enrolled && isAccountExpired(enrolled)) {
      return bad('Thời hạn ghi danh dự thi của tài khoản này đã hết hạn.', 403, { code: 'ENROLLMENT_EXPIRED' });
    }
    if (!enrolled && Number(e.public_access ?? 1) === 0) {
      // Uniform message to prevent account enumeration, while recording audit event
      await recordAudit(env, { examId: e.id, eventType: 'candidate.otp.unlisted_email', detail: { email_domain: email.split('@')[1] || '' } });
      return bad('Email chưa nằm trong danh sách đủ điều kiện dự thi hoặc kỳ thi yêu cầu ghi danh trước.', 403, { code: 'ELIGIBILITY_REQUIRED' });
    }
  }

  await env.DB.prepare(`UPDATE exam_otp_challenges SET used_at=CURRENT_TIMESTAMP WHERE email=? AND purpose='candidate_verify' AND scope_id=? AND used_at IS NULL`).bind(email, e.id).run().catch(() => {});
  const otp = randomOtp6();
  const otpHash = await sha256Text(`${email}:${e.id}:${otp}`);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const challengeId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO exam_otp_challenges(id,email,purpose,scope_id,otp_hash,attempts,max_attempts,expires_at,created_at) VALUES(?,?,'candidate_verify',?,?,0,5,?,CURRENT_TIMESTAMP)`
  ).bind(challengeId, email, e.id, otpHash, expiresAt).run();

  const mailResult = await dispatchEventEmail(env, 'email_verification', {
    to: email,
    examId: e.id,
    idempotencyKey: `cand-otp:${challengeId}`,
    throwOnProviderError: true,
    data: {
      recipient_name: enrolled?.full_name || email,
      exam_title: e.title,
      candidate_code: enrolled?.candidate_code || '',
      class_name: enrolled?.class_name || '',
      otp_code: otp,
      expires_minutes: 10,
      status_label: 'Chờ xác minh mã OTP dự thi'
    }
  });

  await recordAudit(env, {
    examId: e.id,
    eventType: 'candidate.otp.requested',
    detail: { challenge_id: challengeId, email_delivered: mailResult.delivered, provider: mailResult.provider }
  });

  if (!mailResult.delivered) {
    return json({
      ok: false,
      code: 'EMAIL_SERVICE_UNCONFIGURED',
      message: 'Dịch vụ gửi email OTP chưa được cấu hình trong môi trường này nên không thể gửi mã qua hộp thư thực tế.',
      detail: { code: 'EMAIL_SERVICE_UNCONFIGURED', reason: mailResult.reason }
    }, 503);
  }

  return ok({
    sent: true,
    expires_in_seconds: 600,
    message: 'Đã gửi mã xác minh 6 số tới hộp thư của bạn.'
  });
}

async function startPublicAssessment(env, code, request) {
  const e = await resolvePublicExamByCode(env, code);
  if (!e) return bad('Không tìm thấy kỳ thi.', 404);
  if (e.status !== 'published') return bad('Kỳ thi hiện chưa mở hoặc đã kết thúc.', 403, { code: 'EXAM_NOT_OPEN' });

  const now = Date.now();
  const openMs = examTimeMs(e.opens_at);
  const closeMs = examTimeMs(e.closes_at);
  if (openMs && now < openMs) return bad('Chưa đến thời gian mở kỳ thi.', 403, { code: 'EXAM_NOT_YET_OPEN' });
  if (closeMs && now >= closeMs) return bad('Đã hết thời gian mở kỳ thi.', 403, { code: 'EXAM_CLOSED' });

  const body = await readJsonBody(request, 32_768);
  const fullName = str(body.full_name).slice(0, 160);
  const email = str(body.email).toLowerCase().slice(0, 220);
  const candidateCode = str(body.candidate_code).slice(0, 100);
  const className = str(body.class_name).slice(0, 160);
  const verificationCode = str(body.verification_code);

  if (!fullName || !email || !candidateCode) {
    return bad('Vui lòng điền đầy đủ Họ tên, Email và Mã dự thi.', 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return bad('Địa chỉ email không hợp lệ.', 400);
  }

  await checkRateLimit(env, `start:${e.id}:${email}`, 10, 10 * 60 * 1000);

  // Check enrollment / eligibility rules
  const enrollmentCountRow = await env.DB.prepare(`SELECT COUNT(*) n FROM exam_enrollments WHERE exam_id=?`).bind(e.id).first().catch(() => ({ n: 0 }));
  const hasEnrollmentList = Number(enrollmentCountRow?.n || 0) > 0;
  const enrolled = await env.DB.prepare(`SELECT * FROM exam_enrollments WHERE exam_id=? AND LOWER(email)=?`).bind(e.id, email).first().catch(() => null);

  if (enrolled && isAccountExpired(enrolled)) {
    return bad('Thời hạn tham gia kỳ thi của hồ sơ này đã hết hạn.', 403, { code: 'ENROLLMENT_EXPIRED' });
  }
  if (enrolled && enrolled.status !== 'active') {
    return bad('Quyền tham gia kỳ thi của tài khoản này đang bị khóa hoặc thu hồi.', 403, { code: 'ENROLLMENT_LOCKED' });
  }
  if (!enrolled && (Number(e.public_access ?? 1) === 0 || (hasEnrollmentList && Number(e.public_access) === 0))) {
    return bad('Email này không có trong danh sách ghi danh của kỳ thi.', 403, { code: 'NOT_ENROLLED' });
  }

  // Verify OTP if required by exam
  if (Number(e.require_email_verify) !== 0) {
    if (!/^\d{6}$/.test(verificationCode)) {
      return bad('Vui lòng nhập mã xác minh 6 số hợp lệ.', 400, { code: 'OTP_REQUIRED' });
    }
    const challenge = await env.DB.prepare(
      `SELECT * FROM exam_otp_challenges WHERE email=? AND purpose='candidate_verify' AND scope_id=? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`
    ).bind(email, e.id).first();
    const expMs = databaseTimeMs(challenge?.expires_at);
    if (!challenge || !Number.isFinite(expMs) || expMs <= Date.now()) {
      return bad('Mã xác minh không tồn tại hoặc đã hết hạn.', 401, { code: 'OTP_EXPIRED' });
    }
    if (Number(challenge.attempts || 0) >= Number(challenge.max_attempts || 5)) {
      return bad('Mã xác minh đã vượt quá số lần thử cho phép. Vui lòng yêu cầu mã mới.', 429, { code: 'OTP_MAX_ATTEMPTS' });
    }
    const expectedHash = await sha256Text(`${email}:${e.id}:${verificationCode}`);
    if (expectedHash !== challenge.otp_hash) {
      await env.DB.prepare(`UPDATE exam_otp_challenges SET attempts = attempts + 1 WHERE id=?`).bind(challenge.id).run();
      return bad('Mã xác minh không chính xác.', 401, { code: 'OTP_INVALID' });
    }
    const claim = await env.DB.prepare(`UPDATE exam_otp_challenges SET used_at=CURRENT_TIMESTAMP WHERE id=? AND used_at IS NULL`).bind(challenge.id).run();
    if (!Number(claim?.meta?.changes || 0)) {
      return bad('Mã xác minh đã được sử dụng.', 409, { code: 'OTP_ALREADY_USED' });
    }
    if (enrolled) {
      await env.DB.prepare(`UPDATE exam_enrollments SET verified_at=CURRENT_TIMESTAMP WHERE id=?`).bind(enrolled.id).run().catch(() => {});
    }
  }

  // Section 17 Anti-Bypass Guard: Prevent creating a new attempt to bypass a locked or suspended attempt
  const existingLocked = await env.DB.prepare(
    `SELECT id, status, lock_reason FROM exam_guest_attempts WHERE exam_id=? AND (LOWER(email)=? OR LOWER(candidate_code)=LOWER(?)) AND status IN ('locked','suspended') ORDER BY started_at DESC LIMIT 1`
  ).bind(e.id, email, candidateCode).first().catch(() => null);
  if (existingLocked) {
    return bad('Phiên dự thi của bạn đang ở trạng thái tạm khóa hoặc đình chỉ chờ giám thị xác minh. Không thể tạo phiên mới để né tránh trạng thái khóa.', 423, {
      code: 'ATTEMPT_LOCKED_CANNOT_BYPASS',
      attempt_id: existingLocked.id,
      status: existingLocked.status
    });
  }

  // Check if candidate already has an active in_progress attempt for this exam (resume support)
  const existingActive = await env.DB.prepare(
    `SELECT id, access_key, started_at, duration_minutes, time_limit_enabled, extra_time_minutes FROM exam_guest_attempts WHERE exam_id=? AND (LOWER(email)=? OR candidate_code=?) AND status='in_progress' ORDER BY started_at DESC LIMIT 1`
  ).bind(e.id, email, candidateCode).first().catch(() => null);

  if (existingActive) {
    const dl = attemptDeadline(existingActive);
    if (!dl || Date.now() < dl) {
      return ok({
        attempt_id: existingActive.id,
        access_key: existingActive.access_key,
        resumed: true
      });
    }
  }

  // Check max attempts limit
  const maxAttempts = Math.max(1, Number(e.max_attempts || 1));
  const usedCountRow = await env.DB.prepare(
    `SELECT COUNT(*) n FROM exam_guest_attempts WHERE exam_id=? AND (LOWER(email)=? OR candidate_code=?)`
  ).bind(e.id, email, candidateCode).first().catch(() => ({ n: 0 }));
  if (Number(usedCountRow?.n || 0) >= maxAttempts) {
    return bad(`Bạn đã sử dụng hết số lượt dự thi cho phép (${maxAttempts} lượt).`, 403, { code: 'MAX_ATTEMPTS_REACHED' });
  }

  const attemptId = crypto.randomUUID();
  const accessKey = randomHex(24);
  let rawQuestions = safeJson(e.question_json, []);
  if (e.sealed_version_id) {
    const ver = await env.DB.prepare(`SELECT snapshot_json FROM assessment_exam_versions WHERE id=?`).bind(e.sealed_version_id).first().catch(() => null);
    const snap = safeJson(ver?.snapshot_json, null);
    if (snap && Array.isArray(snap.questions)) rawQuestions = snap.questions;
  }
  const snapshotQuestions = buildAttemptQuestionSnapshot(rawQuestions, e, attemptId);

  try {
    await env.DB.prepare(
      `INSERT INTO exam_guest_attempts(id,exam_id,status,started_at,duration_minutes,time_limit_enabled,extra_time_minutes,answers_json,event_log_json,score,max_score,submitted_at,last_saved_at,answer_revision,question_snapshot_json,exam_version_id,access_key,full_name,email,candidate_code,class_name) VALUES(?,?,'in_progress',CURRENT_TIMESTAMP,?,?,0,'{}','[]',NULL,NULL,NULL,NULL,0,?,?,?,?,?,?,?)`
    ).bind(
      attemptId, e.id, Number(e.duration_minutes || 60), Number(e.time_limit_enabled ?? 1),
      JSON.stringify(snapshotQuestions), e.sealed_version_id || null, accessKey,
      fullName, email, candidateCode, className
    ).run();
  } catch {
    // Fallback for strict 20-column legacy table without email column
    await env.DB.prepare(
      `INSERT INTO exam_guest_attempts(id,exam_id,status,started_at,duration_minutes,time_limit_enabled,extra_time_minutes,answers_json,event_log_json,score,max_score,submitted_at,last_saved_at,answer_revision,question_snapshot_json,exam_version_id,access_key,full_name,candidate_code,class_name) VALUES(?,?,'in_progress',CURRENT_TIMESTAMP,?,?,0,'{}','[]',NULL,NULL,NULL,NULL,0,?,?,?,?,?,?)`
    ).bind(
      attemptId, e.id, Number(e.duration_minutes || 60), Number(e.time_limit_enabled ?? 1),
      JSON.stringify(snapshotQuestions), e.sealed_version_id || null, accessKey,
      fullName, candidateCode, className
    ).run();
  }

  await recordAudit(env, {
    examId: e.id,
    attemptId,
    eventType: 'attempt.started',
    detail: { source: 'guest', candidate_code: candidateCode, class_name: className }
  });

  return ok({ attempt_id: attemptId, access_key: accessKey, resumed: false });
}

const FORBIDDEN_EVIDENCE_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'com', 'sh', 'bash', 'ps1', 'vbs', 'js', 'mjs', 'cjs',
  'php', 'py', 'rb', 'pl', 'jar', 'dll', 'so', 'dylib', 'msi', 'scr', 'html',
  'htm', 'xhtml', 'svg', 'xml', 'hta', 'wsf', 'reg'
]);

const ALLOWED_EVIDENCE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'pdf', 'txt', 'csv', 'doc', 'docx', 'xls',
  'xlsx', 'ppt', 'pptx', 'zip', 'mp3', 'mp4', 'm4a', 'wav', 'webm', 'ogg'
]);


async function getAdminDashboard(env, request) {
  const admin = await authorizeAdmin(env, request, 'dashboard:view');
  const now = nowIso();

  const totalExams = Number((await env.DB.prepare(`SELECT COUNT(*) n FROM exams`).first())?.n || 0);
  const openExams = Number((await env.DB.prepare(`SELECT COUNT(*) n FROM exams WHERE status='published' AND (opens_at IS NULL OR opens_at<=?) AND (closes_at IS NULL OR closes_at>?)`).bind(now, now).first())?.n || 0);
  const upcomingExams = Number((await env.DB.prepare(`SELECT COUNT(*) n FROM exams WHERE status IN ('approved','published') AND opens_at IS NOT NULL AND opens_at>?`).bind(now).first())?.n || 0);
  const closedExams = Number((await env.DB.prepare(`SELECT COUNT(*) n FROM exams WHERE status IN ('closed','archived') OR (closes_at IS NOT NULL AND closes_at<=?)`).bind(now).first())?.n || 0);

  const enrolledCount = Number((await env.DB.prepare(`SELECT COUNT(*) n FROM exam_enrollments WHERE status='active'`).first().catch(() => ({ n: 0 })))?.n || 0);
  const internalCandidates = Number((await env.DB.prepare(`SELECT COUNT(*) n FROM users WHERE status='active' AND COALESCE(role,'candidate')='candidate'`).first())?.n || 0);

  const inProgressInternal = Number((await env.DB.prepare(`SELECT COUNT(*) n FROM exam_attempts WHERE status='in_progress'`).first())?.n || 0);
  const inProgressGuest = Number((await env.DB.prepare(`SELECT COUNT(*) n FROM exam_guest_attempts WHERE status='in_progress'`).first())?.n || 0);

  const submittedInternal = Number((await env.DB.prepare(`SELECT COUNT(*) n FROM exam_attempts WHERE status='submitted'`).first())?.n || 0);
  const submittedGuest = Number((await env.DB.prepare(`SELECT COUNT(*) n FROM exam_guest_attempts WHERE status='submitted'`).first())?.n || 0);

  const lockedInternal = Number((await env.DB.prepare(`SELECT COUNT(*) n FROM exam_attempts WHERE status='locked'`).first())?.n || 0);
  const lockedGuest = Number((await env.DB.prepare(`SELECT COUNT(*) n FROM exam_guest_attempts WHERE status='locked'`).first())?.n || 0);

  const pendingGrading = Number((await env.DB.prepare(`SELECT COUNT(*) n FROM assessment_result_workflows WHERE state='marking'`).first())?.n || 0);
  const pendingPublish = Number((await env.DB.prepare(`SELECT COUNT(*) n FROM assessment_result_workflows WHERE state IN ('graded','approved')`).first())?.n || 0);
  const publishedResults = Number((await env.DB.prepare(`SELECT COUNT(*) n FROM assessment_result_workflows WHERE state='published'`).first())?.n || 0);

  const integrityAlerts = Number((await env.DB.prepare(`SELECT COUNT(*) n FROM exam_audit_log WHERE event_type='integrity.signal'`).first())?.n || 0);
  const pendingAppeals = Number((await env.DB.prepare(`SELECT COUNT(*) n FROM exam_appeals WHERE status IN ('pending','reviewing')`).first().catch(() => ({ n: 0 })))?.n || 0);
  const openSupport = Number((await env.DB.prepare(`SELECT COUNT(*) n FROM exam_support_requests WHERE status='open'`).first().catch(() => ({ n: 0 })))?.n || 0);

  const recentAuditRows = (await env.DB.prepare(
    `SELECT id, exam_id, attempt_id, actor_user_id, event_type, detail_json FROM exam_audit_log ORDER BY rowid DESC LIMIT 15`
  ).all())?.results || [];

  return ok({
    admin: { id: admin.user_id, email: admin.email, full_name: admin.full_name, roles: admin.roles },
    metrics: {
      total_exams: totalExams,
      open_exams: openExams,
      upcoming_exams: upcomingExams,
      closed_exams: closedExams,
      total_registered_candidates: enrolledCount + internalCandidates,
      enrolled_records: enrolledCount,
      active_attempts: inProgressInternal + inProgressGuest,
      locked_attempts: lockedInternal + lockedGuest,
      submitted_attempts: submittedInternal + submittedGuest,
      pending_manual_grading: pendingGrading,
      pending_result_publication: pendingPublish,
      published_results: publishedResults,
      security_events: integrityAlerts,
      pending_appeals: pendingAppeals,
      open_support_requests: openSupport
    },
    recent_activities: recentAuditRows.map(r => ({
      id: r.id,
      exam_id: r.exam_id,
      attempt_id: r.attempt_id,
      actor_user_id: r.actor_user_id,
      event_type: r.event_type,
      detail: safeJson(r.detail_json, {})
    })),
    generated_at: now
  });
}

// =============================================================================
// ADMIN EXAM MANAGEMENT & LIFECYCLE
// =============================================================================
async function adminListExams(env, request) {
  await authorizeAdmin(env, request, 'exams:read');
  const rows = (await env.DB.prepare(`SELECT * FROM exams ORDER BY rowid DESC LIMIT 200`).all())?.results || [];
  const exams = [];
  for (const r of rows) {
    const qs = safeJson(r.question_json, []);
    const activeAttempts = Number((await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM exam_attempts WHERE exam_id=? AND status='in_progress') + (SELECT COUNT(*) FROM exam_guest_attempts WHERE exam_id=? AND status='in_progress') n`).bind(r.id, r.id).first())?.n || 0);
    const totalAttempts = Number((await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM exam_attempts WHERE exam_id=?) + (SELECT COUNT(*) FROM exam_guest_attempts WHERE exam_id=?) n`).bind(r.id, r.id).first())?.n || 0);
    exams.push({
      ...r,
      question_count: Array.isArray(qs) ? qs.length : 0,
      active_attempts: activeAttempts,
      total_attempts: totalAttempts
    });
  }
  return ok({ exams });
}

async function adminGetExam(env, examId, request) {
  await authorizeAdmin(env, request, 'exams:read');
  const exam = await env.DB.prepare(`SELECT * FROM exams WHERE id=?`).bind(examId).first();
  if (!exam) return bad('Không tìm thấy kỳ thi.', 404);
  const versions = (await env.DB.prepare(`SELECT id, snapshot_json FROM assessment_exam_versions WHERE id=?`).bind(exam.sealed_version_id || '').all())?.results || [];
  return ok({
    exam: {
      ...exam,
      questions: safeJson(exam.question_json, [])
    },
    versions
  });
}

function validateQuestionsArray(questions) {
  if (!Array.isArray(questions)) throw httpError('Danh sách câu hỏi phải là mảng.', 400);
  const seenIds = new Set();
  return questions.map((q, idx) => {
    if (!q || typeof q !== 'object') throw httpError(`Câu hỏi thứ ${idx + 1} không hợp lệ.`, 400);
    const id = str(q.id || `q-${idx + 1}`);
    if (seenIds.has(id)) throw httpError(`Trùng mã câu hỏi: ${id}.`, 400);
    seenIds.add(id);
    const type = str(q.type || 'mcq');
    const questionText = str(q.question);
    if (!questionText) throw httpError(`Câu hỏi "${id}" thiếu nội dung đề bài.`, 400);
    const pts = Number(q.points ?? 1);
    if (!Number.isFinite(pts) || pts < 0) throw httpError(`Điểm số của câu "${id}" không hợp lệ.`, 400);
    const options = Array.isArray(q.options) ? q.options.map(String) : [];
    return {
      id,
      type,
      question: questionText,
      options,
      answer: q.answer ?? null,
      explanation: str(q.explanation || ''),
      points: pts,
      topic: str(q.topic || 'Chung'),
      difficulty: str(q.difficulty || 'medium'),
      content_language: str(q.content_language || 'vi'),
      script_direction: str(q.script_direction || 'ltr'),
      stimulus: q.stimulus ?? undefined,
      numeric_tolerance: q.numeric_tolerance != null ? Number(q.numeric_tolerance) : undefined,
      recording_duration_seconds: q.recording_duration_seconds != null ? Number(q.recording_duration_seconds) : undefined
    };
  });
}

async function adminCreateOrUpdateExam(env, examId, request, isCreate = false) {
  const admin = await authorizeAdmin(env, request, 'exams:write');
  const body = await readJsonBody(request);
  const id = isCreate ? (str(body.id) || `exam-${crypto.randomUUID().slice(0, 8)}`) : examId;
  const existing = await env.DB.prepare(`SELECT * FROM exams WHERE id=?`).bind(id).first();
  if (!isCreate && !existing) return bad('Không tìm thấy kỳ thi cần chỉnh sửa.', 404);
  if (isCreate && existing) return bad('Mã kỳ thi đã tồn tại.', 409);

  // Protect active attempts from unfair mid-exam question/duration/answer changes (Article 13 & 26)
  if (existing) {
    const activeCount = Number((await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM exam_attempts WHERE exam_id=? AND status='in_progress') + (SELECT COUNT(*) FROM exam_guest_attempts WHERE exam_id=? AND status='in_progress') n`
    ).bind(id, id).first())?.n || 0);

    if (activeCount > 0) {
      const incomingQuestions = body.questions !== undefined ? JSON.stringify(validateQuestionsArray(body.questions)) : existing.question_json;
      const durationChanged = body.duration_minutes !== undefined && Number(body.duration_minutes) !== Number(existing.duration_minutes);
      const questionsChanged = body.questions !== undefined && incomingQuestions !== existing.question_json;
      if (durationChanged || questionsChanged) {
        return bad('Không thể thay đổi đề thi, đáp án hoặc thời lượng làm bài khi đang có thí sinh trong phòng thi.', 409, {
          code: 'ACTIVE_ATTEMPTS_PROTECTED',
          active_attempts: activeCount
        });
      }
    }
  }

  const title = str(body.title ?? existing?.title);
  if (!title) return bad('Tiêu đề kỳ thi không được để trống.', 400);
  const instructions = str(body.instructions ?? existing?.instructions ?? '');
  const durationMinutes = Math.max(1, Number(body.duration_minutes ?? existing?.duration_minutes ?? 60));
  const timeLimitEnabled = body.time_limit_enabled !== undefined ? (body.time_limit_enabled ? 1 : 0) : Number(existing?.time_limit_enabled ?? 1);
  const strictMode = body.strict_mode !== undefined ? (body.strict_mode ? 1 : 0) : Number(existing?.strict_mode ?? 0);
  const fullscreenRequired = body.fullscreen_required !== undefined ? (body.fullscreen_required ? 1 : 0) : Number(existing?.fullscreen_required ?? 0);
  const showScore = body.show_score !== undefined ? (body.show_score ? 1 : 0) : Number(existing?.show_score ?? 1);
  const assessmentType = str(body.assessment_type ?? existing?.assessment_type ?? 'assessment');
  const assessmentLabel = str(body.assessment_label ?? existing?.assessment_label ?? 'Đánh giá năng lực');
  const centerLabel = str(body.center_label ?? existing?.center_label ?? 'Hệ Thống Khảo Thí Và Đánh Giá Sky First');
  const resultPolicy = str(body.result_policy ?? existing?.result_policy ?? 'score_after_submit');
  const resultReleaseAt = body.result_release_at !== undefined ? (str(body.result_release_at) || null) : (existing?.result_release_at || null);
  const opensAt = body.opens_at !== undefined ? (str(body.opens_at) || null) : (existing?.opens_at || null);
  const closesAt = body.closes_at !== undefined ? (str(body.closes_at) || null) : (existing?.closes_at || null);
  if (opensAt && closesAt) {
    const openMs = examTimeMs(opensAt), closeMs = examTimeMs(closesAt);
    if (!Number.isFinite(openMs) || !Number.isFinite(closeMs) || closeMs <= openMs) {
      return bad('Thời gian đóng kỳ thi phải sau thời gian mở kỳ thi.', 400, { code: 'INVALID_SCHEDULE_WINDOW' });
    }
  }
  const securityProfile = str(body.security_profile ?? existing?.security_profile ?? 'STANDARD');
  const allowClipboard = body.allow_clipboard !== undefined ? (body.allow_clipboard ? 1 : 0) : Number(existing?.allow_clipboard ?? 1);
  const allowPaste = body.allow_paste !== undefined ? (body.allow_paste ? 1 : 0) : Number(existing?.allow_paste ?? 1);
  const allowExternalLinks = body.allow_external_links !== undefined ? (body.allow_external_links ? 1 : 0) : Number(existing?.allow_external_links ?? 0);
  const devicePolicy = str(body.device_policy ?? existing?.device_policy ?? 'single_session');
  const resumePolicy = str(body.resume_policy ?? existing?.resume_policy ?? 'same_session');
  const calculatorPolicy = str(body.calculator_policy ?? existing?.calculator_policy ?? 'disabled');
  const publicToken = str(body.public_token ?? existing?.public_token ?? id.toUpperCase());
  const publicAccess = body.public_access !== undefined ? (body.public_access ? 1 : 0) : Number(existing?.public_access ?? 1);
  const requireEmailVerify = body.require_email_verify !== undefined ? (body.require_email_verify ? 1 : 0) : Number(existing?.require_email_verify ?? 0);
  const maxAttempts = Math.max(1, Number(body.max_attempts ?? existing?.max_attempts ?? 1));
  const passingScore = Math.max(0, Number(body.passing_score ?? existing?.passing_score ?? 0));
  const violationThreshold = Math.max(0, Number(body.violation_threshold ?? existing?.violation_threshold ?? 0));
  const randomizeQuestions = body.randomize_questions !== undefined ? (body.randomize_questions ? 1 : 0) : Number(existing?.randomize_questions ?? 0);
  const randomizeOptions = body.randomize_options !== undefined ? (body.randomize_options ? 1 : 0) : Number(existing?.randomize_options ?? 0);

  const questions = body.questions !== undefined
    ? validateQuestionsArray(body.questions)
    : safeJson(existing?.question_json ?? '[]', []);
  const questionJson = JSON.stringify(questions);
  const status = isCreate ? str(body.status || 'draft') : str(existing.status || 'draft');

  if (isCreate) {
    try {
      await env.DB.prepare(
        `INSERT INTO exams(id,title,instructions,duration_minutes,time_limit_enabled,strict_mode,fullscreen_required,show_score,assessment_type,assessment_label,center_label,result_policy,result_release_at,opens_at,closes_at,status,security_profile,allow_clipboard,allow_paste,allow_external_links,device_policy,resume_policy,calculator_policy,question_json,class_id,sealed_version_id,public_token,public_access,require_email_verify,max_attempts,passing_score,violation_threshold,randomize_questions,randomize_options) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        id, title, instructions, durationMinutes, timeLimitEnabled, strictMode, fullscreenRequired, showScore,
        assessmentType, assessmentLabel, centerLabel, resultPolicy, resultReleaseAt, opensAt, closesAt, status,
        securityProfile, allowClipboard, allowPaste, allowExternalLinks, devicePolicy, resumePolicy, calculatorPolicy,
        questionJson, body.class_id || null, null, publicToken, publicAccess, requireEmailVerify, maxAttempts, passingScore,
        violationThreshold, randomizeQuestions, randomizeOptions
      ).run();
    } catch {
      await env.DB.prepare(
        `INSERT INTO exams(id,title,instructions,duration_minutes,time_limit_enabled,strict_mode,fullscreen_required,show_score,assessment_type,assessment_label,center_label,result_policy,result_release_at,closes_at,status,security_profile,allow_clipboard,allow_paste,allow_external_links,device_policy,resume_policy,calculator_policy,question_json,class_id,sealed_version_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        id, title, instructions, durationMinutes, timeLimitEnabled, strictMode, fullscreenRequired, showScore,
        assessmentType, assessmentLabel, centerLabel, resultPolicy, resultReleaseAt, closesAt, status,
        securityProfile, allowClipboard, allowPaste, allowExternalLinks, devicePolicy, resumePolicy, calculatorPolicy,
        questionJson, body.class_id || null, null
      ).run();
    }
  } else {
    try {
      await env.DB.prepare(
        `UPDATE exams SET title=?,instructions=?,duration_minutes=?,time_limit_enabled=?,strict_mode=?,fullscreen_required=?,show_score=?,assessment_type=?,assessment_label=?,center_label=?,result_policy=?,result_release_at=?,opens_at=?,closes_at=?,security_profile=?,allow_clipboard=?,allow_paste=?,allow_external_links=?,device_policy=?,resume_policy=?,calculator_policy=?,question_json=?,public_token=?,public_access=?,require_email_verify=?,max_attempts=?,passing_score=?,violation_threshold=?,randomize_questions=?,randomize_options=? WHERE id=?`
      ).bind(
        title, instructions, durationMinutes, timeLimitEnabled, strictMode, fullscreenRequired, showScore,
        assessmentType, assessmentLabel, centerLabel, resultPolicy, resultReleaseAt, opensAt, closesAt,
        securityProfile, allowClipboard, allowPaste, allowExternalLinks, devicePolicy, resumePolicy, calculatorPolicy,
        questionJson, publicToken, publicAccess, requireEmailVerify, maxAttempts, passingScore,
        violationThreshold, randomizeQuestions, randomizeOptions, id
      ).run();
    } catch {
      await env.DB.prepare(
        `UPDATE exams SET title=?,instructions=?,duration_minutes=?,time_limit_enabled=?,strict_mode=?,fullscreen_required=?,show_score=?,assessment_type=?,assessment_label=?,center_label=?,result_policy=?,result_release_at=?,closes_at=?,security_profile=?,allow_clipboard=?,allow_paste=?,allow_external_links=?,device_policy=?,resume_policy=?,calculator_policy=?,question_json=? WHERE id=?`
      ).bind(
        title, instructions, durationMinutes, timeLimitEnabled, strictMode, fullscreenRequired, showScore,
        assessmentType, assessmentLabel, centerLabel, resultPolicy, resultReleaseAt, closesAt,
        securityProfile, allowClipboard, allowPaste, allowExternalLinks, devicePolicy, resumePolicy, calculatorPolicy,
        questionJson, id
      ).run();
    }
  }

  await recordAudit(env, {
    examId: id,
    actorUserId: admin.user_id,
    eventType: isCreate ? 'exam.created' : 'exam.updated',
    detail: { title, question_count: questions.length, duration_minutes: durationMinutes }
  });

  return adminGetExam(env, id, request);
}

async function adminTransitionExamLifecycle(env, examId, request) {
  const admin = await authorizeAdmin(env, request, 'exams:lifecycle');
  const body = await readJsonBody(request, 16_384);
  const nextStatus = str(body.status);
  const reason = str(body.reason || '');
  const exam = await env.DB.prepare(`SELECT * FROM exams WHERE id=?`).bind(examId).first();
  if (!exam) return bad('Không tìm thấy kỳ thi.', 404);

  const currentStatus = str(exam.status || 'draft');
  const allowedNext = VALID_EXAM_TRANSITIONS[currentStatus] || new Set();
  if (!allowedNext.has(nextStatus)) {
    return bad(`Không thể chuyển trạng thái kỳ thi từ "${currentStatus}" sang "${nextStatus}".`, 409, {
      code: 'INVALID_STATUS_TRANSITION',
      from: currentStatus,
      to: nextStatus
    });
  }

  const questions = safeJson(exam.question_json, []);
  if (nextStatus === 'published' && (!Array.isArray(questions) || questions.length === 0)) {
    return bad('Không thể mở kỳ thi khi đề thi chưa có câu hỏi nào.', 400, { code: 'EMPTY_QUESTIONS' });
  }

  let sealedVersionId = exam.sealed_version_id;
  if (nextStatus === 'published') {
    sealedVersionId = `ver-${exam.id}-${Date.now()}`;
    const snapshot = {
      exam_id: exam.id,
      title: exam.title,
      sealed_at: nowIso(),
      sealed_by: admin.user_id,
      timing: {
        duration_minutes: exam.duration_minutes,
        time_limit_enabled: Number(exam.time_limit_enabled) !== 0
      },
      policies: {
        strict_mode: Number(exam.strict_mode) !== 0,
        fullscreen_required: Number(exam.fullscreen_required) !== 0,
        allow_clipboard: Number(exam.allow_clipboard) !== 0,
        allow_paste: Number(exam.allow_paste) !== 0,
        allow_external_links: Number(exam.allow_external_links) !== 0,
        security_profile: exam.security_profile || 'STANDARD',
        device_policy: exam.device_policy || 'single_session',
        resume_policy: exam.resume_policy || 'same_session',
        calculator_policy: exam.calculator_policy || 'disabled'
      },
      questions
    };
    await env.DB.prepare(`INSERT INTO assessment_exam_versions(id,snapshot_json) VALUES(?,?)`).bind(sealedVersionId, JSON.stringify(snapshot)).run();
  }

  await env.DB.prepare(`UPDATE exams SET status=?, sealed_version_id=? WHERE id=?`).bind(nextStatus, sealedVersionId, examId).run();
  await recordAudit(env, {
    examId,
    actorUserId: admin.user_id,
    eventType: `exam.status.${nextStatus}`,
    detail: { from: currentStatus, to: nextStatus, reason, sealed_version_id: sealedVersionId }
  });

  return ok({ exam_id: examId, status: nextStatus, sealed_version_id: sealedVersionId });
}

// =============================================================================
// ADMIN QUESTION BANK MANAGEMENT
// =============================================================================
async function adminListQuestionBank(env, request) {
  const admin = await authorizeAdmin(env, request, 'questions:read');
  const url = new URL(request.url);
  const topic = str(url.searchParams.get('topic'));
  const difficulty = str(url.searchParams.get('difficulty'));
  const qSearch = str(url.searchParams.get('q')).toLowerCase();

  const rows = (await env.DB.prepare(`SELECT * FROM exam_question_bank WHERE status!='deleted' ORDER BY updated_at DESC LIMIT 300`).all())?.results || [];
  const filtered = rows.filter(r => {
    if (topic && r.topic !== topic) return false;
    if (difficulty && r.difficulty !== difficulty) return false;
    if (qSearch && !String(r.question || '').toLowerCase().includes(qSearch) && !String(r.code || '').toLowerCase().includes(qSearch)) return false;
    return true;
  }).map(r => ({
    ...r,
    tags: safeJson(r.tags_json, []),
    options: safeJson(r.options_json, []),
    answer: safeJson(r.answer_json, r.answer_json),
    stimulus: safeJson(r.stimulus_json, null)
  }));

  if (url.searchParams.get('export') === '1') {
    const watermark = `SKYFIRST-QBANK-${admin.user_id}-${nowIso()}`;
    await recordAudit(env, { actorUserId: admin.user_id, eventType: 'qbank.exported', detail: { count: filtered.length, watermark } });
    return ok({ questions: filtered, export_watermark: watermark });
  }
  return ok({ questions: filtered });
}

async function adminSaveQuestionBankItem(env, questionId, request, isCreate = false) {
  const admin = await authorizeAdmin(env, request, 'questions:write');
  const body = await readJsonBody(request);
  const id = isCreate ? (str(body.id) || `qb-${crypto.randomUUID().slice(0, 8)}`) : questionId;
  const existing = await env.DB.prepare(`SELECT * FROM exam_question_bank WHERE id=?`).bind(id).first();
  if (!isCreate && !existing) return bad('Không tìm thấy câu hỏi trong ngân hàng đề.', 404);

  const [validated] = validateQuestionsArray([{ ...body, id }]);
  const code = str(body.code ?? existing?.code ?? id.toUpperCase());
  const topic = str(body.topic ?? existing?.topic ?? 'Chung');
  const difficulty = ['easy', 'medium', 'hard'].includes(str(body.difficulty)) ? str(body.difficulty) : (existing?.difficulty || 'medium');
  const tags = Array.isArray(body.tags) ? body.tags.map(String) : safeJson(existing?.tags_json, []);
  const nextVersion = existing ? Number(existing.version || 1) + 1 : 1;

  if (isCreate) {
    await env.DB.prepare(
      `INSERT INTO exam_question_bank(id,code,topic,difficulty,tags_json,type,question,options_json,answer_json,explanation,points,stimulus_json,content_language,script_direction,numeric_tolerance,recording_duration_seconds,version,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
    ).bind(
      id, code, topic, difficulty, JSON.stringify(tags), validated.type, validated.question,
      JSON.stringify(validated.options), JSON.stringify(validated.answer), validated.explanation,
      validated.points, validated.stimulus ? JSON.stringify(validated.stimulus) : null,
      validated.content_language, validated.script_direction, validated.numeric_tolerance ?? null,
      validated.recording_duration_seconds ?? null, 1, admin.user_id
    ).run();
  } else {
    await env.DB.prepare(
      `UPDATE exam_question_bank SET code=?,topic=?,difficulty=?,tags_json=?,type=?,question=?,options_json=?,answer_json=?,explanation=?,points=?,stimulus_json=?,content_language=?,script_direction=?,numeric_tolerance=?,recording_duration_seconds=?,version=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(
      code, topic, difficulty, JSON.stringify(tags), validated.type, validated.question,
      JSON.stringify(validated.options), JSON.stringify(validated.answer), validated.explanation,
      validated.points, validated.stimulus ? JSON.stringify(validated.stimulus) : null,
      validated.content_language, validated.script_direction, validated.numeric_tolerance ?? null,
      validated.recording_duration_seconds ?? null, nextVersion, id
    ).run();
  }

  await env.DB.prepare(
    `INSERT INTO exam_question_versions(id,question_id,version,snapshot_json,changed_by,created_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)`
  ).bind(crypto.randomUUID(), id, nextVersion, JSON.stringify({ ...validated, code, topic, difficulty, tags, version: nextVersion }), admin.user_id).run();

  await recordAudit(env, {
    actorUserId: admin.user_id,
    eventType: isCreate ? 'qbank.created' : 'qbank.updated',
    detail: { question_id: id, version: nextVersion, topic, difficulty }
  });

  return ok({ question_id: id, version: nextVersion });
}

async function adminImportQuestionBank(env, request) {
  const admin = await authorizeAdmin(env, request, 'questions:write');
  const body = await readJsonBody(request);
  if (!Array.isArray(body.questions) || !body.questions.length) {
    return bad('Dữ liệu nhập cần có mảng questions hợp lệ.', 400);
  }
  const validated = validateQuestionsArray(body.questions);
  let imported = 0;
  for (const q of validated) {
    const id = str(q.id) || `qb-${crypto.randomUUID().slice(0, 8)}`;
    await env.DB.prepare(
      `INSERT INTO exam_question_bank(id,code,topic,difficulty,tags_json,type,question,options_json,answer_json,explanation,points,stimulus_json,content_language,script_direction,version,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'active',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET question=excluded.question,options_json=excluded.options_json,answer_json=excluded.answer_json,points=excluded.points,version=exam_question_bank.version+1,updated_at=CURRENT_TIMESTAMP`
    ).bind(
      id, id.toUpperCase(), q.topic || 'Chung', q.difficulty || 'medium', '[]',
      q.type, q.question, JSON.stringify(q.options), JSON.stringify(q.answer),
      q.explanation || '', q.points, q.stimulus ? JSON.stringify(q.stimulus) : null,
      q.content_language || 'vi', q.script_direction || 'ltr', admin.user_id
    ).run();
    imported++;
  }
  await recordAudit(env, { actorUserId: admin.user_id, eventType: 'qbank.imported', detail: { count: imported } });
  return ok({ imported });
}

// =============================================================================
// ADMIN CANDIDATES, ENROLLMENTS & LAUNCH LINK ISSUANCE
// =============================================================================
async function adminListCandidates(env, request) {
  await authorizeAdmin(env, request, 'candidates:read');
  const url = new URL(request.url);
  const examId = str(url.searchParams.get('exam_id'));
  const enrollments = (await env.DB.prepare(
    examId
      ? `SELECT * FROM exam_enrollments WHERE exam_id=? ORDER BY created_at DESC LIMIT 300`
      : `SELECT * FROM exam_enrollments ORDER BY created_at DESC LIMIT 300`
  ).bind(...(examId ? [examId] : [])).all())?.results || [];

  // Never expose OTP hashes, session tokens, or secrets (Article 15)
  const users = (await env.DB.prepare(
    `SELECT id, full_name, sfn_id, email, status, role, roles_json FROM users ORDER BY rowid DESC LIMIT 200`
  ).all())?.results || [];

  return ok({ enrollments, users });
}

async function adminEnrollCandidate(env, request) {
  const admin = await authorizeAdmin(env, request, 'candidates:write');
  const body = await readJsonBody(request);
  const examId = str(body.exam_id);
  const email = str(body.email).toLowerCase();
  const fullName = str(body.full_name).slice(0, 160);
  const candidateCode = str(body.candidate_code).slice(0, 100);
  const className = str(body.class_name || '').slice(0, 160);
  const status = ['active', 'locked', 'revoked'].includes(str(body.status)) ? str(body.status) : 'active';

  if (!examId || !email || !fullName || !candidateCode) {
    return bad('Vui lòng cung cấp đầy đủ Mã kỳ thi, Email, Họ tên và Mã thí sinh.', 400);
  }
  const exam = await env.DB.prepare(`SELECT id, title FROM exams WHERE id=?`).bind(examId).first();
  if (!exam) return bad('Kỳ thi không tồn tại.', 404);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO exam_enrollments(id,exam_id,email,full_name,candidate_code,class_name,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(exam_id,email) DO UPDATE SET full_name=excluded.full_name,candidate_code=excluded.candidate_code,class_name=excluded.class_name,status=excluded.status,updated_at=CURRENT_TIMESTAMP`
  ).bind(id, examId, email, fullName, candidateCode, className, status, admin.user_id).run();

  await recordAudit(env, {
    examId,
    actorUserId: admin.user_id,
    eventType: 'candidate.enrollment.upserted',
    detail: { email, candidate_code: candidateCode, status }
  });
  if (status === 'revoked' && str(body.decision_code) && (env?.SEND_LIFECYCLE_EMAILS === '1' || env?.EMAIL_API_URL || body.notify_email)) {
    await dispatchEventEmail(env, 'exam_ban_notice', {
      to: email,
      examId,
      idempotencyKey: `ban:${examId}:${email}:${str(body.decision_code)}`,
      throwOnProviderError: false,
      data: {
        recipient_name: fullName,
        exam_title: exam.title,
        candidate_code: candidateCode,
        class_name: className,
        request_code: str(body.decision_code),
        status_label: 'Thu hồi quyền dự thi theo quyết định xử lý vi phạm',
        reason: str(body.notes || body.reason || 'Xử lý theo quy chế khảo thí')
      }
    }).catch(() => {});
  }
  return ok({ enrolled: true, exam_id: examId, email, candidate_code: candidateCode, status });
}

async function adminIssueLaunchToken(env, request) {
  const admin = await authorizeAdmin(env, request, 'candidates:write');
  const body = await readJsonBody(request);
  const examId = str(body.exam_id);
  const email = str(body.email).toLowerCase();
  const fullName = str(body.full_name).slice(0, 160);
  const candidateCode = str(body.candidate_code).slice(0, 100) || `SFN-${randomHex(3).toUpperCase()}`;

  const exam = await env.DB.prepare(`SELECT * FROM exams WHERE id=?`).bind(examId).first();
  if (!exam) return bad('Kỳ thi không tồn tại.', 404);
  if (exam.status !== 'published') return bad('Chỉ có thể cấp mã khởi chạy cho kỳ thi đang mở (published).', 409);

  let user = await env.DB.prepare(`SELECT * FROM users WHERE LOWER(email)=?`).bind(email).first();
  let userId = user?.id || `usr-${crypto.randomUUID().slice(0, 8)}`;
  if (!user) {
    const created = await upsertCompatibleUser(env.DB, {
      id: userId,
      email,
      full_name: fullName || email,
      sfn_id: candidateCode,
      status: 'active',
      role: 'candidate',
      roles: ['candidate']
    });
    userId = created.id;
  }

  const attemptId = crypto.randomUUID();
  const snapshotQuestions = buildAttemptQuestionSnapshot(safeJson(exam.question_json, []), exam, attemptId);
  await env.DB.prepare(
    `INSERT INTO exam_attempts(id,exam_id,user_id,status,started_at,duration_minutes,time_limit_enabled,extra_time_minutes,answers_json,event_log_json,score,max_score,submitted_at,last_saved_at,answer_revision,question_snapshot_json,exam_version_id) VALUES(?,?,?,'in_progress',CURRENT_TIMESTAMP,?,?,0,'{}','[]',NULL,NULL,NULL,NULL,0,?,?)`
  ).bind(attemptId, exam.id, userId, Number(exam.duration_minutes || 60), Number(exam.time_limit_enabled ?? 1), JSON.stringify(snapshotQuestions), exam.sealed_version_id || null).run();

  const rawLaunch = `launch-${randomHex(24)}`;
  const launchHash = await sha256Text(rawLaunch);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO exam_launch_tokens(token_hash,user_id,attempt_id,expires_at,used_at) VALUES(?,?,?,?,NULL)`
  ).bind(launchHash, userId, attemptId, expiresAt).run();

  await recordAudit(env, {
    examId: exam.id,
    attemptId,
    actorUserId: admin.user_id,
    eventType: 'attempt.launch_token.issued',
    detail: { user_id: userId, expires_at: expiresAt }
  });

  return ok({
    attempt_id: attemptId,
    launch_token: rawLaunch,
    launch_path: `/?launch=${encodeURIComponent(rawLaunch)}`,
    expires_at: expiresAt
  });
}

// =============================================================================
// ADMIN LIVE MONITORING & PROCTORING (Lock / Unlock / Extra Time / Lease Reset)
// =============================================================================
async function adminMonitorAttempts(env, request) {
  await authorizeAdmin(env, request, 'monitor:read');
  const url = new URL(request.url);
  const examId = str(url.searchParams.get('exam_id'));

  const guestSql = `SELECT a.id, a.exam_id, 'guest' source, a.status, a.started_at, a.duration_minutes, a.time_limit_enabled, a.extra_time_minutes, a.last_saved_at, a.submitted_at, a.answer_revision, a.score, a.max_score, a.full_name, a.candidate_code, a.class_name, a.event_log_json, e.title exam_title, l.last_seen_at lease_seen_at FROM exam_guest_attempts a JOIN exams e ON e.id=a.exam_id LEFT JOIN assessment_attempt_leases l ON l.attempt_id=a.id AND l.source='guest' ${examId ? 'WHERE a.exam_id=?' : ''} ORDER BY a.started_at DESC LIMIT 150`;
  const internalSql = `SELECT a.id, a.exam_id, 'internal' source, a.status, a.started_at, a.duration_minutes, a.time_limit_enabled, a.extra_time_minutes, a.last_saved_at, a.submitted_at, a.answer_revision, a.score, a.max_score, u.full_name, u.sfn_id candidate_code, c.name class_name, a.event_log_json, e.title exam_title, l.last_seen_at lease_seen_at FROM exam_attempts a JOIN users u ON u.id=a.user_id JOIN exams e ON e.id=a.exam_id LEFT JOIN classes c ON c.id=e.class_id LEFT JOIN assessment_attempt_leases l ON l.attempt_id=a.id AND l.source='internal' ${examId ? 'WHERE a.exam_id=?' : ''} ORDER BY a.started_at DESC LIMIT 150`;

  const guests = (await env.DB.prepare(guestSql).bind(...(examId ? [examId] : [])).all())?.results || [];
  const internals = (await env.DB.prepare(internalSql).bind(...(examId ? [examId] : [])).all())?.results || [];

  const attempts = [...guests, ...internals].map(a => {
    const events = safeJson(a.event_log_json, []);
    const focusEvents = events.filter(e => ['visibility_hidden', 'window_blur', 'fullscreen_exit', 'copy_blocked', 'paste_blocked'].includes(e.type));
    return {
      id: a.id,
      exam_id: a.exam_id,
      exam_title: a.exam_title,
      source: a.source,
      status: a.status,
      started_at: a.started_at,
      last_saved_at: a.last_saved_at,
      submitted_at: a.submitted_at,
      lease_seen_at: a.lease_seen_at,
      answer_revision: a.answer_revision,
      extra_time_minutes: a.extra_time_minutes || 0,
      full_name: a.full_name,
      candidate_code: a.candidate_code,
      class_name: a.class_name || '',
      score: a.score,
      max_score: a.max_score,
      camera_status: a.camera_status || 'not_required',
      mic_status: a.mic_status || 'not_required',
      secondary_camera_status: a.secondary_camera_status || 'not_required',
      device_status: a.device_status || 'normal',
      initial_ip: a.initial_ip || null,
      last_ip: a.last_ip || null,
      ip_change_count: Number(a.ip_change_count || 0),
      vpn_suspected: Boolean(a.vpn_suspected),
      max_risk_level: Number(a.max_risk_level || 0),
      proctor_event_count: Number(a.proctor_event_count || focusEvents.length),
      observed_signal_count: focusEvents.length,
      recent_signals: focusEvents.slice(-5)
    };
  });

  const supportRequests = (await env.DB.prepare(`SELECT * FROM exam_support_requests ORDER BY created_at DESC LIMIT 50`).all().catch(() => ({ results: [] })))?.results || [];
  const realtimeEvents = (await env.DB.prepare(`SELECT * FROM exam_proctoring_events ORDER BY occurred_at DESC LIMIT 60`).all().catch(() => ({ results: [] })))?.results || [];
  const evidenceCountRow = await env.DB.prepare(`SELECT COUNT(*) n FROM exam_digital_evidence`).first().catch(() => ({ n: 0 }));

  const proctoringCenterSummary = {
    active_candidates: attempts.filter(x => x.status === 'in_progress').length,
    total_monitored: attempts.length,
    camera_active: attempts.filter(x => x.camera_status === 'active').length,
    camera_alert: attempts.filter(x => ['disconnected', 'covered', 'absent', 'multiple_faces'].includes(x.camera_status)).length,
    mic_active: attempts.filter(x => x.mic_status === 'active').length,
    device_alerts: attempts.filter(x => x.device_status !== 'normal').length,
    total_warnings: realtimeEvents.length,
    total_evidence_items: Number(evidenceCountRow?.n || 0),
    risk_breakdown: {
      level_1: realtimeEvents.filter(e => Number(e.risk_level) === 1).length,
      level_2: realtimeEvents.filter(e => Number(e.risk_level) === 2).length,
      level_3: realtimeEvents.filter(e => Number(e.risk_level) === 3).length,
      level_4: realtimeEvents.filter(e => Number(e.risk_level) === 4).length
    }
  };

  return ok({
    summary: proctoringCenterSummary,
    attempts,
    realtime_events: realtimeEvents.map(e => ({ ...e, device_env: safeJson(e.device_env_json, {}) })),
    support_requests: supportRequests,
    disclaimer: 'Sự kiện hệ thống ghi nhận tín hiệu trình duyệt (mất tiêu điểm, rời toàn màn hình); không tự động kết luận hành vi gian lận tuyệt đối trên thiết bị cá nhân.'
  });
}

async function adminProctorAction(env, attemptId, request) {
  const admin = await authorizeAdmin(env, request, 'monitor:write');
  const body = await readJsonBody(request, 16_384);
  const action = str(body.action); // 'lock' | 'unlock' | 'add_time' | 'release_lease'
  const reason = str(body.reason).slice(0, 500);
  if (!reason) return bad('Mọi thao tác giám sát (khóa, mở khóa, cộng giờ, giải phóng phiên) bắt buộc phải ghi rõ lý do kiểm toán.', 400);

  let source = 'guest';
  let row = await env.DB.prepare(`SELECT * FROM exam_guest_attempts WHERE id=?`).bind(attemptId).first();
  if (!row) {
    source = 'internal';
    row = await env.DB.prepare(`SELECT * FROM exam_attempts WHERE id=?`).bind(attemptId).first();
  }
  if (!row) return bad('Không tìm thấy phiên thi.', 404);
  const table = source === 'guest' ? 'exam_guest_attempts' : 'exam_attempts';

  if (action === 'lock') {
    if (row.status !== 'in_progress') return bad('Chỉ có thể khóa phiên thi đang diễn ra.', 409);
    await env.DB.prepare(`UPDATE ${table} SET status='locked' WHERE id=?`).bind(attemptId).run();
    await recordAudit(env, { examId: row.exam_id, attemptId, actorUserId: admin.user_id, eventType: 'attempt.locked', detail: { reason, source } });
    return ok({ attempt_id: attemptId, status: 'locked', reason });
  }
  if (action === 'unlock') {
    if (row.status !== 'locked') return bad('Phiên thi hiện không ở trạng thái khóa.', 409);
    await env.DB.prepare(`UPDATE ${table} SET status='in_progress' WHERE id=?`).bind(attemptId).run();
    await recordAudit(env, { examId: row.exam_id, attemptId, actorUserId: admin.user_id, eventType: 'attempt.unlocked', detail: { reason, source } });
    return ok({ attempt_id: attemptId, status: 'in_progress', reason });
  }
  if (action === 'add_time') {
    const minutes = Number(body.extra_minutes);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 180) return bad('Số phút cộng thêm phải từ 1 đến 180 phút.', 400);
    await env.DB.prepare(`UPDATE ${table} SET extra_time_minutes = COALESCE(extra_time_minutes, 0) + ? WHERE id=?`).bind(minutes, attemptId).run();
    await recordAudit(env, { examId: row.exam_id, attemptId, actorUserId: admin.user_id, eventType: 'attempt.extra_time', detail: { added_minutes: minutes, reason, source } });
    return ok({ attempt_id: attemptId, extra_time_minutes: Number(row.extra_time_minutes || 0) + minutes });
  }
  if (action === 'request_verification') {
    const promptMsg = str(body.prompt_message || reason || 'Giám thị yêu cầu thí sinh xác minh trực tiếp camera và khu vực bàn thi.');
    const promptObj = {
      prompt_id: crypto.randomUUID(),
      message: promptMsg,
      requested_by: admin.email,
      requested_at: nowIso(),
      status: 'pending'
    };
    await env.DB.prepare(`UPDATE ${table} SET lifecycle_state='pending_verification', proctor_prompt_json=? WHERE id=?`).bind(JSON.stringify(promptObj), attemptId).run();
    await recordAudit(env, { examId: row.exam_id, attemptId, actorUserId: admin.user_id, eventType: 'proctor.verification_requested', detail: { prompt: promptObj, reason, source } });
    return ok({ attempt_id: attemptId, lifecycle_state: 'pending_verification', proctor_prompt: promptObj });
  }
  if (action === 'suspend') {
    await env.DB.prepare(`UPDATE ${table} SET status='suspended', lifecycle_state='suspended', lock_reason=? WHERE id=?`).bind(reason, attemptId).run();
    await recordAudit(env, { examId: row.exam_id, attemptId, actorUserId: admin.user_id, eventType: 'attempt.suspended', detail: { reason, source } });
    return ok({ attempt_id: attemptId, status: 'suspended', lifecycle_state: 'suspended', reason });
  }
  if (action === 'classify') {
    const classification = str(body.classification || 'verified_by_officer');
    if (!Object.prototype.hasOwnProperty.call(EVENT_CLASSIFICATION_LABELS, classification)) {
      return bad('Mức phân loại sự kiện giám sát không hợp lệ.', 400);
    }
    await env.DB.prepare(`UPDATE ${table} SET review_classification=? WHERE id=?`).bind(classification, attemptId).run();
    await recordAudit(env, { examId: row.exam_id, attemptId, actorUserId: admin.user_id, eventType: 'attempt.classified', detail: { classification, classification_label: EVENT_CLASSIFICATION_LABELS[classification], reason, source } });
    return ok({ attempt_id: attemptId, classification, classification_label: EVENT_CLASSIFICATION_LABELS[classification], reason });
  }
  if (action === 'release_lease') {
    await env.DB.prepare(`DELETE FROM assessment_attempt_leases WHERE attempt_id=?`).bind(attemptId).run();
    await recordAudit(env, { examId: row.exam_id, attemptId, actorUserId: admin.user_id, eventType: 'attempt.lease_released', detail: { reason, source } });
    return ok({ attempt_id: attemptId, lease_released: true });
  }
  if (action === 'cancel') {
    await env.DB.prepare(`UPDATE ${table} SET status='cancelled', lock_reason=? WHERE id=?`).bind(reason, attemptId).run();
    await recordAudit(env, { examId: row.exam_id, attemptId, actorUserId: admin.user_id, eventType: 'attempt.cancelled', detail: { reason, source } });
    if (row.email && (env?.SEND_LIFECYCLE_EMAILS === '1' || env?.EMAIL_API_URL || body.notify_email)) {
      const ex = await env.DB.prepare(`SELECT title FROM exams WHERE id=?`).bind(row.exam_id).first().catch(() => null);
      await dispatchEventEmail(env, 'exam_session_cancelled', {
        to: row.email,
        examId: row.exam_id,
        attemptId,
        idempotencyKey: `attempt-cancelled:${attemptId}`,
        throwOnProviderError: false,
        data: {
          recipient_name: row.full_name || row.candidate_code || row.email,
          exam_title: ex?.title || row.exam_id,
          candidate_code: row.candidate_code || '',
          attempt_id: attemptId,
          event_time: nowIso(),
          status_label: 'Phiên thi đã hủy theo xác nhận của Hội đồng',
          reason
        }
      }).catch(() => {});
    }
    return ok({ attempt_id: attemptId, status: 'cancelled', reason });
  }

  return bad('Hành động giám sát không hợp lệ.', 400);
}

// =============================================================================
// ADMIN GRADING, APPROVAL, PUBLICATION & APPEALS
// =============================================================================
async function adminGetAttemptGradingDetail(env, attemptId, request) {
  await authorizeAdmin(env, request, 'grading:read');
  let source = 'guest';
  let row = await env.DB.prepare(
    `SELECT a.*, e.title exam_title, COALESCE(a.question_snapshot_json, e.question_json) question_json FROM exam_guest_attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=?`
  ).bind(attemptId).first();
  if (!row) {
    source = 'internal';
    row = await env.DB.prepare(
      `SELECT a.*, u.full_name, u.sfn_id candidate_code, e.title exam_title, COALESCE(a.question_snapshot_json, e.question_json) question_json FROM exam_attempts a JOIN users u ON u.id=a.user_id JOIN exams e ON e.id=a.exam_id WHERE a.id=?`
    ).bind(attemptId).first();
  }
  if (!row) return bad('Không tìm thấy bài thi.', 404);

  const questions = safeJson(row.question_json, []);
  const answers = safeJson(row.answers_json, {});
  const manualRows = (await env.DB.prepare(`SELECT * FROM assessment_manual_grades WHERE attempt_id=?`).bind(attemptId).all())?.results || [];
  const workflow = await env.DB.prepare(`SELECT * FROM assessment_result_workflows WHERE attempt_id=?`).bind(attemptId).first();

  return ok({
    attempt: {
      id: row.id,
      exam_id: row.exam_id,
      exam_title: row.exam_title,
      source,
      status: row.status,
      full_name: row.full_name,
      candidate_code: row.candidate_code,
      score: row.score,
      max_score: row.max_score,
      submitted_at: row.submitted_at,
      workflow_state: workflow?.state || 'marking',
      questions,
      answers,
      manual_grades: manualRows
    }
  });
}

async function adminGradeManualItem(env, attemptId, request) {
  const admin = await authorizeAdmin(env, request, 'grading:write');
  const body = await readJsonBody(request, 32_768);
  const questionId = str(body.question_id);
  const score = Number(body.score);
  const feedback = str(body.feedback).slice(0, 4000);
  const reason = str(body.reason || 'Chấm điểm câu hỏi tự luận').slice(0, 500);

  if (!questionId || !Number.isFinite(score) || score < 0) {
    return bad('Mã câu hỏi hoặc điểm số không hợp lệ.', 400);
  }

  let source = 'guest';
  let a = await env.DB.prepare(
    `SELECT a.*, COALESCE(a.question_snapshot_json, e.question_json) question_json FROM exam_guest_attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=?`
  ).bind(attemptId).first();
  if (!a) {
    source = 'internal';
    a = await env.DB.prepare(
      `SELECT a.*, COALESCE(a.question_snapshot_json, e.question_json) question_json FROM exam_attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=?`
    ).bind(attemptId).first();
  }
  if (!a) return bad('Không tìm thấy bài thi.', 404);
  if (a.status !== 'submitted') return bad('Chỉ có thể chấm điểm bài thi đã nộp.', 409);

  // Protect published results from unauthorized score modification unless revoked first (Article 17 & 35)
  const wf = await env.DB.prepare(`SELECT state FROM assessment_result_workflows WHERE attempt_id=?`).bind(attemptId).first();
  if (wf?.state === 'published') {
    return bad('Kết quả bài thi này đã được công bố và khóa bảo vệ. Cần thu hồi công bố trước khi điều chỉnh điểm.', 409, {
      code: 'PUBLISHED_RESULT_PROTECTED'
    });
  }

  const qs = safeJson(a.question_json, []);
  const q = qs.find(x => String(x.id) === questionId);
  if (!q) return bad('Câu hỏi không thuộc đề thi này.', 404);
  const maxPoints = Number.isFinite(Number(q.points ?? 1)) ? Math.max(0, Number(q.points ?? 1)) : 1;
  if (score > maxPoints) {
    return bad(`Điểm chấm (${score}) vượt quá thang điểm tối đa của câu hỏi (${maxPoints}).`, 400, { code: 'SCORE_EXCEEDS_MAX' });
  }

  const prevGrade = await env.DB.prepare(`SELECT score, status FROM assessment_manual_grades WHERE attempt_id=? AND question_id=?`).bind(attemptId, questionId).first();

  await env.DB.prepare(
    `INSERT INTO assessment_manual_grades(id,attempt_id,question_id,grader_user_id,score,feedback,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'published',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(attempt_id,question_id) DO UPDATE SET grader_user_id=excluded.grader_user_id,score=excluded.score,feedback=excluded.feedback,status='published',updated_at=CURRENT_TIMESTAMP`
  ).bind(crypto.randomUUID(), attemptId, questionId, admin.user_id, score, feedback).run();

  // Recompute total score = autoScore + sum(published manual grades)
  const answers = safeJson(a.answers_json, {});
  const auto = autoScore(qs, answers);
  const allManual = (await env.DB.prepare(`SELECT question_id, score, status FROM assessment_manual_grades WHERE attempt_id=?`).bind(attemptId).all())?.results || [];
  let manualSum = 0, pendingCount = 0;
  for (const mq of auto.manual) {
    const g = allManual.find(r => String(r.question_id) === String(mq.id) && r.status === 'published' && r.score != null);
    if (!g) pendingCount++;
    else manualSum += Number(g.score);
  }
  const newTotal = auto.score + manualSum;
  const table = source === 'guest' ? 'exam_guest_attempts' : 'exam_attempts';
  const nextWfState = pendingCount === 0 ? 'graded' : 'marking';

  await env.DB.batch([
    env.DB.prepare(`UPDATE ${table} SET score=?, max_score=? WHERE id=?`).bind(newTotal, auto.max, attemptId),
    env.DB.prepare(`INSERT INTO assessment_result_workflows(attempt_id,source,state,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(attempt_id) DO UPDATE SET state=excluded.state,updated_at=CURRENT_TIMESTAMP`).bind(attemptId, source, nextWfState),
    env.DB.prepare(`INSERT INTO exam_audit_log(id,exam_id,attempt_id,actor_user_id,event_type,detail_json) VALUES(?,?,?,?,'grading.manual.updated',?)`).bind(
      crypto.randomUUID(), a.exam_id, attemptId, admin.user_id,
      JSON.stringify({ question_id: questionId, score_before: prevGrade?.score ?? null, score_after: score, total_score: newTotal, reason })
    )
  ]);

  return ok({
    attempt_id: attemptId,
    question_id: questionId,
    question_score: score,
    total_score: newTotal,
    max_score: auto.max,
    pending_manual: pendingCount,
    workflow_state: nextWfState
  });
}

async function adminResultWorkflowAction(env, attemptId, request) {
  const body = await readJsonBody(request, 16_384);
  const action = str(body.action); // 'approve' | 'publish' | 'revoke'
  const reason = str(body.reason || '').slice(0, 500);

  const permMap = { approve: 'results:approve', publish: 'results:publish', revoke: 'results:revoke' };
  const requiredPerm = permMap[action];
  if (!requiredPerm) return bad('Thao tác kết quả không hợp lệ.', 400);
  const admin = await authorizeAdmin(env, request, requiredPerm);

  let source = 'guest';
  let a = await env.DB.prepare(
    `SELECT a.*, COALESCE(a.question_snapshot_json, e.question_json) question_json FROM exam_guest_attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=?`
  ).bind(attemptId).first();
  if (!a) {
    source = 'internal';
    a = await env.DB.prepare(
      `SELECT a.*, COALESCE(a.question_snapshot_json, e.question_json) question_json FROM exam_attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=?`
    ).bind(attemptId).first();
  }
  if (!a || a.status !== 'submitted') return bad('Bài thi chưa nộp hoặc không tồn tại.', 404);

  const qs = safeJson(a.question_json, []);
  const { pending, wfState } = await computeTotalAttemptScore(env, a, qs);

  if ((action === 'approve' || action === 'publish') && pending > 0) {
    return bad(`Không thể duyệt hoặc công bố kết quả khi còn ${pending} câu tự luận chưa chấm xong.`, 409, {
      code: 'UNGRADED_MANUAL_QUESTIONS',
      pending_manual: pending
    });
  }
  if (action === 'publish' && (qs.some(q => MANUAL_TYPES.has(str(q.type))) || a.result_policy === 'manual_publish_only') && wfState !== 'approved' && wfState !== 'published') {
    return bad('Kết quả bài thi cần được Phê duyệt (approve) trước khi Công bố chính thức (publish).', 409, {
      code: 'APPROVAL_REQUIRED_BEFORE_PUBLISH',
      current_state: wfState
    });
  }
  if (action === 'approve' && !admin.roles.includes('system_admin')) {
    const selfGraded = await env.DB.prepare(
      `SELECT 1 ok FROM assessment_manual_grades WHERE attempt_id=? AND grader_user_id=? LIMIT 1`
    ).bind(attemptId, admin.user_id).first();
    if (selfGraded) {
      return bad('Nguyên tắc phân tách nhiệm vụ: Cán bộ trực tiếp chấm bài không được tự phê duyệt kết quả của chính mình.', 403, {
        code: 'SEGREGATION_OF_DUTIES_VIOLATION'
      });
    }
  }
  if (action === 'revoke' && !reason) {
    return bad('Bắt buộc phải nhập lý do khi thu hồi kết quả đã công bố.', 400);
  }

  const nextState = action === 'approve' ? 'approved' : action === 'publish' ? 'published' : 'revoked';
  await env.DB.prepare(
    `INSERT INTO assessment_result_workflows(attempt_id,source,state,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(attempt_id) DO UPDATE SET state=excluded.state,updated_at=CURRENT_TIMESTAMP`
  ).bind(attemptId, source, nextState).run();

  await recordAudit(env, {
    examId: a.exam_id,
    attemptId,
    actorUserId: admin.user_id,
    eventType: `result.${nextState}`,
    detail: { previous_state: wfState, new_state: nextState, score: a.score, reason }
  });

  if (nextState === 'published' && a.email && (env?.SEND_LIFECYCLE_EMAILS === '1' || env?.EMAIL_API_URL || body.notify_email)) {
    const rec = await env.DB.prepare(`SELECT receipt_code FROM assessment_receipts WHERE attempt_id=? LIMIT 1`).bind(attemptId).first().catch(() => null);
    const ex = await env.DB.prepare(`SELECT title FROM exams WHERE id=?`).bind(a.exam_id).first().catch(() => null);
    await dispatchEventEmail(env, 'exam_result', {
      to: a.email,
      examId: a.exam_id,
      attemptId,
      idempotencyKey: `exam-result:${attemptId}:published`,
      throwOnProviderError: false,
      data: {
        recipient_name: a.full_name || a.candidate_code || a.email,
        exam_title: ex?.title || a.exam_id,
        candidate_code: a.candidate_code || a.sfn_id || '',
        receipt_code: rec?.receipt_code || '',
        score: a.score,
        max_score: a.max_score,
        show_score: true,
        status_label: 'Đã công bố chính thức'
      }
    }).catch(() => {});
  }

  return ok({ attempt_id: attemptId, workflow_state: nextState, score: a.score, max_score: a.max_score });
}

async function adminListAppeals(env, request) {
  await authorizeAdmin(env, request, 'appeals:read');
  const appeals = (await env.DB.prepare(`SELECT * FROM exam_appeals ORDER BY created_at DESC LIMIT 100`).all().catch(() => ({ results: [] })))?.results || [];
  return ok({ appeals });
}

async function adminResolveAppeal(env, appealId, request) {
  const admin = await authorizeAdmin(env, request, 'appeals:write');
  const body = await readJsonBody(request, 32_768);
  const status = ['received', 'reviewing', 'need_more_info', 'resolved', 'rejected'].includes(str(body.status)) ? str(body.status) : 'resolved';
  const resolutionNote = str(body.resolution_note).slice(0, 4000);
  if (!resolutionNote) return bad('Vui lòng nhập nội dung cập nhật hoặc kết luận giải quyết phúc khảo.', 400);

  const appeal = await env.DB.prepare(`SELECT * FROM exam_appeals WHERE id=?`).bind(appealId).first();
  if (!appeal) return bad('Không tìm thấy đơn phúc khảo.', 404);

  let newScore = appeal.score_before;
  if (body.score_after !== undefined && body.score_after !== null && body.score_after !== '') {
    newScore = Number(body.score_after);
    if (!Number.isFinite(newScore) || newScore < 0) return bad('Điểm sau phúc khảo không hợp lệ.', 400);
    if (status === 'resolved') {
      await env.DB.prepare(`UPDATE exam_guest_attempts SET score=? WHERE id=?`).bind(newScore, appeal.attempt_id).run();
      await env.DB.prepare(`UPDATE exam_attempts SET score=? WHERE id=?`).bind(newScore, appeal.attempt_id).run();
    }
  }

  const prevHistory = safeJson(appeal.history_json, []);
  const nextHistory = [...(Array.isArray(prevHistory) ? prevHistory : []), { status, note: resolutionNote, by: admin.user_id, at: nowIso() }];

  await env.DB.prepare(
    `UPDATE exam_appeals SET status=?, resolution_note=?, score_after=?, resolved_by=?, resolved_at=CURRENT_TIMESTAMP, history_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
  ).bind(status, resolutionNote, newScore, admin.user_id, JSON.stringify(nextHistory), appealId).run();

  await recordAudit(env, {
    examId: appeal.exam_id,
    attemptId: appeal.attempt_id,
    actorUserId: admin.user_id,
    eventType: 'appeal.resolved',
    detail: { appeal_id: appealId, request_code: appeal.request_code, status, score_before: appeal.score_before, score_after: newScore, resolution_note: resolutionNote }
  });

  if (appeal.candidate_email && (env?.SEND_LIFECYCLE_EMAILS === '1' || env?.EMAIL_API_URL || body.notify_email)) {
    const isFinal = status === 'resolved' || status === 'rejected';
    const eventType = isFinal ? 'appeal_result' : 'appeal_update';
    const statusLabels = {
      received: 'Đã tiếp nhận',
      reviewing: 'Đang xem xét',
      need_more_info: 'Cần bổ sung thông tin',
      resolved: 'Đã giải quyết',
      rejected: 'Từ chối với lý do phù hợp'
    };
    await dispatchEventEmail(env, eventType, {
      to: appeal.candidate_email,
      examId: appeal.exam_id,
      attemptId: appeal.attempt_id,
      requestId: appealId,
      idempotencyKey: `appeal-${status}:${appealId}:${nextHistory.length}`,
      throwOnProviderError: false,
      data: {
        recipient_name: appeal.full_name || appeal.candidate_code || appeal.candidate_email,
        request_code: appeal.request_code || appeal.id,
        exam_title: appeal.exam_title || appeal.exam_id,
        candidate_code: appeal.candidate_code,
        status_label: statusLabels[status] || status,
        score_before: appeal.score_before,
        score_after: isFinal ? newScore : null,
        resolution_note: resolutionNote
      }
    }).catch(() => {});
  }

  return ok({ appeal_id: appealId, request_code: appeal.request_code || appealId, status, score_before: appeal.score_before, score_after: newScore });
}

// =============================================================================
// ADMIN USER & ROLE PROVISIONING AND AUDIT LOGS
// =============================================================================
async function adminManageUserRole(env, request) {
  const admin = await authorizeAdmin(env, request, 'users:write');
  const body = await readJsonBody(request, 16_384);
  const email = str(body.email).toLowerCase();
  const fullName = str(body.full_name).slice(0, 160);
  const status = ['active', 'revoked', 'locked'].includes(str(body.status)) ? str(body.status) : 'active';
  const reason = str(body.reason || 'Cập nhật phân quyền quản trị').slice(0, 500);
  const roles = Array.isArray(body.roles) ? body.roles.filter(r => ADMIN_ROLES.includes(r) || r === 'candidate') : ['candidate'];

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad('Email không hợp lệ.', 400);
  if (email === SYSTEM_OWNER_EMAIL) {
    if (str(admin.email).toLowerCase() !== SYSTEM_OWNER_EMAIL || status !== 'active' || body.expires_at || !roles.includes('system_admin')) {
      return bad('Tài khoản Chủ sở hữu hệ thống tối cao (skyfirst.ec@gmail.com) là bất khả xâm phạm, không thể bị khóa, thu hồi quyền hoặc hạ cấp bởi quản trị viên.', 403, { code: 'OWNER_ACCOUNT_PROTECTED' });
    }
    if (!roles.includes(SYSTEM_OWNER_ROLE)) roles.unshift(SYSTEM_OWNER_ROLE);
  }

  const primaryRole = roles[0] || 'candidate';
  const expiresAt = body.expires_at ? str(body.expires_at) : null;
  const upserted = await upsertCompatibleUser(env.DB, {
    id: `usr-${crypto.randomUUID().slice(0, 8)}`,
    email,
    full_name: fullName || email,
    status,
    role: primaryRole,
    roles,
    expires_at: expiresAt,
    preserveExistingExpiry: !body.expires_at && email !== SYSTEM_OWNER_EMAIL
  });
  const userId = upserted.id;

  // If user is revoked/locked or stripped of admin roles, immediately revoke all active admin sessions
  const remainingAdminRoles = roles.filter(r => ADMIN_ROLES.includes(r));
  if (status !== 'active' || remainingAdminRoles.length === 0) {
    await env.DB.prepare(`UPDATE exam_admin_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND revoked_at IS NULL`).bind(userId).run();
  }

  await recordAudit(env, {
    actorUserId: admin.user_id,
    eventType: 'admin.user_role.updated',
    detail: { target_user_id: userId, email, roles, status, reason }
  });

  return ok({ user_id: userId, email, status, roles });
}

async function adminListAuditLogs(env, request) {
  await authorizeAdmin(env, request, 'audit:read');
  const url = new URL(request.url);
  const examId = str(url.searchParams.get('exam_id'));
  const eventType = str(url.searchParams.get('event_type'));
  const rows = (await env.DB.prepare(`SELECT * FROM exam_audit_log ORDER BY rowid DESC LIMIT 250`).all())?.results || [];
  const logs = rows.filter(r => {
    if (examId && r.exam_id !== examId) return false;
    if (eventType && r.event_type !== eventType) return false;
    return true;
  }).map(r => ({
    ...r,
    detail: safeJson(r.detail_json, {})
  }));
  return ok({ logs });
}

async function adminDownloadResponseFile(env, fileId, request) {
  const admin = await authorizeAdmin(env, request, 'grading:read');
  const fileRow = await env.DB.prepare(`SELECT * FROM files WHERE id=?`).bind(fileId).first();
  if (!fileRow) return bad('Không tìm thấy tệp đính kèm.', 404);
  const obj = await env.FILES.get(fileRow.r2_key);
  await recordAudit(env, { actorUserId: admin.user_id, eventType: 'file.downloaded', detail: { file_id: fileId, name: fileRow.name } });
  if (!obj) {
    return ok({ file_metadata: { id: fileRow.id, name: fileRow.name, mime: fileRow.mime, size: fileRow.size }, content_available: false });
  }
  return new Response(obj.body, {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      'content-type': fileRow.mime || 'application/octet-stream',
      'content-disposition': `attachment; filename="${safeName(fileRow.name)}"`
    }
  });
}

async function adminDownloadServiceFile(env, fileId, request) {
  const admin = await authorizeAdmin(env, request);
  const fileRow = await env.DB.prepare(`SELECT * FROM exam_service_files WHERE id=? AND status='active'`).bind(fileId).first();
  if (!fileRow) return bad('Không tìm thấy tệp minh chứng nghiệp vụ.', 404);

  const permByService = {
    appeal: 'appeals:read',
    support: 'support:read',
    bug_report: 'support:read',
    emergency: 'monitor:read',
    fraud_report: 'fraud:read'
  };
  const needed = permByService[fileRow.service_type] || 'audit:read';
  if (!hasAdminPermission(admin.roles, needed) && !hasAdminPermission(admin.roles, 'audit:read')) {
    return bad('Bạn không có quyền truy cập tệp minh chứng của nghiệp vụ này.', 403, { code: 'INSUFFICIENT_PERMISSION' });
  }

  const obj = await env.FILES.get(fileRow.r2_key);
  await recordAudit(env, {
    actorUserId: admin.user_id,
    eventType: 'service_file.downloaded',
    detail: { file_id: fileId, service_type: fileRow.service_type, request_id: fileRow.request_id }
  });
  if (!obj) {
    return ok({ file_metadata: { id: fileRow.id, name: fileRow.original_name, mime: fileRow.mime_type, size: fileRow.byte_size }, content_available: false });
  }
  return new Response(obj.body, {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      'content-type': fileRow.mime_type || 'application/octet-stream',
      'content-disposition': `attachment; filename="${safeName(fileRow.original_name)}"`
    }
  });
}

async function adminListFraudReports(env, request) {
  const admin = await authorizeAdmin(env, request, 'fraud:read');
  await recordAudit(env, { actorUserId: admin.user_id, eventType: 'fraud_report.accessed', detail: { viewer_email: admin.email } });
  const rows = (await env.DB.prepare(`SELECT * FROM exam_fraud_reports ORDER BY created_at DESC LIMIT 100`).all().catch(() => ({ results: [] })))?.results || [];
  return ok({
    fraud_reports: rows.map(r => ({
      ...r,
      evidence_files: safeJson(r.evidence_files_json, []),
      history: safeJson(r.history_json, [])
    }))
  });
}

async function adminResolveFraudReport(env, reportId, request) {
  const admin = await authorizeAdmin(env, request, 'fraud:write');
  const body = await readJsonBody(request, 16_384);
  const status = ['received', 'verifying', 'verified', 'dismissed'].includes(str(body.status)) ? str(body.status) : 'verifying';
  const resolutionNote = str(body.resolution_note).slice(0, 4000);
  if (!resolutionNote) return bad('Vui lòng nhập biên bản xác minh hoặc ghi chú xử lý.', 400);

  const report = await env.DB.prepare(`SELECT * FROM exam_fraud_reports WHERE id=?`).bind(reportId).first();
  if (!report) return bad('Không tìm thấy báo cáo phản ánh.', 404);

  const prevHistory = safeJson(report.history_json, []);
  const nextHistory = [...(Array.isArray(prevHistory) ? prevHistory : []), { status, note: resolutionNote, by: admin.user_id, at: nowIso() }];

  await env.DB.prepare(
    `UPDATE exam_fraud_reports SET status=?, resolution_note=?, resolved_by=?, resolved_at=CURRENT_TIMESTAMP, history_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
  ).bind(status, resolutionNote, admin.user_id, JSON.stringify(nextHistory), reportId).run();

  await recordAudit(env, {
    examId: report.exam_id,
    actorUserId: admin.user_id,
    eventType: 'fraud_report.updated',
    detail: { report_id: reportId, request_code: report.request_code, status, resolution_note: resolutionNote }
  });

  return ok({ report_id: reportId, request_code: report.request_code, status, resolution_note: resolutionNote });
}

async function adminListEmailLogs(env, request) {
  await authorizeAdmin(env, request, 'audit:read');
  const rows = (await env.DB.prepare(
    `SELECT id, idempotency_key, event_type, template_file, sender_address, recipient_email, subject, status, provider, provider_message_id, retry_count, error_detail, exam_id, attempt_id, request_id, created_at, updated_at FROM exam_email_logs ORDER BY created_at DESC LIMIT 200`
  ).all().catch(() => ({ results: [] })))?.results || [];
  return ok({ email_logs: rows });
}

async function adminSendLifecycleEmailAction(env, request) {
  const admin = await authorizeAdmin(env, request, 'exams:write');
  const body = await readJsonBody(request, 32_768);
  const eventType = str(body.event_type);
  const to = str(body.to).toLowerCase();
  if (!EMAIL_TEMPLATES[eventType]) {
    return bad('Loại sự kiện email không hợp lệ.', 400);
  }
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return bad('Địa chỉ email người nhận không hợp lệ.', 400);
  }
  // Enforce confirmation checks before sending official ban or cancellation or result emails
  if (eventType === 'exam_ban_notice' && !str(body.decision_code)) {
    return bad('Chỉ được gửi thông báo xử lý vi phạm / cấm thi khi đã có mã quyết định hợp lệ được ghi nhận.', 409, { code: 'DECISION_REQUIRED' });
  }
  if (eventType === 'exam_session_cancelled' && !str(body.reason)) {
    return bad('Bắt buộc nêu rõ lý do xác nhận hủy phiên thi.', 400, { code: 'CANCEL_REASON_REQUIRED' });
  }
  const res = await dispatchEventEmail(env, eventType, {
    to,
    examId: str(body.exam_id || '') || null,
    attemptId: str(body.attempt_id || '') || null,
    requestId: str(body.request_id || '') || null,
    idempotencyKey: str(body.idempotency_key || '') || null,
    throwOnProviderError: true,
    data: body.data && typeof body.data === 'object' ? body.data : body
  });
  await recordAudit(env, {
    examId: str(body.exam_id || '') || null,
    attemptId: str(body.attempt_id || '') || null,
    actorUserId: admin.user_id,
    eventType: `email.dispatched.${eventType}`,
    detail: { to, from: res.from, template_file: res.template_file, delivered: res.delivered, status: res.status }
  });
  if (!res.delivered) {
    return json({
      ok: false,
      code: 'EMAIL_SERVICE_UNCONFIGURED',
      message: res.reason || 'Dịch vụ gửi email chưa được cấu hình.',
      detail: res
    }, 503);
  }
  return ok({ email_result: res });
}

// =============================================================================
// HEALTH CHECK (16 Core Tables + R2 Binding + Standalone Mode Confirmation)
// =============================================================================
const REQUIRED_SCHEMA_TABLES = [
  'assessment_attempt_leases', 'exam_launch_tokens', 'exam_access_tokens', 'exam_attempts',
  'exam_guest_attempts', 'exams', 'assessment_answer_revisions', 'assessment_response_files',
  'files', 'assessment_manual_grades', 'assessment_result_workflows', 'exam_audit_log',
  'assessment_exam_versions', 'assessment_receipts', 'classes', 'users'
];

async function health(env) {
  const schema = {};
  for (const table of REQUIRED_SCHEMA_TABLES) {
    try {
      await env.DB.prepare(`SELECT 1 FROM ${table} LIMIT 1`).first();
      schema[table] = 'available';
    } catch {
      schema[table] = 'unavailable';
    }
  }
  const missing = Object.entries(schema).filter(([, state]) => state !== 'available').map(([table]) => table);
  const bucketConfigured = !!env.FILES;
  const ready = missing.length === 0 && bucketConfigured;
  return json({
    ok: ready,
    service: 'Sky First Exam',
    version: '5.0.0',
    status: ready ? 'available' : 'degraded',
    runtime: {
      attempt_api: ready ? 'local-d1' : 'degraded',
      control_plane: 'standalone-exam-native',
      slc_dependency: 'removed'
    },
    dependencies: {
      d1: missing.length ? 'degraded' : 'available',
      r2_binding: bucketConfigured ? 'configured' : 'missing'
    },
    schema,
    missing,
    time: nowIso()
  }, ready ? 200 : 503);
}

// =============================================================================
// MAIN API ROUTER (Zero Proxy to SLC)


export async function submitCandidateViolationExplanation(env, source, attemptId, request) {
  const a = await authorize(env, source, attemptId, request);
  const body = await readJsonBody(request, 16_384);
  const explanation = str(body.explanation || body.message).slice(0, 2000);
  if (!explanation || explanation.length < 5) {
    return bad('Vui lòng nhập nội dung giải trình sự cố (tối thiểu 5 ký tự).', 400);
  }
  const table = source === 'guest' ? 'exam_guest_attempts' : 'exam_attempts';
  await env.DB.prepare(`UPDATE ${table} SET candidate_explanation=? WHERE id=?`).bind(explanation, attemptId).run();
  await recordAudit(env, {
    examId: a.exam_id,
    attemptId,
    eventType: 'attempt.candidate_explanation',
    detail: { source, explanation }
  });
  return ok({
    attempt_id: attemptId,
    saved: true,
    candidate_explanation: explanation,
    message: 'Đã ghi nhận nội dung giải trình của thí sinh vào hồ sơ giám sát kỳ thi.'
  });
}

export async function verifyPublicCandidateIdentity(env, code, request) {
  await ensureAdditiveSchema(env);
  const e = await resolvePublicExamByCode(env, code);
  if (!e || e.status !== 'published') return bad('Kỳ thi hiện không mở.', 403, { code: 'EXAM_NOT_OPEN' });
  const body = await readJsonBody(request, 16_384);
  const email = str(body.email).toLowerCase();
  const candidateCode = str(body.candidate_code);
  const fullName = str(body.full_name);
  if (!email || !candidateCode) {
    return bad('Vui lòng cung cấp Email và Mã thí sinh để xác minh danh tính.', 400);
  }
  await checkRateLimit(env, `id_verify:${e.id}:${email}`, 10, 300_000);

  const enrolled = await env.DB.prepare(`SELECT * FROM exam_enrollments WHERE exam_id=? AND LOWER(email)=?`).bind(e.id, email).first().catch(() => null);
  if (enrolled && (enrolled.status !== 'active' || isAccountExpired(enrolled))) {
    return bad('Hồ sơ dự thi của bạn đang bị khóa hoặc đã hết thời hạn.', 403, { code: 'ENROLLMENT_LOCKED' });
  }
  if (!enrolled && Number(e.public_access ?? 1) === 0) {
    return bad('Thí sinh không có trong danh sách được cấp quyền tham gia kỳ thi này.', 403, { code: 'NOT_ENROLLED' });
  }

  const secConfig = normalizeSecurityConfig(e);
  const result = await verifyCandidateIdentityWithAdapter(env, {
    examId: e.id,
    candidateCode: enrolled?.candidate_code || candidateCode,
    email: enrolled?.email || email,
    fullName: enrolled?.full_name || fullName,
    verificationToken: str(body.verification_token),
    providerReference: str(body.reference_code),
    providerSignature: str(body.signature),
    timestamp: str(body.timestamp),
    fallbackPolicy: secConfig.third_party_fallback_policy
  });

  await recordAudit(env, {
    examId: e.id,
    eventType: 'candidate.identity.verified',
    detail: { candidate_code: candidateCode, provider: result.provider, status: result.status, reference_code: result.reference_code }
  });

  if (result.status !== 'verified') {
    return bad('Xác minh danh tính thí sinh chưa thành công.', 403, { code: 'IDENTITY_VERIFICATION_FAILED', verification: result });
  }

  return ok({
    verified: true,
    verification: result,
    security_config: secConfig,
    privacy_policy: PRIVACY_COMPLIANCE_POLICY
  });
}

export async function adminAnalyzeExamAnomalies(env, request) {
  await authorizeAdmin(env, request, 'monitor:read');
  const url = new URL(request.url);
  const examId = str(url.searchParams.get('exam_id'));
  const guestSql = examId
    ? `SELECT a.*, 'guest' source FROM exam_guest_attempts a WHERE a.exam_id=? ORDER BY a.started_at DESC LIMIT 200`
    : `SELECT a.*, 'guest' source FROM exam_guest_attempts a ORDER BY a.started_at DESC LIMIT 200`;
  const intSql = examId
    ? `SELECT a.*, u.full_name, u.sfn_id candidate_code, 'internal' source FROM exam_attempts a JOIN users u ON u.id=a.user_id WHERE a.exam_id=? ORDER BY a.started_at DESC LIMIT 200`
    : `SELECT a.*, u.full_name, u.sfn_id candidate_code, 'internal' source FROM exam_attempts a JOIN users u ON u.id=a.user_id ORDER BY a.started_at DESC LIMIT 200`;

  const guests = (await (examId ? env.DB.prepare(guestSql).bind(examId) : env.DB.prepare(guestSql)).all())?.results || [];
  const internals = (await (examId ? env.DB.prepare(intSql).bind(examId) : env.DB.prepare(intSql)).all())?.results || [];
  const analysis = analyzeExamAnomalies([...guests, ...internals], 3);
  return ok(analysis);
}


// =============================================================================
// ADVANCED PROCTORING, DIGITAL EVIDENCE (R2 + SHA-256 CHAIN) & ADMIN CENTER
// =============================================================================
export async function checkPublicDevicePreflight(env, code, request) {
  await ensureAdditiveSchema(env);
  const e = await resolvePublicExamByCode(env, code);
  if (!e) return bad('Không tìm thấy kỳ thi.', 404);
  const body = await readJsonBody(request, 32_768);
  const evaluation = evaluateDevicePreflightCapabilities(body, e, request);
  const mediaSpoof = inspectMediaDevicesForSpoofing(body.media_devices || []);
  if (mediaSpoof.virtual_camera_detected) {
    evaluation.passed = false;
    evaluation.blockers.push(`Phát hiện phần mềm giả lập Camera (Virtual Camera): ${mediaSpoof.virtual_cameras.join(', ')}. Vui lòng chuyển sang Camera vật lý.`);
  }
  if (mediaSpoof.virtual_microphone_detected) {
    evaluation.passed = false;
    evaluation.blockers.push(`Phát hiện nguồn Microphone giả lập: ${mediaSpoof.virtual_microphones.join(', ')}.`);
  }
  return ok({
    exam_id: e.id,
    exam_title: e.title,
    ...evaluation,
    media_spoof_check: mediaSpoof,
    platform_capability_matrix: PLATFORM_CAPABILITY_MATRIX
  });
}

export async function recordProctoringEvent(env, source, attemptId, request) {
  await ensureAdditiveSchema(env);
  const a = await authorize(env, source, attemptId, request);
  const body = await readJsonBody(request, 65_536);

  // Detect tampered/forged payload signature if client_hash is provided and mismatched
  const rawType = str(body.event_type || body.type || 'window_blur').toLowerCase();
  if (body.forged_payload === true || (body.expected_attempt_id && String(body.expected_attempt_id) !== String(attemptId))) {
    const tamperEval = evaluateProctoringEventRisk('payload_tamper_detected', { repeatCount: 1, examConfig: a, metadata: body });
    const tamperId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO exam_proctoring_events(id,exam_id,attempt_id,source,candidate_code,event_type,category,risk_level,risk_label,description,device_env_json,status,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending_review',?)`
    ).bind(tamperId, a.exam_id, attemptId, source, a.candidate_code || a.sfn_id || '', 'payload_tamper_detected', 'integrity', 4, tamperEval.risk_label, tamperEval.description, JSON.stringify({ ip: clientIpFrom(request) }), nowIso()).run();
    return bad('Phát hiện dữ liệu yêu cầu bị can thiệp hoặc không toàn vẹn.', 400, { code: 'PAYLOAD_TAMPER_DETECTED', event_id: tamperId, risk_level: 4 });
  }

  const priorCountRow = await env.DB.prepare(
    `SELECT COUNT(*) n FROM exam_proctoring_events WHERE attempt_id=? AND event_type=?`
  ).bind(attemptId, rawType).first().catch(() => ({ n: 0 }));
  const repeatCount = Number(priorCountRow?.n || 0) + 1;

  const evaluated = evaluateProctoringEventRisk(rawType, {
    repeatCount,
    examConfig: a,
    metadata: { description: body.description, category: body.category }
  });

  const currentIp = str(body.client_ip || clientIpFrom(request));
  const vpnSuspected = Boolean(body.vpn_suspected || request.headers.get('x-vpn-suspected') === '1');
  const table = source === 'guest' ? 'exam_guest_attempts' : 'exam_attempts';

  let ipChanged = false;
  const initialIp = a.initial_ip || currentIp;
  if (a.last_ip && currentIp && a.last_ip !== currentIp) {
    ipChanged = true;
  }

  // Update attempt live telemetry status columns without interrupting exam answers
  let camStatus = a.camera_status || 'not_required';
  let micStatus = a.mic_status || 'not_required';
  let cam2Status = a.secondary_camera_status || 'not_required';
  let devStatus = a.device_status || 'normal';

  if (rawType === 'camera_connected') camStatus = 'active';
  else if (rawType === 'camera_disconnected') camStatus = 'disconnected';
  else if (rawType === 'camera_covered') camStatus = 'covered';
  else if (rawType === 'candidate_absent_frame') camStatus = 'absent';
  else if (rawType === 'multiple_faces_detected') camStatus = 'multiple_faces';
  else if (rawType === 'camera_moved') camStatus = 'moved';

  if (rawType === 'secondary_camera_connected') cam2Status = 'active';
  else if (rawType === 'secondary_camera_disconnected') cam2Status = 'disconnected';

  if (rawType === 'mic_connected') micStatus = 'active';
  else if (rawType === 'mic_disconnected') micStatus = 'disconnected';
  else if (['audio_interrupted', 'voice_anomaly_detected'].includes(rawType)) micStatus = 'anomaly';

  if (['multi_monitor_detected', 'display_mirroring_detected', 'usb_device_connected', 'bluetooth_device_connected', 'vm_detected', 'remote_desktop_detected', 'devtools_detected', 'extension_detected', 'browser_tamper_detected'].includes(rawType)) {
    devStatus = rawType;
  }

  const newMaxRisk = Math.max(Number(a.max_risk_level || 0), evaluated.risk_level);
  const eventId = crypto.randomUUID();
  const occurredAt = str(body.occurred_at) || nowIso();
  const deviceEnv = {
    ip: currentIp,
    vpn_suspected: vpnSuspected,
    user_agent: str(request.headers.get('user-agent')).slice(0, 200),
    ...(body.device_env && typeof body.device_env === 'object' ? body.device_env : {})
  };

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO exam_proctoring_events(id,exam_id,attempt_id,source,candidate_code,event_type,category,risk_level,risk_label,description,device_env_json,evidence_id,status,occurred_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'pending_review',?,CURRENT_TIMESTAMP)`
    ).bind(
      eventId,
      a.exam_id,
      attemptId,
      source,
      a.candidate_code || a.sfn_id || '',
      evaluated.event_type,
      evaluated.category,
      evaluated.risk_level,
      evaluated.risk_label,
      evaluated.description,
      JSON.stringify(deviceEnv),
      str(body.evidence_id) || null,
      occurredAt
    ),
    env.DB.prepare(
      `UPDATE ${table} SET initial_ip=COALESCE(initial_ip,?), last_ip=?, ip_change_count=COALESCE(ip_change_count,0)+?, vpn_suspected=CASE WHEN ? THEN 1 ELSE COALESCE(vpn_suspected,0) END, camera_status=?, mic_status=?, secondary_camera_status=?, device_status=?, max_risk_level=?, proctor_event_count=COALESCE(proctor_event_count,0)+1 WHERE id=?`
    ).bind(
      initialIp,
      currentIp,
      ipChanged ? 1 : 0,
      vpnSuspected ? 1 : 0,
      camStatus,
      micStatus,
      cam2Status,
      devStatus,
      newMaxRisk,
      attemptId
    )
  ]);

  await recordAudit(env, {
    examId: a.exam_id,
    attemptId,
    eventType: 'proctor.event.recorded',
    detail: { event_id: eventId, event_type: evaluated.event_type, risk_level: evaluated.risk_level, repeat_count: repeatCount }
  });

  return ok({
    event_id: eventId,
    attempt_id: attemptId,
    event_type: evaluated.event_type,
    category: evaluated.category,
    risk_level: evaluated.risk_level,
    risk_label: evaluated.risk_label,
    description: evaluated.description,
    repeat_count: repeatCount,
    auto_cancel_exam: false,
    camera_status: camStatus,
    mic_status: micStatus,
    secondary_camera_status: cam2Status,
    device_status: devStatus
  });
}

export async function uploadDigitalEvidence(env, source, attemptId, request) {
  await ensureAdditiveSchema(env);
  const a = await authorize(env, source, attemptId, request);
  const ct = String(request.headers.get('content-type') || '').toLowerCase();

  let bytes;
  let mime = 'application/octet-stream';
  let evidenceType = 'webcam_snapshot';
  let eventId = null;
  let metadata = {};

  if (ct.includes('multipart/form-data')) {
    let form;
    try { form = await request.formData(); } catch { return bad('Không thể đọc dữ liệu bằng chứng tải lên.', 400); }
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') return bad('Thiếu tệp bằng chứng số.', 400);
    bytes = new Uint8Array(await file.arrayBuffer());
    mime = str(file.type || 'image/webp').slice(0, 120);
    evidenceType = str(form.get('evidence_type') || 'webcam_snapshot').slice(0, 80);
    eventId = str(form.get('event_id')) || null;
    metadata = safeJson(form.get('metadata'), {});
  } else {
    const body = await readJsonBody(request, 2_000_000);
    evidenceType = str(body.evidence_type || 'telemetry_bundle').slice(0, 80);
    eventId = str(body.event_id) || null;
    metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
    if (body.base64_data) {
      const binStr = atob(String(body.base64_data));
      bytes = Uint8Array.from(binStr, c => c.charCodeAt(0));
      mime = str(body.mime_type || 'image/png').slice(0, 120);
    } else {
      const jsonStr = JSON.stringify(body.payload || metadata);
      bytes = new TextEncoder().encode(jsonStr);
      mime = 'application/json';
    }
  }

  if (!bytes || bytes.byteLength === 0) return bad('Nội dung bằng chứng số rỗng.', 400);
  if (bytes.byteLength > 15 * 1024 * 1024) return bad('Tệp bằng chứng vượt quá giới hạn 15MB.', 413);

  const sha256 = await sha256Hex(bytes);
  if (metadata.expected_sha256 && String(metadata.expected_sha256).toLowerCase() !== sha256) {
    return bad('Mã băm kiểm tra tính toàn vẹn của bằng chứng không khớp (Data Integrity Violation).', 400, {
      code: 'EVIDENCE_HASH_MISMATCH',
      expected: metadata.expected_sha256,
      actual: sha256
    });
  }

  const prevRow = await env.DB.prepare(
    `SELECT chain_hash FROM exam_digital_evidence WHERE attempt_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1`
  ).bind(attemptId).first().catch(() => null);
  const prevChain = prevRow?.chain_hash || 'GENESIS';
  const createdIso = nowIso();
  const chainHash = await sha256Hex(`${prevChain}:${sha256}:${createdIso}`);

  const evidenceId = crypto.randomUUID();
  const r2Key = `proctor-evidence/${a.exam_id}/${attemptId}/${createdIso.slice(0, 10)}/${evidenceId}-${evidenceType}`;
  const retentionUntil = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();

  if (env?.FILES?.put) {
    await env.FILES.put(r2Key, bytes, {
      httpMetadata: { contentType: mime },
      customMetadata: { attemptId, examId: a.exam_id, evidenceType, sha256, chainHash }
    });
  }

  await env.DB.prepare(
    `INSERT INTO exam_digital_evidence(id,exam_id,attempt_id,source,candidate_code,event_id,evidence_type,r2_key,mime_type,byte_size,sha256,chain_hash,metadata_json,retention_until,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    evidenceId,
    a.exam_id,
    attemptId,
    source,
    a.candidate_code || a.sfn_id || '',
    eventId,
    evidenceType,
    r2Key,
    mime,
    bytes.byteLength,
    sha256,
    chainHash,
    JSON.stringify({ ...metadata, prev_chain_hash: prevChain, ip: clientIpFrom(request) }),
    retentionUntil,
    createdIso
  ).run();

  if (eventId) {
    await env.DB.prepare(`UPDATE exam_proctoring_events SET evidence_id=? WHERE id=? AND attempt_id=?`).bind(evidenceId, eventId, attemptId).run().catch(() => {});
  }

  await recordAudit(env, {
    examId: a.exam_id,
    attemptId,
    eventType: 'evidence.stored',
    detail: { evidence_id: evidenceId, evidence_type: evidenceType, sha256, chain_hash: chainHash, r2_key: r2Key }
  });

  return ok({
    evidence_id: evidenceId,
    attempt_id: attemptId,
    evidence_type: evidenceType,
    r2_key: r2Key,
    byte_size: bytes.byteLength,
    sha256,
    chain_hash: chainHash,
    retention_until: retentionUntil
  });
}

export async function adminGetAttemptTimeline(env, attemptId, request) {
  const admin = await authorizeAdmin(env, request, 'monitor:read');
  await ensureAdditiveSchema(env);

  let source = 'guest';
  let attempt = await env.DB.prepare(`SELECT * FROM exam_guest_attempts WHERE id=?`).bind(attemptId).first();
  if (!attempt) {
    source = 'internal';
    attempt = await env.DB.prepare(`SELECT a.*, u.full_name, u.sfn_id candidate_code, u.email FROM exam_attempts a JOIN users u ON u.id=a.user_id WHERE a.id=?`).bind(attemptId).first();
  }
  if (!attempt) return bad('Không tìm thấy phiên dự thi.', 404);

  const proctorEvents = (await env.DB.prepare(
    `SELECT * FROM exam_proctoring_events WHERE attempt_id=? ORDER BY occurred_at ASC, rowid ASC`
  ).bind(attemptId).all())?.results || [];

  const evidenceRows = (await env.DB.prepare(
    `SELECT * FROM exam_digital_evidence WHERE attempt_id=? ORDER BY created_at ASC, rowid ASC`
  ).bind(attemptId).all())?.results || [];

  // Verify cryptographic chain of custody across all stored evidence items
  let prevChain = 'GENESIS';
  let chainIntact = true;
  const verifiedEvidence = [];
  for (const ev of evidenceRows) {
    const expectedChain = await sha256Hex(`${prevChain}:${ev.sha256}:${ev.created_at}`);
    const valid = expectedChain === ev.chain_hash;
    if (!valid) chainIntact = false;
    prevChain = ev.chain_hash;
    verifiedEvidence.push({
      ...ev,
      metadata: safeJson(ev.metadata_json, {}),
      chain_verified: valid,
      download_url: `/api/admin/evidence/${ev.id}`
    });
  }

  const auditRows = (await env.DB.prepare(
    `SELECT * FROM exam_audit_log WHERE attempt_id=? ORDER BY rowid ASC`
  ).bind(attemptId).all())?.results || [];

  await recordAudit(env, {
    examId: attempt.exam_id,
    attemptId,
    actorUserId: admin.user_id,
    eventType: 'monitor.timeline.viewed',
    detail: { viewer_email: admin.email }
  });

  return ok({
    attempt: {
      id: attempt.id,
      exam_id: attempt.exam_id,
      source,
      status: attempt.status,
      full_name: attempt.full_name,
      candidate_code: attempt.candidate_code,
      started_at: attempt.started_at,
      last_saved_at: attempt.last_saved_at,
      submitted_at: attempt.submitted_at,
      initial_ip: attempt.initial_ip || null,
      last_ip: attempt.last_ip || null,
      ip_change_count: Number(attempt.ip_change_count || 0),
      vpn_suspected: Boolean(attempt.vpn_suspected),
      camera_status: attempt.camera_status || 'not_required',
      mic_status: attempt.mic_status || 'not_required',
      secondary_camera_status: attempt.secondary_camera_status || 'not_required',
      device_status: attempt.device_status || 'normal',
      max_risk_level: Number(attempt.max_risk_level || 0),
      candidate_explanation: attempt.candidate_explanation || ''
    },
    proctoring_events: proctorEvents.map(e => ({
      ...e,
      device_env: safeJson(e.device_env_json, {})
    })),
    digital_evidence: verifiedEvidence,
    evidence_chain_intact: chainIntact,
    audit_trail: auditRows.map(r => ({ ...r, detail: safeJson(r.detail_json, {}) }))
  });
}

export async function adminReviewProctoringEvent(env, eventId, request) {
  const admin = await authorizeAdmin(env, request, 'monitor:write');
  await ensureAdditiveSchema(env);
  const body = await readJsonBody(request, 16_384);
  const status = ['pending_review', 'acknowledged', 'verified_violation', 'dismissed_benign', 'escalated_suspension'].includes(str(body.status))
    ? str(body.status)
    : 'acknowledged';
  const decisionNote = str(body.decision_note || body.reason).slice(0, 2000);
  if (!decisionNote) return bad('Vui lòng nhập nhận xét hoặc căn cứ xử lý sự kiện giám sát.', 400);

  const existing = await env.DB.prepare(`SELECT * FROM exam_proctoring_events WHERE id=?`).bind(eventId).first();
  if (!existing) return bad('Không tìm thấy sự kiện giám sát.', 404);

  const receivedBy = str(body.received_by || existing.received_by || admin.email);
  const decidedBy = str(body.decided_by || admin.email);
  const decidedAt = nowIso();

  await env.DB.prepare(
    `UPDATE exam_proctoring_events SET status=?, received_by=?, decided_by=?, decision_note=?, decided_at=? WHERE id=?`
  ).bind(status, receivedBy, decidedBy, decisionNote, decidedAt, eventId).run();

  await recordAudit(env, {
    examId: existing.exam_id,
    attemptId: existing.attempt_id,
    actorUserId: admin.user_id,
    eventType: 'proctor.event.reviewed',
    detail: { event_id: eventId, status, received_by: receivedBy, decided_by: decidedBy, decision_note: decisionNote }
  });

  return ok({
    event_id: eventId,
    attempt_id: existing.attempt_id,
    status,
    received_by: receivedBy,
    decided_by: decidedBy,
    decision_note: decisionNote,
    decided_at: decidedAt
  });
}

export async function adminDownloadDigitalEvidence(env, evidenceId, request) {
  const admin = await authorizeAdmin(env, request, 'monitor:read');
  await ensureAdditiveSchema(env);
  const ev = await env.DB.prepare(`SELECT * FROM exam_digital_evidence WHERE id=?`).bind(evidenceId).first();
  if (!ev) return bad('Không tìm thấy bằng chứng số.', 404);

  await recordAudit(env, {
    examId: ev.exam_id,
    attemptId: ev.attempt_id,
    actorUserId: admin.user_id,
    eventType: 'evidence.accessed',
    detail: { evidence_id: evidenceId, r2_key: ev.r2_key, sha256: ev.sha256 }
  });

  const url = new URL(request.url);
  if (url.searchParams.get('meta') === '1' || !env?.FILES?.get) {
    return ok({
      evidence: {
        ...ev,
        metadata: safeJson(ev.metadata_json, {})
      }
    });
  }

  const obj = await env.FILES.get(ev.r2_key);
  if (!obj) {
    return ok({
      evidence: {
        ...ev,
        metadata: safeJson(ev.metadata_json, {})
      }
    });
  }

  return new Response(obj.body, {
    status: 200,
    headers: {
      'content-type': ev.mime_type || 'application/octet-stream',
      'x-evidence-id': ev.id,
      'x-evidence-sha256': ev.sha256,
      'x-evidence-chain-hash': ev.chain_hash,
      'cache-control': 'private, no-store'
    }
  });
}

export async function adminGetProctoringReport(env, request) {
  await authorizeAdmin(env, request, 'monitor:read');
  await ensureAdditiveSchema(env);
  const url = new URL(request.url);
  const examId = str(url.searchParams.get('exam_id'));

  const evRows = examId
    ? ((await env.DB.prepare(`SELECT * FROM exam_proctoring_events WHERE exam_id=? ORDER BY occurred_at DESC`).bind(examId).all())?.results || [])
    : ((await env.DB.prepare(`SELECT * FROM exam_proctoring_events ORDER BY occurred_at DESC LIMIT 500`).all())?.results || []);

  const evidenceCount = examId
    ? Number((await env.DB.prepare(`SELECT COUNT(*) n FROM exam_digital_evidence WHERE exam_id=?`).bind(examId).first())?.n || 0)
    : Number((await env.DB.prepare(`SELECT COUNT(*) n FROM exam_digital_evidence`).first())?.n || 0);

  const byRisk = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const byCategory = {};
  const byStatus = {};
  for (const e of evRows) {
    const r = Number(e.risk_level || 1);
    byRisk[r] = (byRisk[r] || 0) + 1;
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
    byStatus[e.status] = (byStatus[e.status] || 0) + 1;
  }

  return ok({
    report: {
      exam_id: examId || 'ALL',
      generated_at: nowIso(),
      total_events: evRows.length,
      total_digital_evidence: evidenceCount,
      risk_summary: {
        level_1_normal_warning: byRisk[1],
        level_2_abnormal_watch: byRisk[2],
        level_3_violation_sign: byRisk[3],
        level_4_serious_suspension_review: byRisk[4]
      },
      category_breakdown: byCategory,
      resolution_status_breakdown: byStatus,
      policy_note: 'Mọi cảnh báo kỹ thuật đều được đối chiếu bằng chứng số (SHA-256) và xem xét bởi người có thẩm quyền; hệ thống không tự động hủy bài thi khi chưa có quyết định xử lý.'
    }
  });
}


export async function uploadCheckinPhoto(env, source, attemptId, request) {
  await ensureAdditiveSchema(env);
  const a = await authorize(env, source, attemptId, request);
  const body = await readJsonBody(request, 2_000_000);
  const photoType = ['id_card', 'portrait', 'workspace_360', 'desk_inspection'].includes(str(body.photo_type))
    ? str(body.photo_type)
    : 'portrait';

  const base64Data = str(body.base64_data);
  if (!base64Data) return bad('Thiếu dữ liệu hình ảnh check-in trước giờ thi.', 400);
  const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
  const mime = str(body.mime_type || 'image/webp').slice(0, 80);
  const sha256 = await sha256Hex(bytes);

  const prevRow = await env.DB.prepare(
    `SELECT chain_hash FROM exam_digital_evidence WHERE attempt_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1`
  ).bind(attemptId).first().catch(() => null);
  const prevChain = prevRow?.chain_hash || 'GENESIS';
  const createdIso = nowIso();
  const chainHash = await sha256Hex(`${prevChain}:${sha256}:${createdIso}`);
  const evidenceId = crypto.randomUUID();
  const r2Key = `proctor-evidence/${a.exam_id}/${attemptId}/checkin-${photoType}-${evidenceId}`;
  const retentionUntil = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();

  if (env?.FILES?.put) {
    await env.FILES.put(r2Key, bytes, {
      httpMetadata: { contentType: mime },
      customMetadata: { attemptId, examId: a.exam_id, photoType, sha256, chainHash }
    });
  }

  await env.DB.prepare(
    `INSERT INTO exam_digital_evidence(id,exam_id,attempt_id,source,candidate_code,event_id,evidence_type,r2_key,mime_type,byte_size,sha256,chain_hash,metadata_json,retention_until,created_at) VALUES(?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?)`
  ).bind(
    evidenceId,
    a.exam_id,
    attemptId,
    source,
    a.candidate_code || a.sfn_id || '',
    `checkin_${photoType}`,
    r2Key,
    mime,
    bytes.byteLength,
    sha256,
    chainHash,
    JSON.stringify({ photo_type: photoType, verified_at: createdIso }),
    retentionUntil,
    createdIso
  ).run();

  const table = source === 'guest' ? 'exam_guest_attempts' : 'exam_attempts';
  const currentCheckin = safeJson(a.checkin_photos_json, {});
  currentCheckin[photoType] = { evidence_id: evidenceId, sha256, uploaded_at: createdIso };
  await env.DB.prepare(`UPDATE ${table} SET checkin_photos_json=? WHERE id=?`).bind(JSON.stringify(currentCheckin), attemptId).run();

  await recordAudit(env, {
    examId: a.exam_id,
    attemptId,
    eventType: 'attempt.checkin_photo',
    detail: { photo_type: photoType, evidence_id: evidenceId, sha256 }
  });

  return ok({
    attempt_id: attemptId,
    photo_type: photoType,
    evidence_id: evidenceId,
    sha256,
    chain_hash: chainHash,
    checkin_photos: currentCheckin
  });
}

export async function createSecondaryCameraPair(env, source, attemptId, request) {
  await ensureAdditiveSchema(env);
  const a = await authorize(env, source, attemptId, request);
  const pairingCode = `CAM2-${attemptId.slice(0, 6).toUpperCase()}-${randomHex(6).toUpperCase()}`;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO exam_secondary_camera_links(pairing_code,exam_id,attempt_id,source,candidate_code,status,mobile_device_info_json,expires_at,created_at) VALUES(?,?,?,?,?,'pending','{}',?,CURRENT_TIMESTAMP)`
  ).bind(pairingCode, a.exam_id, attemptId, source, a.candidate_code || a.sfn_id || '', expiresAt).run();

  await recordAudit(env, {
    examId: a.exam_id,
    attemptId,
    eventType: 'secondary_camera.pair_created',
    detail: { pairing_code: pairingCode, expires_at: expiresAt }
  });

  return ok({
    attempt_id: attemptId,
    pairing_code: pairingCode,
    qr_url: `https://exam.skyfirst.io.vn/?cam2_qr=${encodeURIComponent(pairingCode)}`,
    expires_at: expiresAt
  });
}

export async function connectSecondaryCameraByQr(env, pairingCode, request) {
  await ensureAdditiveSchema(env);
  const cleanCode = str(pairingCode).toUpperCase();
  const link = await env.DB.prepare(`SELECT * FROM exam_secondary_camera_links WHERE UPPER(pairing_code)=? LIMIT 1`).bind(cleanCode).first();
  if (!link) return bad('Mã QR liên kết camera thứ hai không tồn tại.', 404, { code: 'PAIRING_CODE_NOT_FOUND' });

  const expMs = databaseTimeMs(link.expires_at);
  if (Number.isFinite(expMs) && expMs <= Date.now()) {
    return bad('Mã QR liên kết camera thứ hai đã hết hạn. Vui lòng tạo mã mới trên màn hình thi chính.', 401, { code: 'PAIRING_CODE_EXPIRED' });
  }

  const body = await readJsonBody(request, 16_384);
  const mobileInfo = {
    platform: str(body.platform || 'mobile_camera'),
    camera_facing: str(body.camera_facing || 'environment'),
    user_agent: str(request.headers.get('user-agent')).slice(0, 180),
    ip: clientIpFrom(request),
    paired_at: nowIso()
  };

  const table = link.source === 'guest' ? 'exam_guest_attempts' : 'exam_attempts';
  await env.DB.batch([
    env.DB.prepare(`UPDATE exam_secondary_camera_links SET status='streaming', mobile_device_info_json=?, last_heartbeat_at=CURRENT_TIMESTAMP WHERE pairing_code=?`).bind(JSON.stringify(mobileInfo), link.pairing_code),
    env.DB.prepare(`UPDATE ${table} SET secondary_camera_status='active' WHERE id=?`).bind(link.attempt_id),
    env.DB.prepare(
      `INSERT INTO exam_proctoring_events(id,exam_id,attempt_id,source,candidate_code,event_type,category,risk_level,risk_label,description,device_env_json,status,occurred_at) VALUES(?,?,?,?,?,'secondary_camera_connected','camera_audio',1,?,'Đã kết nối camera thứ hai (điện thoại quét QR) giám sát góc rộng',?,'acknowledged',CURRENT_TIMESTAMP)`
    ).bind(crypto.randomUUID(), link.exam_id, link.attempt_id, link.source, link.candidate_code, RISK_LEVEL_LABELS[1], JSON.stringify(mobileInfo))
  ]);

  return ok({
    paired: true,
    pairing_code: link.pairing_code,
    attempt_id: link.attempt_id,
    exam_id: link.exam_id,
    secondary_camera_status: 'active'
  });
}

export async function uploadSecondaryCameraFrame(env, pairingCode, request) {
  await ensureAdditiveSchema(env);
  const cleanCode = str(pairingCode).toUpperCase();
  const link = await env.DB.prepare(`SELECT * FROM exam_secondary_camera_links WHERE UPPER(pairing_code)=? LIMIT 1`).bind(cleanCode).first();
  if (!link || link.status !== 'streaming') {
    return bad('Phiên liên kết camera thứ hai chưa được kết nối hoặc đã ngắt.', 403, { code: 'SECONDARY_CAMERA_NOT_PAIRED' });
  }

  const body = await readJsonBody(request, 2_000_000);
  const base64Data = str(body.base64_data);
  if (!base64Data) return bad('Thiếu dữ liệu khung hình từ camera thứ hai.', 400);
  const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
  const mime = str(body.mime_type || 'image/webp').slice(0, 80);
  const sha256 = await sha256Hex(bytes);

  const prevRow = await env.DB.prepare(
    `SELECT chain_hash FROM exam_digital_evidence WHERE attempt_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1`
  ).bind(link.attempt_id).first().catch(() => null);
  const prevChain = prevRow?.chain_hash || 'GENESIS';
  const createdIso = nowIso();
  const chainHash = await sha256Hex(`${prevChain}:${sha256}:${createdIso}`);
  const evidenceId = crypto.randomUUID();
  const r2Key = `proctor-evidence/${link.exam_id}/${link.attempt_id}/cam2-qr-${evidenceId}`;
  const retentionUntil = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();

  if (env?.FILES?.put) {
    await env.FILES.put(r2Key, bytes, {
      httpMetadata: { contentType: mime },
      customMetadata: { attemptId: link.attempt_id, examId: link.exam_id, pairingCode: link.pairing_code, sha256, chainHash }
    });
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO exam_digital_evidence(id,exam_id,attempt_id,source,candidate_code,event_id,evidence_type,r2_key,mime_type,byte_size,sha256,chain_hash,metadata_json,retention_until,created_at) VALUES(?,?,?,?,?,NULL,'secondary_camera_snapshot',?,?,?,?,?,?,?,?)`
    ).bind(
      evidenceId,
      link.exam_id,
      link.attempt_id,
      link.source,
      link.candidate_code,
      r2Key,
      mime,
      bytes.byteLength,
      sha256,
      chainHash,
      JSON.stringify({ camera: 'secondary_qr_mobile', pairing_code: link.pairing_code, synchronized_at: createdIso }),
      retentionUntil,
      createdIso
    ),
    env.DB.prepare(`UPDATE exam_secondary_camera_links SET last_heartbeat_at=CURRENT_TIMESTAMP, last_evidence_id=? WHERE pairing_code=?`).bind(evidenceId, link.pairing_code)
  ]);

  return ok({
    evidence_id: evidenceId,
    attempt_id: link.attempt_id,
    evidence_type: 'secondary_camera_snapshot',
    sha256,
    chain_hash: chainHash
  });
}

export async function respondToProctorPrompt(env, source, attemptId, request) {
  await ensureAdditiveSchema(env);
  const a = await authorize(env, source, attemptId, request);
  const body = await readJsonBody(request, 16_384);
  const responseNote = str(body.response_note || body.message).slice(0, 1500);
  if (!responseNote) return bad('Vui lòng nhập phản hồi xác minh theo yêu cầu của giám thị.', 400);

  const table = source === 'guest' ? 'exam_guest_attempts' : 'exam_attempts';
  const currentPrompt = safeJson(a.proctor_prompt_json, {});
  const updatedPrompt = {
    ...currentPrompt,
    status: 'responded',
    response_note: responseNote,
    response_evidence_id: str(body.evidence_id) || null,
    responded_at: nowIso()
  };

  await env.DB.prepare(
    `UPDATE ${table} SET lifecycle_state='resumed', proctor_prompt_json=? WHERE id=?`
  ).bind(JSON.stringify(updatedPrompt), attemptId).run();

  await recordAudit(env, {
    examId: a.exam_id,
    attemptId,
    eventType: 'proctor.prompt.responded',
    detail: updatedPrompt
  });

  return ok({
    attempt_id: attemptId,
    lifecycle_state: 'resumed',
    proctor_prompt: updatedPrompt
  });
}


// =============================================================================
// AUTHOR DOCUMENT/OCR PARSER, AI ASSISTANT, QTI, ANALYTICS & PROPRIETARY LAB
// =============================================================================
export async function adminParseDocumentToQuestions(env, request) {
  const admin = await authorizeAdmin(env, request, 'questions:write');
  await ensureAdditiveSchema(env);
  const body = await readJsonBody(request, 500_000);
  const rawText = str(body.document_text || body.ocr_text || body.content);
  const sourceFormat = str(body.source_format || 'docx_pdf_ocr').toLowerCase();
  const defaultSubject = str(body.subject || 'Chung');
  const defaultTopic = str(body.topic || 'Tài liệu nhập');

  if (!rawText) return bad('Vui lòng cung cấp nội dung văn bản hoặc kết quả OCR từ tài liệu (Word/PDF/PPTX/Excel/Ảnh).', 400);

  // Split into question blocks by "Câu <number>" or "<number>."
  const blocks = rawText
    .split(/(?:^|\n)(?=(?:Câu\s*\d+|Question\s*\d+|\d+)\s*[.:]?\s+)/i)
    .map(b => b.trim())
    .filter(Boolean);

  const parsedDrafts = blocks.map((block, idx) => {
    const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const firstLine = lines[0] || `Câu ${idx + 1}`;
    const stem = firstLine.replace(/^(?:Câu\s*\d+|Question\s*\d+|\d+)\s*[.:]?\s*/i, '').trim() || firstLine;
    const options = [];
    let detectedAnswer = null;
    let explanation = '';
    let points = 1;
    let uncertainOcr = /\?\?\?|\[OCR_UNCERTAIN\]/.test(block);

    for (const line of lines.slice(1)) {
      const optMatch = line.match(/^([A-D])[.)]\s*(.+)$/);
      if (optMatch) {
        options.push(optMatch[2].trim());
        continue;
      }
      const ansMatch = line.match(/^(?:Đáp án|Answer|Key)\s*[:=]\s*(.+)$/i);
      if (ansMatch) {
        const rawAns = ansMatch[1].trim();
        if (/^[A-D]$/i.test(rawAns) && options.length >= (rawAns.toUpperCase().charCodeAt(0) - 64)) {
          detectedAnswer = options[rawAns.toUpperCase().charCodeAt(0) - 65];
        } else {
          detectedAnswer = rawAns;
        }
        continue;
      }
      const ptMatch = line.match(/^(?:Điểm|Points)\s*[:=]\s*(\d+(?:\.\d+)?)/i);
      if (ptMatch) {
        points = Number(ptMatch[1]) || 1;
        continue;
      }
      const expMatch = line.match(/^(?:Lời giải|Giải thích|Explanation)\s*[:=]\s*(.+)$/i);
      if (expMatch) {
        explanation = expMatch[1].trim();
      }
    }

    const qType = options.length >= 2 ? 'mcq' : (/\\frac|\\sqrt|\\int|∑/.test(block) ? 'math' : 'essay');
    // Mandatory rule: Never guess an answer when the source document does not provide one!
    const needsReview = uncertainOcr || (qType === 'mcq' && detectedAnswer === null);

    return {
      draft_id: `DRAFT-${idx + 1}-${randomHex(3).toUpperCase()}`,
      type: qType,
      subject: defaultSubject,
      topic: defaultTopic,
      difficulty: 'medium',
      question: stem,
      options,
      answer: detectedAnswer,
      points,
      explanation,
      has_formula: /\\frac|\\sqrt|\\int|∑|π/.test(block),
      needs_author_review: needsReview,
      review_flags: [
        ...(uncertainOcr ? ['OCR_LOW_CONFIDENCE'] : []),
        ...(qType === 'mcq' && detectedAnswer === null ? ['MISSING_ANSWER_IN_SOURCE_DO_NOT_GUESS'] : [])
      ],
      approval_status: 'pending_author_confirmation'
    };
  });

  await recordAudit(env, {
    actorUserId: admin.user_id,
    eventType: 'authoring.document_parsed',
    detail: { source_format: sourceFormat, extracted_count: parsedDrafts.length }
  });

  return ok({
    source_format: sourceFormat,
    extracted_count: parsedDrafts.length,
    auto_published: false,
    draft_questions: parsedDrafts,
    notice: 'Các câu hỏi nhận diện từ tài liệu ở trạng thái bản nháp chờ kiểm tra. Hệ thống không tự suy đoán đáp án thiếu và không tự đưa vào kỳ thi chính thức khi chưa được phê duyệt.'
  });
}

export async function adminAiAuthoringAssist(env, request) {
  const admin = await authorizeAdmin(env, request, 'questions:write');
  await ensureAdditiveSchema(env);
  const body = await readJsonBody(request, 100_000);
  const topic = str(body.topic || 'Kiến thức tổng hợp');
  const sourceText = str(body.source_text || topic);
  const questionType = str(body.type || 'mcq').toLowerCase();
  const difficulty = ['easy', 'medium', 'hard'].includes(str(body.difficulty)) ? str(body.difficulty) : 'medium';

  const existingBank = (await env.DB.prepare(`SELECT id, question FROM exam_question_bank WHERE status!='deleted' LIMIT 200`).all())?.results || [];
  const duplicateMatch = existingBank.find(q => str(q.question).toLowerCase() === sourceText.toLowerCase());

  const suggestion = {
    suggestion_id: `AI-SUG-${randomHex(4).toUpperCase()}`,
    topic,
    difficulty,
    cognitive_level: difficulty === 'hard' ? 'application' : 'understanding',
    type: questionType,
    question: body.question_stem || `[Dự thảo hỗ trợ biên soạn - ${topic}]: Phân tích nội dung trọng tâm từ nguồn tài liệu "${sourceText.slice(0, 80)}"`,
    options: questionType === 'mcq'
      ? ['Phương án đúng theo tài liệu nguồn', 'Phương án nhiễu 1 (khái niệm gần giống)', 'Phương án nhiễu 2 (trường hợp ngoại lệ)', 'Phương án nhiễu 3 (ngược điều kiện)']
      : (questionType === 'truefalse' ? ['Đúng', 'Sai'] : []),
    suggested_answer: questionType === 'mcq' ? 'Phương án đúng theo tài liệu nguồn' : (questionType === 'truefalse' ? 'Đúng' : null),
    explanation: 'Gợi ý lời giải và căn cứ từ tài liệu nguồn đã cung cấp.',
    rubric: [
      { criterion: 'Xác định đúng luận điểm / công thức trọng tâm', max_points: 0.5 },
      { criterion: 'Lập luận chặt chẽ, trình bày rõ từng bước', max_points: 0.5 }
    ],
    ambiguity_warnings: str(body.question_stem).length > 0 && str(body.question_stem).length < 12
      ? ['Câu hỏi quá ngắn, có nguy cơ đa nghĩa hoặc thiếu dữ kiện.']
      : [],
    duplicate_detected: Boolean(duplicateMatch),
    duplicate_question_id: duplicateMatch?.id || null,
    requires_human_approval: true,
    approval_status: 'draft_pending_author_approval',
    source_reference: sourceText.slice(0, 200)
  };

  await recordAudit(env, {
    actorUserId: admin.user_id,
    eventType: 'authoring.ai_assist_generated',
    detail: { suggestion_id: suggestion.suggestion_id, topic, type: questionType, duplicate_detected: suggestion.duplicate_detected }
  });

  return ok({ suggestion });
}

export async function adminManageProctorSessionDocuments(env, request) {
  const method = request.method.toUpperCase();
  if (method === 'GET') {
    await authorizeAdmin(env, request, 'monitor:read');
    await ensureAdditiveSchema(env);
    const rows = (await env.DB.prepare(`SELECT * FROM exam_service_files WHERE service_type='proctor_session_doc' ORDER BY created_at DESC LIMIT 100`).all())?.results || [];
    return ok({ documents: rows });
  }
  const admin = await authorizeAdmin(env, request, 'monitor:write');
  await ensureAdditiveSchema(env);
  const body = await readJsonBody(request, 500_000);
  const docTitle = str(body.title || 'Biên bản ca thi').slice(0, 160);
  const examId = str(body.exam_id);
  const note = str(body.content || body.note || 'Biên bản nghiệp vụ giám thị');
  const bytes = new TextEncoder().encode(JSON.stringify({ title: docTitle, exam_id: examId, note, author: admin.email, created_at: nowIso() }));
  const digest = await sha256Hex(bytes);
  const fileId = crypto.randomUUID();
  const r2Key = `proctor-session-docs/${examId || 'general'}/${fileId}.json`;

  if (env?.FILES?.put) {
    await env.FILES.put(r2Key, bytes, { httpMetadata: { contentType: 'application/json' } });
  }

  await env.DB.prepare(
    `INSERT INTO exam_service_files(id,service_type,request_id,r2_key,original_name,safe_name,mime_type,byte_size,sha256,uploaded_by_email,status,created_at) VALUES(?,'proctor_session_doc',?,?,?,?,?,?,?,?,'active',CURRENT_TIMESTAMP)`
  ).bind(fileId, examId || null, r2Key, docTitle, safeName(docTitle), 'application/json', bytes.byteLength, digest, admin.email).run();

  await recordAudit(env, {
    examId: examId || null,
    actorUserId: admin.user_id,
    eventType: 'proctor.session_document.uploaded',
    detail: { file_id: fileId, title: docTitle, sha256: digest }
  });

  return ok({
    document: {
      file_id: fileId,
      title: docTitle,
      exam_id: examId || null,
      r2_key: r2Key,
      sha256: digest,
      uploaded_by: admin.email
    }
  });
}

export async function adminQtiExportAndImport(env, request) {
  await ensureAdditiveSchema(env);
  if (request.method.toUpperCase() === 'GET') {
    const admin = await authorizeAdmin(env, request, 'questions:read');
    const url = new URL(request.url);
    const examId = str(url.searchParams.get('exam_id'));
    let rows = (await env.DB.prepare(`SELECT * FROM exam_question_bank WHERE status='active' ORDER BY updated_at DESC LIMIT 100`).all())?.results || [];
    if (!rows.length && examId) {
      const ex = await env.DB.prepare(`SELECT question_json FROM exams WHERE id=?`).bind(examId).first();
      const qs = safeJson(ex?.question_json, []);
      rows = qs.map(q => ({ id: q.id, topic: q.topic || 'Exam Item', question: q.question, options_json: JSON.stringify(q.options || []), answer_json: JSON.stringify(q.answer ?? '') }));
    }
    const itemsXml = rows.map(q => {
      const opts = safeJson(q.options_json, []);
      const ans = safeJson(q.answer_json, '');
      return `  <assessmentItem identifier="${q.id}" title="${q.topic || 'Item'}" adaptive="false" timeDependent="false">
    <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="string">
      <correctResponse><value>${String(ans ?? '')}</value></correctResponse>
    </responseDeclaration>
    <itemBody><p>${String(q.question || '')}</p>${opts.map((o, i) => `<simpleChoice identifier="OPT_${i}">${String(o)}</simpleChoice>`).join('')}</itemBody>
  </assessmentItem>`;
    }).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<questestinterop xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1">\n${itemsXml}\n</questestinterop>`;
    await recordAudit(env, { actorUserId: admin.user_id, eventType: 'qbank.qti_exported', detail: { count: rows.length } });
    return ok({ format: 'IMS_QTI_2.1', item_count: rows.length, qti_xml: xml });
  }

  const admin = await authorizeAdmin(env, request, 'questions:write');
  const body = await readJsonBody(request, 500_000);
  const xml = str(body.qti_xml);
  if (!xml.includes('<assessmentItem')) return bad('Nội dung XML không đúng định dạng chuẩn IMS QTI.', 400);
  const matches = [...xml.matchAll(/<assessmentItem[^>]*identifier="([^"]+)"[^>]*>[\s\S]*?<itemBody>[\s\S]*?<p>([\s\S]*?)<\/p>([\s\S]*?)<\/itemBody>[\s\S]*?<\/assessmentItem>/gi)];
  const imported = [];
  for (const m of matches) {
    const id = str(m[1]) || `qti-${crypto.randomUUID().slice(0, 8)}`;
    const questionText = str(m[2]);
    const choices = [...String(m[3] || '').matchAll(/<simpleChoice[^>]*>([\s\S]*?)<\/simpleChoice>/gi)].map(c => str(c[1]));
    const valMatch = m[0].match(/<correctResponse>\s*<value>([\s\S]*?)<\/value>\s*<\/correctResponse>/i);
    const answer = valMatch ? str(valMatch[1]) : (choices[0] || '');
    await env.DB.prepare(
      `INSERT INTO exam_question_bank(id,code,subject,topic,difficulty,type,question,options_json,answer_json,points,version,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,'active',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET question=excluded.question,options_json=excluded.options_json,answer_json=excluded.answer_json,updated_at=CURRENT_TIMESTAMP`
    ).bind(id, id.toUpperCase(), 'QTI', 'QTI Import', 'medium', choices.length ? 'mcq' : 'short', questionText, JSON.stringify(choices), JSON.stringify(answer), 1, admin.user_id).run();
    imported.push(id);
  }
  await recordAudit(env, { actorUserId: admin.user_id, eventType: 'qbank.qti_imported', detail: { count: imported.length } });
  return ok({ imported_count: imported.length, imported_ids: imported });
}

export async function adminGetExamPsychometricsAndAnalytics(env, examId, request) {
  await authorizeAdmin(env, request, 'results:read');
  await ensureAdditiveSchema(env);
  const exam = await env.DB.prepare(`SELECT * FROM exams WHERE id=?`).bind(examId).first();
  if (!exam) return bad('Không tìm thấy kỳ thi.', 404);

  const guests = (await env.DB.prepare(`SELECT * FROM exam_guest_attempts WHERE exam_id=? AND status='submitted'`).bind(examId).all())?.results || [];
  const internals = (await env.DB.prepare(`SELECT * FROM exam_attempts WHERE exam_id=? AND status='submitted'`).bind(examId).all())?.results || [];
  const all = [...guests, ...internals];
  const scores = all.map(a => Number(a.score ?? 0)).filter(Number.isFinite).sort((a, b) => a - b);

  const count = scores.length;
  const mean = count ? Number((scores.reduce((s, x) => s + x, 0) / count).toFixed(2)) : 0;
  const median = count ? (count % 2 === 1 ? scores[(count - 1) / 2] : Number(((scores[count / 2 - 1] + scores[count / 2]) / 2).toFixed(2))) : 0;
  const min = count ? scores[0] : 0;
  const max = count ? scores[count - 1] : 0;
  const passScore = Number(exam.passing_score || 0);
  const passCount = scores.filter(s => s >= passScore).length;

  const qs = safeJson(exam.question_json, []);
  const itemPsychometrics = (Array.isArray(qs) ? qs : []).map(q => {
    let correct = 0;
    for (const a of all) {
      const ans = safeJson(a.answers_json, {})[q.id];
      if (q.answer !== undefined && String(ans ?? '') === String(q.answer)) correct++;
    }
    const pVal = count ? Number((correct / count).toFixed(2)) : null;
    return {
      question_id: q.id,
      type: q.type,
      difficulty_p_value: pVal,
      difficulty_classification: pVal === null ? 'unrated' : pVal >= 0.75 ? 'easy' : pVal >= 0.35 ? 'optimal' : 'hard',
      needs_item_review: pVal !== null && (pVal < 0.1 || pVal > 0.98)
    };
  });

  return ok({
    exam_id: examId,
    exam_title: exam.title,
    submitted_count: count,
    score_statistics: { mean, median, min, max, passing_score: passScore, pass_rate_percent: count ? Math.round((passCount / count) * 100) : 0 },
    item_psychometrics: itemPsychometrics
  });
}

export async function evaluateCandidateBehavioralBiometrics(env, source, attemptId, request) {
  await ensureAdditiveSchema(env);
  const a = await authorize(env, source, attemptId, request);
  const body = await readJsonBody(request, 32_768);
  const qs = safeJson(a.question_json, []);
  const answers = safeJson(a.answers_json, {});
  const analysis = analyzeCognitiveAndBehavioralSignals({
    answers,
    questions: qs,
    behavioralVector: body.behavioral_vector || body,
    baselineVector: body.baseline_vector || null,
    durationSeconds: Number(body.duration_seconds) || null
  });

  let dynamicChallenge = null;
  if (analysis.requires_dynamic_challenge) {
    dynamicChallenge = generateDynamicIntegrityChallenge(a, answers, qs);
    const table = source === 'guest' ? 'exam_guest_attempts' : 'exam_attempts';
    await env.DB.prepare(`UPDATE ${table} SET lifecycle_state='pending_verification', proctor_prompt_json=? WHERE id=?`).bind(JSON.stringify(dynamicChallenge), attemptId).run();
  }

  return ok({
    attempt_id: attemptId,
    ...analysis,
    dynamic_challenge: dynamicChallenge
  });
}

export async function adminSecurityIntelligenceActions(env, subRoute, request) {
  const admin = await authorizeAdmin(env, request, 'monitor:read');
  await ensureAdditiveSchema(env);
  const url = new URL(request.url);
  const examId = str(url.searchParams.get('exam_id'));

  if (subRoute === 'collusion-graph' && request.method === 'GET') {
    const guests = (await (examId ? env.DB.prepare(`SELECT * FROM exam_guest_attempts WHERE exam_id=?`).bind(examId) : env.DB.prepare(`SELECT * FROM exam_guest_attempts LIMIT 200`)).all())?.results || [];
    const internals = (await (examId ? env.DB.prepare(`SELECT a.*, u.full_name, u.sfn_id candidate_code FROM exam_attempts a JOIN users u ON u.id=a.user_id WHERE a.exam_id=?`).bind(examId) : env.DB.prepare(`SELECT a.*, u.full_name, u.sfn_id candidate_code FROM exam_attempts a JOIN users u ON u.id=a.user_id LIMIT 200`)).all())?.results || [];
    const examRow = examId ? await env.DB.prepare(`SELECT question_json FROM exams WHERE id=?`).bind(examId).first() : null;
    const graph = buildCollusionGraph([...guests, ...internals], safeJson(examRow?.question_json, []));
    return ok({ graph });
  }

  if (subRoute === 'leak-scan' && request.method === 'POST') {
    const body = await readJsonBody(request, 100_000);
    const guests = (await env.DB.prepare(`SELECT * FROM exam_guest_attempts LIMIT 200`).all())?.results || [];
    const internals = (await env.DB.prepare(`SELECT a.*, u.sfn_id candidate_code FROM exam_attempts a JOIN users u ON u.id=a.user_id LIMIT 200`).all())?.results || [];
    const qbank = (await env.DB.prepare(`SELECT * FROM exam_question_bank WHERE status!='deleted' LIMIT 200`).all())?.results || [];
    const leakReport = traceHoneytokenLeak(body.leaked_text || '', [...guests, ...internals], qbank);
    await recordAudit(env, { actorUserId: admin.user_id, eventType: 'security.leak_scan.executed', detail: { leak_detected: leakReport.leak_detected } });
    return ok({ leak_report: leakReport });
  }

  if (subRoute === 'adversarial-lab' && request.method === 'POST') {
    const sim = runAdversarialExamSimulation();
    await recordAudit(env, { actorUserId: admin.user_id, eventType: 'security.adversarial_lab.executed', detail: { tpr: sim.true_positive_rate_percent, fpr: sim.false_positive_rate_percent } });
    return ok({ simulation: sim });
  }

  if (subRoute === 'threat-memory' && request.method === 'GET') {
    return ok({ threats: DEFAULT_THREAT_MEMORY });
  }

  return bad('Tuyến bảo mật không hợp lệ.', 404);
}

export {
  finalResponse,
  getAttempt,
  saveAttempt,
  submitAttempt,
  recordViolation,
  reviewAttempt,
  uploadAttachment,
  redeemLaunch,
  listPublicCatalog,
  getPublicAssessmentInfo,
  requestCandidateVerification,
  startPublicAssessment,
  getAdminDashboard,
  adminListExams,
  adminGetExam,
  adminCreateOrUpdateExam,
  adminTransitionExamLifecycle,
  adminListQuestionBank,
  adminSaveQuestionBankItem,
  adminImportQuestionBank,
  adminListCandidates,
  adminEnrollCandidate,
  adminIssueLaunchToken,
  adminMonitorAttempts,
  adminProctorAction,
  adminGetAttemptGradingDetail,
  adminGradeManualItem,
  adminResultWorkflowAction,
  adminListAppeals,
  adminResolveAppeal,
  adminManageUserRole,
  adminListAuditLogs,
  adminDownloadResponseFile,
  adminDownloadServiceFile,
  adminListFraudReports,
  adminResolveFraudReport,
  adminListEmailLogs,
  adminSendLifecycleEmailAction,
  health
};
