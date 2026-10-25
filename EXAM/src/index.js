// =============================================================================
// SKY FIRST EXAM 2026 — STANDALONE CLOUDFLARE WORKER BACKEND (src/index.js)
// Complete, independent examination platform with zero dependency on SLC.
// Supports:
//  - Candidate Attempt Engine (Launch Redeem, Guest Gate, OTP Verify, Lease,
//    Revisioned Autosave, Strict Mode Lock/Unlock, R2 Upload, Atomic Submit,
//    Review, Result Lookup, Support Request, Appeal Submission)
//  - Full /admin Backend & RBAC (Bootstrap, Admin Email OTP Auth, HttpOnly/Bearer
//    Session + CSRF, Dashboard Metrics, Exam Lifecycle & Sealing, Question Bank
//    & Versioning, Candidate & Enrollment Management, Live Proctoring Monitor,
//    Manual Grading & Score Adjustment, Result Approval/Publication/Revocation,
//    Appeals Resolution, User/Role Provisioning, Audit Log Viewer)
// =============================================================================

const SECURITY = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'permissions-policy': 'camera=(), microphone=(self), display-capture=(), geolocation=(), payment=(), usb=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains'
};

const JSON_HEADERS = { ...SECURITY, 'content-type': 'application/json; charset=utf-8' };
const MANUAL_TYPES = new Set(['essay', 'long', 'structured', 'file', 'image', 'audio', 'math']);
const ATTACHMENT_TYPES = new Set(['file', 'image', 'audio']);
const MAX_JSON_BODY_BYTES = 2_500_000;
const MAX_ANSWER_BYTES = 2_000_000;

export const ADMIN_ROLES = [
  'system_admin',
  'exam_admin',
  'question_bank_manager',
  'exam_author',
  'proctor',
  'grader',
  'result_approver',
  'appeal_officer',
  'report_viewer',
  'account_admin'
];

export const ROLE_PERMISSIONS = {
  system_admin: new Set(['*']),
  account_admin: new Set(['dashboard:view', 'users:read', 'users:write', 'audit:read']),
  exam_admin: new Set(['dashboard:view', 'exams:read', 'exams:write', 'exams:lifecycle', 'questions:read', 'questions:write', 'questions:delete', 'candidates:read', 'candidates:write', 'monitor:read', 'monitor:write', 'support:read', 'support:write', 'grading:read', 'results:read', 'audit:read']),
  question_bank_manager: new Set(['dashboard:view', 'questions:read', 'questions:write', 'questions:delete', 'exams:read']),
  exam_author: new Set(['dashboard:view', 'questions:read', 'questions:write', 'exams:read', 'exams:write']),
  proctor: new Set(['dashboard:view', 'monitor:read', 'monitor:write', 'support:read', 'support:write', 'candidates:read', 'exams:read']),
  grader: new Set(['dashboard:view', 'grading:read', 'grading:write', 'exams:read']),
  result_approver: new Set(['dashboard:view', 'grading:read', 'results:read', 'results:approve', 'results:publish', 'results:revoke', 'exams:read', 'audit:read']),
  appeal_officer: new Set(['dashboard:view', 'appeals:read', 'appeals:write', 'grading:read', 'results:read', 'audit:read']),
  report_viewer: new Set(['dashboard:view', 'exams:read', 'questions:read', 'results:read', 'candidates:read', 'monitor:read', 'appeals:read', 'support:read', 'audit:read'])
};

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

const str = v => String(v ?? '').trim();
const safeJson = (v, f) => { try { return typeof v === 'string' ? JSON.parse(v) : (v ?? f); } catch { return f; } };
const nowIso = () => new Date().toISOString();
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
const ok = (body = {}, extra = {}) => json({ ok: true, ...body }, 200, extra);
const bad = (message, status = 400, detail) => json({ ok: false, message, detail }, status);

function httpError(message, status = 400, detail) {
  return Object.assign(new Error(message), { status, detail });
}

function timingSafeStringEqual(a, b) {
  const s1 = String(a ?? ''), s2 = String(b ?? '');
  const e1 = new TextEncoder().encode(s1), e2 = new TextEncoder().encode(s2);
  const len = Math.max(e1.length, e2.length);
  let diff = e1.length ^ e2.length;
  for (let i = 0; i < len; i++) {
    diff |= (e1[i] || 0) ^ (e2[i] || 0);
  }
  return diff === 0 && e1.length > 0;
}

async function readJsonBody(request, maxBytes = MAX_JSON_BODY_BYTES) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw httpError('Dữ liệu gửi lên vượt giới hạn an toàn.', 413);
  if (!request.body) return {};
  const reader = request.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw httpError('Dữ liệu gửi lên vượt giới hạn an toàn.', 413);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error?.status) throw error;
    throw httpError('Không thể đọc dữ liệu yêu cầu.', 400);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (size === 0) return {};
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw httpError('Nội dung JSON không hợp lệ.', 400);
  }
}

function cleanEvents(raw, fallback = []) {
  const list = Array.isArray(raw) ? raw : (Array.isArray(fallback) ? fallback : []);
  return list.slice(-400).flatMap(event => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return [];
    const type = str(event.type).slice(0, 80);
    if (!type || type === 'ui_state') return [];
    const timestamp = Date.parse(str(event.at));
    const clean = { type, at: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : nowIso() };
    if (typeof event.fullscreen === 'boolean') clean.fullscreen = event.fullscreen;
    return [clean];
  });
}

function sanitizeAnswers(raw, questions = []) {
  if (raw == null) raw = {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw httpError('Cấu trúc bài làm không hợp lệ.', 400);
  const byId = new Map(questions.map(q => [String(q.id), q])), clean = {};
  for (const [id, value] of Object.entries(raw)) {
    const q = byId.get(id);
    if (!q || value === undefined) continue;
    if (value === null || value === '') { clean[id] = value; continue; }
    const type = str(q.type);
    if (ATTACHMENT_TYPES.has(type)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError('Dữ liệu tệp trả lời không hợp lệ.', 400);
      const fileId = str(value.file_id);
      if (!fileId || fileId.length > 200) throw httpError('Mã tệp trả lời không hợp lệ.', 400);
      clean[id] = {
        file_id: fileId,
        name: str(value.name).slice(0, 180),
        mime: str(value.mime).slice(0, 120),
        size: Number.isFinite(Number(value.size)) ? Math.max(0, Number(value.size)) : 0
      };
    } else if (type === 'multi' || type === 'ordering') {
      if (!Array.isArray(value) || value.length > 200) throw httpError('Danh sách lựa chọn không hợp lệ.', 400);
      clean[id] = value.map(item => {
        if (!['string', 'number', 'boolean'].includes(typeof item)) throw httpError('Lựa chọn không hợp lệ.', 400);
        const v = String(item);
        if (v.length > 2000) throw httpError('Lựa chọn vượt giới hạn.', 413);
        return v;
      });
    } else if (type === 'matching') {
      if (typeof value !== 'object' || Array.isArray(value)) throw httpError('Cặp ghép không hợp lệ.', 400);
      const sourceOptions = Array.isArray(q.options) ? q.options : safeJson(q.options, []);
      const allowed = new Set((Array.isArray(sourceOptions) ? sourceOptions : []).map(item => String(item).split('|||')[0]));
      const entries = Object.entries(value);
      if (entries.length > 200) throw httpError('Số cặp ghép vượt giới hạn.', 413);
      const matches = {};
      for (const [key, item] of entries) {
        if (!allowed.has(key)) continue;
        if (!['string', 'number', 'boolean'].includes(typeof item)) throw httpError('Lựa chọn ghép không hợp lệ.', 400);
        const v = String(item);
        if (v.length > 2000) throw httpError('Lựa chọn ghép vượt giới hạn.', 413);
        matches[key] = v;
      }
      clean[id] = matches;
    } else if (typeof value === 'string') {
      if (value.length > 500_000) throw httpError('Câu trả lời vượt giới hạn an toàn.', 413);
      clean[id] = value;
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw httpError('Giá trị câu trả lời không hợp lệ.', 400);
      clean[id] = value;
    } else if (typeof value === 'boolean') {
      clean[id] = value;
    } else {
      throw httpError('Kiểu dữ liệu câu trả lời không hợp lệ.', 400);
    }
  }
  return clean;
}

function withSecurity(response) {
  if (!response || response.status === 101) return response;
  const h = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY)) h.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
}

function databaseTimeMs(value) {
  const raw = str(value);
  if (!raw) return NaN;
  const utc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw) ? raw.replace(' ', 'T') + 'Z' : raw;
  return Date.parse(utc);
}

function examTimeMs(value) {
  const raw = str(value);
  if (!raw) return null;
  const explicit = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const ms = Date.parse(explicit ? raw : raw.replace(' ', 'T') + '+07:00');
  return Number.isFinite(ms) ? ms : null;
}

function bearerToken(request) {
  const m = str(request.headers.get('authorization')).match(/^Bearer\s+([A-Za-z0-9._~-]{16,512})$/i);
  return m ? m[1] : '';
}

function parseCookies(request) {
  const header = str(request.headers.get('cookie'));
  if (!header) return {};
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

async function sha256Text(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function randomHex(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
}

function randomOtp6() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
}

function publicQuestions(raw = '[]') {
  const qs = Array.isArray(raw) ? raw : safeJson(raw, []);
  if (!Array.isArray(qs)) return [];
  return qs.filter(q => q && typeof q === 'object' && !Array.isArray(q)).map(q => {
    const clean = {
      id: str(q.id),
      type: str(q.type),
      question: String(q.question ?? ''),
      points: Number.isFinite(Number(q.points ?? 1)) ? Math.max(0, Number(q.points ?? 1)) : 1
    };
    const options = Array.isArray(q.options) ? q.options : (typeof q.options === 'string' ? safeJson(q.options, []) : []);
    clean.options = Array.isArray(options) ? options.map(x => String(x ?? '')) : [];
    for (const key of ['content_language', 'prompt_language', 'language_code', 'script_direction', 'stimulus_text', 'resource_url', 'resource_title']) {
      if (typeof q[key] === 'string') clean[key] = q[key].slice(0, 20_000);
    }
    if (typeof q.stimulus === 'string') {
      clean.stimulus = q.stimulus.slice(0, 100_000);
    } else if (q.stimulus && typeof q.stimulus === 'object' && !Array.isArray(q.stimulus)) {
      const st = {};
      for (const key of ['type', 'title', 'text', 'url']) {
        if (typeof q.stimulus[key] === 'string') st[key] = q.stimulus[key].slice(0, 100_000);
      }
      clean.stimulus = st;
    }
    for (const key of ['numeric_tolerance', 'tolerance', 'recording_duration_seconds']) {
      if (q[key] != null && Number.isFinite(Number(q[key]))) clean[key] = Number(q[key]);
    }
    return clean;
  });
}

function seededShuffle(items, seedStr) {
  const arr = [...items];
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  for (let i = arr.length - 1; i > 0; i--) {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    const j = (h >>> 0) % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildAttemptQuestionSnapshot(rawQuestions, exam = {}, attemptSeed = '') {
  const qs = Array.isArray(rawQuestions) ? rawQuestions : safeJson(rawQuestions, []);
  if (!Array.isArray(qs)) return [];
  let list = qs.map(q => ({ ...q }));
  if (Number(exam.randomize_questions) === 1 && attemptSeed) {
    list = seededShuffle(list, `${attemptSeed}:q`);
  }
  if (Number(exam.randomize_options) === 1 && attemptSeed) {
    list = list.map(q => {
      if ((q.type === 'mcq' || q.type === 'multi') && Array.isArray(q.options) && q.options.length > 1) {
        return { ...q, options: seededShuffle(q.options, `${attemptSeed}:opt:${q.id}`) };
      }
      return q;
    });
  }
  return list;
}

function assessmentScoreVisible(exam = {}, workflowState = 'graded', now = Date.now()) {
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

function normalizeValue(v) {
  return str(v).replace(/\s+/g, ' ').toLocaleLowerCase('vi-VN');
}

function answerEqual(q, actual) {
  const type = str(q?.type), expected = q?.answer;
  if (type === 'mcq' || type === 'truefalse') return String(actual ?? '') === String(expected ?? '');
  if (type === 'fill' || type === 'short') {
    let accepted = [];
    try {
      const x = typeof expected === 'string' ? JSON.parse(expected) : expected;
      accepted = Array.isArray(x) ? x : [x];
    } catch {
      accepted = String(expected ?? '').split('|');
    }
    return accepted.some(x => normalizeValue(x) === normalizeValue(actual));
  }
  if (type === 'numeric') {
    const a = Number(actual), e = Number(expected), tol = Math.max(0, Number(q.numeric_tolerance ?? q.tolerance ?? 0));
    return Number.isFinite(a) && Number.isFinite(e) && Math.abs(a - e) <= tol;
  }
  if (type === 'multi' || type === 'ordering') {
    let ex = [];
    try { ex = Array.isArray(expected) ? expected : JSON.parse(expected || '[]'); } catch {}
    const ac = Array.isArray(actual) ? actual : [];
    return type === 'multi'
      ? JSON.stringify(ac.map(String).sort()) === JSON.stringify(ex.map(String).sort())
      : JSON.stringify(ac.map(String)) === JSON.stringify(ex.map(String));
  }
  if (type === 'matching') {
    let ex = {};
    try { ex = expected && typeof expected === 'object' ? expected : JSON.parse(expected || '{}'); } catch {}
    const ac = actual && typeof actual === 'object' && !Array.isArray(actual) ? actual : {};
    const keys = Object.keys(ex);
    return keys.length > 0 && keys.every(k => String(ac[k] ?? '') === String(ex[k] ?? ''));
  }
  return false;
}

function autoScore(qs = [], answers = {}) {
  let score = 0, max = 0, manual = [];
  for (const q of qs) {
    const rawPoints = Number(q.points ?? 1), pts = Number.isFinite(rawPoints) ? Math.max(0, rawPoints) : 1;
    max += pts;
    if (MANUAL_TYPES.has(str(q.type))) {
      manual.push(q);
      continue;
    }
    if (answerEqual(q, answers[q.id])) score += pts;
  }
  return { score, max, manual };
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

// =============================================================================
// STANDALONE SCHEMA AUTO-INITIALIZER (Idempotent for Additive Tables)
// =============================================================================
const ensuredDbs = new WeakSet();
async function ensureAdditiveSchema(env) {
  if (!env?.DB || ensuredDbs.has(env.DB)) return;
  try {
    const ddl = [
      `CREATE TABLE IF NOT EXISTS exam_otp_challenges(id TEXT PRIMARY KEY,email TEXT NOT NULL,purpose TEXT NOT NULL,scope_id TEXT DEFAULT '',otp_hash TEXT NOT NULL,attempts INTEGER DEFAULT 0,max_attempts INTEGER DEFAULT 5,expires_at TEXT NOT NULL,used_at TEXT,verified_token_hash TEXT,verified_expires_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS exam_admin_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,email TEXT NOT NULL,roles_json TEXT NOT NULL,csrf_token TEXT NOT NULL,expires_at TEXT NOT NULL,revoked_at TEXT,last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS exam_question_bank(id TEXT PRIMARY KEY,code TEXT,topic TEXT DEFAULT 'Chung',difficulty TEXT DEFAULT 'medium',tags_json TEXT DEFAULT '[]',type TEXT NOT NULL,question TEXT NOT NULL,options_json TEXT DEFAULT '[]',answer_json TEXT,explanation TEXT DEFAULT '',points REAL DEFAULT 1,stimulus_json TEXT,content_language TEXT DEFAULT 'vi',script_direction TEXT DEFAULT 'ltr',numeric_tolerance REAL,recording_duration_seconds INTEGER,version INTEGER DEFAULT 1,status TEXT DEFAULT 'active',created_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS exam_question_versions(id TEXT PRIMARY KEY,question_id TEXT NOT NULL,version INTEGER NOT NULL,snapshot_json TEXT NOT NULL,changed_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS exam_enrollments(id TEXT PRIMARY KEY,exam_id TEXT NOT NULL,user_id TEXT,email TEXT NOT NULL,full_name TEXT NOT NULL,candidate_code TEXT NOT NULL,class_name TEXT DEFAULT '',status TEXT DEFAULT 'active',verified_at TEXT,notes TEXT DEFAULT '',created_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(exam_id,email))`,
      `CREATE TABLE IF NOT EXISTS exam_appeals(id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL,exam_id TEXT NOT NULL,candidate_email TEXT,candidate_code TEXT,reason TEXT NOT NULL,status TEXT DEFAULT 'pending',resolution_note TEXT DEFAULT '',score_before REAL,score_after REAL,resolved_by TEXT,resolved_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS exam_support_requests(id TEXT PRIMARY KEY,exam_id TEXT,attempt_id TEXT,candidate_name TEXT,candidate_email TEXT,candidate_code TEXT,issue_type TEXT DEFAULT 'technical',message TEXT NOT NULL,status TEXT DEFAULT 'open',resolution_note TEXT DEFAULT '',resolved_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS exam_rate_limits(bucket_key TEXT PRIMARY KEY,count INTEGER DEFAULT 1,window_start_ms INTEGER NOT NULL)`
    ];
    for (const stmt of ddl) {
      await env.DB.prepare(stmt).run().catch(() => {});
    }
    // Additive columns on existing tables (fail silently if column already exists or table is mocked)
    const alters = [
      `ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'candidate'`,
      `ALTER TABLE users ADD COLUMN roles_json TEXT DEFAULT '["candidate"]'`,
      `ALTER TABLE exams ADD COLUMN public_token TEXT`,
      `ALTER TABLE exams ADD COLUMN public_access INTEGER DEFAULT 0`,
      `ALTER TABLE exams ADD COLUMN require_email_verify INTEGER DEFAULT 0`,
      `ALTER TABLE exams ADD COLUMN opens_at TEXT`,
      `ALTER TABLE exams ADD COLUMN max_attempts INTEGER DEFAULT 1`,
      `ALTER TABLE exams ADD COLUMN passing_score REAL DEFAULT 0`,
      `ALTER TABLE exams ADD COLUMN violation_threshold INTEGER DEFAULT 0`,
      `ALTER TABLE exams ADD COLUMN randomize_questions INTEGER DEFAULT 0`,
      `ALTER TABLE exams ADD COLUMN randomize_options INTEGER DEFAULT 0`,
      `ALTER TABLE exam_attempts ADD COLUMN lock_reason TEXT`,
      `ALTER TABLE exam_attempts ADD COLUMN locked_at TEXT`,
      `ALTER TABLE exam_attempts ADD COLUMN unlocked_by TEXT`,
      `ALTER TABLE exam_attempts ADD COLUMN unlocked_at TEXT`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN email TEXT`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN lock_reason TEXT`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN locked_at TEXT`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN unlocked_by TEXT`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN unlocked_at TEXT`,
      `ALTER TABLE assessment_result_workflows ADD COLUMN approved_by TEXT`,
      `ALTER TABLE assessment_result_workflows ADD COLUMN approved_at TEXT`,
      `ALTER TABLE assessment_result_workflows ADD COLUMN published_by TEXT`,
      `ALTER TABLE assessment_result_workflows ADD COLUMN published_at TEXT`,
      `ALTER TABLE assessment_result_workflows ADD COLUMN revoked_by TEXT`,
      `ALTER TABLE assessment_result_workflows ADD COLUMN revoked_at TEXT`,
      `ALTER TABLE assessment_result_workflows ADD COLUMN revoke_reason TEXT`
    ];
    for (const sql of alters) {
      await env.DB.prepare(sql).run().catch(() => {});
    }
    ensuredDbs.add(env.DB);
  } catch {
    // Allow partial mock DBs in unit tests
  }
}

async function checkRateLimit(env, key, maxRequests = 10, windowMs = 60_000) {
  await ensureAdditiveSchema(env);
  const now = Date.now();
  try {
    const existing = await env.DB.prepare(`SELECT count, window_start_ms FROM exam_rate_limits WHERE bucket_key=?`).bind(key).first();
    if (!existing || now - Number(existing.window_start_ms) >= windowMs) {
      await env.DB.prepare(`INSERT INTO exam_rate_limits(bucket_key, count, window_start_ms) VALUES(?, 1, ?) ON CONFLICT(bucket_key) DO UPDATE SET count=1, window_start_ms=excluded.window_start_ms`).bind(key, now).run();
      return true;
    }
    if (Number(existing.count) >= maxRequests) {
      throw httpError('Bạn đã gửi quá nhiều yêu cầu. Vui lòng đợi ít phút trước khi thử lại.', 429, { code: 'RATE_LIMITED', retry_after_seconds: Math.ceil((windowMs - (now - Number(existing.window_start_ms))) / 1000) });
    }
    await env.DB.prepare(`UPDATE exam_rate_limits SET count = count + 1 WHERE bucket_key=?`).bind(key).run();
    return true;
  } catch (err) {
    if (err?.status === 429) throw err;
    return true;
  }
}

async function recordAudit(env, { examId = null, attemptId = null, actorUserId = null, eventType, detail = {} }) {
  try {
    await env.DB.prepare(
      `INSERT INTO exam_audit_log(id, exam_id, attempt_id, actor_user_id, event_type, detail_json) VALUES(?, ?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), examId, attemptId, actorUserId, eventType, JSON.stringify({ ...detail, at: nowIso() })).run();
  } catch {}
}

// =============================================================================
// EMAIL DELIVERY SERVICE (Honest Verification, Never Fake-Success on Unconfigured)
// =============================================================================
async function dispatchBusinessEmail(env, { to, subject, text, html, category = 'transactional' }) {
  // Never log OTP or secret content
  if (typeof env?.EMAIL_DISPATCHER === 'function') {
    const res = await env.EMAIL_DISPATCHER({ to, subject, text, html, category });
    return { delivered: true, provider: 'custom_dispatcher', id: res?.id || null };
  }
  const apiUrl = str(env?.EMAIL_API_URL);
  const apiKey = str(env?.EMAIL_API_KEY);
  const fromEmail = str(env?.EMAIL_FROM || 'no-reply@exam.skyfirst.io.vn');
  if (apiUrl && apiKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [to],
          subject,
          text,
          html
        }),
        signal: controller.signal
      });
      if (!resp.ok) {
        throw httpError('Dịch vụ gửi email trả về lỗi.', 502, { code: 'EMAIL_PROVIDER_ERROR', status: resp.status });
      }
      return { delivered: true, provider: 'http_api' };
    } catch (err) {
      if (err?.status) throw err;
      throw httpError('Không thể kết nối dịch vụ gửi email.', 502, { code: 'EMAIL_NETWORK_ERROR' });
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    delivered: false,
    provider: 'unconfigured',
    reason: 'Chưa cấu hình dịch vụ gửi email (EMAIL_API_URL / EMAIL_API_KEY) trong môi trường hiện tại.'
  };
}

// =============================================================================
// ATTEMPT LEASE, AUTHORIZATION, SAVE, SUBMIT & VIOLATION
// =============================================================================
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
  return finalResponse(env, fresh);
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
      questions: publicQuestions(a.question_json)
    },
    candidate: candidateFrom(a, source),
    answers: safeJson(a.answers_json, {}),
    events: safeJson(a.event_log_json, []),
    remaining_seconds: deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : null,
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

function safeName(name = 'file') {
  return String(name).normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 100) || 'file';
}

function mimeAllowed(file, type, bytes) {
  const mime = str(file.type).toLowerCase(), head = [...bytes.slice(0, 12)];
  const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
  const isJpg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isPng = head.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10';
  const isWebp = String.fromCharCode(...head.slice(0, 4)) === 'RIFF' && String.fromCharCode(...head.slice(8, 12)) === 'WEBP';
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  const isMp3 = (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
  const isMp4 = String.fromCharCode(...head.slice(4, 8)) === 'ftyp';
  const isWebm = head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  const isOgg = String.fromCharCode(...head.slice(0, 4)) === 'OggS';
  const isWav = String.fromCharCode(...head.slice(0, 4)) === 'RIFF' && String.fromCharCode(...head.slice(8, 12)) === 'WAVE';
  if (type === 'image') return (mime.startsWith('image/jpeg') && isJpg) || (mime.startsWith('image/png') && isPng) || (mime.startsWith('image/webp') && isWebp);
  if (type === 'audio') return (mime.includes('mpeg') && isMp3) || ((mime.includes('mp4') || mime.includes('m4a')) && isMp4) || (mime.includes('wav') && isWav) || (mime.includes('webm') && isWebm) || ((mime.includes('ogg') || mime.includes('opus')) && isOgg);
  return isPdf || isJpg || isPng || isWebp || isZip || isMp3 || isMp4 || mime.startsWith('text/plain') || mime.startsWith('text/csv');
}

async function uploadAttachment(env, source, attemptId, request) {
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
      center_label: e.center_label || 'TRUNG TÂM KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST',
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
      center_label: e.center_label || 'TRUNG TÂM KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST',
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

  // Cooldown check (60 seconds between sends)
  const recent = await env.DB.prepare(
    `SELECT created_at FROM exam_otp_challenges WHERE email=? AND purpose='candidate_verify' AND scope_id=? ORDER BY created_at DESC LIMIT 1`
  ).bind(email, e.id).first();
  if (recent) {
    const elapsed = Date.now() - databaseTimeMs(recent.created_at);
    if (Number.isFinite(elapsed) && elapsed < 55_000) {
      return bad('Vui lòng đợi 60 giây trước khi yêu cầu gửi lại mã xác minh.', 429, { code: 'OTP_COOLDOWN' });
    }
  }

  // Anti-enumeration check: if exam is restricted to enrolled candidates only (public_access === 0),
  // check enrollment silently or return uniform response if not enrolled.
  const enrollmentCountRow = await env.DB.prepare(`SELECT COUNT(*) n FROM exam_enrollments WHERE exam_id=?`).bind(e.id).first().catch(() => ({ n: 0 }));
  const hasEnrollmentList = Number(enrollmentCountRow?.n || 0) > 0 || Number(e.public_access ?? 1) === 0;
  let enrolled = null;
  if (hasEnrollmentList) {
    enrolled = await env.DB.prepare(`SELECT * FROM exam_enrollments WHERE exam_id=? AND LOWER(email)=? AND status='active'`).bind(e.id, email).first();
    if (!enrolled && Number(e.public_access ?? 1) === 0) {
      // Uniform message to prevent account enumeration, while recording audit event
      await recordAudit(env, { examId: e.id, eventType: 'candidate.otp.unlisted_email', detail: { email_domain: email.split('@')[1] || '' } });
      return bad('Email chưa nằm trong danh sách đủ điều kiện dự thi hoặc kỳ thi yêu cầu ghi danh trước.', 403, { code: 'ELIGIBILITY_REQUIRED' });
    }
  }

  const otp = randomOtp6();
  const otpHash = await sha256Text(`${email}:${e.id}:${otp}`);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const challengeId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO exam_otp_challenges(id,email,purpose,scope_id,otp_hash,attempts,max_attempts,expires_at,created_at) VALUES(?,?,'candidate_verify',?,?,0,5,?,CURRENT_TIMESTAMP)`
  ).bind(challengeId, email, e.id, otpHash, expiresAt).run();

  const mailResult = await dispatchBusinessEmail(env, {
    to: email,
    subject: `[Sky First EXAM] Mã xác minh dự thi: ${e.title}`,
    text: `Mã xác minh dự thi của bạn cho kỳ thi "${e.title}" là: ${otp}. Mã có hiệu lực trong 10 phút và chỉ sử dụng một lần.`,
    html: `<p>Xin chào,</p><p>Mã xác minh dự thi của bạn cho kỳ thi <b>${e.title}</b> là: <strong style="font-size:18px">${otp}</strong></p><p>Mã có hiệu lực trong 10 phút và chỉ sử dụng một lần.</p>`
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

async function lookupPublicResult(env, request) {
  await ensureAdditiveSchema(env);
  const body = await readJsonBody(request, 16_384);
  const receiptCode = str(body.receipt_code).toUpperCase();
  const candidateCode = str(body.candidate_code);
  if (!receiptCode || !candidateCode) {
    return bad('Vui lòng nhập đầy đủ Mã biên nhận và Mã thí sinh để tra cứu.', 400);
  }
  await checkRateLimit(env, `result_lookup:${receiptCode}`, 15, 60_000);

  const rec = await env.DB.prepare(`SELECT * FROM assessment_receipts WHERE UPPER(receipt_code)=?`).bind(receiptCode).first();
  if (!rec) return bad('Không tìm thấy biên nhận phù hợp với thông tin đã nhập.', 404);

  let attempt = await env.DB.prepare(
    `SELECT a.*, e.title, e.show_score, e.result_policy, e.result_release_at, e.closes_at, e.status exam_status, e.passing_score, COALESCE(a.question_snapshot_json, e.question_json) question_json, 'guest' source FROM exam_guest_attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=? AND LOWER(a.candidate_code)=LOWER(?)`
  ).bind(rec.attempt_id, candidateCode).first();

  if (!attempt) {
    attempt = await env.DB.prepare(
      `SELECT a.*, u.full_name, u.sfn_id candidate_code, c.name class_name, e.title, e.show_score, e.result_policy, e.result_release_at, e.closes_at, e.status exam_status, e.passing_score, COALESCE(a.question_snapshot_json, e.question_json) question_json, 'internal' source FROM exam_attempts a JOIN users u ON u.id=a.user_id JOIN exams e ON e.id=a.exam_id LEFT JOIN classes c ON c.id=e.class_id WHERE a.id=? AND LOWER(u.sfn_id)=LOWER(?)`
    ).bind(rec.attempt_id, candidateCode).first();
  }
  if (!attempt) return bad('Không tìm thấy biên nhận phù hợp với thông tin đã nhập.', 404);

  const f = await finalResponse(env, attempt);
  const passed = f.show_score && f.score != null && Number(attempt.passing_score || 0) > 0
    ? Number(f.score) >= Number(attempt.passing_score)
    : null;

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
      show_score: f.show_score,
      score: f.score,
      max_score: f.max_score,
      passing_score: attempt.passing_score || 0,
      passed,
      pending_manual: f.pending_manual
    }
  });
}

async function submitPublicAppeal(env, request) {
  await ensureAdditiveSchema(env);
  const body = await readJsonBody(request, 32_768);
  const receiptCode = str(body.receipt_code).toUpperCase();
  const candidateCode = str(body.candidate_code);
  const candidateEmail = str(body.email).toLowerCase();
  const reason = str(body.reason).slice(0, 4000);
  if (!receiptCode || !candidateCode || !reason || reason.length < 10) {
    return bad('Vui lòng nhập Mã biên nhận, Mã thí sinh và Lý do phúc khảo (tối thiểu 10 ký tự).', 400);
  }
  await checkRateLimit(env, `appeal:${receiptCode}`, 5, 300_000);

  const rec = await env.DB.prepare(`SELECT * FROM assessment_receipts WHERE UPPER(receipt_code)=?`).bind(receiptCode).first();
  if (!rec) return bad('Thông tin biên nhận không hợp lệ.', 404);

  let attempt = await env.DB.prepare(`SELECT id, exam_id, score, candidate_code FROM exam_guest_attempts WHERE id=? AND LOWER(candidate_code)=LOWER(?)`).bind(rec.attempt_id, candidateCode).first();
  if (!attempt) {
    attempt = await env.DB.prepare(`SELECT a.id, a.exam_id, a.score, u.sfn_id candidate_code FROM exam_attempts a JOIN users u ON u.id=a.user_id WHERE a.id=? AND LOWER(u.sfn_id)=LOWER(?)`).bind(rec.attempt_id, candidateCode).first();
  }
  if (!attempt) return bad('Thông tin biên nhận và mã thí sinh không khớp.', 404);

  const existing = await env.DB.prepare(`SELECT id FROM exam_appeals WHERE attempt_id=? AND status IN ('pending','reviewing')`).bind(attempt.id).first();
  if (existing) return bad('Yêu cầu phúc khảo cho bài thi này đang được xử lý.', 409);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO exam_appeals(id,attempt_id,exam_id,candidate_email,candidate_code,reason,status,score_before,created_at,updated_at) VALUES(?,?,?,?,?,?,'pending',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
  ).bind(id, attempt.id, attempt.exam_id, candidateEmail, candidateCode, reason, attempt.score).run();

  await recordAudit(env, { examId: attempt.exam_id, attemptId: attempt.id, eventType: 'appeal.submitted', detail: { appeal_id: id, candidate_code: candidateCode } });
  return ok({ appeal_id: id, status: 'pending', message: 'Đã ghi nhận đơn phúc khảo của bạn.' });
}

async function submitSupportRequest(env, request) {
  await ensureAdditiveSchema(env);
  const body = await readJsonBody(request, 32_768);
  const candidateName = str(body.full_name).slice(0, 160);
  const candidateEmail = str(body.email).toLowerCase().slice(0, 220);
  const candidateCode = str(body.candidate_code).slice(0, 100);
  const examId = str(body.exam_id).slice(0, 100) || null;
  const attemptId = str(body.attempt_id).slice(0, 100) || null;
  const issueType = str(body.issue_type || 'technical').slice(0, 60);
  const message = str(body.message).slice(0, 4000);
  if (!candidateName || !message) {
    return bad('Vui lòng nhập họ tên và nội dung cần hỗ trợ.', 400);
  }
  await checkRateLimit(env, `support:${candidateCode || candidateEmail || 'anon'}`, 5, 300_000);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO exam_support_requests(id,exam_id,attempt_id,candidate_name,candidate_email,candidate_code,issue_type,message,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'open',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
  ).bind(id, examId, attemptId, candidateName, candidateEmail, candidateCode, issueType, message).run();
  await recordAudit(env, { examId, attemptId, eventType: 'support.requested', detail: { support_id: id, issue_type: issueType } });
  return ok({ support_id: id, status: 'open', message: 'Yêu cầu hỗ trợ đã được chuyển tới hội đồng coi thi.' });
}

// =============================================================================
// ADMIN AUTHENTICATION, RBAC & SESSION MANAGEMENT (/api/admin/*)
// =============================================================================
function parseUserRoles(user) {
  if (!user) return [];
  const list = safeJson(user.roles_json, []);
  const roles = new Set(Array.isArray(list) ? list.map(String) : []);
  if (user.role && user.role !== 'candidate') roles.add(String(user.role));
  return [...roles].filter(r => ADMIN_ROLES.includes(r));
}

function hasAdminPermission(roles, requiredPerm) {
  if (!requiredPerm) return roles.length > 0;
  for (const r of roles) {
    const perms = ROLE_PERMISSIONS[r];
    if (perms && (perms.has('*') || perms.has(requiredPerm))) return true;
  }
  return false;
}

async function authorizeAdmin(env, request, requiredPermission = null) {
  await ensureAdditiveSchema(env);
  const cookies = parseCookies(request);
  const rawToken = bearerToken(request) || str(cookies.exam_admin_session);
  if (!rawToken) throw httpError('Vui lòng đăng nhập tài khoản quản trị để tiếp tục.', 401, { code: 'ADMIN_AUTH_REQUIRED' });

  const tokenHash = await sha256Text(rawToken);
  const session = await env.DB.prepare(
    `SELECT s.*, u.full_name, u.status user_status, u.role user_role, u.roles_json user_roles_json FROM exam_admin_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL`
  ).bind(tokenHash).first();

  const expiresMs = databaseTimeMs(session?.expires_at);
  if (!session || session.user_status !== 'active' || !Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
    throw httpError('Phiên quản trị không hợp lệ hoặc đã hết hạn.', 401, { code: 'ADMIN_SESSION_EXPIRED' });
  }

  // Enforce CSRF token AND Origin/Referer validation on mutating requests when authenticated via Cookie
  const method = request.method.toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !bearerToken(request)) {
    const reqOrigin = new URL(request.url).origin;
    const originHeader = str(request.headers.get('origin'));
    const refererHeader = str(request.headers.get('referer'));
    if (originHeader && originHeader !== reqOrigin) {
      throw httpError('Nguồn yêu cầu (Origin) không hợp lệ (chống giả mạo CSRF).', 403, { code: 'CSRF_ORIGIN_MISMATCH' });
    }
    if (!originHeader && refererHeader && !refererHeader.startsWith(reqOrigin)) {
      throw httpError('Nguồn tham chiếu (Referer) không hợp lệ (chống giả mạo CSRF).', 403, { code: 'CSRF_REFERER_MISMATCH' });
    }
    const csrfHeader = str(request.headers.get('x-csrf-token'));
    if (!csrfHeader || !timingSafeStringEqual(csrfHeader, session.csrf_token)) {
      throw httpError('Xác thực chống giả mạo yêu cầu (CSRF) không hợp lệ.', 403, { code: 'CSRF_INVALID' });
    }
  }

  const roles = parseUserRoles({ role: session.user_role, roles_json: session.user_roles_json || session.roles_json });
  if (!roles.length) {
    throw httpError('Tài khoản của bạn đã bị thu hồi quyền quản trị.', 403, { code: 'ADMIN_ROLE_REVOKED' });
  }
  if (requiredPermission && !hasAdminPermission(roles, requiredPermission)) {
    throw httpError('Bạn không có quyền thực hiện nghiệp vụ quản trị này.', 403, {
      code: 'INSUFFICIENT_PERMISSION',
      required: requiredPermission,
      roles
    });
  }

  await env.DB.prepare(`UPDATE exam_admin_sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE token_hash=?`).bind(tokenHash).run().catch(() => {});
  return {
    user_id: session.user_id,
    email: session.email,
    full_name: session.full_name || session.email,
    roles,
    csrf_token: session.csrf_token,
    token_hash: tokenHash
  };
}

async function adminBootstrap(env, request) {
  await ensureAdditiveSchema(env);
  const setupToken = str(env?.ADMIN_BOOTSTRAP_TOKEN || env?.SETUP_TOKEN);
  if (!setupToken) {
    return bad('Chức năng khởi tạo quản trị viên đầu tiên đang tắt (chưa cấu hình ADMIN_BOOTSTRAP_TOKEN).', 403, { code: 'BOOTSTRAP_DISABLED' });
  }
  await checkRateLimit(env, 'admin_bootstrap_attempt', 5, 10 * 60 * 1000);
  const body = await readJsonBody(request, 16_384);
  const email = str(body.email).toLowerCase();
  const existingAdmins = (await env.DB.prepare(`SELECT id, email, role, roles_json FROM users WHERE status='active'`).all())?.results || [];
  const activeSysAdmins = existingAdmins.filter(u => parseUserRoles(u).includes('system_admin'));
  if (activeSysAdmins.length > 0 && !activeSysAdmins.some(u => str(u.email).toLowerCase() === email)) {
    await recordAudit(env, { eventType: 'admin.bootstrap.locked', detail: { reason: 'system_admin_already_exists', attempted_email: email } });
    return bad('Hệ thống đã có Quản trị viên hệ thống (system_admin) đang hoạt động. Chức năng khởi tạo lần đầu đã tự động khóa để bảo mật.', 409, { code: 'BOOTSTRAP_ALREADY_COMPLETED' });
  }
  if (!timingSafeStringEqual(str(body.bootstrap_token), setupToken)) {
    await recordAudit(env, { eventType: 'admin.bootstrap.failed', detail: { reason: 'invalid_token' } });
    return bad('Mã khởi tạo hệ thống không chính xác.', 403, { code: 'INVALID_BOOTSTRAP_TOKEN' });
  }
  const fullName = str(body.full_name || 'Quản trị viên Hệ thống Sky First').slice(0, 160);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return bad('Địa chỉ email quản trị viên không hợp lệ.', 400);
  }
  const roles = Array.isArray(body.roles) && body.roles.length
    ? body.roles.filter(r => ADMIN_ROLES.includes(r))
    : ['system_admin'];
  if (!roles.length) return bad('Vai trò quản trị không hợp lệ.', 400);

  let user = await env.DB.prepare(`SELECT * FROM users WHERE LOWER(email)=?`).bind(email).first();
  const userId = user?.id || `admin-${crypto.randomUUID().slice(0, 8)}`;
  if (user) {
    await env.DB.prepare(`UPDATE users SET full_name=?, status='active', role=?, roles_json=? WHERE id=?`).bind(fullName, roles[0], JSON.stringify(roles), userId).run();
  } else {
    await env.DB.prepare(`INSERT INTO users(id,full_name,sfn_id,email,status,role,roles_json) VALUES(?,?,?,?,?,?,?)`).bind(userId, fullName, `ADM-${userId.slice(-4).toUpperCase()}`, email, 'active', roles[0], JSON.stringify(roles)).run();
  }
  const sessionToken = randomHex(32);
  const sessionHash = await sha256Text(sessionToken);
  const csrfToken = randomHex(24);
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO exam_admin_sessions(token_hash,user_id,email,roles_json,csrf_token,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
  ).bind(sessionHash, userId, email, JSON.stringify(roles), csrfToken, expiresAt).run();
  await recordAudit(env, { actorUserId: userId, eventType: 'admin.bootstrap.provisioned', detail: { email, roles } });
  return ok(
    {
      user_id: userId,
      email,
      full_name: fullName,
      roles,
      admin_token: sessionToken,
      csrf_token: csrfToken,
      expires_at: expiresAt,
      user: { id: userId, email, full_name: fullName, roles }
    },
    200,
    {
      'set-cookie': `exam_admin_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`
    }
  );
}

async function requestAdminOtp(env, request) {
  await ensureAdditiveSchema(env);
  const body = await readJsonBody(request, 16_384);
  const email = str(body.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return bad('Vui lòng nhập địa chỉ email quản trị hợp lệ.', 400);
  }
  await checkRateLimit(env, `admin_otp_req:${email}`, 5, 10 * 60 * 1000);

  // Check cooldown
  const recent = await env.DB.prepare(
    `SELECT created_at FROM exam_otp_challenges WHERE email=? AND purpose='admin_login' ORDER BY created_at DESC LIMIT 1`
  ).bind(email).first();
  if (recent) {
    const elapsed = Date.now() - databaseTimeMs(recent.created_at);
    if (Number.isFinite(elapsed) && elapsed < 55_000) {
      return bad('Vui lòng đợi 60 giây trước khi yêu cầu gửi lại OTP quản trị.', 429, { code: 'OTP_COOLDOWN' });
    }
  }

  // Strictly verify user is provisioned in DB with active status and valid admin role
  // Never grant access just because email looks familiar (Article 10)
  const user = await env.DB.prepare(`SELECT * FROM users WHERE LOWER(email)=? AND status='active'`).bind(email).first();
  const roles = parseUserRoles(user);
  if (!user || !roles.length) {
    await recordAudit(env, { eventType: 'admin.otp.denied', detail: { email_domain: email.split('@')[1] || '' } });
    return bad('Tài khoản email này chưa được cấp quyền quản trị trên hệ thống EXAM.', 403, { code: 'ADMIN_NOT_PROVISIONED' });
  }

  const otp = randomOtp6();
  const otpHash = await sha256Text(`admin:${email}:${otp}`);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const challengeId = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO exam_otp_challenges(id,email,purpose,scope_id,otp_hash,attempts,max_attempts,expires_at,created_at) VALUES(?,?,'admin_login','admin',?,0,5,?,CURRENT_TIMESTAMP)`
  ).bind(challengeId, email, otpHash, expiresAt).run();

  const mailResult = await dispatchBusinessEmail(env, {
    to: email,
    subject: `[Sky First EXAM] Mã OTP đăng nhập Quản trị (/admin)`,
    text: `Mã OTP đăng nhập hệ thống quản trị EXAM của bạn là: ${otp}. Mã có hiệu lực trong 5 phút và chỉ dùng một lần.`,
    html: `<p>Xin chào <b>${user.full_name || email}</b>,</p><p>Mã OTP đăng nhập hệ thống quản trị EXAM của bạn là: <strong style="font-size:18px">${otp}</strong></p><p>Mã có hiệu lực trong 5 phút và chỉ dùng một lần. Tuyệt đối không chia sẻ mã này.</p>`
  });

  await recordAudit(env, {
    actorUserId: user.id,
    eventType: 'admin.otp.requested',
    detail: { challenge_id: challengeId, delivered: mailResult.delivered, provider: mailResult.provider }
  });

  if (!mailResult.delivered) {
    return json({
      ok: false,
      code: 'EMAIL_SERVICE_UNCONFIGURED',
      message: 'Dịch vụ gửi email OTP chưa được cấu hình trong môi trường hiện tại.',
      detail: { code: 'EMAIL_SERVICE_UNCONFIGURED', reason: mailResult.reason }
    }, 503);
  }

  return ok({
    sent: true,
    expires_in_seconds: 300,
    message: 'Mã OTP quản trị đã được gửi tới email của bạn.'
  });
}

async function verifyAdminOtp(env, request) {
  await ensureAdditiveSchema(env);
  const body = await readJsonBody(request, 16_384);
  const email = str(body.email).toLowerCase();
  const otp = str(body.otp || body.code);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(otp)) {
    return bad('Email hoặc mã OTP 6 chữ số không hợp lệ.', 400);
  }
  await checkRateLimit(env, `admin_otp_verify:${email}`, 8, 10 * 60 * 1000);

  const user = await env.DB.prepare(`SELECT * FROM users WHERE LOWER(email)=? AND status='active'`).bind(email).first();
  const roles = parseUserRoles(user);
  if (!user || !roles.length) {
    return bad('Tài khoản không có quyền quản trị hoặc đã bị khóa.', 403);
  }

  const challenge = await env.DB.prepare(
    `SELECT * FROM exam_otp_challenges WHERE email=? AND purpose='admin_login' AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`
  ).bind(email).first();

  const expMs = databaseTimeMs(challenge?.expires_at);
  if (!challenge || !Number.isFinite(expMs) || expMs <= Date.now()) {
    return bad('Mã OTP không tồn tại hoặc đã hết hạn. Vui lòng yêu cầu mã mới.', 401, { code: 'OTP_EXPIRED' });
  }
  if (Number(challenge.attempts || 0) >= Number(challenge.max_attempts || 5)) {
    return bad('Đã vượt quá số lần thử OTP tối đa. Vui lòng yêu cầu mã mới.', 429, { code: 'OTP_MAX_ATTEMPTS' });
  }

  const expectedHash = await sha256Text(`admin:${email}:${otp}`);
  if (expectedHash !== challenge.otp_hash) {
    await env.DB.prepare(`UPDATE exam_otp_challenges SET attempts = attempts + 1 WHERE id=?`).bind(challenge.id).run();
    await recordAudit(env, { actorUserId: user.id, eventType: 'admin.login.failed', detail: { reason: 'wrong_otp' } });
    return bad('Mã OTP không chính xác.', 401, { code: 'OTP_INVALID' });
  }

  const claim = await env.DB.prepare(`UPDATE exam_otp_challenges SET used_at=CURRENT_TIMESTAMP WHERE id=? AND used_at IS NULL`).bind(challenge.id).run();
  if (!Number(claim?.meta?.changes || 0)) {
    return bad('Mã OTP này đã được sử dụng.', 409, { code: 'OTP_ALREADY_USED' });
  }

  const sessionToken = randomHex(32);
  const sessionHash = await sha256Text(sessionToken);
  const csrfToken = randomHex(24);
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO exam_admin_sessions(token_hash,user_id,email,roles_json,csrf_token,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
  ).bind(sessionHash, user.id, email, JSON.stringify(roles), csrfToken, expiresAt).run();

  await recordAudit(env, { actorUserId: user.id, eventType: 'admin.login.success', detail: { roles } });

  const cookieHeader = `exam_admin_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`;
  return ok({
    admin_token: sessionToken,
    csrf_token: csrfToken,
    expires_at: expiresAt,
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      roles
    }
  }, { 'set-cookie': cookieHeader });
}

async function logoutAdmin(env, request) {
  const admin = await authorizeAdmin(env, request);
  await env.DB.prepare(`UPDATE exam_admin_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?`).bind(admin.token_hash).run();
  await recordAudit(env, { actorUserId: admin.user_id, eventType: 'admin.logout', detail: {} });
  return ok({ logged_out: true }, { 'set-cookie': 'exam_admin_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
}

// =============================================================================
// ADMIN DASHBOARD (Real Database Aggregations — Zero Mock Numbers)
// =============================================================================
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
  const centerLabel = str(body.center_label ?? existing?.center_label ?? 'TRUNG TÂM KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST');
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
  await authorizeAdmin(env, request, 'questions:read');
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
  const userId = user?.id || `usr-${crypto.randomUUID().slice(0, 8)}`;
  if (!user) {
    await env.DB.prepare(`INSERT INTO users(id,full_name,sfn_id,email,status) VALUES(?,?,?,?,'active')`).bind(userId, fullName || email, candidateCode, email).run();
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
      observed_signal_count: focusEvents.length,
      recent_signals: focusEvents.slice(-5)
    };
  });

  const supportRequests = (await env.DB.prepare(`SELECT * FROM exam_support_requests ORDER BY created_at DESC LIMIT 50`).all().catch(() => ({ results: [] })))?.results || [];

  return ok({
    attempts,
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
  if (action === 'release_lease') {
    await env.DB.prepare(`DELETE FROM assessment_attempt_leases WHERE attempt_id=?`).bind(attemptId).run();
    await recordAudit(env, { examId: row.exam_id, attemptId, actorUserId: admin.user_id, eventType: 'attempt.lease_released', detail: { reason, source } });
    return ok({ attempt_id: attemptId, lease_released: true });
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
  const status = ['reviewing', 'resolved', 'rejected'].includes(str(body.status)) ? str(body.status) : 'resolved';
  const resolutionNote = str(body.resolution_note).slice(0, 4000);
  if (!resolutionNote) return bad('Vui lòng nhập kết luận giải quyết phúc khảo.', 400);

  const appeal = await env.DB.prepare(`SELECT * FROM exam_appeals WHERE id=?`).bind(appealId).first();
  if (!appeal) return bad('Không tìm thấy đơn phúc khảo.', 404);

  let newScore = appeal.score_before;
  if (body.score_after !== undefined && body.score_after !== null && body.score_after !== '') {
    newScore = Number(body.score_after);
    if (!Number.isFinite(newScore) || newScore < 0) return bad('Điểm sau phúc khảo không hợp lệ.', 400);
    await env.DB.prepare(`UPDATE exam_guest_attempts SET score=? WHERE id=?`).bind(newScore, appeal.attempt_id).run();
    await env.DB.prepare(`UPDATE exam_attempts SET score=? WHERE id=?`).bind(newScore, appeal.attempt_id).run();
  }

  await env.DB.prepare(
    `UPDATE exam_appeals SET status=?, resolution_note=?, score_after=?, resolved_by=?, resolved_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`
  ).bind(status, resolutionNote, newScore, admin.user_id, appealId).run();

  await recordAudit(env, {
    examId: appeal.exam_id,
    attemptId: appeal.attempt_id,
    actorUserId: admin.user_id,
    eventType: 'appeal.resolved',
    detail: { appeal_id: appealId, status, score_before: appeal.score_before, score_after: newScore, resolution_note: resolutionNote }
  });

  return ok({ appeal_id: appealId, status, score_before: appeal.score_before, score_after: newScore });
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

  let user = await env.DB.prepare(`SELECT * FROM users WHERE LOWER(email)=?`).bind(email).first();
  const userId = user?.id || `usr-${crypto.randomUUID().slice(0, 8)}`;
  const primaryRole = roles[0] || 'candidate';

  if (user) {
    await env.DB.prepare(`UPDATE users SET full_name=COALESCE(NULLIF(?,''),full_name), status=?, role=?, roles_json=? WHERE id=?`).bind(fullName, status, primaryRole, JSON.stringify(roles), userId).run();
  } else {
    await env.DB.prepare(`INSERT INTO users(id,full_name,sfn_id,email,status,role,roles_json) VALUES(?,?,?,?,?,?,?)`).bind(userId, fullName || email, `SFN-${userId.slice(-4).toUpperCase()}`, email, status, primaryRole, JSON.stringify(roles)).run();
  }

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
      ...SECURITY,
      'content-type': fileRow.mime || 'application/octet-stream',
      'content-disposition': `attachment; filename="${safeName(fileRow.name)}"`
    }
  });
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
// =============================================================================
async function api(request, env) {
  const url = new URL(request.url), path = url.pathname, method = request.method.toUpperCase();
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: SECURITY });
  if (path === '/health' || path === '/api/health') return health(env);

  // 1. Public Candidate Launch & Catalog & Eligibility & Results
  if (path === '/api/public/exam-launch/redeem' && method === 'POST') return redeemLaunch(env, request);
  if (path === '/api/public/catalog' && method === 'GET') return listPublicCatalog(env);
  if (path === '/api/public/results/lookup' && method === 'POST') return lookupPublicResult(env, request);
  if (path === '/api/public/appeals' && method === 'POST') return submitPublicAppeal(env, request);
  if (path === '/api/public/support' && method === 'POST') return submitSupportRequest(env, request);

  const pubAssess = path.match(/^\/api\/public\/assessments\/([^/]+)(?:\/(request-verification|start))?$/);
  if (pubAssess) {
    const code = decodeURIComponent(pubAssess[1]), action = pubAssess[2] || '';
    if (!action && method === 'GET') return getPublicAssessmentInfo(env, code);
    if (action === 'request-verification' && method === 'POST') return requestCandidateVerification(env, code, request);
    if (action === 'start' && method === 'POST') return startPublicAssessment(env, code, request);
  }

  // 2. Guest & Internal Attempt Execution Endpoints
  const guest = path.match(/^\/api\/public\/exam-attempts\/([^/]+)(?:\/(save|submit|violation|upload|review))?$/);
  if (guest) {
    const id = decodeURIComponent(guest[1]), action = guest[2] || '';
    if (!action && method === 'GET') return getAttempt(env, 'guest', id, request);
    if (action === 'save' && method === 'POST') return saveAttempt(env, 'guest', id, request);
    if (action === 'submit' && method === 'POST') return submitAttempt(env, 'guest', id, request);
    if (action === 'violation' && method === 'POST') return recordViolation(env, 'guest', id, request);
    if (action === 'upload' && method === 'POST') return uploadAttachment(env, 'guest', id, request);
    if (action === 'review' && method === 'GET') return reviewAttempt(env, 'guest', id, request);
  }

  const internal = path.match(/^\/api\/exam-attempts\/([^/]+)(?:\/(save|submit|violation|upload|review))?$/);
  if (internal) {
    const id = decodeURIComponent(internal[1]), action = internal[2] || '';
    if (!action && method === 'GET') return getAttempt(env, 'internal', id, request);
    if (action === 'save' && method === 'POST') return saveAttempt(env, 'internal', id, request);
    if (action === 'submit' && method === 'POST') return submitAttempt(env, 'internal', id, request);
    if (action === 'violation' && method === 'POST') return recordViolation(env, 'internal', id, request);
    if (action === 'upload' && method === 'POST') return uploadAttachment(env, 'internal', id, request);
    if (action === 'review' && method === 'GET') return reviewAttempt(env, 'internal', id, request);
  }

  // 3. Admin Subsystem Endpoints (/api/admin/*)
  if (path === '/api/admin/auth/bootstrap' && method === 'POST') return adminBootstrap(env, request);
  if (path === '/api/admin/auth/request-otp' && method === 'POST') return requestAdminOtp(env, request);
  if (path === '/api/admin/auth/verify-otp' && method === 'POST') return verifyAdminOtp(env, request);
  if (path === '/api/admin/auth/logout' && method === 'POST') return logoutAdmin(env, request);
  if (path === '/api/admin/auth/me' && method === 'GET') {
    const admin = await authorizeAdmin(env, request);
    return ok({ user: admin });
  }

  if (path === '/api/admin/dashboard' && method === 'GET') return getAdminDashboard(env, request);
  if (path === '/api/admin/exams' && method === 'GET') return adminListExams(env, request);
  if (path === '/api/admin/exams' && method === 'POST') return adminCreateOrUpdateExam(env, null, request, true);

  const adminExamMatch = path.match(/^\/api\/admin\/exams\/([^/]+)(?:\/(lifecycle))?$/);
  if (adminExamMatch) {
    const examId = decodeURIComponent(adminExamMatch[1]), sub = adminExamMatch[2] || '';
    if (!sub && method === 'GET') return adminGetExam(env, examId, request);
    if (!sub && (method === 'PUT' || method === 'PATCH')) return adminCreateOrUpdateExam(env, examId, request, false);
    if (sub === 'lifecycle' && method === 'POST') return adminTransitionExamLifecycle(env, examId, request);
  }

  if (path === '/api/admin/questions' && method === 'GET') return adminListQuestionBank(env, request);
  if (path === '/api/admin/questions' && method === 'POST') return adminSaveQuestionBankItem(env, null, request, true);
  if (path === '/api/admin/questions/import' && method === 'POST') return adminImportQuestionBank(env, request);

  const adminQMatch = path.match(/^\/api\/admin\/questions\/([^/]+)$/);
  if (adminQMatch) {
    const qId = decodeURIComponent(adminQMatch[1]);
    if (method === 'PUT' || method === 'PATCH') return adminSaveQuestionBankItem(env, qId, request, false);
    if (method === 'DELETE') {
      const admin = await authorizeAdmin(env, request, 'questions:delete');
      const existing = await env.DB.prepare(`SELECT id, code, topic FROM exam_question_bank WHERE id=? AND status!='deleted'`).bind(qId).first();
      if (!existing) return bad('Không tìm thấy câu hỏi cần xóa/lưu trữ.', 404);
      await env.DB.prepare(`UPDATE exam_question_bank SET status='deleted', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(qId).run();
      await recordAudit(env, { actorUserId: admin.user_id, eventType: 'qbank.deleted', detail: { question_id: qId, code: existing.code } });
      return ok({ question_id: qId, status: 'deleted' });
    }
  }

  if (path === '/api/admin/candidates' && method === 'GET') return adminListCandidates(env, request);
  if (path === '/api/admin/candidates/enroll' && method === 'POST') return adminEnrollCandidate(env, request);
  if (path === '/api/admin/candidates/launch' && method === 'POST') return adminIssueLaunchToken(env, request);

  if (path === '/api/admin/monitor' && method === 'GET') return adminMonitorAttempts(env, request);
  const adminMonitorAction = path.match(/^\/api\/admin\/monitor\/([^/]+)\/action$/);
  if (adminMonitorAction && method === 'POST') return adminProctorAction(env, decodeURIComponent(adminMonitorAction[1]), request);

  const adminSupportResolve = path.match(/^\/api\/admin\/support\/([^/]+)\/resolve$/);
  if (adminSupportResolve && method === 'POST') {
    const supportId = decodeURIComponent(adminSupportResolve[1]);
    const admin = await authorizeAdmin(env, request, 'support:write');
    const body = await readJsonBody(request, 16_384);
    const resolutionNote = str(body.resolution_note).slice(0, 2000);
    if (!resolutionNote) return bad('Vui lòng nhập nội dung xử lý sự cố.', 400);
    const existing = await env.DB.prepare(`SELECT * FROM exam_support_requests WHERE id=?`).bind(supportId).first();
    if (!existing) return bad('Không tìm thấy yêu cầu hỗ trợ.', 404);
    await env.DB.prepare(`UPDATE exam_support_requests SET status='resolved', resolution_note=?, resolved_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(resolutionNote, admin.user_id, supportId).run();
    await recordAudit(env, { examId: existing.exam_id, attemptId: existing.attempt_id, actorUserId: admin.user_id, eventType: 'support.resolved', detail: { support_id: supportId, resolution_note: resolutionNote } });
    return ok({ support_id: supportId, status: 'resolved', resolution_note: resolutionNote });
  }

  const adminGradingMatch = path.match(/^\/api\/admin\/grading\/([^/]+)(?:\/(grade|workflow))?$/);
  if (adminGradingMatch) {
    const attemptId = decodeURIComponent(adminGradingMatch[1]), sub = adminGradingMatch[2] || '';
    if (!sub && method === 'GET') return adminGetAttemptGradingDetail(env, attemptId, request);
    if (sub === 'grade' && method === 'POST') return adminGradeManualItem(env, attemptId, request);
    if (sub === 'workflow' && method === 'POST') return adminResultWorkflowAction(env, attemptId, request);
  }

  if (path === '/api/admin/appeals' && method === 'GET') return adminListAppeals(env, request);
  const adminAppealResolve = path.match(/^\/api\/admin\/appeals\/([^/]+)\/resolve$/);
  if (adminAppealResolve && method === 'POST') return adminResolveAppeal(env, decodeURIComponent(adminAppealResolve[1]), request);

  if (path === '/api/admin/users/role' && method === 'POST') return adminManageUserRole(env, request);
  if (path === '/api/admin/audit-logs' && method === 'GET') return adminListAuditLogs(env, request);

  const adminFileMatch = path.match(/^\/api\/admin\/files\/([^/]+)$/);
  if (adminFileMatch && method === 'GET') return adminDownloadResponseFile(env, decodeURIComponent(adminFileMatch[1]), request);

  // Unknown API routes return explicit local 404 JSON — never proxy to SLC!
  if (path.startsWith('/api/')) {
    return bad('Endpoint API không tồn tại trên hệ thống EXAM độc lập.', 404, { code: 'API_NOT_FOUND', path });
  }
  return null;
}

export default {
  async fetch(request, env) {
    try {
      const apiResponse = await api(request, env);
      if (apiResponse) return withSecurity(apiResponse);
      const u = new URL(request.url);
      const isGetOrHead = ['GET', 'HEAD'].includes(request.method.toUpperCase());
      const isStaticAsset = /\.(?:js|mjs|css|webp|png|jpg|jpeg|svg|ico|json|txt|map|woff2?)$/i.test(u.pathname);
      if (isGetOrHead && !isStaticAsset && /^\/admin(?:\/|\.html|$)/.test(u.pathname)) {
        const adminHtml = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="theme-color" content="#0d2a4a" />
  <meta name="color-scheme" content="light" />
  <meta name="description" content="SKY FIRST EXAM 2026 — Phân hệ Quản trị Khảo thí Độc lập (/admin) với RBAC 10 vai trò, Ngân hàng câu hỏi, Tổ chức kỳ thi, Chấm thi, Phúc khảo và Nhật ký Kiểm toán." />
  <meta name="robots" content="noindex,nofollow" />
  <title>Quản trị Khảo thí (/admin) — SKY FIRST EXAM 2026</title>
  <link rel="icon" type="image/webp" href="/sky-first-logo.webp" />
  <link rel="apple-touch-icon" href="/sky-first-logo.webp" />
  <link rel="stylesheet" href="/styles.css?build=20261025-audit-fix-1" />
</head>
<body>
  <noscript>
    <div style="padding:18px;font-family:'Times New Roman',Times,serif;background:#fff4d6;color:#5f3dc4;border-bottom:1px solid #e5dbff">
      Phân hệ Quản trị Khảo thí SKY FIRST EXAM (/admin) yêu cầu bật JavaScript để xác thực phiên quản trị và tải dữ liệu điều hành.
    </div>
  </noscript>
  <div id="app" aria-live="polite">
    <div class="shell" style="padding-top:36px">
      <div class="card">
        <div class="badge">SKY FIRST EXAM 2026 • QUẢN TRỊ KHẢO THÍ ĐỘC LẬP</div>
        <h1 class="h1" style="margin-top:10px">Đang khởi động Phân hệ Quản trị Khảo thí (/admin)…</h1>
        <p class="sub">Hệ thống đang kiểm tra phiên làm việc quản trị viên và kết nối máy chủ khảo thí.</p>
      </div>
    </div>
  </div>
  <script type="module" src="/admin.js?build=20261025-audit-fix-1"></script>
</body>
</html>`;
        return withSecurity(new Response(request.method.toUpperCase() === 'HEAD' ? null : adminHtml, {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store, no-cache, must-revalidate'
          }
        }));
      }
      let response = await env.ASSETS.fetch(request);
      if (response.status === 404 && isGetOrHead) {
        if (/^\/(?:exam|join)(?:\/|$)/.test(u.pathname)) {
          response = await env.ASSETS.fetch(new Request(new URL('/index.html', u.origin), request));
        }
      }
      return withSecurity(response);
    } catch (error) {
      const status = Number(error?.status) || 500;
      const detail = error?.detail || undefined;
      const message = status === 401
        ? (error?.message && error.message !== 'AUTH' ? error.message : 'Quyền truy cập phiên thi hoặc phiên quản trị không hợp lệ hoặc đã hết hạn.')
        : status === 403
          ? (error?.message && error.message !== 'FORBIDDEN' ? error.message : 'Bạn không có quyền thực hiện thao tác này.')
          : error?.message === 'SESSION_REQUIRED'
            ? 'Phiên thi cần mã phiên thiết bị hợp lệ.'
            : error?.message === 'SESSION_CONFLICT'
              ? 'Phiên thi đang được sử dụng trên tab hoặc thiết bị khác.'
              : status >= 500
                ? 'Dịch vụ dự thi đang gặp sự cố. Bài lưu trên thiết bị vẫn được giữ.'
                : String(error?.message || 'Không thể xử lý yêu cầu.');
      return bad(message, status, detail);
    }
  }
};

export { autoScore, cleanEvents, mimeAllowed, publicQuestions, readJsonBody, sanitizeAnswers };
