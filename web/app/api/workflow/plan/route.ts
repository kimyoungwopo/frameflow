import { hostedBridge } from '../../hosted-bridge';

export async function POST(request: Request) {
  return hostedBridge(request, {"path":"/remote/v1/plan","method":"POST","operation":"plan"});
}
