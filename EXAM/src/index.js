const SECURITY = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://slc.skyfirst.io.vn; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains'
};

async function health() {
  let dependency = 'unavailable';
  try {
    const r = await fetch('https://slc.skyfirst.io.vn/api/health', { headers: { accept: 'application/json' } });
    if (r.ok) dependency = 'available';
  } catch {}
  return Response.json({
    ok: dependency === 'available',
    service: 'Sky First Exam',
    version: '2.0.0',
    status: dependency === 'available' ? 'available' : 'degraded',
    dependency: { slc: dependency },
    time: new Date().toISOString()
  }, { status: dependency === 'available' ? 200 : 503, headers: SECURITY });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return health();
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(SECURITY)) headers.set(key, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
};
