export async function onRequestGet() {
  return Response.json({
    ok: true,
    service: 'slcs-exam',
    runtime: 'cloudflare-pages',
    time: new Date().toISOString()
  }, {
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}
