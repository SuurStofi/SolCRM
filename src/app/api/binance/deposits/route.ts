import { getRecentDeposits } from '@/lib/binance/account';
import { userRoute } from '@/lib/auth/route';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const coin = new URL(request.url).searchParams.get('coin') ?? undefined;
  return userRoute(request, 'GET /api/binance/deposits', () => getRecentDeposits(coin), {
    binance: true,
  });
}
