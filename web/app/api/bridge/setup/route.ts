export async function GET() {
  return Response.json({ error: 'source_delivery_disabled', message: '소스 보호를 위해 설정 파일 배포를 중단했습니다.' }, { status: 410, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
