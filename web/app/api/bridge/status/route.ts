import { hostedBridge } from '../../hosted-bridge';

export async function GET(request: Request) {
  return hostedBridge(request, {"path":"/remote/status","method":"GET"});
}
