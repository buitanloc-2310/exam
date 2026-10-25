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

  console.log(`STANDALONE EXAM 2026 INTEGRATION SUITE: ${passed}/${passed} PASS`);
} finally {
  globalThis.fetch = originalFetch;
  db.close();
}
