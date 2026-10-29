-- =============================================================================
-- SKY FIRST EXAM 2026 — FULL STANDALONE D1 SCHEMA MIGRATION (NON-DESTRUCTIVE)
-- Compatible with Cloudflare D1 / SQLite 3.40+
-- Preserves all 16 core tables and extends schema with additive tables/indexes
-- for independent OTP, Admin RBAC, Question Bank, Enrollments, and Appeals.
-- =============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  description TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  full_name TEXT,
  sfn_id TEXT,
  email TEXT,
  status TEXT DEFAULT 'active',
  role TEXT DEFAULT 'candidate',
  roles_json TEXT DEFAULT '["candidate"]',
  class_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  instructions TEXT,
  duration_minutes INTEGER DEFAULT 60,
  time_limit_enabled INTEGER DEFAULT 1,
  strict_mode INTEGER DEFAULT 0,
  fullscreen_required INTEGER DEFAULT 0,
  show_score INTEGER DEFAULT 1,
  assessment_type TEXT DEFAULT 'assessment',
  assessment_label TEXT DEFAULT 'Đánh giá năng lực',
  center_label TEXT DEFAULT 'Hệ Thống Khảo Thí Và Đánh Giá Sky First',
  result_policy TEXT DEFAULT 'score_after_submit',
  result_release_at TEXT,
  opens_at TEXT,
  closes_at TEXT,
  status TEXT DEFAULT 'draft',
  security_profile TEXT DEFAULT 'STANDARD',
  allow_clipboard INTEGER DEFAULT 1,
  allow_paste INTEGER DEFAULT 1,
  allow_external_links INTEGER DEFAULT 0,
  device_policy TEXT DEFAULT 'single_session',
  resume_policy TEXT DEFAULT 'same_session',
  calculator_policy TEXT DEFAULT 'disabled',
  question_json TEXT DEFAULT '[]',
  class_id TEXT,
  sealed_version_id TEXT,
  public_token TEXT,
  public_access INTEGER DEFAULT 0,
  require_email_verify INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 1,
  passing_score REAL DEFAULT 0,
  violation_threshold INTEGER DEFAULT 0,
  randomize_questions INTEGER DEFAULT 0,
  randomize_options INTEGER DEFAULT 0,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assessment_exam_versions (
  id TEXT PRIMARY KEY,
  exam_id TEXT,
  version_number INTEGER DEFAULT 1,
  snapshot_json TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exam_attempts (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT DEFAULT 'in_progress',
  started_at TEXT DEFAULT CURRENT_TIMESTAMP,
  duration_minutes INTEGER DEFAULT 60,
  time_limit_enabled INTEGER DEFAULT 1,
  extra_time_minutes INTEGER DEFAULT 0,
  answers_json TEXT DEFAULT '{}',
  event_log_json TEXT DEFAULT '[]',
  score REAL,
  max_score REAL,
  submitted_at TEXT,
  last_saved_at TEXT,
  answer_revision INTEGER DEFAULT 0,
  question_snapshot_json TEXT,
  exam_version_id TEXT,
  lock_reason TEXT,
  locked_at TEXT,
  unlocked_by TEXT,
  unlocked_at TEXT
);

CREATE TABLE IF NOT EXISTS exam_guest_attempts (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL,
  status TEXT DEFAULT 'in_progress',
  started_at TEXT DEFAULT CURRENT_TIMESTAMP,
  duration_minutes INTEGER DEFAULT 60,
  time_limit_enabled INTEGER DEFAULT 1,
  extra_time_minutes INTEGER DEFAULT 0,
  answers_json TEXT DEFAULT '{}',
  event_log_json TEXT DEFAULT '[]',
  score REAL,
  max_score REAL,
  submitted_at TEXT,
  last_saved_at TEXT,
  answer_revision INTEGER DEFAULT 0,
  question_snapshot_json TEXT,
  exam_version_id TEXT,
  access_key TEXT,
  full_name TEXT,
  email TEXT,
  candidate_code TEXT,
  class_name TEXT,
  lock_reason TEXT,
  locked_at TEXT,
  unlocked_by TEXT,
  unlocked_at TEXT
);

CREATE TABLE IF NOT EXISTS exam_access_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT,
  attempt_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exam_launch_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT,
  attempt_id TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assessment_attempt_leases (
  attempt_id TEXT NOT NULL,
  source TEXT NOT NULL,
  session_id TEXT NOT NULL,
  claimed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (attempt_id, source)
);

CREATE TABLE IF NOT EXISTS assessment_answer_revisions (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  source TEXT NOT NULL,
  revision INTEGER NOT NULL,
  answers_json TEXT NOT NULL,
  events_json TEXT,
  accepted_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (attempt_id, revision)
);

CREATE TABLE IF NOT EXISTS assessment_response_files (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  source TEXT NOT NULL,
  question_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT,
  r2_key TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT,
  size INTEGER DEFAULT 0,
  visibility TEXT DEFAULT 'private',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assessment_manual_grades (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  grader_user_id TEXT,
  score REAL,
  feedback TEXT DEFAULT '',
  status TEXT DEFAULT 'draft',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS assessment_receipts (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  receipt_code TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (attempt_id)
);

CREATE TABLE IF NOT EXISTS assessment_result_workflows (
  attempt_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  state TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  published_by TEXT,
  published_at TEXT,
  revoked_by TEXT,
  revoked_at TEXT,
  revoke_reason TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exam_audit_log (
  id TEXT PRIMARY KEY,
  exam_id TEXT,
  attempt_id TEXT,
  actor_user_id TEXT,
  event_type TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

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
CREATE INDEX IF NOT EXISTS idx_exams_public_token ON exams(public_token);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_exam ON exam_attempts(exam_id, status);
CREATE INDEX IF NOT EXISTS idx_exam_guest_attempts_exam ON exam_guest_attempts(exam_id, status);
CREATE INDEX IF NOT EXISTS idx_exam_enrollments_exam ON exam_enrollments(exam_id, email);
CREATE INDEX IF NOT EXISTS idx_exam_otp_email ON exam_otp_challenges(email, purpose);
CREATE INDEX IF NOT EXISTS idx_exam_qbank_topic ON exam_question_bank(topic, difficulty, status);
CREATE INDEX IF NOT EXISTS idx_exam_audit_exam ON exam_audit_log(exam_id, event_type);

CREATE TABLE IF NOT EXISTS exam_fraud_reports (
  id TEXT PRIMARY KEY,
  request_code TEXT NOT NULL UNIQUE,
  reporter_name TEXT NOT NULL,
  reporter_phone TEXT NOT NULL,
  reporter_email TEXT NOT NULL,
  class_name TEXT NOT NULL,
  exam_id TEXT,
  exam_title TEXT NOT NULL,
  exam_date TEXT NOT NULL,
  reported_candidate_code TEXT DEFAULT '',
  reported_info TEXT DEFAULT '',
  content TEXT NOT NULL,
  evidence_url TEXT DEFAULT '',
  evidence_files_json TEXT DEFAULT '[]',
  status TEXT DEFAULT 'received',
  resolution_note TEXT DEFAULT '',
  resolved_by TEXT,
  resolved_at TEXT,
  history_json TEXT DEFAULT '[]',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exam_service_files (
  id TEXT PRIMARY KEY,
  service_type TEXT NOT NULL,
  request_id TEXT,
  r2_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  safe_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  uploaded_by_email TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exam_email_logs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE,
  event_type TEXT NOT NULL,
  template_file TEXT NOT NULL,
  sender_address TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT DEFAULT '',
  provider_message_id TEXT,
  retry_count INTEGER DEFAULT 0,
  error_detail TEXT DEFAULT '',
  exam_id TEXT,
  attempt_id TEXT,
  request_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_exam_fraud_reports_code ON exam_fraud_reports(request_code);
CREATE INDEX IF NOT EXISTS idx_exam_service_files_req ON exam_service_files(service_type, request_id);
CREATE INDEX IF NOT EXISTS idx_exam_email_logs_event ON exam_email_logs(event_type, status);
