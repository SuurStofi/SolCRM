import { userRoute } from '@/lib/auth/route';
import { listFlows } from '@/lib/flow/store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return userRoute(request, 'GET /api/flow/list', (user) => listFlows(user.id));
}
