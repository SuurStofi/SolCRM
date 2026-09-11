import { getDepositAddress } from '@/lib/binance/account';
import { handleRoute } from '@/lib/binance/route-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const coin = params.get('coin') ?? 'SOL';
  // Network is explicit: omitting it can return an address on another chain.
  const network = params.get('network') ?? 'SOL';
  return handleRoute('GET /api/binance/deposit-address', () =>
    getDepositAddress(coin, network),
  );
}
