-- =============================================================================
-- SKY FIRST EXAM 2026 — MIGRATION 0002: UPGRADE EXISTING / LEGACY SCHEMA
-- Safe, idempotent upgrade script for environments that already have the
-- original 16 core tables or an earlier 0001 schema.
-- Note: For D1 databases where some ALTER TABLE columns may already exist,
-- the Worker's ensureAdditiveSchema(env) also applies these idempotently at
-- runtime.
-- =============================================================================

CREATE TABLE IF NOT EXISTS exam_otp_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  scope_id TEXT DEFAULT '',
  otp_hash TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 5,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  verified_token_hash TEXT,
  verified_expires_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exam_admin_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  roles_json TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exam_question_bank (
  id TEXT PRIMARY KEY,
  code TEXT,
  topic TEXT DEFAULT 'Chung',
  difficulty TEXT DEFAULT 'medium',
  tags_json TEXT DEFAULT '[]',
  type TEXT NOT NULL,
  question TEXT NOT NULL,
  options_json TEXT DEFAULT '[]',
  answer_json TEXT,
  explanation TEXT DEFAULT '',
  points REAL DEFAULT 1,
  stimulus_json TEXT,
  content_language TEXT DEFAULT 'vi',
  script_direction TEXT DEFAULT 'ltr',
  numeric_tolerance REAL,
  recording_duration_seconds INTEGER,
  version INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active',
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exam_question_versions (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  changed_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exam_enrollments (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL,
  user_id TEXT,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  candidate_code TEXT NOT NULL,
  class_name TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  verified_at TEXT,
  notes TEXT DEFAULT '',
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (exam_id, email)
);

CREATE TABLE IF NOT EXISTS exam_appeals (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  exam_id TEXT NOT NULL,
  candidate_email TEXT,
  candidate_code TEXT,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  resolution_note TEXT DEFAULT '',
  score_before REAL,
  score_after REAL,
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exam_support_requests (
  id TEXT PRIMARY KEY,
  exam_id TEXT,
  attempt_id TEXT,
  candidate_name TEXT,
  candidate_email TEXT,
  candidate_code TEXT,
  issue_type TEXT DEFAULT 'technical',
  message TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  resolution_note TEXT DEFAULT '',
  resolved_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exam_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  count INTEGER DEFAULT 1,
  window_start_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exams_status ON exams(status);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_exam ON exam_attempts(exam_id, status);
CREATE INDEX IF NOT EXISTS idx_exam_guest_attempts_exam ON exam_guest_attempts(exam_id, status);
CREATE INDEX IF NOT EXISTS idx_exam_enrollments_exam ON exam_enrollments(exam_id, email);
CREATE INDEX IF NOT EXISTS idx_exam_otp_email ON exam_otp_challenges(email, purpose);
CREATE INDEX IF NOT EXISTS idx_exam_qbank_topic ON exam_question_bank(topic, difficulty, status);
CREATE INDEX IF NOT EXISTS idx_exam_audit_exam ON exam_audit_log(exam_id, event_type);
