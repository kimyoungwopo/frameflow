import { hostedBridge } from '../../hosted-bridge';

export async function POST(request: Request) {
  return hostedBridge(request, {"path":"/remote/v1/generate","method":"POST","operation":"image"});
}

export async function GET(request: Request) {
  return hostedBridge(request, { path: '/remote/jobs', method: 'GET', job: new URL(request.url).searchParams.get('job') || '' });
}
export async function DELETE(request: Request) {
  return hostedBridge(request, { path: '/remote/jobs', method: 'POST', job: new URL(request.url).searchParams.get('job') || '' });
}
