import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ error: 'local_bridge_required', message: '본인 컴퓨터의 Bridge에 직접 연결하세요.' }, { status: 410 });
}
