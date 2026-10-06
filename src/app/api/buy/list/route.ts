import { userRoute } from '@/lib/auth/route';
import { listBuys } from '@/lib/buy/store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return userRoute(request, 'GET /api/buy/list', (user) => listBuys(user.id));
}
