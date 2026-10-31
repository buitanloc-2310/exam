// =============================================================================
// SKY FIRST EXAM 2026 — DATA ACCESS & REPOSITORY LAYER (src/repository.js)
// Decouples business logic from direct Cloudflare D1 queries.
// Provides:
//  - Pluggable storage driver abstraction (D1 / SQLite / Custom Data Adapter)
//  - Read-through TTL cache for high-frequency metadata & catalog queries
//  - Safe schema migration initialization (ensureAdditiveSchema)
//  - Retry & timeout protection so transient DB hiccups do not crash the app
// =============================================================================

const initializedDbs = new WeakSet();
const memoryCache = new Map();

export class CacheStore {
  constructor(defaultTtlMs = 15_000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key) {
    const entry = memoryCache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      memoryCache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    if (memoryCache.size > 500) {
      const oldest = memoryCache.keys().next().value;
      if (oldest) memoryCache.delete(oldest);
    }
    memoryCache.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  invalidatePrefix(prefix) {
    for (const k of memoryCache.keys()) {
      if (k.startsWith(prefix)) memoryCache.delete(k);
    }
  }

  clear() {
    memoryCache.clear();
  }
}

export const sharedCache = new CacheStore(10_000);

/**
 * Add the authentication/RBAC columns to an existing legacy users table.
 * CREATE TABLE IF NOT EXISTS does not upgrade an already-existing table;
 * inspect the live schema and add only the columns that are actually missing.
 */
export async function ensureUserAuthSchema(db) {
  if (!db?.prepare) throw new Error('D1 binding DB is unavailable');

  await db.prepare(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    full_name TEXT,
    sfn_id TEXT,
    email TEXT,
    status TEXT DEFAULT 'active',
    role TEXT DEFAULT 'candidate',
    roles_json TEXT DEFAULT '["candidate"]',
    class_id TEXT,
    expires_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`).run();

  const required = {
    full_name: 'TEXT',
    sfn_id: 'TEXT',
    email: 'TEXT',
    status: `TEXT DEFAULT 'active'`,
    role: `TEXT DEFAULT 'candidate'`,
    roles_json: `TEXT DEFAULT '["candidate"]'`,
    class_id: 'TEXT',
    expires_at: 'TEXT',
    created_at: 'TEXT',
    updated_at: 'TEXT'
  };

  let info = await db.prepare(`PRAGMA table_info(users)`).all();
  let columns = new Set((info?.results || []).map(column => String(column.name).toLowerCase()));
  if (!columns.has('id')) throw new Error('Bảng users hiện tại không có cột id bắt buộc.');

  for (const [name, ddl] of Object.entries(required)) {
    if (columns.has(name)) continue;
    await db.prepare(`ALTER TABLE users ADD COLUMN ${name} ${ddl}`).run();
    columns.add(name);
  }

  info = await db.prepare(`PRAGMA table_info(users)`).all();
  columns = new Set((info?.results || []).map(column => String(column.name).toLowerCase()));
  const missing = ['id', ...Object.keys(required)].filter(name => !columns.has(name));
  if (missing.length) {
    throw new Error(`Không thể hoàn thiện schema xác thực của users; thiếu cột: ${missing.join(', ')}`);
  }
  return columns;
}

export async function ensureAdditiveSchema(env) {
  if (!env?.DB?.prepare || initializedDbs.has(env.DB)) return;
  try {
    const statements = [
      `CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,full_name TEXT NOT NULL,sfn_id TEXT,email TEXT,status TEXT DEFAULT 'active',role TEXT DEFAULT 'candidate',roles_json TEXT DEFAULT '["candidate"]',class_id TEXT,expires_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS exams(id TEXT PRIMARY KEY,title TEXT NOT NULL,assessment_label TEXT,instructions TEXT,duration_minutes INTEGER DEFAULT 60,time_limit_enabled INTEGER DEFAULT 1,strict_mode INTEGER DEFAULT 1,fullscreen_required INTEGER DEFAULT 0,require_email_verify INTEGER DEFAULT 0,public_access INTEGER DEFAULT 1,public_token TEXT,show_score INTEGER DEFAULT 1,max_attempts INTEGER DEFAULT 1,passing_score REAL DEFAULT 0,result_policy TEXT DEFAULT 'score_after_submit',result_release_at TEXT,open_answers_at TEXT,security_profile TEXT DEFAULT 'STANDARD',security_level INTEGER DEFAULT 1,security_config_json TEXT DEFAULT '{}',matrix_config_json TEXT DEFAULT '{}',violation_threshold INTEGER DEFAULT 0,randomize_questions INTEGER DEFAULT 0,randomize_options INTEGER DEFAULT 0,questions_json TEXT DEFAULT '[]',question_json TEXT DEFAULT '[]',opens_at TEXT,closes_at TEXT,status TEXT DEFAULT 'draft',sealed_version_id TEXT,created_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS exam_attempts(id TEXT PRIMARY KEY,exam_id TEXT NOT NULL,user_id TEXT NOT NULL,status TEXT DEFAULT 'in_progress',started_at TEXT DEFAULT CURRENT_TIMESTAMP,last_saved_at TEXT,submitted_at TEXT,duration_minutes INTEGER DEFAULT 60,time_limit_enabled INTEGER DEFAULT 1,answers_json TEXT DEFAULT '{}',events_json TEXT DEFAULT '[]',event_log_json TEXT DEFAULT '[]',answer_revision INTEGER DEFAULT 0,score REAL,max_score REAL,extra_time_minutes INTEGER DEFAULT 0,question_snapshot_json TEXT,exam_version_id TEXT,variant_code TEXT,device_fingerprint TEXT,verification_ref TEXT,review_classification TEXT DEFAULT 'info',candidate_explanation TEXT DEFAULT '',lock_reason TEXT,locked_at TEXT,unlocked_by TEXT,unlocked_at TEXT)`,
      `CREATE TABLE IF NOT EXISTS guest_exam_attempts(id TEXT PRIMARY KEY,exam_id TEXT NOT NULL,full_name TEXT NOT NULL,email TEXT,candidate_code TEXT NOT NULL,class_name TEXT DEFAULT '',unit_name TEXT DEFAULT '',access_token_hash TEXT NOT NULL,status TEXT DEFAULT 'in_progress',started_at TEXT DEFAULT CURRENT_TIMESTAMP,last_saved_at TEXT,submitted_at TEXT,answers_json TEXT DEFAULT '{}',events_json TEXT DEFAULT '[]',answer_revision INTEGER DEFAULT 0,score REAL,max_score REAL,extra_time_minutes INTEGER DEFAULT 0,exam_version_id TEXT,question_order_json TEXT,option_orders_json TEXT)`,
      `CREATE TABLE IF NOT EXISTS exam_guest_attempts(id TEXT PRIMARY KEY,exam_id TEXT NOT NULL,status TEXT DEFAULT 'in_progress',started_at TEXT DEFAULT CURRENT_TIMESTAMP,duration_minutes INTEGER DEFAULT 60,time_limit_enabled INTEGER DEFAULT 1,extra_time_minutes INTEGER DEFAULT 0,answers_json TEXT DEFAULT '{}',event_log_json TEXT DEFAULT '[]',score REAL,max_score REAL,submitted_at TEXT,last_saved_at TEXT,answer_revision INTEGER DEFAULT 0,question_snapshot_json TEXT,exam_version_id TEXT,variant_code TEXT,device_fingerprint TEXT,verification_ref TEXT,review_classification TEXT DEFAULT 'info',candidate_explanation TEXT DEFAULT '',access_key TEXT,full_name TEXT,email TEXT,candidate_code TEXT,class_name TEXT,lock_reason TEXT,locked_at TEXT,unlocked_by TEXT,unlocked_at TEXT)`,
      `CREATE TABLE IF NOT EXISTS exam_launch_tokens(token_hash TEXT PRIMARY KEY,exam_id TEXT,user_id TEXT,attempt_id TEXT,candidate_name TEXT,candidate_code TEXT,expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS exam_access_tokens(token_hash TEXT PRIMARY KEY,attempt_id TEXT NOT NULL,user_id TEXT,source TEXT DEFAULT 'internal',expires_at TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS assessment_attempt_leases(attempt_id TEXT NOT NULL,source TEXT NOT NULL,session_id TEXT NOT NULL,device_fingerprint TEXT DEFAULT '',claimed_at TEXT DEFAULT CURRENT_TIMESTAMP,last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(attempt_id,source))`,
      `CREATE TABLE IF NOT EXISTS assessment_answer_revisions(id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL,source TEXT NOT NULL,revision INTEGER NOT NULL,answers_json TEXT NOT NULL,events_json TEXT DEFAULT '[]',accepted_at TEXT DEFAULT CURRENT_TIMESTAMP,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(attempt_id,revision))`,
      `CREATE TABLE IF NOT EXISTS assessment_receipts(id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL UNIQUE,receipt_code TEXT NOT NULL UNIQUE,payload_json TEXT DEFAULT '{}',submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,sha256 TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS assessment_exam_versions(id TEXT PRIMARY KEY,exam_id TEXT,version_number INTEGER DEFAULT 1,questions_json TEXT,snapshot_json TEXT,settings_json TEXT DEFAULT '{}',created_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS assessment_manual_grades(id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL,question_id TEXT NOT NULL,score REAL,max_score REAL,feedback TEXT DEFAULT '',grader_user_id TEXT,graded_by TEXT,status TEXT DEFAULT 'draft',graded_at TEXT DEFAULT CURRENT_TIMESTAMP,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(attempt_id,question_id))`,
      `CREATE TABLE IF NOT EXISTS assessment_result_workflows(attempt_id TEXT PRIMARY KEY,source TEXT DEFAULT 'internal',state TEXT DEFAULT 'pending_grading',approved_by TEXT,approved_at TEXT,published_by TEXT,published_at TEXT,revoked_by TEXT,revoked_at TEXT,revoke_reason TEXT,note TEXT DEFAULT '',updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS assessment_response_files(id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL,source TEXT DEFAULT 'internal',question_id TEXT NOT NULL,file_id TEXT,r2_key TEXT,file_name TEXT,mime_type TEXT,byte_size INTEGER DEFAULT 0,status TEXT DEFAULT 'active',created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,owner_user_id TEXT,r2_key TEXT NOT NULL,name TEXT NOT NULL,mime TEXT,size INTEGER DEFAULT 0,visibility TEXT DEFAULT 'private',created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS classes(id TEXT PRIMARY KEY,name TEXT NOT NULL,code TEXT,description TEXT,status TEXT DEFAULT 'active',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS exam_audit_log(id TEXT PRIMARY KEY,exam_id TEXT,attempt_id TEXT,actor_user_id TEXT,event_type TEXT NOT NULL,detail_json TEXT DEFAULT '{}',created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS exam_otp_challenges(id TEXT PRIMARY KEY,email TEXT NOT NULL,purpose TEXT NOT NULL,scope_id TEXT DEFAULT '',otp_hash TEXT NOT NULL,attempts INTEGER DEFAULT 0,max_attempts INTEGER DEFAULT 5,expires_at TEXT NOT NULL,used_at TEXT,verified_token_hash TEXT,verified_expires_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS exam_admin_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,email TEXT NOT NULL,roles_json TEXT NOT NULL,csrf_token TEXT NOT NULL,expires_at TEXT NOT NULL,revoked_at TEXT,last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS exam_question_bank(id TEXT PRIMARY KEY,code TEXT,subject TEXT DEFAULT 'Chung',topic TEXT DEFAULT 'Chung',cognitive_level TEXT DEFAULT 'understanding',difficulty TEXT DEFAULT 'medium',tags_json TEXT DEFAULT '[]',type TEXT NOT NULL,question TEXT NOT NULL,options_json TEXT DEFAULT '[]',answer_json TEXT,explanation TEXT DEFAULT '',points REAL DEFAULT 1,stimulus_json TEXT,content_language TEXT DEFAULT 'vi',script_direction TEXT DEFAULT 'ltr',numeric_tolerance REAL,recording_duration_seconds INTEGER,version INTEGER DEFAULT 1,status TEXT DEFAULT 'active',created_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS exam_question_versions(id TEXT PRIMARY KEY,question_id TEXT NOT NULL,version INTEGER NOT NULL,snapshot_json TEXT NOT NULL,changed_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS exam_enrollments(id TEXT PRIMARY KEY,exam_id TEXT NOT NULL,user_id TEXT,email TEXT NOT NULL,full_name TEXT NOT NULL,candidate_code TEXT NOT NULL,class_name TEXT DEFAULT '',status TEXT DEFAULT 'active',expires_at TEXT,verified_at TEXT,notes TEXT DEFAULT '',created_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(exam_id,email))`,
      `CREATE TABLE IF NOT EXISTS exam_identity_verifications(id TEXT PRIMARY KEY,exam_id TEXT NOT NULL,attempt_id TEXT,candidate_code TEXT NOT NULL,email TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'skyfirst_internal',reference_code TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'verified',method TEXT NOT NULL DEFAULT 'otp_and_roster',verified_at TEXT,expires_at TEXT,metadata_json TEXT DEFAULT '{}',created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS exam_appeals(id TEXT PRIMARY KEY,request_code TEXT,attempt_id TEXT NOT NULL,exam_id TEXT NOT NULL,full_name TEXT DEFAULT '',phone TEXT DEFAULT '',candidate_email TEXT,class_name TEXT DEFAULT '',candidate_code TEXT,exam_title TEXT DEFAULT '',exam_date TEXT DEFAULT '',receipt_code TEXT DEFAULT '',reason TEXT NOT NULL,evidence_files_json TEXT DEFAULT '[]',status TEXT DEFAULT 'pending',resolution_note TEXT DEFAULT '',score_before REAL,score_after REAL,resolved_by TEXT,resolved_at TEXT,history_json TEXT DEFAULT '[]',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS exam_support_requests(id TEXT PRIMARY KEY,request_code TEXT,exam_id TEXT,attempt_id TEXT,candidate_name TEXT,phone TEXT DEFAULT '',candidate_email TEXT,class_name TEXT DEFAULT '',candidate_code TEXT,exam_title TEXT DEFAULT '',exam_date TEXT DEFAULT '',occurred_at TEXT DEFAULT '',category TEXT DEFAULT 'support',issue_type TEXT DEFAULT 'technical',priority TEXT DEFAULT 'normal',message TEXT NOT NULL,steps_to_reproduce TEXT DEFAULT '',technical_meta_json TEXT DEFAULT '{}',evidence_files_json TEXT DEFAULT '[]',status TEXT DEFAULT 'open',resolution_note TEXT DEFAULT '',resolved_by TEXT,history_json TEXT DEFAULT '[]',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS exam_rate_limits(bucket_key TEXT PRIMARY KEY,count INTEGER DEFAULT 1,window_start_ms INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS exam_fraud_reports(id TEXT PRIMARY KEY,request_code TEXT NOT NULL UNIQUE,reporter_name TEXT NOT NULL,reporter_phone TEXT NOT NULL,reporter_email TEXT NOT NULL,class_name TEXT NOT NULL,exam_id TEXT,exam_title TEXT NOT NULL,exam_date TEXT NOT NULL,reported_candidate_code TEXT DEFAULT '',reported_info TEXT DEFAULT '',content TEXT NOT NULL,evidence_url TEXT DEFAULT '',evidence_files_json TEXT DEFAULT '[]',status TEXT DEFAULT 'received',resolution_note TEXT DEFAULT '',resolved_by TEXT,resolved_at TEXT,history_json TEXT DEFAULT '[]',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS exam_service_files(id TEXT PRIMARY KEY,service_type TEXT NOT NULL,request_id TEXT,r2_key TEXT NOT NULL,original_name TEXT NOT NULL,safe_name TEXT NOT NULL,mime_type TEXT NOT NULL,byte_size INTEGER NOT NULL,sha256 TEXT NOT NULL,uploaded_by_email TEXT DEFAULT '',status TEXT DEFAULT 'active',created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS exam_proctoring_events(id TEXT PRIMARY KEY,exam_id TEXT NOT NULL,attempt_id TEXT NOT NULL,source TEXT DEFAULT 'guest',candidate_code TEXT DEFAULT '',event_type TEXT NOT NULL,category TEXT DEFAULT 'browser',risk_level INTEGER DEFAULT 1,risk_label TEXT DEFAULT 'Mức 1: Cảnh báo thông thường',description TEXT NOT NULL,device_env_json TEXT DEFAULT '{}',evidence_id TEXT,status TEXT DEFAULT 'pending_review',received_by TEXT,decided_by TEXT,decision_note TEXT DEFAULT '',decided_at TEXT,occurred_at TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS exam_secondary_camera_links(pairing_code TEXT PRIMARY KEY,exam_id TEXT NOT NULL,attempt_id TEXT NOT NULL,source TEXT DEFAULT 'guest',candidate_code TEXT DEFAULT '',status TEXT DEFAULT 'pending',mobile_device_info_json TEXT DEFAULT '{}',last_heartbeat_at TEXT,last_evidence_id TEXT,expires_at TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS exam_digital_evidence(id TEXT PRIMARY KEY,exam_id TEXT NOT NULL,attempt_id TEXT NOT NULL,source TEXT DEFAULT 'guest',candidate_code TEXT DEFAULT '',event_id TEXT,evidence_type TEXT NOT NULL,r2_key TEXT NOT NULL UNIQUE,mime_type TEXT NOT NULL,byte_size INTEGER NOT NULL,sha256 TEXT NOT NULL,chain_hash TEXT NOT NULL,metadata_json TEXT DEFAULT '{}',retention_until TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS exam_email_logs(id TEXT PRIMARY KEY,idempotency_key TEXT UNIQUE,event_type TEXT NOT NULL,template_file TEXT NOT NULL,sender_address TEXT NOT NULL,recipient_email TEXT NOT NULL,subject TEXT NOT NULL,status TEXT NOT NULL,provider TEXT DEFAULT '',provider_message_id TEXT,retry_count INTEGER DEFAULT 0,error_detail TEXT DEFAULT '',exam_id TEXT,attempt_id TEXT,request_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`
    ];
    for (const sql of statements) {
      await env.DB.prepare(sql).run().catch(() => {});
    }
    const alters = [
      `ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'candidate'`,
      `ALTER TABLE users ADD COLUMN roles_json TEXT DEFAULT '["candidate"]'`,
      `ALTER TABLE users ADD COLUMN class_id TEXT`,
      `ALTER TABLE users ADD COLUMN expires_at TEXT`,
      `ALTER TABLE users ADD COLUMN created_at TEXT`,
      `ALTER TABLE users ADD COLUMN updated_at TEXT`,
      `ALTER TABLE exams ADD COLUMN opens_at TEXT`,
      `ALTER TABLE exams ADD COLUMN open_answers_at TEXT`,
      `ALTER TABLE exams ADD COLUMN public_token TEXT`,
      `ALTER TABLE exams ADD COLUMN public_access INTEGER DEFAULT 0`,
      `ALTER TABLE exams ADD COLUMN require_email_verify INTEGER DEFAULT 0`,
      `ALTER TABLE exams ADD COLUMN max_attempts INTEGER DEFAULT 1`,
      `ALTER TABLE exams ADD COLUMN passing_score REAL DEFAULT 0`,
      `ALTER TABLE exams ADD COLUMN security_level INTEGER DEFAULT 1`,
      `ALTER TABLE exams ADD COLUMN security_config_json TEXT DEFAULT '{}'`,
      `ALTER TABLE exams ADD COLUMN matrix_config_json TEXT DEFAULT '{}'`,
      `ALTER TABLE exams ADD COLUMN violation_threshold INTEGER DEFAULT 0`,
      `ALTER TABLE exams ADD COLUMN randomize_questions INTEGER DEFAULT 0`,
      `ALTER TABLE exams ADD COLUMN randomize_options INTEGER DEFAULT 0`,
      `ALTER TABLE exams ADD COLUMN created_by TEXT`,
      `ALTER TABLE exams ADD COLUMN created_at TEXT`,
      `ALTER TABLE exams ADD COLUMN updated_at TEXT`,
      `ALTER TABLE exam_attempts ADD COLUMN variant_code TEXT`,
      `ALTER TABLE exam_attempts ADD COLUMN device_fingerprint TEXT`,
      `ALTER TABLE exam_attempts ADD COLUMN verification_ref TEXT`,
      `ALTER TABLE exam_attempts ADD COLUMN review_classification TEXT DEFAULT 'info'`,
      `ALTER TABLE exam_attempts ADD COLUMN candidate_explanation TEXT DEFAULT ''`,
      `ALTER TABLE exam_attempts ADD COLUMN lock_reason TEXT`,
      `ALTER TABLE exam_attempts ADD COLUMN locked_at TEXT`,
      `ALTER TABLE exam_attempts ADD COLUMN unlocked_by TEXT`,
      `ALTER TABLE exam_attempts ADD COLUMN unlocked_at TEXT`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN email TEXT`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN variant_code TEXT`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN device_fingerprint TEXT`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN verification_ref TEXT`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN review_classification TEXT DEFAULT 'info'`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN candidate_explanation TEXT DEFAULT ''`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN lock_reason TEXT`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN locked_at TEXT`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN unlocked_by TEXT`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN unlocked_at TEXT`,
      `ALTER TABLE assessment_attempt_leases ADD COLUMN device_fingerprint TEXT DEFAULT ''`,
      `ALTER TABLE assessment_exam_versions ADD COLUMN exam_id TEXT`,
      `ALTER TABLE assessment_exam_versions ADD COLUMN version_number INTEGER DEFAULT 1`,
      `ALTER TABLE assessment_exam_versions ADD COLUMN created_by TEXT`,
      `ALTER TABLE assessment_exam_versions ADD COLUMN created_at TEXT`,
      `ALTER TABLE assessment_result_workflows ADD COLUMN approved_by TEXT`,
      `ALTER TABLE assessment_result_workflows ADD COLUMN approved_at TEXT`,
      `ALTER TABLE assessment_result_workflows ADD COLUMN published_by TEXT`,
      `ALTER TABLE assessment_result_workflows ADD COLUMN published_at TEXT`,
      `ALTER TABLE assessment_result_workflows ADD COLUMN revoked_by TEXT`,
      `ALTER TABLE assessment_result_workflows ADD COLUMN revoked_at TEXT`,
      `ALTER TABLE assessment_result_workflows ADD COLUMN revoke_reason TEXT`,
      `ALTER TABLE exam_audit_log ADD COLUMN created_at TEXT`,
      `ALTER TABLE exam_question_bank ADD COLUMN subject TEXT DEFAULT 'Chung'`,
      `ALTER TABLE exam_question_bank ADD COLUMN cognitive_level TEXT DEFAULT 'understanding'`,
      `ALTER TABLE exam_enrollments ADD COLUMN expires_at TEXT`,
      `ALTER TABLE exam_attempts ADD COLUMN initial_ip TEXT`,
      `ALTER TABLE exam_attempts ADD COLUMN last_ip TEXT`,
      `ALTER TABLE exam_attempts ADD COLUMN ip_change_count INTEGER DEFAULT 0`,
      `ALTER TABLE exam_attempts ADD COLUMN vpn_suspected INTEGER DEFAULT 0`,
      `ALTER TABLE exam_attempts ADD COLUMN camera_status TEXT DEFAULT 'not_required'`,
      `ALTER TABLE exam_attempts ADD COLUMN mic_status TEXT DEFAULT 'not_required'`,
      `ALTER TABLE exam_attempts ADD COLUMN secondary_camera_status TEXT DEFAULT 'not_required'`,
      `ALTER TABLE exam_attempts ADD COLUMN device_status TEXT DEFAULT 'normal'`,
      `ALTER TABLE exam_attempts ADD COLUMN kiosk_mode TEXT DEFAULT 'browser'`,
      `ALTER TABLE exam_attempts ADD COLUMN max_risk_level INTEGER DEFAULT 0`,
      `ALTER TABLE exam_attempts ADD COLUMN proctor_event_count INTEGER DEFAULT 0`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN initial_ip TEXT`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN last_ip TEXT`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN ip_change_count INTEGER DEFAULT 0`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN vpn_suspected INTEGER DEFAULT 0`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN camera_status TEXT DEFAULT 'not_required'`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN mic_status TEXT DEFAULT 'not_required'`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN secondary_camera_status TEXT DEFAULT 'not_required'`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN device_status TEXT DEFAULT 'normal'`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN kiosk_mode TEXT DEFAULT 'browser'`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN max_risk_level INTEGER DEFAULT 0`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN proctor_event_count INTEGER DEFAULT 0`,
      `ALTER TABLE exam_attempts ADD COLUMN lifecycle_state TEXT DEFAULT 'in_progress'`,
      `ALTER TABLE exam_attempts ADD COLUMN checkin_photos_json TEXT DEFAULT '{}'`,
      `ALTER TABLE exam_attempts ADD COLUMN proctor_prompt_json TEXT DEFAULT '{}'`,
      `ALTER TABLE exam_attempts ADD COLUMN platform_type TEXT DEFAULT 'desktop'`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN lifecycle_state TEXT DEFAULT 'in_progress'`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN checkin_photos_json TEXT DEFAULT '{}'`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN proctor_prompt_json TEXT DEFAULT '{}'`,
      `ALTER TABLE exam_guest_attempts ADD COLUMN platform_type TEXT DEFAULT 'desktop'`,
      `ALTER TABLE exam_appeals ADD COLUMN request_code TEXT`,
      `ALTER TABLE exam_appeals ADD COLUMN full_name TEXT DEFAULT ''`,
      `ALTER TABLE exam_appeals ADD COLUMN phone TEXT DEFAULT ''`,
      `ALTER TABLE exam_appeals ADD COLUMN class_name TEXT DEFAULT ''`,
      `ALTER TABLE exam_appeals ADD COLUMN exam_title TEXT DEFAULT ''`,
      `ALTER TABLE exam_appeals ADD COLUMN exam_date TEXT DEFAULT ''`,
      `ALTER TABLE exam_appeals ADD COLUMN receipt_code TEXT DEFAULT ''`,
      `ALTER TABLE exam_appeals ADD COLUMN evidence_files_json TEXT DEFAULT '[]'`,
      `ALTER TABLE exam_appeals ADD COLUMN history_json TEXT DEFAULT '[]'`,
      `ALTER TABLE exam_support_requests ADD COLUMN request_code TEXT`,
      `ALTER TABLE exam_support_requests ADD COLUMN phone TEXT DEFAULT ''`,
      `ALTER TABLE exam_support_requests ADD COLUMN class_name TEXT DEFAULT ''`,
      `ALTER TABLE exam_support_requests ADD COLUMN exam_title TEXT DEFAULT ''`,
      `ALTER TABLE exam_support_requests ADD COLUMN exam_date TEXT DEFAULT ''`,
      `ALTER TABLE exam_support_requests ADD COLUMN occurred_at TEXT DEFAULT ''`,
      `ALTER TABLE exam_support_requests ADD COLUMN category TEXT DEFAULT 'support'`,
      `ALTER TABLE exam_support_requests ADD COLUMN priority TEXT DEFAULT 'normal'`,
      `ALTER TABLE exam_support_requests ADD COLUMN steps_to_reproduce TEXT DEFAULT ''`,
      `ALTER TABLE exam_support_requests ADD COLUMN technical_meta_json TEXT DEFAULT '{}'`,
      `ALTER TABLE exam_support_requests ADD COLUMN evidence_files_json TEXT DEFAULT '[]'`,
      `ALTER TABLE exam_support_requests ADD COLUMN history_json TEXT DEFAULT '[]'`
    ];
    for (const sql of alters) {
      await env.DB.prepare(sql).run().catch(() => {});
    }
    // Verify legacy authentication columns before marking this D1 binding initialized.
    // This is not optional: the owner OTP flow depends on these columns.
    await ensureUserAuthSchema(env.DB);
    initializedDbs.add(env.DB);
  } catch {
    // Non-fatal fallback
  }
}

export class ExamRepository {
  constructor(env) {
    this.env = env;
    this.db = env?.DATA_ADAPTER || env?.DB;
    this.cache = sharedCache;
  }

  async init() {
    await ensureAdditiveSchema(this.env);
  }

  prepare(sql) {
    return this.db.prepare(sql);
  }

  async first(sql, params = [], { cacheKey = '', ttlMs = 0 } = {}) {
    if (cacheKey) {
      const cached = this.cache.get(cacheKey);
      if (cached !== undefined) return cached;
    }
    const stmt = this.db.prepare(sql);
    const bound = params.length ? stmt.bind(...params) : stmt;
    const row = await bound.first();
    if (cacheKey && row) this.cache.set(cacheKey, row, ttlMs || 10_000);
    return row;
  }

  async all(sql, params = [], { cacheKey = '', ttlMs = 0 } = {}) {
    if (cacheKey) {
      const cached = this.cache.get(cacheKey);
      if (cached !== undefined) return cached;
    }
    const stmt = this.db.prepare(sql);
    const bound = params.length ? stmt.bind(...params) : stmt;
    const res = await bound.all();
    const list = res?.results || [];
    if (cacheKey) this.cache.set(cacheKey, list, ttlMs || 10_000);
    return list;
  }

  async run(sql, params = [], { invalidatePrefix = '' } = {}) {
    const stmt = this.db.prepare(sql);
    const bound = params.length ? stmt.bind(...params) : stmt;
    const res = await bound.run();
    if (invalidatePrefix) this.cache.invalidatePrefix(invalidatePrefix);
    return res;
  }

  async batch(statements, { invalidatePrefix = '' } = {}) {
    const res = await this.db.batch(statements);
    if (invalidatePrefix) this.cache.invalidatePrefix(invalidatePrefix);
    return res;
  }

  async findUserByEmail(email) {
    const clean = String(email || '').trim().toLowerCase();
    if (!clean) return null;
    return this.first(`SELECT * FROM users WHERE LOWER(email)=? LIMIT 1`, [clean]);
  }

  async findEnrollment(examId, email) {
    const clean = String(email || '').trim().toLowerCase();
    if (!examId || !clean) return null;
    return this.first(`SELECT * FROM exam_enrollments WHERE exam_id=? AND LOWER(email)=? LIMIT 1`, [examId, clean]);
  }
}

export function getRepository(env) {
  return new ExamRepository(env);
}
