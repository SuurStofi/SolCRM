import { getAccountSnapshot } from '@/lib/binance/account';
import { userRoute } from '@/lib/auth/route';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return userRoute(request, 'GET /api/binance/account', () => getAccountSnapshot(), {
    binance: true,
  });
}
