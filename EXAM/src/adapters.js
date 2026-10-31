// =============================================================================
// SKY FIRST EXAM 2026 — EXTERNAL SERVICE ADAPTERS LAYER (src/adapters.js)
// Decouples external integrations from core exam business logic:
//  1. EmailProviderAdapter (3 official senders, idempotency, retry, fallback)
//  2. IdentityVerificationAdapter (Third-party candidate identity verification
//     with HMAC signature check, anti-replay, reference tracking, privacy-first
//     minimal status storage, and graceful fallback)
//  3. ObjectStorageAdapter (R2 storage with MIME magic-byte signature validation)
// =============================================================================

import { EMAIL_SENDERS, renderEmailTemplate } from './email-templates.js';
import { ensureAdditiveSchema } from './repository.js';

export const str = v => String(v ?? '').trim();

export function httpError(message, status = 400, detail) {
  return Object.assign(new Error(message), { status, detail });
}

export async function sha256Hex(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(String(secret || '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(String(message || '')));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqualStr(a, b) {
  const s1 = String(a ?? ''), s2 = String(b ?? '');
  const e1 = new TextEncoder().encode(s1), e2 = new TextEncoder().encode(s2);
  const len = Math.max(e1.length, e2.length);
  let diff = e1.length ^ e2.length;
  for (let i = 0; i < len; i++) {
    diff |= (e1[i] || 0) ^ (e2[i] || 0);
  }
  return diff === 0 && e1.length > 0;
}

// =============================================================================
// 1. EMAIL PROVIDER ADAPTER
// =============================================================================
export async function logEmailState(env, entry) {
  if (!env?.DB?.prepare) return;
  try {
    await ensureAdditiveSchema(env);
    await env.DB.prepare(
      `INSERT INTO exam_email_logs(id,idempotency_key,event_type,template_file,sender_address,recipient_email,subject,status,provider,provider_message_id,retry_count,error_detail,exam_id,attempt_id,request_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET status=excluded.status,provider=excluded.provider,provider_message_id=excluded.provider_message_id,retry_count=excluded.retry_count,error_detail=excluded.error_detail,updated_at=CURRENT_TIMESTAMP`
    ).bind(
      entry.id,
      entry.idempotency_key || null,
      entry.event_type || 'system_notification',
      entry.template_file || 'system-notification.html',
      entry.sender_address || EMAIL_SENDERS.NOREPLY,
      entry.recipient_email || '',
      entry.subject || '',
      entry.status || 'queued',
      entry.provider || '',
      entry.provider_message_id || null,
      Number(entry.retry_count || 0),
      String(entry.error_detail || '').slice(0, 500),
      entry.exam_id || null,
      entry.attempt_id || null,
      entry.request_id || null
    ).run();
  } catch {
    // Non-blocking log write
  }
}

export async function dispatchBusinessEmail(env, {
  to,
  subject,
  text,
  html,
  eventType = 'system_notification',
  templateFile = 'system-notification.html',
  senderAddress = '',
  category = 'noreply',
  idempotencyKey = '',
  examId = null,
  attemptId = null,
  requestId = null,
  throwOnProviderError = false
}) {
  const cleanTo = str(to).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanTo) || cleanTo.length > 220) {
    return { delivered: false, status: 'rejected', provider: 'validation', reason: 'Địa chỉ email người nhận không hợp lệ.' };
  }

  const resolvedSender = Object.values(EMAIL_SENDERS).includes(senderAddress)
    ? senderAddress
    : (category === 'exam' ? EMAIL_SENDERS.EXAM : category === 'support' ? EMAIL_SENDERS.SUPPORT : EMAIL_SENDERS.NOREPLY);

  if (idempotencyKey && env?.DB?.prepare) {
    try {
      await ensureAdditiveSchema(env);
      const existing = await env.DB.prepare(
        `SELECT id, status, provider, provider_message_id FROM exam_email_logs WHERE idempotency_key=? LIMIT 1`
      ).bind(idempotencyKey).first();
      if (existing && (existing.status === 'sent' || existing.status === 'delivered')) {
        return {
          delivered: true,
          deduplicated: true,
          status: existing.status,
          provider: existing.provider || 'idempotent_cache',
          message_id: existing.provider_message_id || existing.id,
          from: resolvedSender
        };
      }
    } catch {}
  }

  const logId = crypto.randomUUID();
  const baseLog = {
    id: logId,
    idempotency_key: idempotencyKey || null,
    event_type: eventType,
    template_file: templateFile,
    sender_address: resolvedSender,
    recipient_email: cleanTo,
    subject: str(subject).slice(0, 240),
    exam_id: examId,
    attempt_id: attemptId,
    request_id: requestId
  };

  await logEmailState(env, { ...baseLog, status: 'queued', provider: 'pending', retry_count: 0 });

  if (typeof env?.EMAIL_DISPATCHER === 'function') {
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await env.EMAIL_DISPATCHER({
          from: resolvedSender,
          to: cleanTo,
          subject,
          text,
          html,
          category,
          event_type: eventType,
          template_file: templateFile
        });
        const msgId = res?.id || res?.message_id || `disp-${logId.slice(0, 8)}`;
        await logEmailState(env, {
          ...baseLog,
          status: 'sent',
          provider: 'custom_dispatcher',
          provider_message_id: String(msgId),
          retry_count: attempt
        });
        return { delivered: true, status: 'sent', provider: 'custom_dispatcher', message_id: String(msgId), from: resolvedSender };
      } catch (err) {
        lastErr = err;
        if (err?.status && err.status >= 400 && err.status < 500) break;
      }
    }
    await logEmailState(env, {
      ...baseLog,
      status: 'failed',
      provider: 'custom_dispatcher',
      retry_count: 1,
      error_detail: lastErr?.message || 'Dispatcher error'
    });
    if (throwOnProviderError) {
      if (lastErr?.status) throw lastErr;
      throw httpError('Dịch vụ gửi email trả về lỗi.', 502, { code: 'EMAIL_PROVIDER_ERROR' });
    }
    return { delivered: false, status: 'failed', provider: 'custom_dispatcher', reason: lastErr?.message || 'Lỗi dịch vụ gửi email' };
  }

  const apiUrl = str(env?.EMAIL_API_URL);
  const apiKey = str(env?.EMAIL_API_KEY);
  if (apiUrl && apiKey) {
    let lastErr = null;
    let lastStatus = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'authorization': `Bearer ${apiKey}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            from: resolvedSender,
            to: [cleanTo],
            subject,
            text,
            html,
            headers: {
              'X-SkyFirst-Event': eventType,
              'X-SkyFirst-Template': templateFile
            }
          }),
          signal: controller.signal
        });
        lastStatus = response.status;
        if (response.ok) {
          let payload = null;
          try { payload = await response.json(); } catch {}
          const msgId = payload?.id || payload?.message_id || `http-${logId.slice(0, 8)}`;
          await logEmailState(env, {
            ...baseLog,
            status: 'sent',
            provider: 'http_api',
            provider_message_id: String(msgId),
            retry_count: attempt
          });
          return { delivered: true, status: 'sent', provider: 'http_api', message_id: String(msgId), from: resolvedSender };
        }
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          await logEmailState(env, {
            ...baseLog,
            status: 'rejected',
            provider: 'http_api',
            retry_count: attempt,
            error_detail: `HTTP ${response.status}`
          });
          if (throwOnProviderError) {
            throw httpError('Nhà cung cấp dịch vụ email từ chối yêu cầu gửi thư.', 502, { code: 'EMAIL_REJECTED', status: response.status });
          }
          return { delivered: false, status: 'rejected', provider: 'http_api', reason: `HTTP ${response.status}` };
        }
        lastErr = new Error(`HTTP ${response.status}`);
      } catch (err) {
        if (err?.status) throw err;
        lastErr = err;
      } finally {
        clearTimeout(timer);
      }
    }
    await logEmailState(env, {
      ...baseLog,
      status: 'failed',
      provider: 'http_api',
      retry_count: 1,
      error_detail: lastErr?.message || `HTTP ${lastStatus}`
    });
    if (throwOnProviderError) {
      throw httpError('Không thể kết nối dịch vụ gửi email.', 502, { code: 'EMAIL_NETWORK_ERROR' });
    }
    return { delivered: false, status: 'failed', provider: 'http_api', reason: lastErr?.message || 'Lỗi kết nối dịch vụ email' };
  }

  await logEmailState(env, {
    ...baseLog,
    status: 'unconfigured',
    provider: 'none',
    retry_count: 0,
    error_detail: 'EMAIL_SERVICE_UNCONFIGURED'
  });
  return {
    delivered: false,
    status: 'unconfigured',
    provider: 'none',
    from: resolvedSender,
    reason: 'Chưa cấu hình dịch vụ gửi email (EMAIL_API_URL / EMAIL_API_KEY) trong môi trường hiện tại.'
  };
}

export async function dispatchEventEmail(env, eventType, {
  to,
  data = {},
  idempotencyKey = '',
  examId = null,
  attemptId = null,
  requestId = null,
  throwOnProviderError = false
} = {}) {
  const rendered = renderEmailTemplate(eventType, {
    ...data,
    event_time: data.event_time || new Date().toISOString()
  });
  return dispatchBusinessEmail(env, {
    to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    eventType: rendered.event_type,
    templateFile: rendered.template_file,
    senderAddress: rendered.from,
    category: rendered.group,
    idempotencyKey,
    examId,
    attemptId,
    requestId,
    throwOnProviderError
  });
}

// =============================================================================
// 2. THIRD-PARTY CANDIDATE IDENTITY VERIFICATION ADAPTER (Appendix XV.2.3-2.5)
// Supports external identity verification providers via adapter interface.
// Privacy-first: stores ONLY verification status (verified/failed/pending/expired)
// and reference_code. NEVER stores raw biometric images, ID scans, or screen captures.
// =============================================================================
export async function verifyCandidateIdentityWithAdapter(env, {
  examId,
  candidateCode,
  email,
  fullName,
  verificationToken = '',
  providerReference = '',
  providerSignature = '',
  timestamp = '',
  fallbackPolicy = 'otp_fallback'
}) {
  await ensureAdditiveSchema(env);
  const cleanEmail = str(email).toLowerCase();
  const cleanCode = str(candidateCode);

  // Anti-replay check if a providerReference was already consumed
  if (providerReference && env?.DB?.prepare) {
    const existingRef = await env.DB.prepare(
      `SELECT id, status, email, candidate_code, expires_at FROM exam_identity_verifications WHERE reference_code=? LIMIT 1`
    ).bind(providerReference).first().catch(() => null);
    if (existingRef) {
      throw httpError('Mã tham chiếu xác minh danh tính đã được sử dụng (chống phát lại request).', 409, {
        code: 'VERIFICATION_REPLAY_DETECTED',
        reference_code: providerReference
      });
    }
  }

  // Case A: Custom injected adapter function (e.g. env.IDENTITY_VERIFIER)
  if (typeof env?.IDENTITY_VERIFIER === 'function') {
    try {
      const res = await env.IDENTITY_VERIFIER({
        exam_id: examId,
        candidate_code: cleanCode,
        email: cleanEmail,
        full_name: fullName,
        verification_token: verificationToken,
        reference_code: providerReference
      });
      const status = ['verified', 'failed', 'pending', 'expired'].includes(res?.status) ? res.status : 'failed';
      const refCode = str(res?.reference_code || providerReference || `IDV-${crypto.randomUUID().slice(0, 12).toUpperCase()}`);
      const expiresAt = res?.expires_at || new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await recordVerificationResult(env, {
        examId,
        candidateCode: cleanCode,
        email: cleanEmail,
        provider: str(res?.provider || 'custom_identity_adapter'),
        referenceCode: refCode,
        status,
        method: str(res?.method || 'third_party_api'),
        expiresAt
      });
      return { status, reference_code: refCode, provider: str(res?.provider || 'custom_identity_adapter'), fallback_used: false };
    } catch (err) {
      if (fallbackPolicy === 'strict_block') {
        throw httpError('Dịch vụ xác minh danh tính bên thứ ba đang gián đoạn.', 503, { code: 'IDENTITY_PROVIDER_UNAVAILABLE' });
      }
      const refCode = `FALLBACK-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
      return { status: 'verified', reference_code: refCode, provider: 'skyfirst_otp_fallback', fallback_used: true, reason: err?.message };
    }
  }

  // Case B: Official HMAC-signed Webhook/Token or HTTP API Provider (IDENTITY_API_URL + IDENTITY_API_SECRET)
  const apiUrl = str(env?.IDENTITY_API_URL);
  const apiSecret = str(env?.IDENTITY_API_SECRET);

  if (apiSecret && providerReference && providerSignature) {
    const tsMs = Number(timestamp) || Date.parse(timestamp);
    if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > 10 * 60 * 1000) {
      await recordVerificationResult(env, {
        examId,
        candidateCode: cleanCode,
        email: cleanEmail,
        provider: 'hmac_signed_provider',
        referenceCode: providerReference,
        status: 'expired',
        method: 'hmac_token'
      });
      throw httpError('Chữ ký xác minh danh tính đã hết thời hạn hiệu lực.', 401, { code: 'IDENTITY_SIGNATURE_EXPIRED' });
    }
    const payloadToSign = `${examId}:${cleanCode}:${cleanEmail}:${providerReference}:${timestamp}`;
    const expectedSig = await hmacSha256Hex(apiSecret, payloadToSign);
    if (!timingSafeEqualStr(providerSignature, expectedSig)) {
      await recordVerificationResult(env, {
        examId,
        candidateCode: cleanCode,
        email: cleanEmail,
        provider: 'hmac_signed_provider',
        referenceCode: providerReference,
        status: 'failed',
        method: 'hmac_token'
      });
      throw httpError('Chữ ký xác minh danh tính bên thứ ba không hợp lệ.', 401, { code: 'IDENTITY_SIGNATURE_INVALID' });
    }
    await recordVerificationResult(env, {
      examId,
      candidateCode: cleanCode,
      email: cleanEmail,
      provider: 'hmac_signed_provider',
      referenceCode: providerReference,
      status: 'verified',
      method: 'hmac_token'
    });
    return { status: 'verified', reference_code: providerReference, provider: 'hmac_signed_provider', fallback_used: false };
  }

  if (apiUrl && apiSecret) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const reqPayload = JSON.stringify({
        exam_id: examId,
        candidate_code: cleanCode,
        email: cleanEmail,
        verification_token: verificationToken
      });
      const reqSig = await hmacSha256Hex(apiSecret, reqPayload);
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${apiSecret}`,
          'x-skyfirst-signature': reqSig,
          'content-type': 'application/json'
        },
        body: reqPayload,
        signal: controller.signal
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || typeof data !== 'object') {
        throw new Error(`HTTP ${response.status}`);
      }
      const status = ['verified', 'failed', 'pending', 'expired'].includes(data.status) ? data.status : 'failed';
      const refCode = str(data.reference_code || `IDV-${crypto.randomUUID().slice(0, 12).toUpperCase()}`);
      await recordVerificationResult(env, {
        examId,
        candidateCode: cleanCode,
        email: cleanEmail,
        provider: str(data.provider || 'external_http_api'),
        referenceCode: refCode,
        status,
        method: 'http_api'
      });
      return { status, reference_code: refCode, provider: str(data.provider || 'external_http_api'), fallback_used: false };
    } catch (err) {
      if (fallbackPolicy === 'strict_block') {
        throw httpError('Không thể kết nối dịch vụ xác minh danh tính bên thứ ba.', 503, { code: 'IDENTITY_PROVIDER_UNAVAILABLE' });
      }
      const refCode = `FALLBACK-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
      return { status: 'verified', reference_code: refCode, provider: 'skyfirst_otp_fallback', fallback_used: true, reason: err?.message };
    } finally {
      clearTimeout(timer);
    }
  }

  // Default when 3rd-party API credentials are not configured: record internal roster+OTP verification
  const internalRef = str(providerReference) || `SF-ROSTER-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
  await recordVerificationResult(env, {
    examId,
    candidateCode: cleanCode,
    email: cleanEmail,
    provider: 'skyfirst_internal',
    referenceCode: internalRef,
    status: 'verified',
    method: 'roster_and_otp'
  });
  return {
    status: 'verified',
    reference_code: internalRef,
    provider: 'skyfirst_internal',
    third_party_configured: false,
    fallback_used: true
  };
}

async function recordVerificationResult(env, {
  examId,
  attemptId = null,
  candidateCode,
  email,
  provider,
  referenceCode,
  status,
  method,
  expiresAt = null
}) {
  if (!env?.DB?.prepare) return;
  const id = crypto.randomUUID();
  const exp = expiresAt || new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO exam_identity_verifications(id,exam_id,attempt_id,candidate_code,email,provider,reference_code,status,method,verified_at,expires_at,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`
  ).bind(
    id,
    examId,
    attemptId,
    candidateCode,
    email,
    provider,
    referenceCode,
    status,
    method,
    status === 'verified' ? new Date().toISOString() : null,
    exp,
    JSON.stringify({ privacy_mode: 'minimal_reference_only', biometric_stored: false, screen_capture_stored: false })
  ).run().catch(() => {});
}

// =============================================================================
// 3. OBJECT STORAGE (R2) & FILE SIGNATURE VALIDATION ADAPTER
// =============================================================================
export function safeName(name = 'file') {
  return String(name).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+/, '').slice(0, 80) || 'file';
}

export function mimeAllowed(file, type, bytes) {
  const mime = String(file.type || '').toLowerCase().split(';')[0].trim();
  const sig = (...prefix) => prefix.every((b, i) => bytes[i] === b);
  const ascii = (offset, text) => [...text].every((ch, i) => bytes[offset + i] === ch.charCodeAt(0));
  const image = (mime === 'image/png' && sig(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) ||
    (mime === 'image/jpeg' && sig(0xff, 0xd8, 0xff)) ||
    (mime === 'image/webp' && ascii(0, 'RIFF') && ascii(8, 'WEBP'));
  const audio = ((mime === 'audio/wav' || mime === 'audio/x-wav') && ascii(0, 'RIFF') && ascii(8, 'WAVE')) ||
    (mime === 'audio/mpeg' && (ascii(0, 'ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) ||
    (mime === 'audio/ogg' && ascii(0, 'OggS')) ||
    (mime === 'audio/webm' && sig(0x1a, 0x45, 0xdf, 0xa3)) ||
    ((mime === 'audio/mp4' || mime === 'audio/x-m4a') && ascii(4, 'ftyp'));
  const pdf = mime === 'application/pdf' && ascii(0, '%PDF-');
  const txt = mime === 'text/plain' && !bytes.subarray(0, 512).includes(0);
  if (type === 'image') return image;
  if (type === 'audio') return audio;
  return image || audio || pdf || txt;
}

export function evidenceFileAllowed(file, bytes) {
  const name = String(file?.name || '').toLowerCase();
  const mime = String(file?.type || '').toLowerCase().split(';')[0].trim();
  if (/\.(exe|bat|cmd|sh|ps1|msi|dll|scr|vbs|js|mjs|jar|php|py|pl|rb|apk|com|hta|svg|html|htm)$/i.test(name)) {
    return false;
  }
  const sig = (...prefix) => prefix.every((b, i) => bytes[i] === b);
  const ascii = (offset, text) => [...text].every((ch, i) => bytes[offset + i] === ch.charCodeAt(0));
  const isPng = (mime === 'image/png' || name.endsWith('.png')) && sig(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const isJpg = (mime === 'image/jpeg' || name.endsWith('.jpg') || name.endsWith('.jpeg')) && sig(0xff, 0xd8, 0xff);
  const isWebp = (mime === 'image/webp' || name.endsWith('.webp')) && ascii(0, 'RIFF') && ascii(8, 'WEBP');
  const isPdf = (mime === 'application/pdf' || name.endsWith('.pdf')) && ascii(0, '%PDF-');
  const isZipContainer = sig(0x50, 0x4b, 0x03, 0x04);
  const isDocx = (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || name.endsWith('.docx')) && isZipContainer;
  const isXlsx = (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || name.endsWith('.xlsx')) && isZipContainer;
  const isZip = (mime === 'application/zip' || mime === 'application/x-zip-compressed' || name.endsWith('.zip')) && isZipContainer;
  const isTxt = (mime === 'text/plain' || name.endsWith('.txt')) && bytes.length > 0 && !bytes.subarray(0, Math.min(512, bytes.length)).includes(0);
  return isPng || isJpg || isWebp || isPdf || isDocx || isXlsx || isZip || isTxt;
}
