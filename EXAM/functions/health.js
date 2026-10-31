export async function onRequestGet() {
  return Response.json({
    ok: true,
    unit: 'Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First',
    service: 'Hệ Thống Khảo Thí Và Đánh Giá Sky First',
    version: '7.0.0',
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
