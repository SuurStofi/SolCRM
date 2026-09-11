import { getRecentDeposits } from '@/lib/binance/account';
import { handleRoute } from '@/lib/binance/route-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const coin = new URL(request.url).searchParams.get('coin') ?? undefined;
  return handleRoute('GET /api/binance/deposits', () => getRecentDeposits(coin));
}
