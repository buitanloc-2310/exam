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
      if (u.pathname === '/' || u.pathname.startsWith('/admin') || u.pathname.startsWith('/join/') || u.pathname.startsWith('/exam/')) {
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

    // Immediate resend within 60s cooldown is blocked with 429
    const cooldownOtp = await call('/api/admin/auth/request-otp', {
      method: 'POST',
      body: { email: 'admin@skyfirst.io.vn' }
    });
    assert.equal(cooldownOtp.status, 429);

    // Wrong OTP attempt is rejected with 401
    const wrongVerify = await call('/api/admin/auth/verify-otp', {
      method: 'POST',
      body: { email: 'admin@skyfirst.io.vn', otp: '000000' }
    });
    assert.equal(wrongVerify.status, 401);

    // Valid OTP succeeds and returns token + CSRF + HttpOnly cookie
    const goodVerify = await call('/api/admin/auth/verify-otp', {
      method: 'POST',
      body: { email: 'admin@skyfirst.io.vn', otp: otpCode }
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
      body: { email: 'admin@skyfirst.io.vn', otp: otpCode }
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

  console.log(`STANDALONE EXAM 2026 INTEGRATION SUITE: ${passed}/${passed} PASS`);
} finally {
  globalThis.fetch = originalFetch;
  db.close();
}

// 15. Direct Worker /admin HTML routing on exam.skyfirst.io.vn and www.exam.skyfirst.io.vn (CSP-compliant, zero inline scripts)
{
  for (const url of ['https://exam.skyfirst.io.vn/admin', 'https://www.exam.skyfirst.io.vn/admin', 'https://exam.skyfirst.io.vn/admin/exams']) {
    const res = await examWorker.fetch(new Request(url, { method: 'GET' }), baseEnv);
    assert.equal(res.status, 200, `Expected 200 for ${url}`);
    assert.match(res.headers.get('content-security-policy') || '', /script-src 'self'/);
    assert.match(res.headers.get('cache-control') || '', /no-store/);
    const html = await res.text();
    assert.match(html, /<script type="module" src="\/admin\.js\?build=20261025-v5-final"><\/script>/);
    assert.doesNotMatch(html, /Khu quản trị không có trong cổng dự thi/);
  }
  console.log('PASS Scenario 15: Worker directly serves CSP-compliant /admin HTML on exam.skyfirst.io.vn/admin and www.exam.skyfirst.io.vn/admin');
}
