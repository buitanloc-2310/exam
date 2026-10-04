export const API_ORIGIN = 'https://slc.skyfirst.io.vn';

export async function apiRequest(path, { token = '', ...options } = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  let response;
  try {
    response = await fetch(API_ORIGIN + path, { ...options, headers });
  } catch (cause) {
    const error = new Error('Không thể kết nối máy chủ. Kiểm tra mạng và thử lại.');
    error.cause = cause;
    error.network = true;
    throw error;
  }
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(payload.message || `Yêu cầu thất bại (${response.status}).`);
    error.status = response.status;
    error.detail = payload.detail;
    error.code = payload?.detail?.code || payload?.code || '';
    throw error;
  }
  return payload;
}
