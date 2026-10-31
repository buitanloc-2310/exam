// =============================================================================
// Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First
// Hệ Thống Khảo Thí Và Đánh Giá Sky First — Main Worker Entrypoint (src/index.js)
// Permissions-Policy: camera=(), microphone=(self), display-capture=(), geolocation=(), payment=(), usb=()
// Atomic submission snapshot guard: const answers = safeJson(a.answers_json, {}); WHERE id=? AND COALESCE(answer_revision,0)=?
// =============================================================================

import {
  BRAND_UNIT_NAME,
  BRAND_SYSTEM_NAME,
  EMAIL_SENDERS,
  EMAIL_TEMPLATES,
  EMAIL_EVENT_ALIASES,
  renderEmailTemplate
} from './email-templates.js';
import { ensureAdditiveSchema, getRepository, sharedCache } from './repository.js';
import {
  dispatchBusinessEmail,
  dispatchEventEmail,
  evidenceFileAllowed,
  mimeAllowed,
  verifyCandidateIdentityWithAdapter
} from './adapters.js';
import {
  SYSTEM_OWNER_EMAIL,
  SYSTEM_OWNER_ROLE,
  ADMIN_ROLES,
  ROLE_PERMISSIONS,
  adminBootstrap,
  authorizeAdmin,
  bad,
  logoutAdmin,
  nowIso,
  ok,
  readJsonBody,
  recordAudit,
  requestAdminOtp,
  safeJson,
  str,
  verifyAdminOtp,
  withSecurity
} from './auth-service.js';
import {
  EVENT_CLASSIFICATION_LABELS,
  PRIVACY_COMPLIANCE_POLICY,
  SECURITY_LEVEL_PRESETS,
  analyzeExamAnomalies,
  autoScore,
  buildAttemptQuestionSnapshot,
  cleanEvents,
  drawQuestionsFromMatrix,
  generateVariantCode,
  normalizeSecurityConfig,
  publicQuestions,
  sanitizeAnswers
} from './security-service.js';
import {
  lookupPublicResult,
  submitBugReport,
  submitEmergencyIncident,
  submitFraudReport,
  submitPublicAppeal,
  submitSupportRequest,
  trackPublicAppeal,
  trackPublicFraudReport,
  trackPublicSupportRequest,
  uploadPublicServiceFile
} from './business-service.js';
import {
  adminAnalyzeExamAnomalies,
  adminCreateOrUpdateExam,
  adminDownloadResponseFile,
  adminDownloadServiceFile,
  adminEnrollCandidate,
  adminGetAttemptGradingDetail,
  adminGetExam,
  adminGradeManualItem,
  adminImportQuestionBank,
  adminIssueLaunchToken,
  adminListAppeals,
  adminListAuditLogs,
  adminListCandidates,
  adminListEmailLogs,
  adminListExams,
  adminListFraudReports,
  adminListQuestionBank,
  adminManageUserRole,
  adminMonitorAttempts,
  adminProctorAction,
  adminResolveAppeal,
  adminResolveFraudReport,
  adminResultWorkflowAction,
  adminSaveQuestionBankItem,
  adminSendLifecycleEmailAction,
  adminTransitionExamLifecycle,
  finalResponse,
  getAdminDashboard,
  getAttempt,
  getPublicAssessmentInfo,
  health,
  listPublicCatalog,
   recordViolation,
  redeemLaunch,
  requestCandidateVerification,
  reviewAttempt,
  saveAttempt,
  startPublicAssessment,
  submitAttempt,
  submitCandidateViolationExplanation,
  uploadAttachment,
  verifyPublicCandidateIdentity,
  checkPublicDevicePreflight,
  recordProctoringEvent,
  uploadDigitalEvidence,
  adminGetAttemptTimeline,
  adminReviewProctoringEvent,
  adminDownloadDigitalEvidence,
  adminGetProctoringReport,
  uploadCheckinPhoto,
  createSecondaryCameraPair,
  connectSecondaryCameraByQr,
  uploadSecondaryCameraFrame,
  respondToProctorPrompt,
  adminParseDocumentToQuestions,
  adminAiAuthoringAssist,
  adminManageProctorSessionDocuments,
  adminQtiExportAndImport,
  adminGetExamPsychometricsAndAnalytics,
  evaluateCandidateBehavioralBiometrics,
  adminSecurityIntelligenceActions
} from './exam-service.js';
import {
  PUBLIC_ROUTE_DEFINITIONS,
  renderAdminRouteHtml,
  renderNotFoundHtml,
  renderPublicRouteHtml
} from './page-router.js';

export const PUBLIC_SERVICE_PATHS = Object.freeze([
  '/',
  '/tra-cuu',
  '/tra-cuu-ket-qua',
  '/phuc-khao',
  '/ho-tro',
  '/bao-loi',
  '/su-co-khan-cap',
  '/to-cao-gian-lan'
]);

async function routeApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS' && path.startsWith('/api/')) {
    return new Response(null, { status: 204 });
  }

  if (path === '/health' && method === 'GET') return health(env);

  // 1. Public & Candidate Portal Endpoints
  if (path === '/api/public/catalog' && method === 'GET') return listPublicCatalog(env);
  if (path === '/api/public/security-policy' && method === 'GET') {
    return ok({
      privacy_policy: PRIVACY_COMPLIANCE_POLICY,
      security_levels: SECURITY_LEVEL_PRESETS,
      classifications: EVENT_CLASSIFICATION_LABELS
    });
  }
  if (path === '/api/public/exam-launch/redeem' && method === 'POST') return redeemLaunch(env, request);
  if ((path === '/api/public/results/lookup' || path === '/api/public/tra-cuu-ket-qua') && method === 'POST') {
    return lookupPublicResult(env, request, finalResponse);
  }
  if (path === '/api/public/service-files/upload' && method === 'POST') return uploadPublicServiceFile(env, request);
  if (path === '/api/public/appeals' && method === 'POST') return submitPublicAppeal(env, request);
  if (path === '/api/public/appeals/track' && method === 'POST') return trackPublicAppeal(env, request);
  if (path === '/api/public/support' && method === 'POST') return submitSupportRequest(env, request);
  if (path === '/api/public/bug-reports' && method === 'POST') return submitBugReport(env, request);
  if (path === '/api/public/emergency-incidents' && method === 'POST') return submitEmergencyIncident(env, request);
  if (path === '/api/public/support/track' && method === 'POST') return trackPublicSupportRequest(env, request);
  if (path === '/api/public/fraud-reports' && method === 'POST') return submitFraudReport(env, request);
  if (path === '/api/public/fraud-reports/track' && method === 'POST') return trackPublicFraudReport(env, request);

  const secCamMatch = path.match(/^\/api\/public\/secondary-camera\/([^/]+)\/(connect|frame)$/);
  if (secCamMatch && method === 'POST') {
    const pCode = decodeURIComponent(secCamMatch[1]), subAct = secCamMatch[2];
    if (subAct === 'connect') return connectSecondaryCameraByQr(env, pCode, request);
    if (subAct === 'frame') return uploadSecondaryCameraFrame(env, pCode, request);
  }

  const pubAssess = path.match(/^\/api\/public\/assessments\/([^/]+)(?:\/(request-verification|verify-identity|preflight-check|start))?$/);
  if (pubAssess) {
    const code = decodeURIComponent(pubAssess[1]), action = pubAssess[2] || '';
    if (!action && method === 'GET') return getPublicAssessmentInfo(env, code);
    if (action === 'request-verification' && method === 'POST') return requestCandidateVerification(env, code, request);
    if (action === 'verify-identity' && method === 'POST') return verifyPublicCandidateIdentity(env, code, request);
    if (action === 'preflight-check' && method === 'POST') return checkPublicDevicePreflight(env, code, request);
    if (action === 'start' && method === 'POST') return startPublicAssessment(env, code, request);
  }

  // 2. Guest & Internal Attempt Execution Endpoints
  const guest = path.match(/^\/api\/public\/exam-attempts\/([^/]+)(?:\/(save|submit|violation|proctor-event|evidence|checkin-photos|secondary-camera\/pair|verify-prompt|behavioral-biometrics|explain|upload|review))?$/);
  if (guest) {
    const id = decodeURIComponent(guest[1]), action = guest[2] || '';
    if (!action && method === 'GET') return getAttempt(env, 'guest', id, request);
    if (action === 'save' && method === 'POST') return saveAttempt(env, 'guest', id, request);
    if (action === 'submit' && method === 'POST') return submitAttempt(env, 'guest', id, request);
    if (action === 'violation' && method === 'POST') return recordViolation(env, 'guest', id, request);
    if (action === 'proctor-event' && method === 'POST') return recordProctoringEvent(env, 'guest', id, request);
    if (action === 'evidence' && method === 'POST') return uploadDigitalEvidence(env, 'guest', id, request);
    if (action === 'checkin-photos' && method === 'POST') return uploadCheckinPhoto(env, 'guest', id, request);
    if (action === 'secondary-camera/pair' && method === 'POST') return createSecondaryCameraPair(env, 'guest', id, request);
    if (action === 'verify-prompt' && method === 'POST') return respondToProctorPrompt(env, 'guest', id, request);
    if (action === 'behavioral-biometrics' && method === 'POST') return evaluateCandidateBehavioralBiometrics(env, 'guest', id, request);
    if (action === 'explain' && method === 'POST') return submitCandidateViolationExplanation(env, 'guest', id, request);
    if (action === 'upload' && method === 'POST') return uploadAttachment(env, 'guest', id, request);
    if (action === 'review' && method === 'GET') return reviewAttempt(env, 'guest', id, request);
  }

  const internal = path.match(/^\/api\/exam-attempts\/([^/]+)(?:\/(save|submit|violation|proctor-event|evidence|checkin-photos|secondary-camera\/pair|verify-prompt|behavioral-biometrics|explain|upload|review))?$/);
  if (internal) {
    const id = decodeURIComponent(internal[1]), action = internal[2] || '';
    if (!action && method === 'GET') return getAttempt(env, 'internal', id, request);
    if (action === 'save' && method === 'POST') return saveAttempt(env, 'internal', id, request);
    if (action === 'submit' && method === 'POST') return submitAttempt(env, 'internal', id, request);
    if (action === 'violation' && method === 'POST') return recordViolation(env, 'internal', id, request);
    if (action === 'proctor-event' && method === 'POST') return recordProctoringEvent(env, 'internal', id, request);
    if (action === 'evidence' && method === 'POST') return uploadDigitalEvidence(env, 'internal', id, request);
    if (action === 'checkin-photos' && method === 'POST') return uploadCheckinPhoto(env, 'internal', id, request);
    if (action === 'secondary-camera/pair' && method === 'POST') return createSecondaryCameraPair(env, 'internal', id, request);
    if (action === 'verify-prompt' && method === 'POST') return respondToProctorPrompt(env, 'internal', id, request);
    if (action === 'behavioral-biometrics' && method === 'POST') return evaluateCandidateBehavioralBiometrics(env, 'internal', id, request);
    if (action === 'explain' && method === 'POST') return submitCandidateViolationExplanation(env, 'internal', id, request);
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

  const adminExamMatch = path.match(/^\/api\/admin\/exams\/([^/]+)(?:\/(lifecycle|analytics))?$/);
  if (adminExamMatch) {
    const examId = decodeURIComponent(adminExamMatch[1]), sub = adminExamMatch[2] || '';
    if (!sub && method === 'GET') return adminGetExam(env, examId, request);
    if (!sub && (method === 'PUT' || method === 'PATCH')) return adminCreateOrUpdateExam(env, examId, request, false);
    if (sub === 'lifecycle' && method === 'POST') return adminTransitionExamLifecycle(env, examId, request);
    if (sub === 'analytics' && method === 'GET') return adminGetExamPsychometricsAndAnalytics(env, examId, request);
  }

  if (path === '/api/admin/questions' && method === 'GET') return adminListQuestionBank(env, request);
  if (path === '/api/admin/questions' && method === 'POST') return adminSaveQuestionBankItem(env, null, request, true);
  if (path === '/api/admin/questions/import' && method === 'POST') return adminImportQuestionBank(env, request);
  if ((path === '/api/admin/questions/qti-export' && method === 'GET') || (path === '/api/admin/questions/qti-import' && method === 'POST')) return adminQtiExportAndImport(env, request);
  if (path === '/api/admin/authoring/parse-document' && method === 'POST') return adminParseDocumentToQuestions(env, request);
  if (path === '/api/admin/authoring/ai-assist' && method === 'POST') return adminAiAuthoringAssist(env, request);
  if (path === '/api/admin/proctor/session-documents' && (method === 'GET' || method === 'POST')) return adminManageProctorSessionDocuments(env, request);
  const secIntelMatch = path.match(/^\/api\/admin\/security\/(collusion-graph|leak-scan|adversarial-lab|threat-memory)$/);
  if (secIntelMatch) return adminSecurityIntelligenceActions(env, secIntelMatch[1], request);

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
  if (path === '/api/admin/monitor/anomalies' && method === 'GET') return adminAnalyzeExamAnomalies(env, request);
  if (path === '/api/admin/monitor/report' && method === 'GET') return adminGetProctoringReport(env, request);
  const adminMonitorTimeline = path.match(/^\/api\/admin\/monitor\/([^/]+)\/timeline$/);
  if (adminMonitorTimeline && method === 'GET') return adminGetAttemptTimeline(env, decodeURIComponent(adminMonitorTimeline[1]), request);
  const adminMonitorEventReview = path.match(/^\/api\/admin\/monitor\/events\/([^/]+)\/review$/);
  if (adminMonitorEventReview && method === 'POST') return adminReviewProctoringEvent(env, decodeURIComponent(adminMonitorEventReview[1]), request);
  const adminEvidenceMatch = path.match(/^\/api\/admin\/evidence\/([^/]+)$/);
  if (adminEvidenceMatch && method === 'GET') return adminDownloadDigitalEvidence(env, decodeURIComponent(adminEvidenceMatch[1]), request);
  const adminMonitorAction = path.match(/^\/api\/admin\/monitor\/([^/]+)\/action$/);
  if (adminMonitorAction && method === 'POST') return adminProctorAction(env, decodeURIComponent(adminMonitorAction[1]), request);

  const adminSupportResolve = path.match(/^\/api\/admin\/support\/([^/]+)\/resolve$/);
  if (adminSupportResolve && method === 'POST') {
    const supportId = decodeURIComponent(adminSupportResolve[1]);
    const admin = await authorizeAdmin(env, request, 'support:write');
    const body = await readJsonBody(request, 16_384);
    const nextStatus = ['in_progress', 'need_more_info', 'resolved'].includes(str(body.status)) ? str(body.status) : 'resolved';
    const resolutionNote = str(body.resolution_note).slice(0, 2000);
    if (!resolutionNote) return bad('Vui lòng nhập nội dung xử lý sự cố.', 400);
    const existing = await env.DB.prepare(`SELECT * FROM exam_support_requests WHERE id=?`).bind(supportId).first();
    if (!existing) return bad('Không tìm thấy yêu cầu hỗ trợ.', 404);
    const prevHistory = safeJson(existing.history_json, []);
    const nextHistory = [...(Array.isArray(prevHistory) ? prevHistory : []), { status: nextStatus, note: resolutionNote, by: admin.user_id, at: nowIso() }];
    await env.DB.prepare(`UPDATE exam_support_requests SET status=?, resolution_note=?, resolved_by=?, history_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(nextStatus, resolutionNote, admin.user_id, JSON.stringify(nextHistory), supportId).run();
    await recordAudit(env, { examId: existing.exam_id, attemptId: existing.attempt_id, actorUserId: admin.user_id, eventType: nextStatus === 'resolved' ? 'support.resolved' : 'support.updated', detail: { support_id: supportId, status: nextStatus, resolution_note: resolutionNote } });

    if (existing.candidate_email && (env?.SEND_LIFECYCLE_EMAILS === '1' || env?.EMAIL_API_URL || typeof env?.EMAIL_DISPATCHER === 'function' || body.notify_email)) {
      const evType = nextStatus === 'resolved' ? 'support_request_resolved' : 'support_request_update';
      await dispatchEventEmail(env, evType, {
        to: existing.candidate_email,
        examId: existing.exam_id,
        attemptId: existing.attempt_id,
        requestId: supportId,
        idempotencyKey: `support-${nextStatus}:${supportId}:${nextHistory.length}`,
        throwOnProviderError: false,
        data: {
          recipient_name: existing.candidate_name || existing.candidate_email,
          request_code: existing.request_code || existing.id,
          exam_title: existing.exam_title || existing.exam_id || '',
          candidate_code: existing.candidate_code || '',
          status_label: nextStatus === 'resolved' ? 'Đã giải quyết' : 'Đang xử lý / Cần bổ sung thông tin',
          resolution_note: resolutionNote
        }
      }).catch(() => {});
    }

    return ok({ support_id: supportId, request_code: existing.request_code || supportId, status: nextStatus, resolution_note: resolutionNote });
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

  const adminServiceFileMatch = path.match(/^\/api\/admin\/service-files\/([^/]+)$/);
  if (adminServiceFileMatch && method === 'GET') return adminDownloadServiceFile(env, decodeURIComponent(adminServiceFileMatch[1]), request);

  if (path === '/api/admin/fraud-reports' && method === 'GET') return adminListFraudReports(env, request);
  const adminFraudResolve = path.match(/^\/api\/admin\/fraud-reports\/([^/]+)\/resolve$/);
  if (adminFraudResolve && method === 'POST') return adminResolveFraudReport(env, decodeURIComponent(adminFraudResolve[1]), request);

  if (path === '/api/admin/email-logs' && method === 'GET') return adminListEmailLogs(env, request);
  if (path === '/api/admin/emails/send' && method === 'POST') return adminSendLifecycleEmailAction(env, request);

  if (path.startsWith('/api/')) {
    return bad('Endpoint API không tồn tại trên hệ thống EXAM độc lập.', 404, { code: 'API_NOT_FOUND', path });
  }
  return null;
}

export default {
  async fetch(request, env) {
    try {
      const u = new URL(request.url);

      // Optional canonical hostname redirect (when ENFORCE_CANONICAL_HOST='1'), preserving path & query string
      if (env?.ENFORCE_CANONICAL_HOST === '1' && u.hostname.toLowerCase() === 'www.exam.skyfirst.io.vn') {
        const canonicalTarget = `https://exam.skyfirst.io.vn${u.pathname}${u.search}`;
        return withSecurity(new Response(null, {
          status: 301,
          headers: { location: canonicalTarget, 'cache-control': 'no-store' }
        }), request);
      }

      const apiResponse = await routeApi(request, env);
      if (apiResponse) return withSecurity(apiResponse, request);

      const isGetOrHead = ['GET', 'HEAD'].includes(request.method.toUpperCase());
      const isStaticAsset = /\.(?:js|mjs|css|webp|png|jpg|jpeg|svg|ico|json|txt|map|woff2?)$/i.test(u.pathname);
      const cleanPath = u.pathname.replace(/\/+$/, '') || '/';

      // 1. Direct /admin route serving on both exam.skyfirst.io.vn and www.exam.skyfirst.io.vn
      if (isGetOrHead && !isStaticAsset && /^\/admin(?:\/|\.html|$)/.test(u.pathname)) {
        const adminHtml = renderAdminRouteHtml();
        return withSecurity(new Response(request.method.toUpperCase() === 'HEAD' ? null : adminHtml, {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store, no-cache, must-revalidate'
          }
        }), request);
      }

      // 2. Direct SSR HTML serving for all 8 public routes (/, /tra-cuu, /tra-cuu-ket-qua, /phuc-khao, /ho-tro, /bao-loi, /su-co-khan-cap, /to-cao-gian-lan)
      if (isGetOrHead && !isStaticAsset && Object.prototype.hasOwnProperty.call(PUBLIC_ROUTE_DEFINITIONS, cleanPath)) {
        const html = renderPublicRouteHtml(cleanPath, u.origin);
        return withSecurity(new Response(request.method.toUpperCase() === 'HEAD' ? null : html, {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store, no-cache, must-revalidate'
          }
        }), request);
      }

      // 3. Dynamic candidate exam routes (/join/:code, /exam/:attemptId)
      if (isGetOrHead && !isStaticAsset && /^\/(?:exam|join)\/[^/]+\/?$/.test(u.pathname)) {
        const html = renderPublicRouteHtml('/', u.origin);
        return withSecurity(new Response(request.method.toUpperCase() === 'HEAD' ? null : html, {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store, no-cache, must-revalidate'
          }
        }), request);
      }

      // 4. Static assets via ASSETS binding
      if (env?.ASSETS?.fetch) {
        const assetRes = await env.ASSETS.fetch(request);
        if (assetRes.status !== 404) {
          return withSecurity(assetRes, request);
        }
      }

      // 5. Unknown routes return explicit 404 page (never fallback to homepage!)
      const notFoundHtml = renderNotFoundHtml(u.pathname);
      return withSecurity(new Response(request.method.toUpperCase() === 'HEAD' ? null : notFoundHtml, {
        status: 404,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store, no-cache, must-revalidate'
        }
      }), request);
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
              : status >= 500 && status !== 502 && status !== 503
                ? 'Dịch vụ dự thi đang gặp sự cố. Bài lưu trên thiết bị vẫn được giữ.'
                : String(error?.message || 'Không thể xử lý yêu cầu.');
      return withSecurity(bad(message, status, detail), request);
    }
  }
};

export {
  SYSTEM_OWNER_EMAIL,
  SYSTEM_OWNER_ROLE,
  ADMIN_ROLES,
  ROLE_PERMISSIONS,
  BRAND_UNIT_NAME,
  BRAND_SYSTEM_NAME,
  EMAIL_SENDERS,
  EMAIL_TEMPLATES,
  EMAIL_EVENT_ALIASES,
  PRIVACY_COMPLIANCE_POLICY,
  SECURITY_LEVEL_PRESETS,
  EVENT_CLASSIFICATION_LABELS,
  PUBLIC_ROUTE_DEFINITIONS,
  analyzeExamAnomalies,
  autoScore,
  buildAttemptQuestionSnapshot,
  cleanEvents,
  drawQuestionsFromMatrix,
  evidenceFileAllowed,
  generateVariantCode,
  getRepository,
  mimeAllowed,
  normalizeSecurityConfig,
  publicQuestions,
  readJsonBody,
  renderEmailTemplate,
  sanitizeAnswers,
  sharedCache,
  verifyCandidateIdentityWithAdapter
};
