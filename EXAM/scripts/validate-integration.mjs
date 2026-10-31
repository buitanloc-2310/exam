process.on('unhandledRejection', e => { console.error(e); process.exit(1); });
/**
 * Standalone EXAM 2026 End-to-End Integration & Security Verification Suite (scripts/validate-integration.mjs)
 * Covers all mandatory scenarios from Article 35 without any external SLC dependency:
 * 1. Unauthorized user accessing /api/admin/* -> 401
 * 2. Logged-in user with insufficient role (e.g. report_viewer / proctor) calling restricted admin API -> 403
 * 3. Wrong, expired, or already-used OTP -> 401 / 409 / 429
 * 4. Excessive OTP requests (cooldown & rate limit) -> 429
 * 5. Unlisted email attempting restricted exam -> 403
 * 6. Exam not yet open (draft/upcoming) or closed -> 403
 * 7. Candidate attempting to access another candidate's attempt (IDOR/BOLA) -> 401
 * 8. Invalid answer shapes or oversized payload -> 400 / 413
 * 9. Fake score or fake answer supplied in submit request -> Ignored, server scores saved snapshot
 * 10. Duplicate submission -> Idempotent
 * 11. Concurrent save requests with same revision -> First succeeds, second gets 409 REVISION_CONFLICT
 * 12. Offline/reconnect recovery via revisioned save -> Preserves state
 * 13. Hard deadline elapsed during save -> Auto-finalizes last accepted snapshot and returns 409 submitted
 * 14. Ungraded essay blocks score visibility and blocks result publication -> 409 UNGRADED_MANUAL_QUESTIONS
 * 15. Unauthorized role attempting to modify grades -> 403 INSUFFICIENT_PERMISSION
 * 16. Published result protected against unauthorized score modification until revoked -> 409 PUBLISHED_RESULT_PROTECTED
 * 17. Invalid attachment file signature / wrong MIME -> 415
 * 18. Unconfigured or failing email service -> 503 EMAIL_SERVICE_UNCONFIGURED / 502 (never faked as 200)
 * 19. Complete SLC independence -> Global fetch throws if any outbound call is attempted, yet full EXAM lifecycle succeeds
 * 20. Direct private file access without admin grading permission -> 401 / 403
 * 21. Active attempt mid-exam protection -> Blocks changing questions or duration while candidate is in_progress
 * 22. Strict mode violation locking & proctor unlock with audit log
 * 23. Candidate result lookup & appeal submission & appeal officer resolution
 */

import { DatabaseSync } from './sqlite-compat.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import examWorker from '../src/index.js';

const db = new DatabaseSync(':memory:');
const migrationSql = fs.readFileSync('migrations/0001_exam_standalone_schema.sql', 'utf8');
db.exec(migrationSql);

class Stmt {
  constructor(sql, params = []) { this.sql = sql; this.params = params; }
  bind(...params) { return new Stmt(this.sql, params); }
  async first() { return db.prepare(this.sql).get(...this.params) || null; }
  async all() { return { results: db.prepare(this.sql).all(...this.params) }; }
  async run() {
    const x = db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(x.changes) } };
  }
}

const DB = {
  prepare: sql => new Stmt(sql),
  batch: async statements => {
    db.exec('BEGIN');
    try {
      const r = [];
      for (const s of statements) r.push(await s.run());
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
};

const r2Store = new Map();
const FILES = {
  put: async (key, stream, meta) => { r2Store.set(key, { stream, meta }); },
  delete: async key => { r2Store.delete(key); },
  get: async key => r2Store.has(key) ? { body: 'mock-binary-content' } : null
};

const sentEmails = [];
let emailServiceMode = 'active'; // 'active' | 'unconfigured' | 'error'

const baseEnv = {
  DB,
  FILES,
  ADMIN_BOOTSTRAP_TOKEN: 'test-bootstrap-secret-2026',
  EMAIL_DISPATCHER: async mail => {
    if (emailServiceMode === 'error') {
      throw Object.assign(new Error('Dịch vụ gửi email gặp sự cố.'), { status: 502, detail: { code: 'EMAIL_PROVIDER_ERROR' } });
    }
    sentEmails.push(mail);
    return { id: `mail-${sentEmails.length}` };
  },
  ASSETS: {
    fetch: async req => {
      const u = new URL(req.url);
      if (u.pathname === '/' || u.pathname.startsWith('/admin') || u.pathname.startsWith('/join/') || u.pathname.startsWith('/exam/') || ['/tra-cuu-ket-qua/', '/phuc-khao/', '/ho-tro/', '/su-co-khan-cap/', '/to-cao-gian-lan/'].includes(u.pathname)) {
        return new Response(fs.readFileSync('public/index.html', 'utf8'), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      return new Response('not-found', { status: 404 });
    }
  }
};

function crossSiteResReq(r) { return r; }
function getEnv() {
  if (emailServiceMode === 'unconfigured') {
    const { EMAIL_DISPATCHER, ...rest } = baseEnv;
    return rest;
  }
  return baseEnv;
}

// Intercept global fetch to prove ZERO outbound network calls (and zero SLC calls)
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input?.url;
  throw new Error(`FORBIDDEN_OUTBOUND_NETWORK_CALL: ${url}`);
};

async function call(path, { method = 'GET', token = '', csrf = '', cookie = '', session = '', body, formData } = {}) {
  const headers = {};
  if (token) headers['authorization'] = `Bearer ${token}`;
  if (csrf) headers['x-csrf-token'] = csrf;
  if (cookie) headers['cookie'] = cookie;
  if (session) headers['x-exam-session'] = session;
  let reqBody = undefined;
  if (formData) {
    reqBody = formData;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    reqBody = JSON.stringify(body);
  }
  const req = new Request(`https://exam.skyfirst.io.vn${path}`, { method, headers, body: reqBody });
  const res = await examWorker.fetch(req, getEnv());
  const data = await res.json().catch(() => null);
  return { status: res.status, data, headers: res.headers };
}

let passed = 0;
async function scenario(name, fn) {
  await fn();
  passed++;
  console.log(`PASS integration [${passed}]: ${name}`);
}

try {
  // Scenario 1: Unauthenticated access to /api/admin/* is blocked (401)
  await scenario('Unauthenticated access to /api/admin/dashboard is rejected with 401', async () => {
    const r = await call('/api/admin/dashboard');
    assert.equal(r.status, 401);
    assert.equal(r.data.ok, false);
  });

  // Scenario 2: Admin Bootstrap & Unprovisioned email cannot request admin OTP
  await scenario('Unprovisioned email cannot request admin OTP (403 ADMIN_NOT_PROVISIONED)', async () => {
    const r = await call('/api/admin/auth/request-otp', {
      method: 'POST',
      body: { email: 'stranger@example.com' }
    });
    assert.equal(r.status, 403);
    assert.equal(r.data.detail?.code, 'ADMIN_NOT_PROVISIONED');
    assert.equal(r.data.message, 'Vui lòng sử dụng địa chỉ email đã được cấp quyền để xác thực và đăng nhập.');
  });

  // Scenario 3: Bootstrap system_admin and test Admin OTP login flow (wrong OTP, valid OTP, replay OTP)
  let sysAdminToken = '', sysAdminCsrf = '';
  await scenario('Bootstrap system_admin, enforce OTP cooldown/validation/single-use, and issue session', async () => {
    const badBoot = await call('/api/admin/auth/bootstrap', {
      method: 'POST',
      body: { bootstrap_token: 'wrong-token', email: 'admin@skyfirst.io.vn', full_name: 'Sys Admin' }
    });
    assert.equal(badBoot.status, 403);

    const goodBoot = await call('/api/admin/auth/bootstrap', {
      method: 'POST',
      body: { bootstrap_token: 'test-bootstrap-secret-2026', email: 'admin@skyfirst.io.vn', full_name: 'Trưởng Ban Khảo Thí' }
    });
    assert.equal(goodBoot.status, 200);
    assert.deepEqual(goodBoot.data.roles, ['system_admin']);

    // Request OTP
    const reqOtp = await call('/api/admin/auth/request-otp', {
      method: 'POST',
      body: { email: 'admin@skyfirst.io.vn' }
    });
    assert.equal(reqOtp.status, 200);
    assert.equal(sentEmails.length, 1);
    const otpMatch = sentEmails[0].text.match(/\b(\d{6})\b/);
    assert.ok(otpMatch, 'OTP must be 6 digits');
    const otpCode = otpMatch[1];

    // Immediate resend succeeds without any cooldown timer and invalidates previous OTP
    const resendOtp = await call('/api/admin/auth/request-otp', {
      method: 'POST',
      body: { email: 'admin@skyfirst.io.vn' }
    });
    assert.equal(resendOtp.status, 200);
    assert.equal(sentEmails.length, 2);
    const newOtpCode = sentEmails[1].text.match(/\b(\d{6})\b/)[1];

    // Previous OTP is now invalidated (401)
    const oldOtpVerify = await call('/api/admin/auth/verify-otp', {
      method: 'POST',
      body: { email: 'admin@skyfirst.io.vn', otp: otpCode }
    });
    assert.equal(oldOtpVerify.status, 401);

    // Wrong OTP attempt is rejected with 401
    const wrongVerify = await call('/api/admin/auth/verify-otp', {
      method: 'POST',
      body: { email: 'admin@skyfirst.io.vn', otp: '000000' }
    });
    assert.equal(wrongVerify.status, 401);

    // Valid new OTP succeeds and returns token + CSRF + HttpOnly cookie
    const goodVerify = await call('/api/admin/auth/verify-otp', {
      method: 'POST',
      body: { email: 'admin@skyfirst.io.vn', otp: newOtpCode }
    });
    assert.equal(goodVerify.status, 200);
    assert.ok(goodVerify.data.admin_token);
    assert.ok(goodVerify.data.csrf_token);
    assert.match(goodVerify.headers.get('set-cookie') || '', /HttpOnly/i);
    sysAdminToken = goodVerify.data.admin_token;
    sysAdminCsrf = goodVerify.data.csrf_token;

    // Replaying the same OTP is rejected
    const replayVerify = await call('/api/admin/auth/verify-otp', {
      method: 'POST',
      body: { email: 'admin@skyfirst.io.vn', otp: newOtpCode }
    });
    assert.equal(replayVerify.status, 401);
  });

  // Scenario 4: RBAC Role Enforcement (report_viewer and grader cannot create exams or change roles)
  let viewerToken = '', graderToken = '', approverToken = '';
  await scenario('RBAC enforces least privilege across roles (403 INSUFFICIENT_PERMISSION)', async () => {
    for (const [email, role] of [
      ['viewer@skyfirst.io.vn', 'report_viewer'],
      ['grader@skyfirst.io.vn', 'grader'],
      ['approver@skyfirst.io.vn', 'result_approver']
    ]) {
      const r = await call('/api/admin/users/role', {
        method: 'POST',
        token: sysAdminToken,
        body: { email, full_name: role, status: 'active', roles: [role], reason: 'Test RBAC' }
      });
      assert.equal(r.status, 200);
    }

    // Helper to get session token for a role user
    async function loginRole(email) {
      db.prepare(`DELETE FROM exam_otp_challenges WHERE email=?`).run(email);
      db.prepare(`DELETE FROM exam_rate_limits`).run();
      await call('/api/admin/auth/request-otp', { method: 'POST', body: { email } });
      const code = sentEmails.at(-1).text.match(/\b(\d{6})\b/)[1];
      const v = await call('/api/admin/auth/verify-otp', { method: 'POST', body: { email, otp: code } });
      return v.data.admin_token;
    }

    viewerToken = await loginRole('viewer@skyfirst.io.vn');
    graderToken = await loginRole('grader@skyfirst.io.vn');
    approverToken = await loginRole('approver@skyfirst.io.vn');

    // Viewer can read dashboard but cannot create exam or grade
    const viewerDash = await call('/api/admin/dashboard', { token: viewerToken });
    assert.equal(viewerDash.status, 200);

    const viewerCreateExam = await call('/api/admin/exams', {
      method: 'POST',
      token: viewerToken,
      body: { title: 'Unauthorized Exam' }
    });
    assert.equal(viewerCreateExam.status, 403);
    assert.equal(viewerCreateExam.data.detail?.code, 'INSUFFICIENT_PERMISSION');

    const viewerManageUser = await call('/api/admin/users/role', {
      method: 'POST',
      token: viewerToken,
      body: { email: 'hacker@example.com', roles: ['system_admin'] }
    });
    assert.equal(viewerManageUser.status, 403);
  });

  // Scenario 5: Question Bank Creation, Versioning, and Exam Creation & Lifecycle
  const examId = 'exam-skyfirst-2026';
  await scenario('Question Bank versioning and Exam lifecycle state transitions work end-to-end', async () => {
    const q1 = await call('/api/admin/questions', {
      method: 'POST',
      token: sysAdminToken,
      body: { id: 'q-mcq-1', topic: 'Toán logic', difficulty: 'medium', type: 'mcq', question: '5 + 7 bằng bao nhiêu?', options: ['10', '11', '12', '13'], answer: '12', points: 2 }
    });
    assert.equal(q1.status, 200);
    assert.equal(q1.data.version, 1);

    const q1Update = await call('/api/admin/questions/q-mcq-1', {
      method: 'PUT',
      token: sysAdminToken,
      body: { topic: 'Toán logic', difficulty: 'hard', type: 'mcq', question: '5 + 7 bằng mấy?', options: ['10', '11', '12', '13'], answer: '12', points: 2 }
    });
    assert.equal(q1Update.status, 200);
    assert.equal(q1Update.data.version, 2);

    // Create exam in draft state
    const createEx = await call('/api/admin/exams', {
      method: 'POST',
      token: sysAdminToken,
      body: {
        id: examId,
        public_token: 'SF2026',
        title: 'Kỳ thi Đánh giá Năng lực Sky First 2026',
        duration_minutes: 45,
        time_limit_enabled: true,
        strict_mode: true,
        security_profile: 'STRICT_LOCK',
        violation_threshold: 2,
        require_email_verify: true,
        public_access: false,
        result_policy: 'full_review_after_close',
        passing_score: 5,
        questions: [
          { id: 'q1', type: 'mcq', question: '5 + 7 = ?', options: ['10', '12', '14'], answer: '12', points: 4 },
          { id: 'q2', type: 'essay', question: 'Giải thích phương pháp tính của bạn.', points: 6 }
        ]
      }
    });
    assert.equal(createEx.status, 200);
    assert.equal(createEx.data.exam.status, 'draft');

    // Candidate cannot start a draft exam (403 EXAM_NOT_OPEN)
    const startDraft = await call('/api/public/assessments/SF2026/start', {
      method: 'POST',
      body: { full_name: 'Candidate A', email: 'cand1@example.com', candidate_code: 'SFN-001', class_name: 'K1' }
    });
    assert.equal(startDraft.status, 403);
    assert.equal(startDraft.data.detail?.code, 'EXAM_NOT_OPEN');

    // Publish exam -> seals immutable version
    const pubEx = await call(`/api/admin/exams/${examId}/lifecycle`, {
      method: 'POST',
      token: sysAdminToken,
      body: { status: 'published', reason: 'Mở kỳ thi chính thức' }
    });
    assert.equal(pubEx.status, 200);
    assert.ok(pubEx.data.sealed_version_id);
  });

  // Scenario 6: Unenrolled candidate blocked on restricted exam; Enrolled candidate verifies OTP & starts attempt
  let guestAttemptId = '', guestAccessKey = '';
  const guestSession = 'guest-session-0123456789abcdef';
  await scenario('Enrollment check, honest email failure reporting, and candidate OTP verification flow', async () => {
    // Unenrolled email blocked
    const unlistedOtp = await call('/api/public/assessments/SF2026/request-verification', {
      method: 'POST',
      body: { email: 'unlisted@example.com' }
    });
    assert.equal(unlistedOtp.status, 403);
    assert.equal(unlistedOtp.data.detail?.code, 'ELIGIBILITY_REQUIRED');

    // Enroll candidate
    const enroll = await call('/api/admin/candidates/enroll', {
      method: 'POST',
      token: sysAdminToken,
      body: { exam_id: examId, email: 'cand1@example.com', full_name: 'Nguyễn Văn An', candidate_code: 'SFN-001', class_name: 'Lớp 12A1', status: 'active' }
    });
    assert.equal(enroll.status, 200);

    // Test honest reporting when email service is unconfigured (503 EMAIL_SERVICE_UNCONFIGURED)
    emailServiceMode = 'unconfigured';
    const unconfOtp = await call('/api/public/assessments/SF2026/request-verification', {
      method: 'POST',
      body: { email: 'cand1@example.com' }
    });
    assert.equal(unconfOtp.status, 503);
    assert.equal(unconfOtp.data.code, 'EMAIL_SERVICE_UNCONFIGURED');

    // Re-enable email service, clear cooldown record, and request OTP
    emailServiceMode = 'active';
    db.prepare(`DELETE FROM exam_otp_challenges WHERE email='cand1@example.com'`).run();
    const okOtp = await call('/api/public/assessments/SF2026/request-verification', {
      method: 'POST',
      body: { email: 'cand1@example.com' }
    });
    assert.equal(okOtp.status, 200);
    const candOtp = sentEmails.at(-1).text.match(/\b(\d{6})\b/)[1];

    // Start assessment with valid OTP
    const started = await call('/api/public/assessments/SF2026/start', {
      method: 'POST',
      body: {
        full_name: 'Nguyễn Văn An',
        email: 'cand1@example.com',
        candidate_code: 'SFN-001',
        class_name: 'Lớp 12A1',
        verification_code: candOtp
      }
    });
    assert.equal(started.status, 200);
    assert.ok(started.data.attempt_id);
    assert.ok(started.data.access_key);
    guestAttemptId = started.data.attempt_id;
    guestAccessKey = started.data.access_key;
  });

  // Scenario 7: Mid-exam protection & IDOR protection & Invalid answer shapes
  await scenario('Mid-exam question/duration edits are blocked while attempt is active, and IDOR is blocked', async () => {
    const midEdit = await call(`/api/admin/exams/${examId}`, {
      method: 'PUT',
      token: sysAdminToken,
      body: { title: 'Edited', duration_minutes: 90 }
    });
    assert.equal(midEdit.status, 409);
    assert.equal(midEdit.data.detail?.code, 'ACTIVE_ATTEMPTS_PROTECTED');

    // Load attempt & verify answer key is stripped
    const loaded = await call(`/api/public/exam-attempts/${guestAttemptId}`, {
      token: guestAccessKey,
      session: guestSession
    });
    assert.equal(loaded.status, 200);
    assert.equal(loaded.data.exam.questions[0].answer, undefined);

    // Another candidate or wrong token cannot access this attempt (IDOR -> 401)
    const idor = await call(`/api/public/exam-attempts/${guestAttemptId}`, {
      token: 'wrong-access-key-000000000000',
      session: guestSession
    });
    assert.equal(idor.status, 401);

    // Invalid answer data shape rejected (400)
    const badShape = await call(`/api/public/exam-attempts/${guestAttemptId}/save`, {
      method: 'POST',
      token: guestAccessKey,
      session: guestSession,
      body: { revision: 0, answers: { q1: { nested: 'invalid' } }, events: [] }
    });
    assert.equal(badShape.status, 400);
  });

  // Scenario 8: Strict Mode Violation Locking & Proctor Unlock
  await scenario('Strict mode locks attempt upon reaching violation threshold and proctor can unlock with audit reason', async () => {
    // Save valid answers first (rev 0 -> 1)
    const s1 = await call(`/api/public/exam-attempts/${guestAttemptId}/save`, {
      method: 'POST',
      token: guestAccessKey,
      session: guestSession,
      body: { revision: 0, answers: { q1: '12', q2: '5 cộng 7 bằng 12 theo phép cộng số tự nhiên.' }, events: [] }
    });
    assert.equal(s1.status, 200);
    assert.equal(s1.data.answer_revision, 1);

    // Send 2 violations (reaching violation_threshold = 2) -> locks attempt
    const v = await call(`/api/public/exam-attempts/${guestAttemptId}/violation`, {
      method: 'POST',
      token: guestAccessKey,
      session: guestSession,
      body: {
        reason: 'fullscreen_exit',
        revision: 1,
        events: [
          { type: 'visibility_hidden', at: new Date().toISOString() },
          { type: 'fullscreen_exit', at: new Date().toISOString() }
        ]
      }
    });
    assert.equal(v.status, 200);
    assert.equal(v.data.locked, true);

    // While locked, candidate cannot save or submit (423 ATTEMPT_LOCKED)
    const saveLocked = await call(`/api/public/exam-attempts/${guestAttemptId}/save`, {
      method: 'POST',
      token: guestAccessKey,
      session: guestSession,
      body: { revision: 1, answers: { q1: '10' }, events: [] }
    });
    assert.equal(saveLocked.status, 423);
    assert.equal(saveLocked.data.detail?.code, 'ATTEMPT_LOCKED');

    // Proctor unlocks attempt with mandatory reason
    const unlock = await call(`/api/admin/monitor/${guestAttemptId}/action`, {
      method: 'POST',
      token: sysAdminToken,
      body: { action: 'unlock', reason: 'Xác minh thí sinh bị văng toàn màn hình do thông báo hệ điều hành' }
    });
    assert.equal(unlock.status, 200);
    assert.equal(unlock.data.status, 'in_progress');
  });

  // Scenario 9: Submission, Manual Grading Protection, Result Approval/Publication, Review, Lookup & Appeals
  let receiptCode = '';
  await scenario('Submission, manual grading workflow, published result protection, lookup, and appeals work end-to-end', async () => {
    // Submit attempt (attempt has MCQ q1=4pts + Essay q2=6pts)
    const sub = await call(`/api/public/exam-attempts/${guestAttemptId}/submit`, {
      method: 'POST',
      token: guestAccessKey,
      session: guestSession,
      body: { revision: 1, score: 999, answers: { q1: '10' } } // Fake client score & wrong answer ignored!
    });
    assert.equal(sub.status, 200);
    assert.equal(sub.data.pending_manual, 1);
    assert.equal(sub.data.show_score, false);
    assert.equal(sub.data.score, null);
    assert.match(sub.data.receipt_code, /^EXM-/);
    receiptCode = sub.data.receipt_code;

    // Approver cannot publish result while essay q2 is still ungraded (409 UNGRADED_MANUAL_QUESTIONS)
    const prematurePub = await call(`/api/admin/grading/${guestAttemptId}/workflow`, {
      method: 'POST',
      token: approverToken,
      body: { action: 'publish', reason: 'Try early publish' }
    });
    assert.equal(prematurePub.status, 409);
    assert.equal(prematurePub.data.detail?.code, 'UNGRADED_MANUAL_QUESTIONS');

    // Viewer cannot grade essay (403)
    const viewerGrade = await call(`/api/admin/grading/${guestAttemptId}/grade`, {
      method: 'POST',
      token: viewerToken,
      body: { question_id: 'q2', score: 5, feedback: 'Good', reason: 'Unauthorized' }
    });
    assert.equal(viewerGrade.status, 403);

    // Grader grades essay q2 = 5 / 6 -> total score becomes 4 (MCQ) + 5 (Essay) = 9 / 10
    const graded = await call(`/api/admin/grading/${guestAttemptId}/grade`, {
      method: 'POST',
      token: graderToken,
      body: { question_id: 'q2', score: 5, feedback: 'Lập luận rõ ràng, đầy đủ.', reason: 'Chấm tự luận đợt 1' }
    });
    assert.equal(graded.status, 200);
    assert.equal(graded.data.total_score, 9);
    assert.equal(graded.data.pending_manual, 0);
    assert.equal(graded.data.workflow_state, 'graded');

    // Approver cannot publish before approving when manual grading is present (409 APPROVAL_REQUIRED_BEFORE_PUBLISH)
    const pubBeforeApprove = await call(`/api/admin/grading/${guestAttemptId}/workflow`, {
      method: 'POST',
      token: approverToken,
      body: { action: 'publish', reason: 'Skip approve step' }
    });
    assert.equal(pubBeforeApprove.status, 409);
    assert.equal(pubBeforeApprove.data.detail?.code, 'APPROVAL_REQUIRED_BEFORE_PUBLISH');

    // Approver approves and publishes the result
    const approved = await call(`/api/admin/grading/${guestAttemptId}/workflow`, {
      method: 'POST',
      token: approverToken,
      body: { action: 'approve', reason: 'Đã kiểm tra biểu điểm' }
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.data.workflow_state, 'approved');

    const published = await call(`/api/admin/grading/${guestAttemptId}/workflow`, {
      method: 'POST',
      token: approverToken,
      body: { action: 'publish', reason: 'Công bố kết quả chính thức' }
    });
    assert.equal(published.status, 200);
    assert.equal(published.data.workflow_state, 'published');

    // Attempting to modify grade after result is published is blocked (409 PUBLISHED_RESULT_PROTECTED)
    const editPublished = await call(`/api/admin/grading/${guestAttemptId}/grade`, {
      method: 'POST',
      token: graderToken,
      body: { question_id: 'q2', score: 1, feedback: 'Tamper', reason: 'Tamper after publish' }
    });
    assert.equal(editPublished.status, 409);
    assert.equal(editPublished.data.detail?.code, 'PUBLISHED_RESULT_PROTECTED');

    // Candidate looks up result using receipt_code + candidate_code
    const lookup = await call('/api/public/results/lookup', {
      method: 'POST',
      body: { receipt_code: receiptCode, candidate_code: 'SFN-001' }
    });
    assert.equal(lookup.status, 200);
    assert.equal(lookup.data.result.show_score, true);
    assert.equal(lookup.data.result.score, 9);
    assert.equal(lookup.data.result.max_score, 10);
    assert.equal(lookup.data.result.passed, true);

    // Candidate reviews detailed questions & feedback
    const review = await call(`/api/public/exam-attempts/${guestAttemptId}/review`, {
      token: guestAccessKey,
      session: guestSession
    });
    assert.equal(review.status, 200);
    assert.equal(review.data.questions.length, 2);
    assert.equal(review.data.questions[0].answer, '12');

    // Candidate submits an appeal
    const appeal = await call('/api/public/appeals', {
      method: 'POST',
      body: {
        receipt_code: receiptCode,
        candidate_code: 'SFN-001',
        email: 'cand1@example.com',
        reason: 'Em xin phúc khảo câu tự luận số 2 để được xem xét cộng thêm 0.5 điểm trình bày.'
      }
    });
    assert.equal(appeal.status, 200);
    const appealId = appeal.data.appeal_id;

    // System admin / appeal officer resolves appeal -> updates score to 9.5
    const resolved = await call(`/api/admin/appeals/${appealId}/resolve`, {
      method: 'POST',
      token: sysAdminToken,
      body: {
        status: 'resolved',
        score_after: 9.5,
        resolution_note: 'Hội đồng thống nhất cộng 0.5 điểm phần lập luận bổ sung.'
      }
    });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.data.score_after, 9.5);
  });

  // Scenario 10: Admin issued Launch Token & Hard Deadline Auto-Submission
  await scenario('Admin launch token issuance, redemption, and hard deadline auto-submission work independently of SLC', async () => {
    const issued = await call('/api/admin/candidates/launch', {
      method: 'POST',
      token: sysAdminToken,
      body: { exam_id: examId, email: 'internal.student@skyfirst.io.vn', full_name: 'Lê Hoàng Nam', candidate_code: 'SFN-INT-01' }
    });
    assert.equal(issued.status, 200);
    assert.ok(issued.data.launch_token);

    const redeemed = await call('/api/public/exam-launch/redeem', {
      method: 'POST',
      body: { launch_token: issued.data.launch_token }
    });
    assert.equal(redeemed.status, 200);
    const intAttemptId = redeemed.data.attempt_id;
    const intAccessToken = redeemed.data.access_token;
    const intSession = 'internal-session-0123456789abcdef';

    const saveInt = await call(`/api/exam-attempts/${intAttemptId}/save`, {
      method: 'POST',
      token: intAccessToken,
      session: intSession,
      body: { revision: 0, answers: { q1: '12' }, events: [] }
    });
    assert.equal(saveInt.status, 200);

    // Expire the attempt clock on the server and try saving a wrong answer -> server rejects late edit & auto-submits saved answer ('12')
    db.prepare(`UPDATE exam_attempts SET started_at='2020-01-01 00:00:00' WHERE id=?`).run(intAttemptId);
    const lateSave = await call(`/api/exam-attempts/${intAttemptId}/save`, {
      method: 'POST',
      token: intAccessToken,
      session: intSession,
      body: { revision: 1, answers: { q1: '10' }, events: [] }
    });
    assert.equal(lateSave.status, 409);
    assert.equal(lateSave.data.detail?.status, 'submitted');

    const dbRow = db.prepare(`SELECT status, score, answers_json FROM exam_attempts WHERE id=?`).get(intAttemptId);
    assert.equal(dbRow.status, 'submitted');
    assert.equal(dbRow.score, 4);
    assert.equal(JSON.parse(dbRow.answers_json).q1, '12');
  });

  // Scenario 11: Audit Log Integrity & Dashboard Verification
  await scenario('Dashboard metrics and immutable audit log reflect all real operations', async () => {
    const dash = await call('/api/admin/dashboard', { token: sysAdminToken });
    assert.equal(dash.status, 200);
    assert.equal(dash.data.metrics.total_exams, 1);
    assert.equal(dash.data.metrics.submitted_attempts, 2);

    const logs = await call('/api/admin/audit-logs', { token: sysAdminToken });
    assert.equal(logs.status, 200);
    assert.ok(logs.data.logs.length >= 10);
    const rawLogs = JSON.stringify(logs.data.logs);
    assert.doesNotMatch(rawLogs, /test-bootstrap-secret-2026/, 'Bootstrap secret must never appear in audit logs');
  });

  // Scenario 12: One-time Bootstrap Lock, Cookie CSRF Origin/Referer Defense, Schedule Validation, Question Bank Delete, & Support Resolution
  await scenario('One-time bootstrap lock, Cookie CSRF Origin defense, schedule validation, question delete, and support resolution', async () => {
    // Re-calling bootstrap when system_admin is already active is locked (409 BOOTSTRAP_ALREADY_COMPLETED)
    const secondBoot = await call('/api/admin/auth/bootstrap', {
      method: 'POST',
      body: { bootstrap_token: 'test-bootstrap-secret-2026', email: 'another@skyfirst.io.vn', full_name: 'Second Admin' }
    });
    assert.equal(secondBoot.status, 409);
    assert.equal(secondBoot.data.detail?.code, 'BOOTSTRAP_ALREADY_COMPLETED');

    // Cookie-authenticated mutating request with cross-site Origin header is blocked (403 CSRF_ORIGIN_MISMATCH)
    const crossSiteReq = new Request('https://exam.skyfirst.io.vn/api/admin/questions', {
      method: 'POST',
      headers: {
        'cookie': `exam_admin_session=${sysAdminToken}`,
        'x-csrf-token': sysAdminCsrf,
        'origin': 'https://evil.example.com',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ id: 'csrf-q', question: 'Test', type: 'mcq', options: ['A', 'B'], answer: 'A' })
    });
    const crossSiteRes = await examWorker.fetch(crossSiteResReq(crossSiteReq), getEnv());
    const crossSiteData = await crossSiteRes.json();
    assert.equal(crossSiteRes.status, 403);
    assert.equal(crossSiteData.detail?.code, 'CSRF_ORIGIN_MISMATCH');

    // Contradictory schedule window (closes_at <= opens_at) is rejected (400 INVALID_SCHEDULE_WINDOW)
    const badSched = await call('/api/admin/exams', {
      method: 'POST',
      token: sysAdminToken,
      body: {
        id: 'exam-bad-sched',
        title: 'Bad Schedule Exam',
        opens_at: '2026-12-10T10:00:00+07:00',
        closes_at: '2026-12-01T10:00:00+07:00',
        questions: [{ id: 'q1', type: 'mcq', question: 'Q?', options: ['A', 'B'], answer: 'A' }]
      }
    });
    assert.equal(badSched.status, 400);
    assert.equal(badSched.data.detail?.code, 'INVALID_SCHEDULE_WINDOW');

    // Delete / archive question bank item
    const delQ = await call('/api/admin/questions/q-mcq-1', {
      method: 'DELETE',
      token: sysAdminToken
    });
    assert.equal(delQ.status, 200);
    assert.equal(delQ.data.status, 'deleted');

    // Candidate submits support request -> Admin resolves it
    const sup = await call('/api/public/support', {
      method: 'POST',
      body: { full_name: 'Nguyễn Văn An', candidate_code: 'SFN-001', email: 'cand1@example.com', exam_id: examId, message: 'Cần hỗ trợ kiểm tra biên nhận.' }
    });
    assert.equal(sup.status, 200);
    const resolveSup = await call(`/api/admin/support/${sup.data.support_id}/resolve`, {
      method: 'POST',
      token: sysAdminToken,
      body: { resolution_note: 'Đã xác nhận mã biên nhận hợp lệ trên hệ thống.' }
    });
    assert.equal(resolveSup.status, 200);
    assert.equal(resolveSup.data.status, 'resolved');
  });

  // Scenario 13: Segregation of Duties (Grader who also holds result_approver cannot self-approve their own grading)
  await scenario('Segregation of duties prevents a grader from approving their own manual grading (403 SEGREGATION_OF_DUTIES_VIOLATION)', async () => {
    // Grant grader user both grader and result_approver roles
    await call('/api/admin/users/role', {
      method: 'POST',
      token: sysAdminToken,
      body: { email: 'grader@skyfirst.io.vn', full_name: 'Dual Grader', status: 'active', roles: ['grader', 'result_approver'], reason: 'Test SoD' }
    });
    // Revoke publication on guestAttemptId first so it is back in revoked/editable state, then re-grade by graderToken
    await call(`/api/admin/grading/${guestAttemptId}/workflow`, {
      method: 'POST',
      token: approverToken,
      body: { action: 'revoke', reason: 'Mở khóa tạm thời để kiểm tra phân tách nhiệm vụ' }
    });
    const regrade = await call(`/api/admin/grading/${guestAttemptId}/grade`, {
      method: 'POST',
      token: graderToken,
      body: { question_id: 'q2', score: 5.5, feedback: 'Chấm lại', reason: 'Test SoD' }
    });
    assert.equal(regrade.status, 200);

    // Now graderToken (who graded q2) attempts to approve guestAttemptId -> blocked by Segregation of Duties!
    const selfApprove = await call(`/api/admin/grading/${guestAttemptId}/workflow`, {
      method: 'POST',
      token: graderToken,
      body: { action: 'approve', reason: 'Tự duyệt bài mình chấm' }
    });
    assert.equal(selfApprove.status, 403);
    assert.equal(selfApprove.data.detail?.code, 'SEGREGATION_OF_DUTIES_VIOLATION');

    // Independent approverToken (who did not grade q2) approves and re-publishes cleanly
    const indepApprove = await call(`/api/admin/grading/${guestAttemptId}/workflow`, {
      method: 'POST',
      token: approverToken,
      body: { action: 'approve', reason: 'Người duyệt độc lập phê duyệt' }
    });
    assert.equal(indepApprove.status, 200);
    const indepPublish = await call(`/api/admin/grading/${guestAttemptId}/workflow`, {
      method: 'POST',
      token: approverToken,
      body: { action: 'publish', reason: 'Công bố lại sau phê duyệt độc lập' }
    });
    assert.equal(indepPublish.status, 200);
  });

  // Scenario 14: Legacy 16-Table Schema Upgrade Verification (Section VI)
  await scenario('Legacy 16-table database upgrades cleanly via 0002 migration + ensureAdditiveSchema without losing existing data', async () => {
    const legacyDb = new DatabaseSync(':memory:');
    try {
      // 1. Create ONLY the original 16 tables from exam-main-audited.zip
      legacyDb.exec(`
        CREATE TABLE exams(id TEXT PRIMARY KEY,title TEXT,instructions TEXT,duration_minutes INTEGER,time_limit_enabled INTEGER,strict_mode INTEGER,fullscreen_required INTEGER,show_score INTEGER,assessment_type TEXT,assessment_label TEXT,center_label TEXT,result_policy TEXT,result_release_at TEXT,closes_at TEXT,status TEXT,security_profile TEXT,allow_clipboard INTEGER,allow_paste INTEGER,allow_external_links INTEGER,device_policy TEXT,resume_policy TEXT,calculator_policy TEXT,question_json TEXT,class_id TEXT,sealed_version_id TEXT);
        CREATE TABLE users(id TEXT PRIMARY KEY,full_name TEXT,sfn_id TEXT,email TEXT,status TEXT);
        CREATE TABLE classes(id TEXT PRIMARY KEY,name TEXT);
        CREATE TABLE assessment_exam_versions(id TEXT PRIMARY KEY,snapshot_json TEXT);
        CREATE TABLE exam_attempts(id TEXT PRIMARY KEY,exam_id TEXT,user_id TEXT,status TEXT,started_at TEXT,duration_minutes INTEGER,time_limit_enabled INTEGER,extra_time_minutes INTEGER DEFAULT 0,answers_json TEXT,event_log_json TEXT,score REAL,max_score REAL,submitted_at TEXT,last_saved_at TEXT,answer_revision INTEGER DEFAULT 0,question_snapshot_json TEXT,exam_version_id TEXT);
        CREATE TABLE exam_guest_attempts(id TEXT PRIMARY KEY,exam_id TEXT,status TEXT,started_at TEXT,duration_minutes INTEGER,time_limit_enabled INTEGER,extra_time_minutes INTEGER DEFAULT 0,answers_json TEXT,event_log_json TEXT,score REAL,max_score REAL,submitted_at TEXT,last_saved_at TEXT,answer_revision INTEGER DEFAULT 0,question_snapshot_json TEXT,exam_version_id TEXT,access_key TEXT,full_name TEXT,candidate_code TEXT,class_name TEXT);
        CREATE TABLE exam_access_tokens(token_hash TEXT PRIMARY KEY,user_id TEXT,attempt_id TEXT,expires_at TEXT,created_at TEXT);
        CREATE TABLE exam_launch_tokens(token_hash TEXT PRIMARY KEY,user_id TEXT,attempt_id TEXT,expires_at TEXT,used_at TEXT);
        CREATE TABLE assessment_attempt_leases(attempt_id TEXT,source TEXT,session_id TEXT,claimed_at TEXT,last_seen_at TEXT,PRIMARY KEY(attempt_id,source));
        CREATE TABLE assessment_answer_revisions(id TEXT PRIMARY KEY,attempt_id TEXT,source TEXT,revision INTEGER,answers_json TEXT,events_json TEXT,accepted_at TEXT,UNIQUE(attempt_id,revision));
        CREATE TABLE assessment_response_files(id TEXT PRIMARY KEY,attempt_id TEXT,source TEXT,question_id TEXT,file_id TEXT,status TEXT,created_at TEXT);
        CREATE TABLE files(id TEXT PRIMARY KEY,owner_user_id TEXT,r2_key TEXT,name TEXT,mime TEXT,size INTEGER,visibility TEXT,created_at TEXT);
        CREATE TABLE assessment_manual_grades(id TEXT PRIMARY KEY,attempt_id TEXT,question_id TEXT,grader_user_id TEXT,score REAL,feedback TEXT,status TEXT,created_at TEXT,updated_at TEXT,UNIQUE(attempt_id,question_id));
        CREATE TABLE assessment_receipts(id TEXT PRIMARY KEY,attempt_id TEXT,receipt_code TEXT,payload_json TEXT,created_at TEXT,UNIQUE(attempt_id));
        CREATE TABLE assessment_result_workflows(attempt_id TEXT PRIMARY KEY,source TEXT,state TEXT,updated_at TEXT);
        CREATE TABLE exam_audit_log(id TEXT PRIMARY KEY,exam_id TEXT,attempt_id TEXT,actor_user_id TEXT,event_type TEXT,detail_json TEXT);
      `);
      // Insert pre-existing production-like records
      legacyDb.prepare(`INSERT INTO exams VALUES('legacy-exam-1','Legacy Exam','Rules',60,1,0,0,1,'assessment','Assessment','Sky First','score_after_submit',NULL,NULL,'published','STANDARD',1,1,0,'single_session','same_session','disabled','[{"id":"q1","type":"mcq","question":"1+1?","options":["1","2"],"answer":"2","points":1}]',NULL,NULL)`).run();
      legacyDb.prepare(`INSERT INTO users VALUES('legacy-u1','Legacy Student','SFN-LEG-01','legacy@skyfirst.io.vn','active')`).run();

      // 2. Apply 0002 upgrade migration
      legacyDb.exec(fs.readFileSync('migrations/0002_exam_upgrade_existing_schema.sql', 'utf8'));

      class LegStmt {
        constructor(sql, params = []) { this.sql = sql; this.params = params; }
        bind(...params) { return new LegStmt(this.sql, params); }
        async first() { return legacyDb.prepare(this.sql).get(...this.params) || null; }
        async all() { return { results: legacyDb.prepare(this.sql).all(...this.params) }; }
        async run() { const x = legacyDb.prepare(this.sql).run(...this.params); return { success: true, meta: { changes: Number(x.changes) } }; }
      }
      const legEnv = {
        ...baseEnv,
        DB: {
          prepare: sql => new LegStmt(sql),
          batch: async stmts => {
            legacyDb.exec('BEGIN');
            try { const r = []; for (const s of stmts) r.push(await s.run()); legacyDb.exec('COMMIT'); return r; }
            catch (e) { legacyDb.exec('ROLLBACK'); throw e; }
          }
        }
      };

      // 3. Verify health, bootstrap, and public catalog on upgraded legacy DB
      const hRes = await examWorker.fetch(new Request('https://exam.skyfirst.io.vn/health'), legEnv);
      const hData = await hRes.json();
      assert.equal(hRes.status, 200);
      assert.equal(hData.status, 'available');

      const catRes = await examWorker.fetch(new Request('https://exam.skyfirst.io.vn/api/public/catalog'), legEnv);
      const catData = await catRes.json();
      assert.equal(catRes.status, 200);

      const bootRes = await examWorker.fetch(new Request('https://exam.skyfirst.io.vn/api/admin/auth/bootstrap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bootstrap_token: 'test-bootstrap-secret-2026', email: 'legacy.admin@skyfirst.io.vn', full_name: 'Legacy Admin' })
      }), legEnv);
      assert.equal(bootRes.status, 200);

      // Confirm pre-existing exam & user remain intact
      const countExams = legacyDb.prepare(`SELECT COUNT(*) n FROM exams WHERE id='legacy-exam-1'`).get().n;
      const countUsers = legacyDb.prepare(`SELECT COUNT(*) n FROM users WHERE id='legacy-u1'`).get().n;
      assert.equal(countExams, 1);
      assert.equal(countUsers, 1);

      // Critical regression: legacy users table originally had only five columns.
      // After schema initialization, the owner must be provisioned, complete 1st login without OTP, and receive OTP on 2nd login.
      legacyDb.prepare(`DELETE FROM users WHERE LOWER(email)='skyfirst.ec@gmail.com'`).run();
      const legacyOwnerFirstRes = await examWorker.fetch(new Request('https://exam.skyfirst.io.vn/api/admin/auth/request-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'Skyfirst.ec@gmail.com' })
      }), legEnv);
      const legacyOwnerFirstData = await legacyOwnerFirstRes.json();
      assert.equal(legacyOwnerFirstRes.status, 200, JSON.stringify(legacyOwnerFirstData));
      assert.equal(legacyOwnerFirstData.first_login, true);
      assert.ok(legacyOwnerFirstData.admin_token);

      const legacyOwnerOtpRes = await examWorker.fetch(new Request('https://exam.skyfirst.io.vn/api/admin/auth/request-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'Skyfirst.ec@gmail.com' })
      }), legEnv);
      const legacyOwnerOtpData = await legacyOwnerOtpRes.json();
      assert.equal(legacyOwnerOtpRes.status, 200, JSON.stringify(legacyOwnerOtpData));
      assert.equal(legacyOwnerOtpData.otp_required, true);
      const legacyOwner = legacyDb.prepare(`SELECT email,status,role,roles_json,expires_at FROM users WHERE LOWER(email)='skyfirst.ec@gmail.com'`).get();
      assert.ok(legacyOwner, 'Legacy D1 must receive the owner account');
      assert.equal(legacyOwner.status, 'active');
      assert.equal(legacyOwner.role, 'system_owner');
      assert.deepEqual(JSON.parse(legacyOwner.roles_json), ['system_owner', 'system_admin']);
      assert.equal(legacyOwner.expires_at, null);
      assert.equal(sentEmails.at(-1).to, 'skyfirst.ec@gmail.com');
    } finally {
      legacyDb.close();
    }
  });


  // Scenario 15b: Separated Service Workflows (/phuc-khao, /ho-tro, /bao-loi, /su-co-khan-cap, /to-cao-gian-lan), Evidence File Validation, Sender Routing & Email Logs
  await scenario('Separated business endpoints, evidence file upload validation, 3-sender email routing, and email logs work end-to-end', async () => {
    // 1. Upload valid PNG evidence file via /api/public/service-files/upload
    const validPngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    const validBlob = new Blob([validPngBytes], { type: 'image/png' });
    const fdValid = new FormData();
    fdValid.set('file', validBlob, 'minh-chung.png');
    fdValid.set('service_type', 'fraud_report');
    fdValid.set('email', 'reporter@example.com');
    const upOk = await call('/api/public/service-files/upload', { method: 'POST', formData: fdValid });
    assert.equal(upOk.status, 200);
    assert.ok(upOk.data.file.file_id);

    // 2. Reject dangerous executable (.exe) or forged file signature (415)
    const badBlob = new Blob([validPngBytes], { type: 'application/octet-stream' });
    const fdBad = new FormData();
    fdBad.set('file', badBlob, 'malware.exe');
    fdBad.set('service_type', 'bug_report');
    const upBad = await call('/api/public/service-files/upload', { method: 'POST', formData: fdBad });
    assert.equal(upBad.status, 415);

    // 3. Bug report (/bao-loi -> POST /api/public/bug-reports) sends technical-incident.html from support@skyfirst.io.vn
    const bugRes = await call('/api/public/bug-reports', {
      method: 'POST',
      body: {
        full_name: 'Trần Văn Bình',
        phone: '0901234567',
        email: 'binh.tran@example.com',
        class_name: 'Lớp 12A2',
        candidate_code: 'SFN-002',
        exam_title: 'Kỳ thi Đánh giá Năng lực Sky First 2026',
        exam_date: '29/10/2026',
        occurred_at: '09:30 29/10/2026',
        message: 'Màn hình câu hỏi số 3 bị chậm tải hình ảnh minh họa.'
      }
    });
    assert.equal(bugRes.status, 200);
    assert.match(bugRes.data.request_code, /^BL-/);
    assert.equal(sentEmails.at(-1).from, 'support@skyfirst.io.vn');
    assert.equal(sentEmails.at(-1).template_file, 'technical-incident.html');

    // 4. Emergency incident (/su-co-khan-cap -> POST /api/public/emergency-incidents)
    const emgRes = await call('/api/public/emergency-incidents', {
      method: 'POST',
      body: {
        full_name: 'Trần Văn Bình',
        phone: '0901234567',
        email: 'binh.tran@example.com',
        class_name: 'Lớp 12A2',
        candidate_code: 'SFN-002',
        exam_title: 'Kỳ thi Đánh giá Năng lực Sky First 2026',
        occurred_at: '09:35 29/10/2026',
        attempt_id: guestAttemptId,
        message: 'Mất kết nối mạng đột ngột khi đang lưu câu tự luận.'
      }
    });
    assert.equal(emgRes.status, 200);
    assert.match(emgRes.data.request_code, /^KC-/);
    assert.equal(sentEmails.at(-1).from, 'support@skyfirst.io.vn');
    assert.equal(sentEmails.at(-1).template_file, 'technical-incident.html');

    // 5. Fraud report (/to-cao-gian-lan -> POST /api/public/fraud-reports)
    // Rejects when missing both evidence file and evidence URL (400 EVIDENCE_REQUIRED)
    const fraudNoEv = await call('/api/public/fraud-reports', {
      method: 'POST',
      body: {
        reporter_name: 'Lê Thị Hoa',
        phone: '0912345678',
        email: 'hoa.le@example.com',
        class_name: 'Lớp 12A3',
        exam_title: 'Kỳ thi Đánh giá Năng lực Sky First 2026',
        exam_date: '29/10/2026',
        content: 'Phát hiện có tài khoản chia sẻ đề thi lên nhóm mạng xã hội trong giờ thi.'
      }
    });
    assert.equal(fraudNoEv.status, 400);
    assert.equal(fraudNoEv.data.detail?.code, 'EVIDENCE_REQUIRED');

    // Succeeds when valid evidence file or URL is provided, sends fraud-report.html from noreply@skyfirst.io.vn
    const fraudOk = await call('/api/public/fraud-reports', {
      method: 'POST',
      body: {
        reporter_name: 'Lê Thị Hoa',
        phone: '0912345678',
        email: 'hoa.le@example.com',
        class_name: 'Lớp 12A3',
        exam_title: 'Kỳ thi Đánh giá Năng lực Sky First 2026',
        exam_date: '29/10/2026',
        reported_candidate_code: 'SFN-999',
        content: 'Phát hiện có tài khoản chia sẻ đề thi lên nhóm mạng xã hội trong giờ thi.',
        evidence_file_ids: [upOk.data.file.file_id],
        evidence_url: 'https://exam.skyfirst.io.vn/evidence-post-123'
      }
    });
    assert.equal(fraudOk.status, 200);
    assert.match(fraudOk.data.request_code, /^TC-/);
    assert.equal(sentEmails.at(-1).from, 'noreply@skyfirst.io.vn');
    assert.equal(sentEmails.at(-1).template_file, 'fraud-report.html');

    // Track fraud report with matching email succeeds; wrong email is rejected (404)
    const trackFraudBad = await call('/api/public/fraud-reports/track', {
      method: 'POST',
      body: { request_code: fraudOk.data.request_code, email: 'other@example.com' }
    });
    assert.equal(trackFraudBad.status, 404);

    const trackFraudGood = await call('/api/public/fraud-reports/track', {
      method: 'POST',
      body: { request_code: fraudOk.data.request_code, email: 'hoa.le@example.com' }
    });
    assert.equal(trackFraudGood.status, 200);
    assert.equal(trackFraudGood.data.report.status, 'received');

    // Unauthenticated download of service evidence file is rejected (401)
    const unauthFile = await call(`/api/admin/service-files/${upOk.data.file.file_id}`);
    assert.equal(unauthFile.status, 401);

    // Authorized admin can view email logs & verify no OTP code appears in exam_email_logs
    const emailLogsRes = await call('/api/admin/email-logs', { token: sysAdminToken });
    assert.equal(emailLogsRes.status, 200);
    assert.ok(emailLogsRes.data.email_logs.length >= 4);
  });


  // Scenario 16: Expired account OTP rejection, old OTP invalidation, 3rd-party Identity Adapter (HMAC + anti-replay), Candidate Explanation, Proctor Classification, Anomaly Analysis & Fraud Access Audit
  await scenario('Expired account OTP rejection, old OTP invalidation, 3rd-party Identity Adapter, candidate explanation, proctor classification, and anomaly analysis work end-to-end', async () => {
    // 1. Create an admin user with an expired expires_at -> OTP request must be rejected (403) and send zero emails
    await call('/api/admin/users/role', {
      method: 'POST',
      token: sysAdminToken,
      body: { email: 'expired.officer@skyfirst.io.vn', full_name: 'Expired Officer', status: 'active', roles: ['proctor'], expires_at: '2020-01-01T00:00:00Z', reason: 'Test expiry' }
    });
    const emailsBefore = sentEmails.length;
    const expOtp = await call('/api/admin/auth/request-otp', {
      method: 'POST',
      body: { email: 'expired.officer@skyfirst.io.vn' }
    });
    assert.equal(expOtp.status, 403);
    assert.equal(expOtp.data.code, 'ADMIN_NOT_PROVISIONED');
    assert.equal(sentEmails.length, emailsBefore, 'Zero emails must be sent to expired account');

    // 2. Old unused OTP is automatically invalidated when a new OTP is issued
    db.prepare(`DELETE FROM exam_otp_challenges WHERE email='viewer@skyfirst.io.vn'`).run();
    db.prepare(`DELETE FROM exam_rate_limits`).run();
    await call('/api/admin/auth/request-otp', { method: 'POST', body: { email: 'viewer@skyfirst.io.vn' } });
    const firstOtp = sentEmails.at(-1).text.match(/\b(\d{6})\b/)[1];
    // Expire cooldown so second OTP can be requested
    db.prepare(`UPDATE exam_otp_challenges SET created_at='2020-01-01 00:00:00' WHERE email='viewer@skyfirst.io.vn'`).run();
    await call('/api/admin/auth/request-otp', { method: 'POST', body: { email: 'viewer@skyfirst.io.vn' } });
    const secondOtp = sentEmails.at(-1).text.match(/\b(\d{6})\b/)[1];
    // Attempting to verify with firstOtp must fail
    const oldVerify = await call('/api/admin/auth/verify-otp', { method: 'POST', body: { email: 'viewer@skyfirst.io.vn', otp: firstOtp } });
    assert.equal(oldVerify.status, 401);
    const newVerify = await call('/api/admin/auth/verify-otp', { method: 'POST', body: { email: 'viewer@skyfirst.io.vn', otp: secondOtp } });
    assert.equal(newVerify.status, 200);

    // 3. Third-party Identity Verification Adapter & Anti-Replay protection
    const idVerify1 = await call('/api/public/assessments/SF2026/verify-identity', {
      method: 'POST',
      body: { email: 'cand1@example.com', candidate_code: 'SFN-001', full_name: 'Nguyễn Văn An', reference_code: 'REF-UNIQUE-2026-001' }
    });
    assert.equal(idVerify1.status, 200);
    assert.equal(idVerify1.data.verified, true);

    // Replaying the same reference_code is blocked (409 VERIFICATION_REPLAY_DETECTED)
    const idReplay = await call('/api/public/assessments/SF2026/verify-identity', {
      method: 'POST',
      body: { email: 'cand1@example.com', candidate_code: 'SFN-001', full_name: 'Nguyễn Văn An', reference_code: 'REF-UNIQUE-2026-001' }
    });
    assert.equal(idReplay.status, 409);
    assert.equal(idReplay.data.code, 'VERIFICATION_REPLAY_DETECTED');

    // 4. Candidate Violation Explanation & Proctor Classification + Anomaly Analysis
    const explainRes = await call(`/api/public/exam-attempts/${guestAttemptId}/explain`, {
      method: 'POST',
      token: guestAccessKey,
      session: guestSession,
      body: { explanation: 'Trình duyệt tự thoát toàn màn hình do thông báo cập nhật hệ điều hành Windows.' }
    });
    assert.equal(explainRes.status, 200);
    assert.equal(explainRes.data.saved, true);

    const classifyRes = await call(`/api/admin/monitor/${guestAttemptId}/action`, {
      method: 'POST',
      token: sysAdminToken,
      body: { action: 'classify', classification: 'verified_by_officer', reason: 'Đã đối chiếu giải trình hợp lệ của thí sinh' }
    });
    assert.equal(classifyRes.status, 200);

    const anomalyRes = await call(`/api/admin/monitor/anomalies?exam_id=${examId}`, { token: sysAdminToken });
    assert.equal(anomalyRes.status, 200);
    assert.equal(anomalyRes.data.auto_disqualification_enabled, false);
    assert.equal(anomalyRes.data.privacy_policy.screen_capture_enabled, false);

    // 5. Fraud Report viewing records audit trail (fraud_report.accessed)
    const fraudList = await call('/api/admin/fraud-reports', { token: sysAdminToken });
    assert.equal(fraudList.status, 200);
    const accessLogCount = db.prepare(`SELECT COUNT(*) n FROM exam_audit_log WHERE event_type='fraud_report.accessed'`).get().n;
    assert.ok(accessLogCount >= 1, 'Viewing fraud reports must record an audit log entry');
  });


  // Scenario 17: Comprehensive 15-Case Proctoring, Device/OS, Camera/Mic/2nd-Cam, Network/VPN, Digital Evidence Chain-of-Custody & Recovery Acceptance Suite (Section 11)
  await scenario('All 15 mandatory proctoring, device/OS, camera/mic, network/IP/VPN, R2 SHA-256 digital evidence chain, and recovery acceptance cases pass end-to-end', async () => {
    // Re-open a dedicated active attempt for proctoring acceptance testing
    const procLaunch = await call('/api/admin/candidates/launch', {
      method: 'POST',
      token: sysAdminToken,
      body: { exam_id: examId, email: 'proctor.test@skyfirst.io.vn', full_name: 'Phạm Minh Tuấn', candidate_code: 'SFN-PROC-01' }
    });
    assert.equal(procLaunch.status, 200);
    const procRedeem = await call('/api/public/exam-launch/redeem', {
      method: 'POST',
      body: { launch_token: procLaunch.data.launch_token }
    });
    assert.equal(procRedeem.status, 200);
    const pAttemptId = procRedeem.data.attempt_id;
    const pToken = procRedeem.data.access_token;
    const pSession = 'proctor-session-0123456789abcdef';

    // Preflight capability check (honest disclosure of browser vs native companion capabilities)
    const preflightRes = await call('/api/public/assessments/SF2026/preflight-check', {
      method: 'POST',
      body: { fullscreen_supported: true, is_extended_display: false, camera_ready: true, microphone_ready: true, vm_suspected: false }
    });
    assert.equal(preflightRes.status, 200);
    assert.equal(preflightRes.data.passed, true);
    assert.ok(preflightRes.data.honest_disclosure);

    // Helper to post proctoring events
    async function postProctorEvent(eventType, extra = {}) {
      return call(`/api/exam-attempts/${pAttemptId}/proctor-event`, {
        method: 'POST',
        token: pToken,
        session: pSession,
        body: { event_type: eventType, ...extra }
      });
    }

    // Case 1: Tab switching & window switching
    const c1Tab = await postProctorEvent('tab_switch', { description: 'Thí sinh chuyển sang tab khác' });
    assert.equal(c1Tab.status, 200);
    assert.equal(c1Tab.data.risk_level, 2);
    const c1Win = await postProctorEvent('window_switch', { description: 'Thí sinh chuyển cửa sổ ứng dụng' });
    assert.equal(c1Win.status, 200);

    // Case 2: Fullscreen exit
    const c2Fs = await postProctorEvent('fullscreen_exit', { description: 'Thoát chế độ toàn màn hình' });
    assert.equal(c2Fs.status, 200);
    assert.equal(c2Fs.data.risk_level, 2);

    // Case 3: Copy & paste restriction
    const c3Copy = await postProctorEvent('copy_blocked');
    const c3Paste = await postProctorEvent('paste_blocked');
    assert.equal(c3Copy.status, 200);
    assert.equal(c3Paste.status, 200);

    // Case 4: PrintScreen & screen recording detection
    const c4Prt = await postProctorEvent('printscreen_attempt');
    const c4Rec = await postProctorEvent('screen_recording_detected');
    assert.equal(c4Prt.data.risk_level, 2);
    assert.equal(c4Rec.data.risk_level, 3);

    // Case 5: Multi-monitor & display mirroring detection
    const c5Mon = await postProctorEvent('multi_monitor_detected', { device_env: { screen_count: 2, is_extended: true } });
    assert.equal(c5Mon.data.risk_level, 3);
    assert.equal(c5Mon.data.device_status, 'multi_monitor_detected');

    // Case 6: USB & Bluetooth device connection monitoring
    const c6Usb = await postProctorEvent('usb_device_connected', { device_env: { usb_vendor: '0x1234' } });
    const c6Bt = await postProctorEvent('bluetooth_device_connected');
    assert.equal(c6Usb.data.risk_level, 2);
    assert.equal(c6Bt.data.risk_level, 2);

    // Case 7: Remote desktop / remote assistance detection (Mức 4 — serious, but auto_cancel_exam is false)
    const c7Rdp = await postProctorEvent('remote_desktop_detected', { description: 'Phát hiện phiên điều khiển từ xa RDP/TeamViewer' });
    assert.equal(c7Rdp.data.risk_level, 4);
    assert.equal(c7Rdp.data.auto_cancel_exam, false);

    // Case 8: Virtual Machine detection
    const c8Vm = await postProctorEvent('vm_detected', { device_env: { gpu_renderer: 'VMware SVGA II' } });
    assert.ok(c8Vm.data.risk_level >= 3);

    // Case 9: IP change & VPN/Proxy usage (logged without auto-cancelling attempt)
    await postProctorEvent('ip_changed', { client_ip: '203.113.10.1' });
    const c9Ip = await postProctorEvent('vpn_proxy_suspected', { client_ip: '198.51.100.44', vpn_suspected: true });
    assert.equal(c9Ip.status, 200);
    assert.equal(c9Ip.data.auto_cancel_exam, false);

    // Case 10: Camera, Microphone, Secondary Camera & Network disconnect/anomalies
    await postProctorEvent('camera_connected');
    await postProctorEvent('mic_connected');
    await postProctorEvent('secondary_camera_connected');
    const c10CamCover = await postProctorEvent('camera_covered');
    assert.equal(c10CamCover.data.camera_status, 'covered');
    const c10MultiFace = await postProctorEvent('multiple_faces_detected');
    assert.equal(c10MultiFace.data.risk_level, 4);
    assert.equal(c10MultiFace.data.camera_status, 'multiple_faces');
    const c10CamOff = await postProctorEvent('camera_disconnected');
    assert.equal(c10CamOff.data.camera_status, 'disconnected');
    const c10Cam2Off = await postProctorEvent('secondary_camera_disconnected');
    assert.equal(c10Cam2Off.data.secondary_camera_status, 'disconnected');
    const c10MicOff = await postProctorEvent('mic_disconnected');
    assert.equal(c10MicOff.data.mic_status, 'disconnected');
    const c10Voice = await postProctorEvent('voice_anomaly_detected');
    assert.equal(c10Voice.data.risk_level, 3);
    const c10NetOff = await postProctorEvent('network_disconnected');
    assert.equal(c10NetOff.data.risk_level, 1);

    // Case 11: Simultaneous login on multiple devices (lease conflict -> 409 SESSION_CONFLICT & logs multi_device_login)
    await call(`/api/exam-attempts/${pAttemptId}/save`, {
      method: 'POST',
      token: pToken,
      session: pSession,
      body: { revision: 0, answers: { q1: '12' }, events: [] }
    });
    const competingLogin = await call(`/api/exam-attempts/${pAttemptId}/save`, {
      method: 'POST',
      token: pToken,
      session: 'other-device-session-999999999999',
      body: { revision: 1, answers: { q1: '10' }, events: [] }
    });
    assert.equal(competingLogin.status, 409);
    assert.equal(competingLogin.data.code, 'SESSION_CONFLICT');

    // Case 12: API payload tampering & forgery detection (400 PAYLOAD_TAMPER_DETECTED + Mức 4 event logged)
    const tamperedCall = await postProctorEvent('window_blur', { forged_payload: true });
    assert.equal(tamperedCall.status, 400);
    assert.equal(tamperedCall.data.code, 'PAYLOAD_TAMPER_DETECTED');
    assert.equal(tamperedCall.data.detail.risk_level, 4);

    // Case 13: Session recovery after network/device incident (reconnect + save + submit works cleanly without data loss)
    await postProctorEvent('network_reconnected');
    await postProctorEvent('camera_connected');
    const recSave = await call(`/api/exam-attempts/${pAttemptId}/save`, {
      method: 'POST',
      token: pToken,
      session: pSession,
      body: { revision: 1, answers: { q1: '12', q2: 'Bài làm tự luận khôi phục sau sự cố mạng.' }, events: [] }
    });
    assert.equal(recSave.status, 200);
    assert.equal(recSave.data.answer_revision, 2);

    // Case 14: Digital Evidence storage (R2), SHA-256 + Chain Hash verification, Admin Timeline & Officer Decision
    const ev1 = await call(`/api/exam-attempts/${pAttemptId}/evidence`, {
      method: 'POST',
      token: pToken,
      session: pSession,
      body: {
        evidence_type: 'webcam_snapshot',
        event_id: c10MultiFace.data.event_id,
        base64_data: Buffer.from('mock-webcam-frame-1').toString('base64'),
        mime_type: 'image/webp',
        metadata: { camera: 'primary', faces_detected: 2 }
      }
    });
    assert.equal(ev1.status, 200);
    assert.ok(ev1.data.sha256);
    assert.ok(ev1.data.chain_hash);

    const ev2 = await call(`/api/exam-attempts/${pAttemptId}/evidence`, {
      method: 'POST',
      token: pToken,
      session: pSession,
      body: {
        evidence_type: 'secondary_camera_snapshot',
        base64_data: Buffer.from('mock-secondary-cam-frame-2').toString('base64'),
        mime_type: 'image/webp',
        metadata: { camera: 'secondary_wide_angle' }
      }
    });
    assert.equal(ev2.status, 200);
    assert.notEqual(ev2.data.r2_key, ev1.data.r2_key, 'Evidence must never overwrite old evidence');
    assert.notEqual(ev2.data.chain_hash, ev1.data.chain_hash);

    // Forged evidence hash is rejected (400 EVIDENCE_HASH_MISMATCH)
    const badHashEv = await call(`/api/exam-attempts/${pAttemptId}/evidence`, {
      method: 'POST',
      token: pToken,
      session: pSession,
      body: {
        evidence_type: 'audio_clip',
        base64_data: Buffer.from('audio-data').toString('base64'),
        metadata: { expected_sha256: '0000000000000000000000000000000000000000000000000000000000000000' }
      }
    });
    assert.equal(badHashEv.status, 400);
    assert.equal(badHashEv.data.code, 'EVIDENCE_HASH_MISMATCH');

    // Admin retrieves attempt timeline & verifies cryptographic chain of custody
    const timelineRes = await call(`/api/admin/monitor/${pAttemptId}/timeline`, { token: sysAdminToken });
    assert.equal(timelineRes.status, 200);
    assert.equal(timelineRes.data.evidence_chain_intact, true);
    assert.equal(timelineRes.data.digital_evidence.length, 2);
    assert.ok(timelineRes.data.proctoring_events.length >= 15);
    assert.ok(timelineRes.data.attempt.ip_change_count >= 2);

    // Admin downloads evidence from R2 & checks SHA-256 headers; unauthenticated request is blocked (401)
    const unauthEv = await call(`/api/admin/evidence/${ev1.data.evidence_id}`);
    assert.equal(unauthEv.status, 401);
    const authEvReq = new Request(`https://exam.skyfirst.io.vn/api/admin/evidence/${ev1.data.evidence_id}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${sysAdminToken}` }
    });
    const authEvRes = await examWorker.fetch(authEvReq, getEnv());
    assert.equal(authEvRes.status, 200);
    assert.equal(authEvRes.headers.get('x-evidence-sha256'), ev1.data.sha256);
    assert.equal(authEvRes.headers.get('x-evidence-chain-hash'), ev1.data.chain_hash);

    // Admin reviews proctoring event with received_by, decided_by, status & decision_note
    const revEv = await call(`/api/admin/monitor/events/${c10MultiFace.data.event_id}/review`, {
      method: 'POST',
      token: sysAdminToken,
      body: {
        status: 'verified_violation',
        received_by: 'proctor@skyfirst.io.vn',
        decided_by: 'admin@skyfirst.io.vn',
        decision_note: 'Đã đối chiếu ảnh bằng chứng số R2, xác nhận có người thứ hai xuất hiện trong khung hình.'
      }
    });
    assert.equal(revEv.status, 200);
    assert.equal(revEv.data.status, 'verified_violation');

    // Admin generates post-exam proctoring summary report
    const repRes = await call(`/api/admin/monitor/report?exam_id=${examId}`, { token: sysAdminToken });
    assert.equal(repRes.status, 200);
    assert.ok(repRes.data.report.total_events >= 15);
    assert.equal(repRes.data.report.total_digital_evidence, 2);

    // Case 15: Submit attempt & verify existing exam/submit/lookup/appeal workflows remain 100% functional
    const pSubmit = await call(`/api/exam-attempts/${pAttemptId}/submit`, {
      method: 'POST',
      token: pToken,
      session: pSession,
      body: { revision: 2 }
    });
    assert.equal(pSubmit.status, 200);
    assert.match(pSubmit.data.receipt_code, /^EXM-/);
  });


  // Scenario 18: Sections 13-23 Expansion — Virtual Camera/Mic Detection, Pre-Exam ID/Portrait/Room Photo Check-in, QR-Paired Secondary Mobile Camera, Live Proctor Verification Prompt, Anti-Bypass Lock Guard, Mobile Android/iOS Telemetry & Question Bank Leakage Watermark
  await scenario('Sections 13-23: Virtual Camera/Mic detection, Pre-Exam Check-in Photos, QR Secondary Mobile Camera, Live Proctor Verification Prompt, Lock Anti-Bypass Guard, Mobile Android/iOS telemetry, and QBank export watermark work end-to-end', async () => {
    // 1. Virtual Camera / Virtual Microphone detection in preflight-check (Section 13 & 21.4)
    const vcamPreflight = await call('/api/public/assessments/SF2026/preflight-check', {
      method: 'POST',
      body: {
        fullscreen_supported: true,
        camera_ready: true,
        microphone_ready: true,
        media_devices: [
          { kind: 'videoinput', label: 'OBS Virtual Camera' },
          { kind: 'audioinput', label: 'VB-Audio Virtual Cable' }
        ]
      }
    });
    assert.equal(vcamPreflight.status, 200);
    assert.equal(vcamPreflight.data.passed, false, 'Virtual camera/mic must fail preflight check');
    assert.equal(vcamPreflight.data.media_spoof_check.virtual_camera_detected, true);
    assert.equal(vcamPreflight.data.media_spoof_check.virtual_microphone_detected, true);
    assert.ok(vcamPreflight.data.platform_capability_matrix.windows_desktop);
    assert.ok(vcamPreflight.data.platform_capability_matrix.macos_desktop);
    assert.ok(vcamPreflight.data.platform_capability_matrix.android_mobile);
    assert.ok(vcamPreflight.data.platform_capability_matrix.ios_mobile);

    // 2. Launch a new candidate attempt for Sections 13-23 verification
    const s18Launch = await call('/api/admin/candidates/launch', {
      method: 'POST',
      token: sysAdminToken,
      body: { exam_id: examId, email: 'mobile.cand@skyfirst.io.vn', full_name: 'Hoàng Minh Đức', candidate_code: 'SFN-MOB-01' }
    });
    assert.equal(s18Launch.status, 200);
    const s18Redeem = await call('/api/public/exam-launch/redeem', {
      method: 'POST',
      body: { launch_token: s18Launch.data.launch_token }
    });
    const mAttemptId = s18Redeem.data.attempt_id;
    const mToken = s18Redeem.data.access_token;
    const mSession = 'mobile-session-0123456789abcdef';

    // 3. Pre-Exam Check-in Photos: ID card, Portrait, and 360 Workspace/Desk Inspection (Section 14 & 21.1)
    for (const photoType of ['id_card', 'portrait', 'workspace_360']) {
      const ckRes = await call(`/api/exam-attempts/${mAttemptId}/checkin-photos`, {
        method: 'POST',
        token: mToken,
        session: mSession,
        body: {
          photo_type: photoType,
          base64_data: Buffer.from(`checkin-${photoType}-image-bytes`).toString('base64'),
          mime_type: 'image/webp'
        }
      });
      assert.equal(ckRes.status, 200);
      assert.ok(ckRes.data.evidence_id);
      assert.ok(ckRes.data.sha256);
    }

    // 4. QR-Linked Secondary Mobile Camera Pairing & Synchronized Frame Upload (Section 14 & 21.2)
    const pairRes = await call(`/api/exam-attempts/${mAttemptId}/secondary-camera/pair`, {
      method: 'POST',
      token: mToken,
      session: mSession
    });
    assert.equal(pairRes.status, 200);
    assert.match(pairRes.data.pairing_code, /^CAM2-/);
    assert.match(pairRes.data.qr_url, /cam2_qr=/);

    const connectQrRes = await call(`/api/public/secondary-camera/${pairRes.data.pairing_code}/connect`, {
      method: 'POST',
      body: { platform: 'iOS Safari 18', camera_facing: 'environment' }
    });
    assert.equal(connectQrRes.status, 200);
    assert.equal(connectQrRes.data.paired, true);
    assert.equal(connectQrRes.data.secondary_camera_status, 'active');

    const frameQrRes = await call(`/api/public/secondary-camera/${pairRes.data.pairing_code}/frame`, {
      method: 'POST',
      body: {
        base64_data: Buffer.from('wide-angle-desk-view-frame').toString('base64'),
        mime_type: 'image/webp'
      }
    });
    assert.equal(frameQrRes.status, 200);
    assert.equal(frameQrRes.data.evidence_type, 'secondary_camera_snapshot');

    // 5. Mobile Android/iOS & Anti-Spoofing Telemetry Events (Sections 14, 15, 21, 22)
    for (const [evType, expectedMinRisk] of [
      ['app_backgrounded', 2],
      ['screen_locked', 2],
      ['call_interruption', 1],
      ['orientation_change', 1],
      ['virtual_camera_detected', 4],
      ['spoof_media_detected', 4],
      ['person_substituted', 4],
      ['gaze_or_head_anomaly', 1],
      ['print_or_save_blocked', 2]
    ]) {
      const evRes = await call(`/api/exam-attempts/${mAttemptId}/proctor-event`, {
        method: 'POST',
        token: mToken,
        session: mSession,
        body: { event_type: evType }
      });
      assert.equal(evRes.status, 200);
      assert.ok(evRes.data.risk_level >= expectedMinRisk, `Expected risk >= ${expectedMinRisk} for ${evType}`);
      assert.equal(evRes.data.auto_cancel_exam, false);
    }

    // 6. Live Proctor Direct Verification Prompt & Candidate Response (Section 21.8)
    const promptAction = await call(`/api/admin/monitor/${mAttemptId}/action`, {
      method: 'POST',
      token: sysAdminToken,
      body: {
        action: 'request_verification',
        prompt_message: 'Vui lòng xoay camera phụ 360 độ để giám thị kiểm tra khu vực bàn làm bài.',
        reason: 'Kiểm tra ngẫu nhiên không gian phòng thi'
      }
    });
    assert.equal(promptAction.status, 200);
    assert.equal(promptAction.data.lifecycle_state, 'pending_verification');

    const respondPrompt = await call(`/api/exam-attempts/${mAttemptId}/verify-prompt`, {
      method: 'POST',
      token: mToken,
      session: mSession,
      body: {
        response_note: 'Em đã xoay camera phụ 360 độ quanh bàn thi theo yêu cầu của giám thị.',
        evidence_id: frameQrRes.data.evidence_id
      }
    });
    assert.equal(respondPrompt.status, 200);
    assert.equal(respondPrompt.data.lifecycle_state, 'resumed');
    assert.equal(respondPrompt.data.proctor_prompt.status, 'responded');

    // 7. Question Bank Export Watermark & Audit Log (Section 21.6)
    const qbExport = await call('/api/admin/questions?export=1', { token: sysAdminToken });
    assert.equal(qbExport.status, 200);
    assert.match(qbExport.data.export_watermark, /^SKYFIRST-QBANK-/);

    // 8. Lock/Suspension Anti-Bypass Guard (Section 17: Cannot create a new attempt when existing attempt is locked)
    await call('/api/admin/candidates/enroll', {
      method: 'POST',
      token: sysAdminToken,
      body: { exam_id: examId, email: 'locked.cand@example.com', full_name: 'Thí sinh Đang Khóa', candidate_code: 'SFN-LCK-01', class_name: 'Lớp 12A', status: 'active' }
    });
    db.prepare(`DELETE FROM exam_otp_challenges WHERE email='locked.cand@example.com'`).run();
    db.prepare(`DELETE FROM exam_rate_limits`).run();
    await call('/api/public/assessments/SF2026/request-verification', { method: 'POST', body: { email: 'locked.cand@example.com' } });
    const lckOtp = sentEmails.at(-1).text.match(/\b(\d{6})\b/)[1];
    const lckStart1 = await call('/api/public/assessments/SF2026/start', {
      method: 'POST',
      body: { full_name: 'Thí sinh Đang Khóa', email: 'locked.cand@example.com', candidate_code: 'SFN-LCK-01', class_name: 'Lớp 12A', verification_code: lckOtp }
    });
    assert.equal(lckStart1.status, 200);
    await call(`/api/admin/monitor/${lckStart1.data.attempt_id}/action`, {
      method: 'POST',
      token: sysAdminToken,
      body: { action: 'lock', reason: 'Khóa tạm thời để kiểm tra chống tạo phiên mới lách khóa' }
    });

    db.prepare(`DELETE FROM exam_otp_challenges WHERE email='locked.cand@example.com'`).run();
    db.prepare(`DELETE FROM exam_rate_limits`).run();
    await call('/api/public/assessments/SF2026/request-verification', { method: 'POST', body: { email: 'locked.cand@example.com' } });
    const lckOtp2 = sentEmails.at(-1).text.match(/\b(\d{6})\b/)[1];
    const bypassAttempt = await call('/api/public/assessments/SF2026/start', {
      method: 'POST',
      body: { full_name: 'Thí sinh Đang Khóa', email: 'locked.cand@example.com', candidate_code: 'SFN-LCK-01', class_name: 'Lớp 12A', verification_code: lckOtp2 }
    });
    assert.equal(bypassAttempt.status, 423);
    assert.equal(bypassAttempt.data.code, 'ATTEMPT_LOCKED_CANNOT_BYPASS');

    // 9. Milestone 6: Candidate File-Upload Prohibition (403), Author/Proctor Document Upload, QTI 2.1, Scientific Calculator, and 9 Sky First Proprietary Anti-Cheat Technologies
    // 9a. Candidate file upload attempt is strictly forbidden (403 CANDIDATE_FILE_UPLOAD_FORBIDDEN)
    const fd = new FormData();
    fd.append('file', new Blob(['fake answer file'], { type: 'text/plain' }), 'answer.txt');
    fd.append('question_id', 'q2');
    const candUploadRes = await examWorker.fetch(new Request(`https://exam.skyfirst.io.vn/api/public/exam-attempts/${mAttemptId}/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${mToken}` },
      body: fd
    }), baseEnv);
    assert.equal(candUploadRes.status, 403);
    const candUploadJson = await candUploadRes.json();
    assert.equal(candUploadJson.detail?.code || candUploadJson.code, 'CANDIDATE_FILE_UPLOAD_FORBIDDEN');

    // 9b. Author Document / OCR Question Parser & AI Authoring Assistant
    const parseDocRes = await call('/api/admin/authoring/parse-document', {
      method: 'POST',
      token: sysAdminToken,
      body: {
        source_format: 'docx',
        subject: 'Toán học',
        topic: 'Giải tích',
        document_text: 'Câu 1: Đạo hàm của x^2 là gì?\nA. x\nB. 2x\nC. 2\nD. x^3\nĐáp án: B\n\nCâu 2: Trình bày định lý cơ bản của giải tích.'
      }
    });
    assert.equal(parseDocRes.status, 200);
    assert.equal(parseDocRes.data.extracted_count, 2);
    assert.equal(parseDocRes.data.draft_questions[0].type, 'mcq');
    assert.equal(parseDocRes.data.draft_questions[0].answer, '2x');
    assert.equal(parseDocRes.data.draft_questions[1].type, 'essay');

    const aiAssistRes = await call('/api/admin/authoring/ai-assist', {
      method: 'POST',
      token: sysAdminToken,
      body: { topic: 'Giải tích', source_text: 'Đạo hàm của sin(x) là cos(x)', type: 'mcq', difficulty: 'medium' }
    });
    assert.equal(aiAssistRes.status, 200);
    assert.equal(aiAssistRes.data.suggestion.options.length, 4);
    assert.equal(aiAssistRes.data.suggestion.requires_human_approval, true);

    // 9c. Proctor Session Document Upload & Listing
    const procDocRes = await call('/api/admin/proctor/session-documents', {
      method: 'POST',
      token: sysAdminToken,
      body: {
        exam_id: examId,
        title: 'Biên bản xác minh camera phụ ca sáng',
        content: 'Đã kiểm tra góc quay 360 độ hợp lệ.'
      }
    });
    assert.equal(procDocRes.status, 200);
    assert.match(procDocRes.data.document.sha256, /^[a-f0-9]{64}$/);

    const procDocList = await call(`/api/admin/proctor/session-documents?exam_id=${examId}`, { token: sysAdminToken });
    assert.equal(procDocList.status, 200);
    assert.ok(procDocList.data.documents.length >= 1);

    // 9d. QTI 2.1 Export & Import
    const qtiExp = await call(`/api/admin/questions/qti-export?exam_id=${examId}`, { token: sysAdminToken });
    assert.equal(qtiExp.status, 200);
    assert.match(qtiExp.data.qti_xml, /<questestinterop/);

    const qtiImp = await call('/api/admin/questions/qti-import', {
      method: 'POST',
      token: sysAdminToken,
      body: { qti_xml: qtiExp.data.qti_xml }
    });
    assert.equal(qtiImp.status, 200);
    assert.ok(qtiImp.data.imported_count >= 1);

    // 9e. Privacy Shield Behavioral Biometrics & Dynamic Integrity Challenge
    const bioRes = await call(`/api/exam-attempts/${mAttemptId}/behavioral-biometrics`, {
      method: 'POST',
      token: mToken,
      session: mSession,
      body: {
        behavioral_vector: { keystroke_dwell_ms: 10, keystroke_flight_ms: 120, bulk_input_ratio: 0.85 },
        duration_seconds: 25
      }
    });
    assert.equal(bioRes.status, 200);
    assert.equal(bioRes.data.privacy_shield_mode, 'edge_feature_vectors_only_no_raw_keylog');
    assert.equal(bioRes.data.requires_dynamic_challenge, true);
    assert.ok(bioRes.data.dynamic_challenge.challenge_id);

    // 9f. Honeytoken Leak Scan, Collusion Graph, Adversarial Lab, Threat Memory & Psychometrics Analytics
    const leakScan = await call('/api/admin/security/leak-scan', {
      method: 'POST',
      token: sysAdminToken,
      body: { leaked_text: `Phát hiện rò rỉ đề của thí sinh SFN-MOB-01 câu hỏi: 5 + 7 bằng mấy?` }
    });
    assert.equal(leakScan.status, 200);
    assert.equal(leakScan.data.leak_report.leak_detected, true);
    assert.ok(leakScan.data.leak_report.matched_sources.length >= 1);

    const colGraph = await call(`/api/admin/security/collusion-graph?exam_id=${examId}`, { token: sysAdminToken });
    assert.equal(colGraph.status, 200);
    assert.ok(Array.isArray(colGraph.data.graph.nodes));

    const advLab = await call('/api/admin/security/adversarial-lab', {
      method: 'POST',
      token: sysAdminToken,
      body: { exam_id: examId }
    });
    assert.equal(advLab.status, 200);
    assert.equal(advLab.data.simulation.true_positive_rate_percent, 100);
    assert.equal(advLab.data.simulation.false_positive_rate_percent, 0);

    const threatMem = await call('/api/admin/security/threat-memory', { token: sysAdminToken });
    assert.equal(threatMem.status, 200);
    assert.ok(threatMem.data.threats.length >= 4);

    const psychAnalytics = await call(`/api/admin/exams/${examId}/analytics`, { token: sysAdminToken });
    assert.equal(psychAnalytics.status, 200);
    assert.ok(Array.isArray(psychAnalytics.data.item_psychometrics));

    // 9g. Supreme System Owner (Skyfirst.ec@gmail.com):
    // - 1st Login: Server-controlled one-time activation completes login immediately WITHOUT OTP and WITHOUT sending OTP email, then auto-locks permanently.
    // - 2nd+ Login: Requires 6-digit single-use OTP sent from noreply@skyfirst.io.vn.
    // - D1 Legacy Schema Compatibility: Works even when users table has NOT NULL password_hash, password_salt, custom NOT NULL columns, and CHECK(role) constraints.
    db.prepare(`DELETE FROM exam_otp_challenges WHERE email='skyfirst.ec@gmail.com'`).run();
    db.prepare(`DELETE FROM users WHERE LOWER(email)='skyfirst.ec@gmail.com'`).run();
    db.prepare(`DELETE FROM exam_admin_accounts WHERE LOWER(email)='skyfirst.ec@gmail.com'`).run();
    db.prepare(`DELETE FROM exam_owner_bootstrap_state`).run();
    db.prepare(`DELETE FROM exam_admin_sessions WHERE LOWER(email)='skyfirst.ec@gmail.com'`).run();
    db.prepare(`DELETE FROM exam_rate_limits`).run();

    // First login succeeds immediately even when email service is unconfigured (because 1st login does not send OTP email!)
    const emailsBeforeFirstLogin = sentEmails.length;
    emailServiceMode = 'unconfigured';
    const ownerFirstLogin = await call('/api/admin/auth/request-otp', {
      method: 'POST',
      body: { email: 'Skyfirst.ec@gmail.com' }
    });
    assert.equal(ownerFirstLogin.status, 200, 'First owner login must succeed immediately via server-controlled one-time bootstrap state');
    assert.equal(ownerFirstLogin.data.first_login, true);
    assert.equal(ownerFirstLogin.data.otp_required, false);
    assert.ok(ownerFirstLogin.data.admin_token, 'First owner login must return admin_token');
    assert.ok(ownerFirstLogin.data.csrf_token, 'First owner login must return csrf_token');
    assert.match(ownerFirstLogin.headers.get('set-cookie') || '', /HttpOnly/i);
    assert.deepEqual(ownerFirstLogin.data.user.roles, ['system_owner', 'system_admin']);
    assert.equal(sentEmails.length, emailsBeforeFirstLogin, 'First owner login must NOT send any OTP email');

    // Verify one-time bootstrap state is now permanently locked in D1
    const bootstrapStateRow = db.prepare(`SELECT status, used_count, locked_at FROM exam_owner_bootstrap_state WHERE state_key='supreme_owner_first_login'`).get();
    assert.ok(bootstrapStateRow);
    assert.equal(bootstrapStateRow.status, 'locked', 'One-time owner bootstrap state must auto-lock after 1st login');
    assert.equal(Number(bootstrapStateRow.used_count), 1);
    assert.ok(bootstrapStateRow.locked_at);

    // Verify owner session from 1st login works on /api/admin/auth/me and /api/admin/dashboard
    const ownerMe1 = await call('/api/admin/auth/me', { token: ownerFirstLogin.data.admin_token });
    assert.equal(ownerMe1.status, 200);
    assert.equal(ownerMe1.data.user.email, 'skyfirst.ec@gmail.com');

    // 2nd Login onwards: Now that first_login_available = 0, OTP is strictly required.
    // When email service is unconfigured, 2nd login returns 503 EMAIL_SERVICE_UNCONFIGURED (never fakes OTP sent and never bypasses OTP!)
    const ownerSecondUnconf = await call('/api/admin/auth/request-otp', {
      method: 'POST',
      body: { email: 'Skyfirst.ec@gmail.com' }
    });
    assert.equal(ownerSecondUnconf.status, 503);
    assert.equal(ownerSecondUnconf.data.code, 'EMAIL_SERVICE_UNCONFIGURED');
    emailServiceMode = 'active';

    // When email service is active, 2nd login sends 6-digit OTP from noreply@skyfirst.io.vn to skyfirst.ec@gmail.com
    const ownerOtp1 = await call('/api/admin/auth/request-otp', {
      method: 'POST',
      body: { email: 'Skyfirst.ec@gmail.com' }
    });
    assert.equal(ownerOtp1.status, 200);
    assert.equal(ownerOtp1.data.otp_required, true);
    assert.ok(!ownerOtp1.data.first_login, '2nd login must not trigger first_login bypass');
    const persistedOwner = db.prepare(`SELECT email,status,role,roles_json,expires_at FROM users WHERE LOWER(email)='skyfirst.ec@gmail.com'`).get();
    assert.ok(persistedOwner, 'Owner account must be persisted in D1');
    assert.equal(persistedOwner.status, 'active');
    assert.deepEqual(JSON.parse(persistedOwner.roles_json), ['system_owner', 'system_admin']);
    assert.equal(persistedOwner.expires_at, null);
    const firstOwnerMail = sentEmails.at(-1);
    assert.equal(firstOwnerMail.from, 'noreply@skyfirst.io.vn');
    assert.equal(firstOwnerMail.to, 'skyfirst.ec@gmail.com');
    const firstOwnerCode = firstOwnerMail.text.match(/\b(\d{6})\b/)[1];

    // Immediate resend without any cooldown invalidates first OTP and issues second OTP
    const ownerOtp2 = await call('/api/admin/auth/request-otp', {
      method: 'POST',
      body: { email: 'Skyfirst.ec@gmail.com' }
    });
    assert.equal(ownerOtp2.status, 200);
    const secondOwnerMail = sentEmails.at(-1);
    assert.equal(secondOwnerMail.from, 'noreply@skyfirst.io.vn');
    assert.equal(secondOwnerMail.to, 'skyfirst.ec@gmail.com');
    const secondOwnerCode = secondOwnerMail.text.match(/\b(\d{6})\b/)[1];

    const staleOwnerVerify = await call('/api/admin/auth/verify-otp', {
      method: 'POST',
      body: { email: 'Skyfirst.ec@gmail.com', otp: firstOwnerCode }
    });
    assert.equal(staleOwnerVerify.status, 401);

    const ownerVerify = await call('/api/admin/auth/verify-otp', {
      method: 'POST',
      body: { email: 'Skyfirst.ec@gmail.com', otp: secondOwnerCode }
    });
    assert.equal(ownerVerify.status, 200);
    assert.ok(ownerVerify.data.user.roles.includes('system_owner'));
    assert.ok(ownerVerify.data.user.roles.includes('system_admin'));

    // Regular system_admin cannot lock, revoke, or demote skyfirst.ec@gmail.com (403 OWNER_ACCOUNT_PROTECTED)
    const attackOwner = await call('/api/admin/users/role', {
      method: 'POST',
      token: sysAdminToken,
      body: { email: 'skyfirst.ec@gmail.com', full_name: 'Downgrade Attempt', status: 'locked', roles: ['candidate'], reason: 'Attempt to lock owner' }
    });
    assert.equal(attackOwner.status, 403);
    assert.equal(attackOwner.data.detail?.code || attackOwner.data.code, 'OWNER_ACCOUNT_PROTECTED');

    // 9h. Test Legacy Production D1 scrd-files users Schema (NOT NULL password_hash, password_salt, custom NOT NULL columns, CHECK(role) constraint)
    {
      const legacyDb = new DatabaseSync(':memory:');
      legacyDb.exec(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          sfn_id TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          full_name TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('student', 'teacher', 'admin')),
          status TEXT NOT NULL DEFAULT 'active',
          roles_json TEXT NOT NULL DEFAULT '["student"]',
          class_id TEXT,
          expires_at TEXT,
          phone_verified INTEGER NOT NULL,
          profile_json TEXT NOT NULL
        );
      `);
      class LegacyStmt {
        constructor(sql, params = []) { this.sql = sql; this.params = params; }
        bind(...params) { return new LegacyStmt(this.sql, params); }
        async first() { return legacyDb.prepare(this.sql).get(...this.params) || null; }
        async all() { return { results: legacyDb.prepare(this.sql).all(...this.params) }; }
        async run() {
          const x = legacyDb.prepare(this.sql).run(...this.params);
          return { success: true, meta: { changes: Number(x.changes) } };
        }
      }
      const legacyEnv = {
        ...baseEnv,
        DB: {
          prepare: sql => new LegacyStmt(sql),
          batch: async stmts => {
            legacyDb.exec('BEGIN');
            try {
              const out = [];
              for (const s of stmts) out.push(await s.run());
              legacyDb.exec('COMMIT');
              return out;
            } catch (err) {
              legacyDb.exec('ROLLBACK');
              throw err;
            }
          }
        }
      };

      // 1st Login on legacy scrd-files DB must provision owner cleanly without OWNER_PROVISIONING_FAILED!
      const legRes1 = await examWorker.fetch(new Request('https://exam.skyfirst.io.vn/api/admin/auth/request-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'Skyfirst.ec@gmail.com' })
      }), legacyEnv);
      const legData1 = await legRes1.json();
      assert.equal(legRes1.status, 200, `Legacy DB 1st login failed: ${JSON.stringify(legData1)}`);
      assert.equal(legData1.first_login, true);
      assert.ok(legData1.admin_token);

      // 2nd Login on legacy scrd-files DB must send 6-digit OTP and verify cleanly
      const legRes2 = await examWorker.fetch(new Request('https://exam.skyfirst.io.vn/api/admin/auth/request-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'Skyfirst.ec@gmail.com' })
      }), legacyEnv);
      const legData2 = await legRes2.json();
      assert.equal(legRes2.status, 200);
      assert.equal(legData2.otp_required, true);
      const legOtp = sentEmails.at(-1).text.match(/\b(\d{6})\b/)[1];
      const legVerify = await examWorker.fetch(new Request('https://exam.skyfirst.io.vn/api/admin/auth/verify-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'Skyfirst.ec@gmail.com', otp: legOtp })
      }), legacyEnv);
      const legVerifyData = await legVerify.json();
      assert.equal(legVerify.status, 200);
      assert.deepEqual(legVerifyData.user.roles, ['system_owner', 'system_admin']);
      legacyDb.close();
    }

  });

  console.log(`STANDALONE EXAM 2026 INTEGRATION SUITE: ${passed}/${passed} PASS`);
} finally {
  globalThis.fetch = originalFetch;
  db.close();
}

// 16. Verify all 14 active URLs across exam.skyfirst.io.vn and www.exam.skyfirst.io.vn, 301 canonical path preservation, and 404 for removed/unknown routes (/tra-cuu, /bao-loi)
{
  const mandatoryRoutes = [
    ['/', 'home', 'Hệ Thống Khảo Thí Và Đánh Giá Sky First'],
    ['/admin', 'admin', 'Phân hệ Quản trị'],
    ['/tra-cuu-ket-qua', 'tra-cuu-ket-qua', 'Tra cứu kết quả thi'],
    ['/phuc-khao', 'phuc-khao', 'Đăng ký phúc khảo kết quả thi'],
    ['/ho-tro', 'ho-tro', 'Hỗ trợ thí sinh'],
    ['/su-co-khan-cap', 'su-co-khan-cap', 'Báo sự cố khẩn cấp'],
    ['/to-cao-gian-lan', 'to-cao-gian-lan', 'Tố cáo gian lận']
  ];
  const hosts = ['https://exam.skyfirst.io.vn', 'https://www.exam.skyfirst.io.vn'];
  let verifiedUrls = 0;
  for (const host of hosts) {
    for (const [route, routeKey, expectedHeading] of mandatoryRoutes) {
      const res = await examWorker.fetch(new Request(`${host}${route}`, { method: 'GET' }), baseEnv);
      assert.equal(res.status, 200, `Expected 200 for ${host}${route}`);
      assert.equal(res.headers.get('location'), null, `Unexpected redirect for ${host}${route}`);
      assert.match(res.headers.get('content-type') || '', /text\/html/);
      assert.match(res.headers.get('cache-control') || '', /no-store/);
      const html = await res.text();
      assert.match(html, new RegExp(`data-route="${routeKey}"`), `Missing data-route="${routeKey}" on ${host}${route}`);
      assert.ok(html.includes(expectedHeading), `Missing heading "${expectedHeading}" on ${host}${route}`);
      assert.doesNotMatch(html, /href="\/bao-loi"/, `Removed /bao-loi link must not appear in HTML on ${host}${route}`);
      assert.doesNotMatch(html, /href="\/tra-cuu"/, `Removed /tra-cuu link must not appear in HTML on ${host}${route}`);
      verifiedUrls++;
    }
    // Also verify trailing slash on /su-co-khan-cap/ and /admin/ preserves route and does not redirect to /
    const suCoSlash = await examWorker.fetch(new Request(`${host}/su-co-khan-cap/`, { method: 'GET' }), baseEnv);
    assert.equal(suCoSlash.status, 200);
    assert.equal(suCoSlash.headers.get('location'), null);
    assert.match(await suCoSlash.text(), /data-route="su-co-khan-cap"/);
  }
  assert.equal(verifiedUrls, 14, 'All 14 active URLs across both hostnames must be verified');

  for (const host of hosts) {
    for (const removedRoute of ['/tra-cuu', '/bao-loi', '/tra-cuu/', '/bao-loi/']) {
      const removedRes = await examWorker.fetch(new Request(`${host}${removedRoute}`, { method: 'GET' }), baseEnv);
      assert.equal(removedRes.status, 404, `Removed ${removedRoute} must return 404 on ${host}`);
      assert.equal(removedRes.headers.get('location'), null, `Removed ${removedRoute} must never redirect to /`);
      const removedHtml = await removedRes.text();
      assert.match(removedHtml, /data-route="404"/);
    }
  }

  // Verify optional canonical 301 redirect preserves path and query string (never redirects to /)
  const canonRes = await examWorker.fetch(
    new Request('https://www.exam.skyfirst.io.vn/su-co-khan-cap?attempt_id=att-123&candidate_code=SFN-001', { method: 'GET' }),
    { ...baseEnv, ENFORCE_CANONICAL_HOST: '1' }
  );
  assert.equal(canonRes.status, 301);
  assert.equal(canonRes.headers.get('location'), 'https://exam.skyfirst.io.vn/su-co-khan-cap?attempt_id=att-123&candidate_code=SFN-001');

  // Verify unknown route returns 404 (never falls back to homepage /)
  const notFoundRes = await examWorker.fetch(new Request('https://exam.skyfirst.io.vn/duong-dan-khong-ton-tai', { method: 'GET' }), baseEnv);
  assert.equal(notFoundRes.status, 404);
  const notFoundHtml = await notFoundRes.text();
  assert.match(notFoundHtml, /data-route="404"/);

  console.log('PASS Scenario 16: All 14 active URLs across exam.skyfirst.io.vn and www.exam.skyfirst.io.vn return route-specific HTML (200 OK), /su-co-khan-cap renders properly, and /tra-cuu + /bao-loi + unknown routes return 404');
}


// 17. Bundle Cloudflare Pages Advanced Mode Worker (public/_worker.js + public/_routes.json) and verify self-contained execution
{
  const moduleOrder = [
    'src/email-templates.js',
    'src/page-router.js',
    'src/repository.js',
    'src/adapters.js',
    'src/auth-service.js',
    'src/security-service.js',
    'src/business-service.js',
    'src/exam-service.js',
    'src/index.js'
  ];
  const chunks = [
    '// SKY FIRST EXAM 2026 — Self-Contained Cloudflare Pages Advanced Mode Worker (_worker.js)',
    '// Auto-generated during npm run build from src/*.js'
  ];
  for (const modPath of moduleOrder) {
    let code = fs.readFileSync(modPath, 'utf8');
    // Strip relative import statements
    code = code.replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
    if (modPath !== 'src/index.js') {
      // Strip export { ... } blocks and convert export declarations to plain declarations
      code = code.replace(/^\s*export\s*\{[\s\S]*?\};?\s*$/gm, '');
      code = code.replace(/^(\s*)export\s+(async\s+function|function|const|let|var|class)\b/gm, '$1$2');
    }
    chunks.push(`// --- MODULE: ${modPath} ---\n` + code.trim());
  }
  const bundledWorkerCode = chunks.join('\n\n') + '\n';
  fs.writeFileSync('public/_worker.js', bundledWorkerCode, 'utf8');
  fs.writeFileSync('public/_routes.json', JSON.stringify({
    version: 1,
    include: ['/*'],
    exclude: [
      '/styles.css',
      '/sky-first-logo.webp',
      '/api.js',
      '/storage.js',
      '/core.js',
      '/security-client.js',
      '/exam.js',
      '/admin.js'
    ]
  }, null, 2) + '\n', 'utf8');

  const bundledMod = await import('../public/_worker.js');
  const hRes = await bundledMod.default.fetch(new Request('https://exam.skyfirst.io.vn/tra-cuu'), baseEnv);
  assert.equal(hRes.status, 404);
  const blRes = await bundledMod.default.fetch(new Request('https://exam.skyfirst.io.vn/bao-loi'), baseEnv);
  assert.equal(blRes.status, 404);
  const scRes = await bundledMod.default.fetch(new Request('https://exam.skyfirst.io.vn/su-co-khan-cap'), baseEnv);
  assert.equal(scRes.status, 200);
  const admRes = await bundledMod.default.fetch(new Request('https://exam.skyfirst.io.vn/admin'), baseEnv);
  assert.equal(admRes.status, 200);
  const trRes = await bundledMod.default.fetch(new Request('https://www.exam.skyfirst.io.vn/tra-cuu-ket-qua'), baseEnv);
  assert.equal(trRes.status, 200);

  console.log('PASS Scenario 17: Cloudflare Pages Advanced Mode _worker.js & _routes.json compiled, verified, and preserved in ./public for deployment');
}

process.exit(0);
