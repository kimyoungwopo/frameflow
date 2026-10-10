import { hostedBridge } from '../../../../hosted-bridge';

export async function POST(request: Request) {
  return hostedBridge(request, {"path":"/remote/auth/device/start","method":"POST","create":true});
}
