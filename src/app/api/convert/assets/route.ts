import { userRoute } from '@/lib/auth/route';
import { getFreeBalances } from '@/lib/binance/account';
import { getConvertibleAssets } from '@/lib/binance/convert';

export const dynamic = 'force-dynamic';

/**
 * The asset menu for a free-form exchange: everything Binance can convert,
 * annotated with what this account holds.
 */
export async function GET(request: Request) {
  return userRoute(
    request,
    'GET /api/convert/assets',
    async () => {
      const balances = await getFreeBalances();
      const assets = await getConvertibleAssets(balances);
      return { assets };
    },
    { binance: true },
  );
}
