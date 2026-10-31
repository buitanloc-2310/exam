// =============================================================================
// SKY FIRST EXAM 2026 — DATA ACCESS & REPOSITORY LAYER (src/repository.js)
// Decouples business logic from direct Cloudflare D1 queries.
// Provides:
//  - Pluggable storage driver abstraction (D1 / SQLite / Custom Data Adapter)
//  - Read-through TTL cache for high-frequency metadata & catalog queries
//  - Fast, schema-aware migration initialization (ensureAdditiveSchema)
//  - Live D1 users table introspection & constraint-safe upsert (upsertCompatibleUser)
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

export async function inspectUsersTableColumns(db) {
  const info = await db.prepare(`PRAGMA table_info(users)`).all();
  const map = new Map();
  for (const col of info?.results || []) {
    const lower = String(col.name || '').toLowerCase();
    if (lower) {
      map.set(lower, {
        name: String(col.name),
        type: String(col.type || 'TEXT').toUpperCase(),
        notnull: Number(col.notnull || 0) === 1,
        dflt_value: col.dflt_value ?? null,
        pk: Number(col.pk || 0) >= 1
      });
    }
  }
  return map;
}

/**
 * Add authentication/RBAC columns to an existing legacy users table safely.
 * Inspects live PRAGMA table_info(users) and adds only genuinely missing columns.
 */
export async function ensureUserAuthSchema(db) {
  if (!db?.prepare) throw new Error('D1 binding DB is unavailable');

  await db.prepare(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    full_name TEXT,
    sfn_id TEXT,
    email TEXT,
    password_hash TEXT DEFAULT '',
    password_salt TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    role TEXT DEFAULT 'candidate',
    roles_json TEXT DEFAULT '["candidate"]',
    class_id TEXT,
    expires_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS exam_admin_accounts (
    email TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    full_name TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    role TEXT DEFAULT 'system_admin',
    roles_json TEXT DEFAULT '["system_admin"]',
    expires_at TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`).run().catch(() => {});

  await db.prepare(`CREATE TABLE IF NOT EXISTS exam_owner_bootstrap_state (
    state_key TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'armed',
    used_count INTEGER NOT NULL DEFAULT 0,
    max_uses INTEGER NOT NULL DEFAULT 1,
    claimed_session_hash TEXT,
    claimed_at TEXT,
    locked_at TEXT,
    locked_by_ip TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`).run().catch(() => {});

  const required = {
    full_name: 'TEXT',
    sfn_id: 'TEXT',
    email: 'TEXT',
    password_hash: `TEXT DEFAULT ''`,
    password_salt: `TEXT DEFAULT ''`,
    status: `TEXT DEFAULT 'active'`,
    role: `TEXT DEFAULT 'candidate'`,
    roles_json: `TEXT DEFAULT '["candidate"]'`,
    class_id: 'TEXT',
    expires_at: 'TEXT',
    created_at: 'TEXT',
    updated_at: 'TEXT'
  };

  let colMap = await inspectUsersTableColumns(db);
  if (!colMap.has('id')) throw new Error('Bảng users hiện tại không có cột id bắt buộc.');

  for (const [name, ddl] of Object.entries(required)) {
    if (colMap.has(name)) continue;
    try {
      await db.prepare(`ALTER TABLE users ADD COLUMN ${name} ${ddl}`).run();
    } catch {
      await db.prepare(`ALTER TABLE users ADD COLUMN ${name} TEXT`).run().catch(() => {});
    }
  }

  colMap = await inspectUsersTableColumns(db);
  const critical = ['id', 'email', 'status', 'role', 'roles_json'];
  const missing = critical.filter(name => !colMap.has(name));
  if (missing.length) {
    throw new Error(`Không thể hoàn thiện schema xác thực của users; thiếu cột: ${missing.join(', ')}`);
  }
  return new Set(colMap.keys());
}

/**
 * Constraint-safe, schema-introspected user upsert for D1 `users` table.
 * Handles legacy NOT NULL columns (such as password_hash, password_salt, profile fields),
 * legacy CHECK constraints on `role` or `status`, and UNIQUE constraints on `email` / `sfn_id`.
 */
export async function upsertCompatibleUser(db, {
  id = '',
  email = '',
  full_name = '',
  sfn_id = '',
  status = 'active',
  role = 'candidate',
  roles = ['candidate'],
  class_id = null,
  expires_at = null,
  preserveExistingExpiry = false
} = {}) {
  await ensureUserAuthSchema(db);
  const colMap = await inspectUsersTableColumns(db);
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail) throw new Error('Email tài khoản không được để trống.');

  const rolesList = Array.isArray(roles) && roles.length ? roles.map(String) : [String(role || 'candidate')];
  const rolesJson = JSON.stringify(rolesList);
  const desiredRole = String(role || rolesList[0] || 'candidate');
  const desiredName = String(full_name || cleanEmail).trim() || cleanEmail;
  const nowStr = new Date().toISOString();

  const existingRes = await db.prepare(
    `SELECT * FROM users WHERE LOWER(TRIM(email))=? ORDER BY id LIMIT 10`
  ).bind(cleanEmail).all();
  const matching = existingRes?.results || [];

  const roleCandidates = [...new Set([
    desiredRole,
    rolesList.includes('system_admin') ? 'system_admin' : null,
    rolesList.includes('system_owner') || rolesList.includes('system_admin') ? 'admin' : null,
    'candidate',
    'user',
    'student'
  ].filter(Boolean))];

  let finalUserId = '';

  if (matching.length > 0) {
    const primary = matching[0];
    finalUserId = String(primary.id);

    for (let idx = 0; idx < matching.length; idx++) {
      const row = matching[idx];
      const rowId = String(row.id);
      const effectiveExpiry = preserveExistingExpiry && expires_at === null
        ? (row.expires_at ?? null)
        : expires_at;
      const expiryVal = effectiveExpiry === null && colMap.get('expires_at')?.notnull
        ? '2099-12-31T23:59:59.000Z'
        : effectiveExpiry;

      let updated = false;
      let lastErr = null;
      const tryRoles = [...new Set([...roleCandidates, row.role].filter(Boolean))];

      for (const candidateRole of tryRoles) {
        const sets = [];
        const vals = [];
        const addSet = (colKey, val) => {
          const c = colMap.get(colKey);
          if (!c) return;
          sets.push(`${c.name}=?`);
          vals.push(val);
        };

        if (colMap.has('full_name')) addSet('full_name', desiredName || row.full_name || cleanEmail);
        if (idx === 0 && colMap.has('email') && String(row.email || '') !== cleanEmail && matching.length === 1) {
          addSet('email', cleanEmail);
        }
        if (colMap.has('status')) addSet('status', status);
        if (colMap.has('role')) addSet('role', candidateRole);
        if (colMap.has('roles_json')) addSet('roles_json', rolesJson);
        if (colMap.has('expires_at')) addSet('expires_at', expiryVal);
        if (class_id !== null && colMap.has('class_id')) addSet('class_id', class_id);
        if (colMap.has('password_hash') && (row.password_hash === null || row.password_hash === undefined) && colMap.get('password_hash').notnull) {
          addSet('password_hash', 'OTP_ONLY_NO_PASSWORD');
        }
        if (colMap.has('password_salt') && (row.password_salt === null || row.password_salt === undefined) && colMap.get('password_salt').notnull) {
          addSet('password_salt', 'OTP_ONLY_SALT');
        }
        if (colMap.has('updated_at')) addSet('updated_at', nowStr);

        if (!sets.length) {
          updated = true;
          break;
        }
        try {
          const res = await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id=?`).bind(...vals, rowId).run();
          if (res?.success !== false) {
            updated = true;
            break;
          }
        } catch (err) {
          lastErr = err;
        }
      }
      if (!updated && idx === 0 && lastErr) {
        throw lastErr;
      }
    }
  } else {
    let candidateId = String(id || `usr-${crypto.randomUUID().slice(0, 8)}`);
    const idExists = await db.prepare(`SELECT id FROM users WHERE id=? LIMIT 1`).bind(candidateId).first().catch(() => null);
    if (idExists) candidateId = `${candidateId}-${crypto.randomUUID().slice(0, 8)}`;
    finalUserId = candidateId;

    let candidateSfn = String(sfn_id || `SFN-${candidateId.slice(-4).toUpperCase()}`);
    if (colMap.has('sfn_id')) {
      const sfnExists = await db.prepare(`SELECT id FROM users WHERE sfn_id=? LIMIT 1`).bind(candidateSfn).first().catch(() => null);
      if (sfnExists) candidateSfn = `${candidateSfn}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
    }

    const expiryVal = expires_at === null && colMap.get('expires_at')?.notnull
      ? '2099-12-31T23:59:59.000Z'
      : expires_at;

    let inserted = false;
    let lastErr = null;

    for (const candidateRole of roleCandidates) {
      const rowValues = new Map();
      const setCol = (k, v) => {
        const c = colMap.get(k);
        if (c) rowValues.set(c.name, v);
      };

      setCol('id', finalUserId);
      setCol('full_name', desiredName);
      setCol('sfn_id', candidateSfn);
      setCol('email', cleanEmail);
      setCol('password_hash', 'OTP_ONLY_NO_PASSWORD');
      setCol('password_salt', 'OTP_ONLY_SALT');
      setCol('status', status);
      setCol('role', candidateRole);
      setCol('roles_json', rolesJson);
      if (class_id !== null) setCol('class_id', class_id);
      setCol('expires_at', expiryVal);
      setCol('created_at', nowStr);
      setCol('updated_at', nowStr);

      // Fill any other legacy NOT NULL columns that lack defaults in D1 users table
      for (const [lowerKey, col] of colMap.entries()) {
        if (rowValues.has(col.name) || col.pk || !col.notnull || col.dflt_value !== null) continue;
        if (lowerKey.includes('email') || lowerKey.includes('user')) {
          rowValues.set(col.name, cleanEmail);
        } else if (lowerKey.includes('name')) {
          rowValues.set(col.name, desiredName);
        } else if (lowerKey.includes('json') || lowerKey.includes('meta')) {
          rowValues.set(col.name, '{}');
        } else if (/INT|BOOL|REAL|FLOA|DOUB|NUM/.test(col.type)) {
          rowValues.set(col.name, 0);
        } else {
          rowValues.set(col.name, '');
        }
      }

      const colNames = [...rowValues.keys()];
      const placeholders = colNames.map(() => '?').join(',');
      const bindVals = colNames.map(k => rowValues.get(k));

      try {
        const res = await db.prepare(
          `INSERT INTO users(${colNames.join(',')}) VALUES(${placeholders})`
        ).bind(...bindVals).run();
        if (res?.success !== false) {
          inserted = true;
          break;
        }
      } catch (err) {
        lastErr = err;
      }
    }

    if (!inserted && lastErr) {
      throw lastErr;
    }
  }

  // Mirror into exam_admin_accounts for fast, resilient RBAC lookup
  await db.prepare(
    `INSERT INTO exam_admin_accounts(email,user_id,full_name,status,role,roles_json,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(email) DO UPDATE SET user_id=excluded.user_id,full_name=excluded.full_name,status=excluded.status,role=excluded.role,roles_json=excluded.roles_json,expires_at=excluded.expires_at,updated_at=CURRENT_TIMESTAMP`
  ).bind(cleanEmail, finalUserId, desiredName, status, desiredRole, rolesJson, expires_at).run().catch(() => {});

  const verified = await db.prepare(`SELECT * FROM users WHERE id=? LIMIT 1`).bind(finalUserId).first();
  return verified || {
    id: finalUserId,
    email: cleanEmail,
    full_name: desiredName,
    sfn_id: sfn_id || 'SFO-0001',
    status,
    role: desiredRole,
    roles_json: rolesJson,
    expires_at
  };
}

export async function ensureAdditiveSchema(env) {
  if (!env?.DB?.prepare || initializedDbs.has(env.DB)) return;
  try {
    // Inspect existing tables and their CREATE TABLE SQL in a single D1 query
    const masterRes = await env.DB.prepare(`SELECT name, sql FROM sqlite_master WHERE type='table'`).all().catch(() => ({ results: [] }));
    const existingTables = new Map();
    for (const r of masterRes?.results || []) {
      if (r?.name) existingTables.set(String(r.name).toLowerCase(), String(r.sql || '').toLowerCase());
    }

    const tableSpecs = [
      ['users', `CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,full_name TEXT NOT NULL,sfn_id TEXT,email TEXT,password_hash TEXT DEFAULT '',password_salt TEXT DEFAULT '',status TEXT DEFAULT 'active',role TEXT DEFAULT 'candidate',roles_json TEXT DEFAULT '["candidate"]',class_id TEXT,expires_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['exams', `CREATE TABLE IF NOT EXISTS exams(id TEXT PRIMARY KEY,title TEXT NOT NULL,assessment_label TEXT,instructions TEXT,duration_minutes INTEGER DEFAULT 60,time_limit_enabled INTEGER DEFAULT 1,strict_mode INTEGER DEFAULT 1,fullscreen_required INTEGER DEFAULT 0,require_email_verify INTEGER DEFAULT 0,public_access INTEGER DEFAULT 1,public_token TEXT,show_score INTEGER DEFAULT 1,max_attempts INTEGER DEFAULT 1,passing_score REAL DEFAULT 0,result_policy TEXT DEFAULT 'score_after_submit',result_release_at TEXT,open_answers_at TEXT,security_profile TEXT DEFAULT 'STANDARD',security_level INTEGER DEFAULT 1,security_config_json TEXT DEFAULT '{}',matrix_config_json TEXT DEFAULT '{}',violation_threshold INTEGER DEFAULT 0,randomize_questions INTEGER DEFAULT 0,randomize_options INTEGER DEFAULT 0,questions_json TEXT DEFAULT '[]',question_json TEXT DEFAULT '[]',opens_at TEXT,closes_at TEXT,status TEXT DEFAULT 'draft',sealed_version_id TEXT,created_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['exam_attempts', `CREATE TABLE IF NOT EXISTS exam_attempts(id TEXT PRIMARY KEY,exam_id TEXT NOT NULL,user_id TEXT NOT NULL,status TEXT DEFAULT 'in_progress',started_at TEXT DEFAULT CURRENT_TIMESTAMP,last_saved_at TEXT,submitted_at TEXT,duration_minutes INTEGER DEFAULT 60,time_limit_enabled INTEGER DEFAULT 1,answers_json TEXT DEFAULT '{}',events_json TEXT DEFAULT '[]',event_log_json TEXT DEFAULT '[]',answer_revision INTEGER DEFAULT 0,score REAL,max_score REAL,extra_time_minutes INTEGER DEFAULT 0,question_snapshot_json TEXT,exam_version_id TEXT,variant_code TEXT,device_fingerprint TEXT,verification_ref TEXT,review_classification TEXT DEFAULT 'info',candidate_explanation TEXT DEFAULT '',lock_reason TEXT,locked_at TEXT,unlocked_by TEXT,unlocked_at TEXT,initial_ip TEXT,last_ip TEXT,ip_change_count INTEGER DEFAULT 0,vpn_suspected INTEGER DEFAULT 0,camera_status TEXT DEFAULT 'not_required',mic_status TEXT DEFAULT 'not_required',secondary_camera_status TEXT DEFAULT 'not_required',device_status TEXT DEFAULT 'normal',kiosk_mode TEXT DEFAULT 'browser',max_risk_level INTEGER DEFAULT 0,proctor_event_count INTEGER DEFAULT 0,lifecycle_state TEXT DEFAULT 'in_progress',checkin_photos_json TEXT DEFAULT '{}',proctor_prompt_json TEXT DEFAULT '{}',platform_type TEXT DEFAULT 'desktop')`],
      ['guest_exam_attempts', `CREATE TABLE IF NOT EXISTS guest_exam_attempts(id TEXT PRIMARY KEY,exam_id TEXT NOT NULL,full_name TEXT NOT NULL,email TEXT,candidate_code TEXT NOT NULL,class_name TEXT DEFAULT '',unit_name TEXT DEFAULT '',access_token_hash TEXT NOT NULL,status TEXT DEFAULT 'in_progress',started_at TEXT DEFAULT CURRENT_TIMESTAMP,last_saved_at TEXT,submitted_at TEXT,answers_json TEXT DEFAULT '{}',events_json TEXT DEFAULT '[]',answer_revision INTEGER DEFAULT 0,score REAL,max_score REAL,extra_time_minutes INTEGER DEFAULT 0,exam_version_id TEXT,question_order_json TEXT,option_orders_json TEXT)`],
      ['exam_guest_attempts', `CREATE TABLE IF NOT EXISTS exam_guest_attempts(id TEXT PRIMARY KEY,exam_id TEXT NOT NULL,status TEXT DEFAULT 'in_progress',started_at TEXT DEFAULT CURRENT_TIMESTAMP,duration_minutes INTEGER DEFAULT 60,time_limit_enabled INTEGER DEFAULT 1,extra_time_minutes INTEGER DEFAULT 0,answers_json TEXT DEFAULT '{}',event_log_json TEXT DEFAULT '[]',score REAL,max_score REAL,submitted_at TEXT,last_saved_at TEXT,answer_revision INTEGER DEFAULT 0,question_snapshot_json TEXT,exam_version_id TEXT,variant_code TEXT,device_fingerprint TEXT,verification_ref TEXT,review_classification TEXT DEFAULT 'info',candidate_explanation TEXT DEFAULT '',access_key TEXT,full_name TEXT,email TEXT,candidate_code TEXT,class_name TEXT,lock_reason TEXT,locked_at TEXT,unlocked_by TEXT,unlocked_at TEXT,initial_ip TEXT,last_ip TEXT,ip_change_count INTEGER DEFAULT 0,vpn_suspected INTEGER DEFAULT 0,camera_status TEXT DEFAULT 'not_required',mic_status TEXT DEFAULT 'not_required',secondary_camera_status TEXT DEFAULT 'not_required',device_status TEXT DEFAULT 'normal',kiosk_mode TEXT DEFAULT 'browser',max_risk_level INTEGER DEFAULT 0,proctor_event_count INTEGER DEFAULT 0,lifecycle_state TEXT DEFAULT 'in_progress',checkin_photos_json TEXT DEFAULT '{}',proctor_prompt_json TEXT DEFAULT '{}',platform_type TEXT DEFAULT 'desktop')`],
      ['exam_launch_tokens', `CREATE TABLE IF NOT EXISTS exam_launch_tokens(token_hash TEXT PRIMARY KEY,exam_id TEXT,user_id TEXT,attempt_id TEXT,candidate_name TEXT,candidate_code TEXT,expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['exam_access_tokens', `CREATE TABLE IF NOT EXISTS exam_access_tokens(token_hash TEXT PRIMARY KEY,attempt_id TEXT NOT NULL,user_id TEXT,source TEXT DEFAULT 'internal',expires_at TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['assessment_attempt_leases', `CREATE TABLE IF NOT EXISTS assessment_attempt_leases(attempt_id TEXT NOT NULL,source TEXT NOT NULL,session_id TEXT NOT NULL,device_fingerprint TEXT DEFAULT '',claimed_at TEXT DEFAULT CURRENT_TIMESTAMP,last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(attempt_id,source))`],
      ['assessment_answer_revisions', `CREATE TABLE IF NOT EXISTS assessment_answer_revisions(id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL,source TEXT NOT NULL,revision INTEGER NOT NULL,answers_json TEXT NOT NULL,events_json TEXT DEFAULT '[]',accepted_at TEXT DEFAULT CURRENT_TIMESTAMP,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(attempt_id,revision))`],
      ['assessment_receipts', `CREATE TABLE IF NOT EXISTS assessment_receipts(id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL UNIQUE,receipt_code TEXT NOT NULL UNIQUE,payload_json TEXT DEFAULT '{}',submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,sha256 TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['assessment_exam_versions', `CREATE TABLE IF NOT EXISTS assessment_exam_versions(id TEXT PRIMARY KEY,exam_id TEXT,version_number INTEGER DEFAULT 1,questions_json TEXT,snapshot_json TEXT,settings_json TEXT DEFAULT '{}',created_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['assessment_manual_grades', `CREATE TABLE IF NOT EXISTS assessment_manual_grades(id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL,question_id TEXT NOT NULL,score REAL,max_score REAL,feedback TEXT DEFAULT '',grader_user_id TEXT,graded_by TEXT,status TEXT DEFAULT 'draft',graded_at TEXT DEFAULT CURRENT_TIMESTAMP,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(attempt_id,question_id))`],
      ['assessment_result_workflows', `CREATE TABLE IF NOT EXISTS assessment_result_workflows(attempt_id TEXT PRIMARY KEY,source TEXT DEFAULT 'internal',state TEXT DEFAULT 'pending_grading',approved_by TEXT,approved_at TEXT,published_by TEXT,published_at TEXT,revoked_by TEXT,revoked_at TEXT,revoke_reason TEXT,note TEXT DEFAULT '',updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['assessment_response_files', `CREATE TABLE IF NOT EXISTS assessment_response_files(id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL,source TEXT DEFAULT 'internal',question_id TEXT NOT NULL,file_id TEXT,r2_key TEXT,file_name TEXT,mime_type TEXT,byte_size INTEGER DEFAULT 0,status TEXT DEFAULT 'active',created_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['files', `CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,owner_user_id TEXT,r2_key TEXT NOT NULL,name TEXT NOT NULL,mime TEXT,size INTEGER DEFAULT 0,visibility TEXT DEFAULT 'private',created_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['classes', `CREATE TABLE IF NOT EXISTS classes(id TEXT PRIMARY KEY,name TEXT NOT NULL,code TEXT,description TEXT,status TEXT DEFAULT 'active',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['exam_audit_log', `CREATE TABLE IF NOT EXISTS exam_audit_log(id TEXT PRIMARY KEY,exam_id TEXT,attempt_id TEXT,actor_user_id TEXT,event_type TEXT NOT NULL,detail_json TEXT DEFAULT '{}',created_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['exam_otp_challenges', `CREATE TABLE IF NOT EXISTS exam_otp_challenges(id TEXT PRIMARY KEY,email TEXT NOT NULL,purpose TEXT NOT NULL,scope_id TEXT DEFAULT '',otp_hash TEXT NOT NULL,attempts INTEGER DEFAULT 0,max_attempts INTEGER DEFAULT 5,expires_at TEXT NOT NULL,used_at TEXT,verified_token_hash TEXT,verified_expires_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['exam_admin_sessions', `CREATE TABLE IF NOT EXISTS exam_admin_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,email TEXT NOT NULL,roles_json TEXT NOT NULL,csrf_token TEXT NOT NULL,expires_at TEXT NOT NULL,revoked_at TEXT,last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['exam_admin_accounts', `CREATE TABLE IF NOT EXISTS exam_admin_accounts(email TEXT PRIMARY KEY,user_id TEXT NOT NULL,full_name TEXT DEFAULT '',status TEXT DEFAULT 'active',role TEXT DEFAULT 'system_admin',roles_json TEXT DEFAULT '["system_admin"]',expires_at TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['exam_owner_bootstrap_state', `CREATE TABLE IF NOT EXISTS exam_owner_bootstrap_state(state_key TEXT PRIMARY KEY,owner_email TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'armed',used_count INTEGER NOT NULL DEFAULT 0,max_uses INTEGER NOT NULL DEFAULT 1,claimed_session_hash TEXT,claimed_at TEXT,locked_at TEXT,locked_by_ip TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['exam_question_bank', `CREATE TABLE IF NOT EXISTS exam_question_bank(id TEXT PRIMARY KEY,code TEXT,subject TEXT DEFAULT 'Chung',topic TEXT DEFAULT 'Chung',cognitive_level TEXT DEFAULT 'understanding',difficulty TEXT DEFAULT 'medium',tags_json TEXT DEFAULT '[]',type TEXT NOT NULL,question TEXT NOT NULL,options_json TEXT DEFAULT '[]',answer_json TEXT,explanation TEXT DEFAULT '',points REAL DEFAULT 1,stimulus_json TEXT,content_language TEXT DEFAULT 'vi',script_direction TEXT DEFAULT 'ltr',numeric_tolerance REAL,recording_duration_seconds INTEGER,version INTEGER DEFAULT 1,status TEXT DEFAULT 'active',created_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['exam_question_versions', `CREATE TABLE IF NOT EXISTS exam_question_versions(id TEXT PRIMARY KEY,question_id TEXT NOT NULL,version INTEGER NOT NULL,snapshot_json TEXT NOT NULL,changed_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['exam_enrollments', `CREATE TABLE IF NOT EXISTS exam_enrollments(id TEXT PRIMARY KEY,exam_id TEXT NOT NULL,user_id TEXT,email TEXT NOT NULL,full_name TEXT NOT NULL,candidate_code TEXT NOT NULL,class_name TEXT DEFAULT '',status TEXT DEFAULT 'active',expires_at TEXT,verified_at TEXT,notes TEXT DEFAULT '',created_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(exam_id,email))`],
      ['exam_identity_verifications', `CREATE TABLE IF NOT EXISTS exam_identity_verifications(id TEXT PRIMARY KEY,exam_id TEXT NOT NULL,attempt_id TEXT,candidate_code TEXT NOT NULL,email TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'skyfirst_internal',reference_code TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'verified',method TEXT NOT NULL DEFAULT 'otp_and_roster',verified_at TEXT,expires_at TEXT,metadata_json TEXT DEFAULT '{}',created_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['exam_appeals', `CREATE TABLE IF NOT EXISTS exam_appeals(id TEXT PRIMARY KEY,request_code TEXT,attempt_id TEXT NOT NULL,exam_id TEXT NOT NULL,full_name TEXT DEFAULT '',phone TEXT DEFAULT '',candidate_email TEXT,class_name TEXT DEFAULT '',candidate_code TEXT,exam_title TEXT DEFAULT '',exam_date TEXT DEFAULT '',receipt_code TEXT DEFAULT '',reason TEXT NOT NULL,evidence_files_json TEXT DEFAULT '[]',status TEXT DEFAULT 'pending',resolution_note TEXT DEFAULT '',score_before REAL,score_after REAL,resolved_by TEXT,resolved_at TEXT,history_json TEXT DEFAULT '[]',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['exam_support_requests', `CREATE TABLE IF NOT EXISTS exam_support_requests(id TEXT PRIMARY KEY,request_code TEXT,exam_id TEXT,attempt_id TEXT,candidate_name TEXT,phone TEXT DEFAULT '',candidate_email TEXT,class_name TEXT DEFAULT '',candidate_code TEXT,exam_title TEXT DEFAULT '',exam_date TEXT DEFAULT '',occurred_at TEXT DEFAULT '',category TEXT DEFAULT 'support',issue_type TEXT DEFAULT 'technical',priority TEXT DEFAULT 'normal',message TEXT NOT NULL,steps_to_reproduce TEXT DEFAULT '',technical_meta_json TEXT DEFAULT '{}',evidence_files_json TEXT DEFAULT '[]',status TEXT DEFAULT 'open',resolution_note TEXT DEFAULT '',resolved_by TEXT,history_json TEXT DEFAULT '[]',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['exam_rate_limits', `CREATE TABLE IF NOT EXISTS exam_rate_limits(bucket_key TEXT PRIMARY KEY,count INTEGER DEFAULT 1,window_start_ms INTEGER NOT NULL)`],
      ['exam_fraud_reports', `CREATE TABLE IF NOT EXISTS exam_fraud_reports(id TEXT PRIMARY KEY,request_code TEXT NOT NULL UNIQUE,reporter_name TEXT NOT NULL,reporter_phone TEXT NOT NULL,reporter_email TEXT NOT NULL,class_name TEXT NOT NULL,exam_id TEXT,exam_title TEXT NOT NULL,exam_date TEXT NOT NULL,reported_candidate_code TEXT DEFAULT '',reported_info TEXT DEFAULT '',content TEXT NOT NULL,evidence_url TEXT DEFAULT '',evidence_files_json TEXT DEFAULT '[]',status TEXT DEFAULT 'received',resolution_note TEXT DEFAULT '',resolved_by TEXT,resolved_at TEXT,history_json TEXT DEFAULT '[]',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['exam_service_files', `CREATE TABLE IF NOT EXISTS exam_service_files(id TEXT PRIMARY KEY,service_type TEXT NOT NULL,request_id TEXT,r2_key TEXT NOT NULL,original_name TEXT NOT NULL,safe_name TEXT NOT NULL,mime_type TEXT NOT NULL,byte_size INTEGER NOT NULL,sha256 TEXT NOT NULL,uploaded_by_email TEXT DEFAULT '',status TEXT DEFAULT 'active',created_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['exam_proctoring_events', `CREATE TABLE IF NOT EXISTS exam_proctoring_events(id TEXT PRIMARY KEY,exam_id TEXT NOT NULL,attempt_id TEXT NOT NULL,source TEXT DEFAULT 'guest',candidate_code TEXT DEFAULT '',event_type TEXT NOT NULL,category TEXT DEFAULT 'browser',risk_level INTEGER DEFAULT 1,risk_label TEXT DEFAULT 'Mức 1: Cảnh báo thông thường',description TEXT NOT NULL,device_env_json TEXT DEFAULT '{}',evidence_id TEXT,status TEXT DEFAULT 'pending_review',received_by TEXT,decided_by TEXT,decision_note TEXT DEFAULT '',decided_at TEXT,occurred_at TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['exam_secondary_camera_links', `CREATE TABLE IF NOT EXISTS exam_secondary_camera_links(pairing_code TEXT PRIMARY KEY,exam_id TEXT NOT NULL,attempt_id TEXT NOT NULL,source TEXT DEFAULT 'guest',candidate_code TEXT DEFAULT '',status TEXT DEFAULT 'pending',mobile_device_info_json TEXT DEFAULT '{}',last_heartbeat_at TEXT,last_evidence_id TEXT,expires_at TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['exam_digital_evidence', `CREATE TABLE IF NOT EXISTS exam_digital_evidence(id TEXT PRIMARY KEY,exam_id TEXT NOT NULL,attempt_id TEXT NOT NULL,source TEXT DEFAULT 'guest',candidate_code TEXT DEFAULT '',event_id TEXT,evidence_type TEXT NOT NULL,r2_key TEXT NOT NULL UNIQUE,mime_type TEXT NOT NULL,byte_size INTEGER NOT NULL,sha256 TEXT NOT NULL,chain_hash TEXT NOT NULL,metadata_json TEXT DEFAULT '{}',retention_until TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`],
      ['exam_email_logs', `CREATE TABLE IF NOT EXISTS exam_email_logs(id TEXT PRIMARY KEY,idempotency_key TEXT UNIQUE,event_type TEXT NOT NULL,template_file TEXT NOT NULL,sender_address TEXT NOT NULL,recipient_email TEXT NOT NULL,subject TEXT NOT NULL,status TEXT NOT NULL,provider TEXT DEFAULT '',provider_message_id TEXT,retry_count INTEGER DEFAULT 0,error_detail TEXT DEFAULT '',exam_id TEXT,attempt_id TEXT,request_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`]
    ];

    const missingTables = tableSpecs.filter(([tName]) => !existingTables.has(tName));
    if (missingTables.length > 0) {
      if (typeof env.DB.batch === 'function') {
        try {
          await env.DB.batch(missingTables.map(([, sql]) => env.DB.prepare(sql)));
        } catch {
          for (const [, sql] of missingTables) {
            await env.DB.prepare(sql).run().catch(() => {});
          }
        }
      } else {
        for (const [, sql] of missingTables) {
          await env.DB.prepare(sql).run().catch(() => {});
        }
      }
      for (const [tName, sql] of missingTables) {
        existingTables.set(tName, sql.toLowerCase());
      }
    }

    const alters = [
      ['users', 'role', `ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'candidate'`],
      ['users', 'roles_json', `ALTER TABLE users ADD COLUMN roles_json TEXT DEFAULT '["candidate"]'`],
      ['users', 'class_id', `ALTER TABLE users ADD COLUMN class_id TEXT`],
      ['users', 'expires_at', `ALTER TABLE users ADD COLUMN expires_at TEXT`],
      ['users', 'created_at', `ALTER TABLE users ADD COLUMN created_at TEXT`],
      ['users', 'updated_at', `ALTER TABLE users ADD COLUMN updated_at TEXT`],
      ['exams', 'opens_at', `ALTER TABLE exams ADD COLUMN opens_at TEXT`],
      ['exams', 'open_answers_at', `ALTER TABLE exams ADD COLUMN open_answers_at TEXT`],
      ['exams', 'public_token', `ALTER TABLE exams ADD COLUMN public_token TEXT`],
      ['exams', 'public_access', `ALTER TABLE exams ADD COLUMN public_access INTEGER DEFAULT 0`],
      ['exams', 'require_email_verify', `ALTER TABLE exams ADD COLUMN require_email_verify INTEGER DEFAULT 0`],
      ['exams', 'max_attempts', `ALTER TABLE exams ADD COLUMN max_attempts INTEGER DEFAULT 1`],
      ['exams', 'passing_score', `ALTER TABLE exams ADD COLUMN passing_score REAL DEFAULT 0`],
      ['exams', 'security_level', `ALTER TABLE exams ADD COLUMN security_level INTEGER DEFAULT 1`],
      ['exams', 'security_config_json', `ALTER TABLE exams ADD COLUMN security_config_json TEXT DEFAULT '{}'`],
      ['exams', 'matrix_config_json', `ALTER TABLE exams ADD COLUMN matrix_config_json TEXT DEFAULT '{}'`],
      ['exams', 'violation_threshold', `ALTER TABLE exams ADD COLUMN violation_threshold INTEGER DEFAULT 0`],
      ['exams', 'randomize_questions', `ALTER TABLE exams ADD COLUMN randomize_questions INTEGER DEFAULT 0`],
      ['exams', 'randomize_options', `ALTER TABLE exams ADD COLUMN randomize_options INTEGER DEFAULT 0`],
      ['exams', 'created_by', `ALTER TABLE exams ADD COLUMN created_by TEXT`],
      ['exams', 'created_at', `ALTER TABLE exams ADD COLUMN created_at TEXT`],
      ['exams', 'updated_at', `ALTER TABLE exams ADD COLUMN updated_at TEXT`],
      ['exam_attempts', 'variant_code', `ALTER TABLE exam_attempts ADD COLUMN variant_code TEXT`],
      ['exam_attempts', 'device_fingerprint', `ALTER TABLE exam_attempts ADD COLUMN device_fingerprint TEXT`],
      ['exam_attempts', 'verification_ref', `ALTER TABLE exam_attempts ADD COLUMN verification_ref TEXT`],
      ['exam_attempts', 'review_classification', `ALTER TABLE exam_attempts ADD COLUMN review_classification TEXT DEFAULT 'info'`],
      ['exam_attempts', 'candidate_explanation', `ALTER TABLE exam_attempts ADD COLUMN candidate_explanation TEXT DEFAULT ''`],
      ['exam_attempts', 'lock_reason', `ALTER TABLE exam_attempts ADD COLUMN lock_reason TEXT`],
      ['exam_attempts', 'locked_at', `ALTER TABLE exam_attempts ADD COLUMN locked_at TEXT`],
      ['exam_attempts', 'unlocked_by', `ALTER TABLE exam_attempts ADD COLUMN unlocked_by TEXT`],
      ['exam_attempts', 'unlocked_at', `ALTER TABLE exam_attempts ADD COLUMN unlocked_at TEXT`],
      ['exam_guest_attempts', 'email', `ALTER TABLE exam_guest_attempts ADD COLUMN email TEXT`],
      ['exam_guest_attempts', 'variant_code', `ALTER TABLE exam_guest_attempts ADD COLUMN variant_code TEXT`],
      ['exam_guest_attempts', 'device_fingerprint', `ALTER TABLE exam_guest_attempts ADD COLUMN device_fingerprint TEXT`],
      ['exam_guest_attempts', 'verification_ref', `ALTER TABLE exam_guest_attempts ADD COLUMN verification_ref TEXT`],
      ['exam_guest_attempts', 'review_classification', `ALTER TABLE exam_guest_attempts ADD COLUMN review_classification TEXT DEFAULT 'info'`],
      ['exam_guest_attempts', 'candidate_explanation', `ALTER TABLE exam_guest_attempts ADD COLUMN candidate_explanation TEXT DEFAULT ''`],
      ['exam_guest_attempts', 'lock_reason', `ALTER TABLE exam_guest_attempts ADD COLUMN lock_reason TEXT`],
      ['exam_guest_attempts', 'locked_at', `ALTER TABLE exam_guest_attempts ADD COLUMN locked_at TEXT`],
      ['exam_guest_attempts', 'unlocked_by', `ALTER TABLE exam_guest_attempts ADD COLUMN unlocked_by TEXT`],
      ['exam_guest_attempts', 'unlocked_at', `ALTER TABLE exam_guest_attempts ADD COLUMN unlocked_at TEXT`],
      ['assessment_attempt_leases', 'device_fingerprint', `ALTER TABLE assessment_attempt_leases ADD COLUMN device_fingerprint TEXT DEFAULT ''`],
      ['assessment_exam_versions', 'exam_id', `ALTER TABLE assessment_exam_versions ADD COLUMN exam_id TEXT`],
      ['assessment_exam_versions', 'version_number', `ALTER TABLE assessment_exam_versions ADD COLUMN version_number INTEGER DEFAULT 1`],
      ['assessment_exam_versions', 'created_by', `ALTER TABLE assessment_exam_versions ADD COLUMN created_by TEXT`],
      ['assessment_exam_versions', 'created_at', `ALTER TABLE assessment_exam_versions ADD COLUMN created_at TEXT`],
      ['assessment_result_workflows', 'approved_by', `ALTER TABLE assessment_result_workflows ADD COLUMN approved_by TEXT`],
      ['assessment_result_workflows', 'approved_at', `ALTER TABLE assessment_result_workflows ADD COLUMN approved_at TEXT`],
      ['assessment_result_workflows', 'published_by', `ALTER TABLE assessment_result_workflows ADD COLUMN published_by TEXT`],
      ['assessment_result_workflows', 'published_at', `ALTER TABLE assessment_result_workflows ADD COLUMN published_at TEXT`],
      ['assessment_result_workflows', 'revoked_by', `ALTER TABLE assessment_result_workflows ADD COLUMN revoked_by TEXT`],
      ['assessment_result_workflows', 'revoked_at', `ALTER TABLE assessment_result_workflows ADD COLUMN revoked_at TEXT`],
      ['assessment_result_workflows', 'revoke_reason', `ALTER TABLE assessment_result_workflows ADD COLUMN revoke_reason TEXT`],
      ['exam_audit_log', 'created_at', `ALTER TABLE exam_audit_log ADD COLUMN created_at TEXT`],
      ['exam_question_bank', 'subject', `ALTER TABLE exam_question_bank ADD COLUMN subject TEXT DEFAULT 'Chung'`],
      ['exam_question_bank', 'cognitive_level', `ALTER TABLE exam_question_bank ADD COLUMN cognitive_level TEXT DEFAULT 'understanding'`],
      ['exam_enrollments', 'expires_at', `ALTER TABLE exam_enrollments ADD COLUMN expires_at TEXT`],
      ['exam_attempts', 'initial_ip', `ALTER TABLE exam_attempts ADD COLUMN initial_ip TEXT`],
      ['exam_attempts', 'last_ip', `ALTER TABLE exam_attempts ADD COLUMN last_ip TEXT`],
      ['exam_attempts', 'ip_change_count', `ALTER TABLE exam_attempts ADD COLUMN ip_change_count INTEGER DEFAULT 0`],
      ['exam_attempts', 'vpn_suspected', `ALTER TABLE exam_attempts ADD COLUMN vpn_suspected INTEGER DEFAULT 0`],
      ['exam_attempts', 'camera_status', `ALTER TABLE exam_attempts ADD COLUMN camera_status TEXT DEFAULT 'not_required'`],
      ['exam_attempts', 'mic_status', `ALTER TABLE exam_attempts ADD COLUMN mic_status TEXT DEFAULT 'not_required'`],
      ['exam_attempts', 'secondary_camera_status', `ALTER TABLE exam_attempts ADD COLUMN secondary_camera_status TEXT DEFAULT 'not_required'`],
      ['exam_attempts', 'device_status', `ALTER TABLE exam_attempts ADD COLUMN device_status TEXT DEFAULT 'normal'`],
      ['exam_attempts', 'kiosk_mode', `ALTER TABLE exam_attempts ADD COLUMN kiosk_mode TEXT DEFAULT 'browser'`],
      ['exam_attempts', 'max_risk_level', `ALTER TABLE exam_attempts ADD COLUMN max_risk_level INTEGER DEFAULT 0`],
      ['exam_attempts', 'proctor_event_count', `ALTER TABLE exam_attempts ADD COLUMN proctor_event_count INTEGER DEFAULT 0`],
      ['exam_guest_attempts', 'initial_ip', `ALTER TABLE exam_guest_attempts ADD COLUMN initial_ip TEXT`],
      ['exam_guest_attempts', 'last_ip', `ALTER TABLE exam_guest_attempts ADD COLUMN last_ip TEXT`],
      ['exam_guest_attempts', 'ip_change_count', `ALTER TABLE exam_guest_attempts ADD COLUMN ip_change_count INTEGER DEFAULT 0`],
      ['exam_guest_attempts', 'vpn_suspected', `ALTER TABLE exam_guest_attempts ADD COLUMN vpn_suspected INTEGER DEFAULT 0`],
      ['exam_guest_attempts', 'camera_status', `ALTER TABLE exam_guest_attempts ADD COLUMN camera_status TEXT DEFAULT 'not_required'`],
      ['exam_guest_attempts', 'mic_status', `ALTER TABLE exam_guest_attempts ADD COLUMN mic_status TEXT DEFAULT 'not_required'`],
      ['exam_guest_attempts', 'secondary_camera_status', `ALTER TABLE exam_guest_attempts ADD COLUMN secondary_camera_status TEXT DEFAULT 'not_required'`],
      ['exam_guest_attempts', 'device_status', `ALTER TABLE exam_guest_attempts ADD COLUMN device_status TEXT DEFAULT 'normal'`],
      ['exam_guest_attempts', 'kiosk_mode', `ALTER TABLE exam_guest_attempts ADD COLUMN kiosk_mode TEXT DEFAULT 'browser'`],
      ['exam_guest_attempts', 'max_risk_level', `ALTER TABLE exam_guest_attempts ADD COLUMN max_risk_level INTEGER DEFAULT 0`],
      ['exam_guest_attempts', 'proctor_event_count', `ALTER TABLE exam_guest_attempts ADD COLUMN proctor_event_count INTEGER DEFAULT 0`],
      ['exam_attempts', 'lifecycle_state', `ALTER TABLE exam_attempts ADD COLUMN lifecycle_state TEXT DEFAULT 'in_progress'`],
      ['exam_attempts', 'checkin_photos_json', `ALTER TABLE exam_attempts ADD COLUMN checkin_photos_json TEXT DEFAULT '{}'`],
      ['exam_attempts', 'proctor_prompt_json', `ALTER TABLE exam_attempts ADD COLUMN proctor_prompt_json TEXT DEFAULT '{}'`],
      ['exam_attempts', 'platform_type', `ALTER TABLE exam_attempts ADD COLUMN platform_type TEXT DEFAULT 'desktop'`],
      ['exam_guest_attempts', 'lifecycle_state', `ALTER TABLE exam_guest_attempts ADD COLUMN lifecycle_state TEXT DEFAULT 'in_progress'`],
      ['exam_guest_attempts', 'checkin_photos_json', `ALTER TABLE exam_guest_attempts ADD COLUMN checkin_photos_json TEXT DEFAULT '{}'`],
      ['exam_guest_attempts', 'proctor_prompt_json', `ALTER TABLE exam_guest_attempts ADD COLUMN proctor_prompt_json TEXT DEFAULT '{}'`],
      ['exam_guest_attempts', 'platform_type', `ALTER TABLE exam_guest_attempts ADD COLUMN platform_type TEXT DEFAULT 'desktop'`],
      ['exam_appeals', 'request_code', `ALTER TABLE exam_appeals ADD COLUMN request_code TEXT`],
      ['exam_appeals', 'full_name', `ALTER TABLE exam_appeals ADD COLUMN full_name TEXT DEFAULT ''`],
      ['exam_appeals', 'phone', `ALTER TABLE exam_appeals ADD COLUMN phone TEXT DEFAULT ''`],
      ['exam_appeals', 'class_name', `ALTER TABLE exam_appeals ADD COLUMN class_name TEXT DEFAULT ''`],
      ['exam_appeals', 'exam_title', `ALTER TABLE exam_appeals ADD COLUMN exam_title TEXT DEFAULT ''`],
      ['exam_appeals', 'exam_date', `ALTER TABLE exam_appeals ADD COLUMN exam_date TEXT DEFAULT ''`],
      ['exam_appeals', 'receipt_code', `ALTER TABLE exam_appeals ADD COLUMN receipt_code TEXT DEFAULT ''`],
      ['exam_appeals', 'evidence_files_json', `ALTER TABLE exam_appeals ADD COLUMN evidence_files_json TEXT DEFAULT '[]'`],
      ['exam_appeals', 'history_json', `ALTER TABLE exam_appeals ADD COLUMN history_json TEXT DEFAULT '[]'`],
      ['exam_support_requests', 'request_code', `ALTER TABLE exam_support_requests ADD COLUMN request_code TEXT`],
      ['exam_support_requests', 'phone', `ALTER TABLE exam_support_requests ADD COLUMN phone TEXT DEFAULT ''`],
      ['exam_support_requests', 'class_name', `ALTER TABLE exam_support_requests ADD COLUMN class_name TEXT DEFAULT ''`],
      ['exam_support_requests', 'exam_title', `ALTER TABLE exam_support_requests ADD COLUMN exam_title TEXT DEFAULT ''`],
      ['exam_support_requests', 'exam_date', `ALTER TABLE exam_support_requests ADD COLUMN exam_date TEXT DEFAULT ''`],
      ['exam_support_requests', 'occurred_at', `ALTER TABLE exam_support_requests ADD COLUMN occurred_at TEXT DEFAULT ''`],
      ['exam_support_requests', 'category', `ALTER TABLE exam_support_requests ADD COLUMN category TEXT DEFAULT 'support'`],
      ['exam_support_requests', 'priority', `ALTER TABLE exam_support_requests ADD COLUMN priority TEXT DEFAULT 'normal'`],
      ['exam_support_requests', 'steps_to_reproduce', `ALTER TABLE exam_support_requests ADD COLUMN steps_to_reproduce TEXT DEFAULT ''`],
      ['exam_support_requests', 'technical_meta_json', `ALTER TABLE exam_support_requests ADD COLUMN technical_meta_json TEXT DEFAULT '{}'`],
      ['exam_support_requests', 'evidence_files_json', `ALTER TABLE exam_support_requests ADD COLUMN evidence_files_json TEXT DEFAULT '[]'`],
      ['exam_support_requests', 'history_json', `ALTER TABLE exam_support_requests ADD COLUMN history_json TEXT DEFAULT '[]'`]
    ];

    for (const [tName, colName, sql] of alters) {
      const ddl = existingTables.get(tName) || '';
      const colRegex = new RegExp(`\\b${colName}\\b`, 'i');
      if (!colRegex.test(ddl)) {
        await env.DB.prepare(sql).run().catch(() => {});
      }
    }

    await ensureUserAuthSchema(env.DB);

    // Seed server-controlled one-time initialization state for the Supreme System Owner
    const priorOwnerSessions = await env.DB.prepare(
      `SELECT COUNT(*) n FROM exam_admin_sessions WHERE LOWER(email)='skyfirst.ec@gmail.com'`
    ).first().catch(() => ({ n: 0 }));
    const hasPriorSessions = Number(priorOwnerSessions?.n || 0) > 0;
    await env.DB.prepare(
      `INSERT OR IGNORE INTO exam_owner_bootstrap_state(state_key,owner_email,status,used_count,max_uses,locked_at) VALUES('supreme_owner_first_login','skyfirst.ec@gmail.com',?,?,1,?)`
    ).bind(
      hasPriorSessions ? 'locked' : 'armed',
      hasPriorSessions ? 1 : 0,
      hasPriorSessions ? new Date().toISOString() : null
    ).run().catch(() => {});

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
