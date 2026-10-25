export async function onRequestGet() {
  return Response.json({
    ok: true,
    service: 'Sky First Exam',
    version: '5.0.0',
    status: 'available',
    runtime: {
      control_plane: 'standalone-exam-native',
      slc_dependency: 'removed'
    },
    time: new Date().toISOString()
  }, {
    status: 200,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
  });
}
