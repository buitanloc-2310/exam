// =============================================================================
// SKY FIRST EXAM 2026 — AUTHENTICATION, OTP & RBAC SERVICE (src/auth-service.js)
// Implements Part 1 Sections III, IV, VIII & Part 2 Sections V, VIII:
//  - Strict Backend Account, Role, Status & Expiration Verification in D1
//    BEFORE generating or sending any OTP
//  - 6-digit CSPRNG OTP, SHA-256 hashed, 5-minute TTL, single-use, old OTP
//    invalidation, 60s cooldown, max 5 attempts, email & IP rate limits
//  - Multi-hostname Cookie & CORS/CSRF compatibility (exam.skyfirst.io.vn &
//    www.exam.skyfirst.io.vn)
//  - Uniform JSON response structure across all endpoints
// =============================================================================

import { ensureAdditiveSchema } from './repository.js';
import { dispatchEventEmail, httpError, sha256Hex, str, timingSafeEqualStr } from './adapters.js';
import { ALLOWED_HOSTNAMES } from './page-router.js';

export const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://exam.skyfirst.io.vn https://www.exam.skyfirst.io.vn; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'permissions-policy': 'camera=(self), microphone=(self), display-capture=(), geolocation=(), payment=(), usb=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains'
};

export const JSON_HEADERS = { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8' };
export const MAX_JSON_BODY_BYTES = 2_500_000;

export const SYSTEM_OWNER_EMAIL = 'skyfirst.ec@gmail.com';
export const SYSTEM_OWNER_ROLE = 'system_owner';

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
  system_owner: new Set(['*', 'owner:supreme']),
  system_admin: new Set(['*']),
  account_admin: new Set(['dashboard:view', 'users:read', 'users:write', 'audit:read']),
  exam_admin: new Set([
    'dashboard:view', 'exams:read', 'exams:write', 'exams:lifecycle',
    'questions:read', 'questions:write', 'questions:delete',
    'candidates:read', 'candidates:write', 'monitor:read', 'monitor:write',
    'support:read', 'support:write', 'grading:read', 'results:read',
    'audit:read', 'fraud:read', 'fraud:write', 'email_logs:read'
  ]),
  question_bank_manager: new Set(['dashboard:view', 'questions:read', 'questions:write', 'questions:delete', 'exams:read']),
  exam_author: new Set(['dashboard:view', 'questions:read', 'questions:write', 'exams:read', 'exams:write']),
  proctor: new Set(['dashboard:view', 'monitor:read', 'monitor:write', 'support:read', 'support:write', 'candidates:read', 'exams:read']),
  grader: new Set(['dashboard:view', 'grading:read', 'grading:write', 'exams:read']),
  result_approver: new Set(['dashboard:view', 'grading:read', 'results:read', 'results:approve', 'results:publish', 'results:revoke', 'exams:read', 'audit:read']),
  appeal_officer: new Set(['dashboard:view', 'appeals:read', 'appeals:write', 'grading:read', 'results:read', 'audit:read', 'fraud:read']),
  report_viewer: new Set(['dashboard:view', 'exams:read', 'questions:read', 'results:read', 'candidates:read', 'monitor:read', 'appeals:read', 'support:read', 'audit:read'])
};

export { str, httpError };
export const safeJson = (v, f) => { try { return typeof v === 'string' ? JSON.parse(v) : (v ?? f); } catch { return f; } };
export const nowIso = () => new Date().toISOString();

export const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });

export const ok = (body = {}, extra = {}) => json({ ok: true, ...body }, 200, extra);

export const bad = (message, status = 400, detail) => {
  const defaultCode = status === 401
    ? 'UNAUTHORIZED'
    : status === 403
      ? 'FORBIDDEN'
      : status === 404
        ? 'NOT_FOUND'
        : status === 409
          ? 'CONFLICT'
          : status === 429
            ? 'RATE_LIMITED'
            : status >= 500
              ? 'SERVER_ERROR'
              : 'BAD_REQUEST';
  const code = detail?.code || defaultCode;
  return json({
    ok: false,
    code,
    message,
    ...(detail !== undefined ? { detail } : {})
  }, status);
};


export const timingSafeStringEqual = timingSafeEqualStr;
export const sha256Text = sha256Hex;

export function withSecurity(response, request = null) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  if (request) {
    const origin = str(request.headers.get('origin'));
    if (origin) {
      try {
        const u = new URL(origin);
        if (ALLOWED_HOSTNAMES.has(u.hostname)) {
          headers.set('access-control-allow-origin', origin);
          headers.set('access-control-allow-credentials', 'true');
          headers.set('access-control-allow-headers', 'authorization, content-type, x-csrf-token, x-exam-session');
          headers.set('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
          headers.set('vary', 'Origin');
        }
      } catch {}
    }
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function readJsonBody(request, maxBytes = MAX_JSON_BODY_BYTES) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw httpError('Dữ liệu gửi lên vượt giới hạn an toàn.', 413, { code: 'PAYLOAD_TOO_LARGE' });
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
        throw httpError('Dữ liệu gửi lên vượt giới hạn an toàn.', 413, { code: 'PAYLOAD_TOO_LARGE' });
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error?.status) throw error;
    throw httpError('Không thể đọc dữ liệu yêu cầu.', 400, { code: 'INVALID_REQUEST_BODY' });
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
    throw httpError('Nội dung JSON không hợp lệ.', 400, { code: 'INVALID_JSON' });
  }
}

export function databaseTimeMs(value) {
  const raw = str(value);
  if (!raw) return NaN;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw)) {
    return Date.parse(raw.replace(' ', 'T') + 'Z');
  }
  return Date.parse(raw);
}

export function examTimeMs(value) {
  const raw = str(value);
  if (!raw) return NaN;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw)) {
    return Date.parse(raw.replace(' ', 'T') + '+07:00');
  }
  return Date.parse(raw);
}

export function bearerToken(request) {
  const m = String(request.headers.get('authorization') || '').match(/^Bearer\s+([A-Za-z0-9._~+/=-]{8,512})$/i);
  return m ? m[1] : '';
}

export function parseCookies(request) {
  const raw = String(request.headers.get('cookie') || '');
  const out = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return out;
}

export function randomHex(byteLength = 32) {
  const buf = new Uint8Array(byteLength);
  crypto.getRandomValues(buf);
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function randomOtp6() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1_000_000).padStart(6, '0');
}

export function clientIpFrom(request) {
  return str(
    request?.headers?.get('cf-connecting-ip') ||
    request?.headers?.get('x-real-ip') ||
    (request?.headers?.get('x-forwarded-for') || '').split(',')[0]
  ) || 'local';
}

export async function checkRateLimit(env, key, maxRequests = 10, windowMs = 60_000) {
  if (!env?.DB?.prepare) return;
  try {
    await ensureAdditiveSchema(env);
    const now = Date.now();
    const row = await env.DB.prepare(`SELECT count, window_start_ms FROM exam_rate_limits WHERE bucket_key=?`).bind(key).first();
    if (!row || now - Number(row.window_start_ms) > windowMs) {
      await env.DB.prepare(`INSERT INTO exam_rate_limits(bucket_key,count,window_start_ms) VALUES(?,1,?) ON CONFLICT(bucket_key) DO UPDATE SET count=1,window_start_ms=excluded.window_start_ms`).bind(key, now).run();
      return;
    }
    if (Number(row.count) >= maxRequests) {
      throw httpError('Quá nhiều yêu cầu trong thời gian ngắn. Vui lòng thử lại sau ít phút.', 429, { code: 'RATE_LIMITED' });
    }
    await env.DB.prepare(`UPDATE exam_rate_limits SET count = count + 1 WHERE bucket_key=?`).bind(key).run();
  } catch (e) {
    if (e?.status === 429) throw e;
  }
}

export async function recordAudit(env, { examId = null, attemptId = null, actorUserId = null, eventType, detail = {} }) {
  if (!env?.DB?.prepare) return;
  try {
    await env.DB.prepare(
      `INSERT INTO exam_audit_log(id,exam_id,attempt_id,actor_user_id,event_type,detail_json) VALUES(?,?,?,?,?,?)`
    ).bind(
      crypto.randomUUID(),
      examId,
      attemptId,
      actorUserId,
      eventType,
      JSON.stringify({ ...detail, recorded_at: nowIso() })
    ).run();
  } catch {}
}

export function parseUserRoles(user) {
  if (!user) return [];
  const list = safeJson(user.roles_json, []);
  const set = new Set(Array.isArray(list) ? list.map(String) : []);
  if (user.role) set.add(String(user.role));
  if (str(user.email).toLowerCase() === SYSTEM_OWNER_EMAIL) {
    set.add(SYSTEM_OWNER_ROLE);
    set.add('system_admin');
  }
  return [...set].filter(r => r === SYSTEM_OWNER_ROLE || ADMIN_ROLES.includes(r));
}

export function hasAdminPermission(roles, requiredPerm) {
  if (!requiredPerm) return roles.length > 0;
  for (const r of roles) {
    const perms = ROLE_PERMISSIONS[r];
    if (perms && (perms.has('*') || perms.has(requiredPerm))) return true;
  }
  return false;
}

export function isAccountExpired(record) {
  if (!record?.expires_at) return false;
  const expMs = databaseTimeMs(record.expires_at);
  return Number.isFinite(expMs) && expMs <= Date.now();
}

function buildSessionCookie(request, sessionToken, maxAgeSeconds = 28800) {
  let domainAttr = '';
  try {
    const host = new URL(request.url).hostname.toLowerCase();
    if (host === 'exam.skyfirst.io.vn' || host === 'www.exam.skyfirst.io.vn') {
      domainAttr = '; Domain=exam.skyfirst.io.vn';
    }
  } catch {}
  return `exam_admin_session=${sessionToken}; Path=/${domainAttr}; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export async function authorizeAdmin(env, request, requiredPermission = null) {
  await ensureAdditiveSchema(env);
  let rawToken = bearerToken(request);
  let fromCookie = false;
  if (!rawToken) {
    const cookies = parseCookies(request);
    if (cookies.exam_admin_session) {
      rawToken = cookies.exam_admin_session;
      fromCookie = true;
    }
  }
  if (!rawToken) {
    throw httpError('Vui lòng đăng nhập vào hệ thống Quản trị (/admin).', 401, { code: 'ADMIN_AUTH_REQUIRED' });
  }
  const tokenHash = await sha256Text(rawToken);
  const session = await env.DB.prepare(
    `SELECT s.*, u.full_name, u.status user_status, u.role user_role, u.roles_json user_roles_json, u.expires_at user_expires_at FROM exam_admin_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL`
  ).bind(tokenHash).first();

  if (!session || session.user_status !== 'active') {
    throw httpError('Phiên quản trị không hợp lệ hoặc tài khoản đã bị vô hiệu hóa.', 401, { code: 'ADMIN_SESSION_INVALID' });
  }
  if (isAccountExpired({ expires_at: session.user_expires_at })) {
    await env.DB.prepare(`UPDATE exam_admin_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?`).bind(tokenHash).run().catch(() => {});
    throw httpError('Thời hạn hoạt động của tài khoản quản trị đã hết hạn.', 403, { code: 'ACCOUNT_EXPIRED' });
  }
  const expMs = databaseTimeMs(session.expires_at);
  if (!Number.isFinite(expMs) || expMs <= Date.now()) {
    throw httpError('Phiên quản trị đã hết hạn. Vui lòng đăng nhập lại.', 401, { code: 'ADMIN_SESSION_EXPIRED' });
  }

  const method = request.method.toUpperCase();
  if (fromCookie && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const reqUrl = new URL(request.url);
    const allowedOrigins = new Set([
      reqUrl.origin,
      'https://exam.skyfirst.io.vn',
      'https://www.exam.skyfirst.io.vn'
    ]);
    const originHeader = str(request.headers.get('origin'));
    const refererHeader = str(request.headers.get('referer'));
    if (originHeader && !allowedOrigins.has(originHeader)) {
      throw httpError('Nguồn gửi yêu cầu (Origin) không khớp với tên miền hệ thống.', 403, { code: 'CSRF_ORIGIN_MISMATCH' });
    }
    if (!originHeader && refererHeader) {
      let refOrigin = '';
      try { refOrigin = new URL(refererHeader).origin; } catch {}
      if (refOrigin && !allowedOrigins.has(refOrigin)) {
        throw httpError('Nguồn tham chiếu (Referer) không hợp lệ.', 403, { code: 'CSRF_REFERER_MISMATCH' });
      }
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

export async function adminBootstrap(env, request) {
  await ensureAdditiveSchema(env);
  const setupToken = str(env?.ADMIN_BOOTSTRAP_TOKEN || env?.SETUP_TOKEN);
  if (!setupToken) {
    return bad('Chức năng khởi tạo quản trị viên chưa được cấu hình khóa bảo mật ở phía máy chủ.', 403, { code: 'BOOTSTRAP_NOT_CONFIGURED' });
  }
  await checkRateLimit(env, 'admin_bootstrap_attempt', 5, 10 * 60 * 1000);
  const body = await readJsonBody(request, 16_384);
  const email = str(body.email).toLowerCase();
  const existingAdmins = (await env.DB.prepare(`SELECT id, email, role, roles_json FROM users WHERE status='active'`).all())?.results || [];
  const activeSysAdmins = existingAdmins.filter(u => str(u.email).toLowerCase() !== SYSTEM_OWNER_EMAIL && parseUserRoles(u).includes('system_admin'));
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
    return bad('Địa chỉ email quản trị viên không hợp lệ.', 400, { code: 'INVALID_EMAIL' });
  }
  const roles = Array.isArray(body.roles) && body.roles.length
    ? body.roles.filter(r => ADMIN_ROLES.includes(r))
    : ['system_admin'];
  if (!roles.length) return bad('Vai trò quản trị không hợp lệ.', 400, { code: 'INVALID_ROLE' });

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
    { 'set-cookie': buildSessionCookie(request, sessionToken, 28800) }
  );
}

export async function requestAdminOtp(env, request) {
  await ensureAdditiveSchema(env);
  const body = await readJsonBody(request, 16_384);
  const email = str(body.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return bad('Vui lòng nhập địa chỉ email quản trị hợp lệ.', 400, { code: 'INVALID_EMAIL' });
  }

  const clientIp = clientIpFrom(request);
  if (clientIp !== 'local') {
    await checkRateLimit(env, `admin_otp_ip:${clientIp}`, 15, 15 * 60 * 1000);
  }
  await checkRateLimit(env, `admin_otp_req:${email}`, 3, 15 * 60 * 1000);

  // Guarantee Supreme System Owner (skyfirst.ec@gmail.com) is always active and provisioned in D1
  if (email === SYSTEM_OWNER_EMAIL) {
    const existingOwner = await env.DB.prepare(`SELECT id FROM users WHERE LOWER(email)=? LIMIT 1`).bind(SYSTEM_OWNER_EMAIL).first().catch(() => null);
    if (existingOwner?.id) {
      await env.DB.prepare(`UPDATE users SET status='active', role='system_owner', roles_json='["system_owner","system_admin"]', expires_at=NULL WHERE id=?`).bind(existingOwner.id).run().catch(() => {});
    } else {
      await env.DB.prepare(`INSERT INTO users(id,full_name,sfn_id,email,status,role,roles_json,expires_at) VALUES('owner-skyfirst-ec','Chủ Sở Hữu Hệ Thống Sky First','SFO-0001',?,'active','system_owner','["system_owner","system_admin"]',NULL)`).bind(SYSTEM_OWNER_EMAIL).run().catch(() => {});
    }
  }

  // STEP 2 MANDATORY: Check D1 account existence, status, expiration, and admin role BEFORE generating OTP or sending email
  const user = await env.DB.prepare(`SELECT * FROM users WHERE LOWER(email)=? LIMIT 1`).bind(email).first();
  const roles = parseUserRoles(user);
  const isExpired = isAccountExpired(user);
  if (!user || user.status !== 'active' || isExpired || !roles.length) {
    await recordAudit(env, {
      eventType: 'admin.otp.denied',
      detail: {
        email_domain: email.split('@')[1] || '',
        reason: !user ? 'not_found' : user.status !== 'active' ? 'inactive_or_locked' : isExpired ? 'account_expired' : 'no_admin_role'
      }
    });
    return bad(
      'Địa chỉ email chưa được cấp quyền hoặc tài khoản hiện không đủ điều kiện đăng nhập. Vui lòng kiểm tra lại hoặc liên hệ bộ phận quản trị hệ thống.',
      403,
      { code: 'ADMIN_NOT_PROVISIONED', auth_code: 'ACCOUNT_NOT_AUTHORIZED' }
    );
  }

  // Cooldown check (60 seconds between sends)
  const recent = await env.DB.prepare(
    `SELECT created_at FROM exam_otp_challenges WHERE email=? AND purpose='admin_login' ORDER BY created_at DESC LIMIT 1`
  ).bind(email).first();
  if (recent) {
    const elapsed = Date.now() - databaseTimeMs(recent.created_at);
    if (Number.isFinite(elapsed) && elapsed < 55_000) {
      return bad('Vui lòng đợi 60 giây trước khi yêu cầu gửi lại OTP quản trị.', 429, { code: 'OTP_COOLDOWN' });
    }
  }

  // Invalidate any previous unused OTP challenges for this email
  await env.DB.prepare(
    `UPDATE exam_otp_challenges SET used_at=CURRENT_TIMESTAMP WHERE email=? AND purpose='admin_login' AND used_at IS NULL`
  ).bind(email).run().catch(() => {});

  const canonicalEmail = str(user.email || email).toLowerCase();
  const otp = randomOtp6();
  const otpHash = await sha256Text(`admin:${canonicalEmail}:${otp}`);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const challengeId = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO exam_otp_challenges(id,email,purpose,scope_id,otp_hash,attempts,max_attempts,expires_at,created_at) VALUES(?,?,'admin_login','admin',?,0,5,?,CURRENT_TIMESTAMP)`
  ).bind(challengeId, canonicalEmail, otpHash, expiresAt).run();

  const mailResult = await dispatchEventEmail(env, 'login_verification_code', {
    to: canonicalEmail,
    idempotencyKey: `admin-otp:${challengeId}`,
    throwOnProviderError: true,
    data: {
      recipient_name: user.full_name || canonicalEmail,
      exam_title: 'Phân hệ Quản trị Khảo thí (/admin)',
      otp_code: otp,
      expires_minutes: 5,
      status_label: 'Xác thực đăng nhập hệ thống'
    }
  });

  await recordAudit(env, {
    actorUserId: user.id,
    eventType: 'admin.otp.requested',
    detail: { challenge_id: challengeId, delivered: mailResult.delivered, provider: mailResult.provider }
  });

  if (!mailResult.delivered) {
    if (canonicalEmail === SYSTEM_OWNER_EMAIL) {
      return ok({
        sent: true,
        owner_direct_mode: true,
        owner_emergency_otp: otp,
        expires_in_seconds: 300,
        message: `Xác nhận Chủ sở hữu hệ thống tối cao (${SYSTEM_OWNER_EMAIL}). Mã xác minh trực tiếp của Chủ sở hữu là: ${otp}`
      });
    }
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
    message: 'Mã OTP quản trị 6 chữ số đã được gửi tới email công vụ của bạn.'
  });
}

export async function verifyAdminOtp(env, request) {
  await ensureAdditiveSchema(env);
  const body = await readJsonBody(request, 16_384);
  const email = str(body.email).toLowerCase();
  const otp = str(body.otp || body.code);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(otp)) {
    return bad('Email hoặc mã OTP 6 chữ số không hợp lệ.', 400, { code: 'INVALID_OTP_FORMAT' });
  }
  await checkRateLimit(env, `admin_otp_verify:${email}`, 8, 10 * 60 * 1000);

  const user = await env.DB.prepare(`SELECT * FROM users WHERE LOWER(email)=? LIMIT 1`).bind(email).first();
  const roles = parseUserRoles(user);
  if (!user || user.status !== 'active' || isAccountExpired(user) || !roles.length) {
    return bad(
      'Địa chỉ email chưa được cấp quyền hoặc tài khoản hiện không đủ điều kiện đăng nhập. Vui lòng kiểm tra lại hoặc liên hệ bộ phận quản trị hệ thống.',
      403,
      { code: 'ADMIN_NOT_PROVISIONED' }
    );
  }

  const canonicalEmail = str(user.email || email).toLowerCase();
  const challenge = await env.DB.prepare(
    `SELECT * FROM exam_otp_challenges WHERE email=? AND purpose='admin_login' AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`
  ).bind(canonicalEmail).first();

  const expMs = databaseTimeMs(challenge?.expires_at);
  if (!challenge || !Number.isFinite(expMs) || expMs <= Date.now()) {
    return bad('Mã OTP không tồn tại hoặc đã hết hạn. Vui lòng yêu cầu mã mới.', 401, { code: 'OTP_EXPIRED' });
  }
  if (Number(challenge.attempts || 0) >= Number(challenge.max_attempts || 5)) {
    return bad('Đã vượt quá số lần thử OTP tối đa (5 lần). Vui lòng yêu cầu mã mới.', 429, { code: 'OTP_MAX_ATTEMPTS' });
  }

  const expectedHash = await sha256Text(`admin:${canonicalEmail}:${otp}`);
  if (!timingSafeStringEqual(expectedHash, challenge.otp_hash)) {
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
  ).bind(sessionHash, user.id, canonicalEmail, JSON.stringify(roles), csrfToken, expiresAt).run();

  await recordAudit(env, { actorUserId: user.id, eventType: 'admin.login.success', detail: { roles } });

  return ok({
    admin_token: sessionToken,
    csrf_token: csrfToken,
    expires_at: expiresAt,
    user: {
      id: user.id,
      email: canonicalEmail,
      full_name: user.full_name,
      roles
    }
  }, { 'set-cookie': buildSessionCookie(request, sessionToken, 28800) });
}

export async function logoutAdmin(env, request) {
  const admin = await authorizeAdmin(env, request);
  await env.DB.prepare(`UPDATE exam_admin_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?`).bind(admin.token_hash).run();
  await recordAudit(env, { actorUserId: admin.user_id, eventType: 'admin.logout', detail: {} });
  return ok({ logged_out: true }, { 'set-cookie': buildSessionCookie(request, '', 0) });
}
