import { userRoute } from '@/lib/auth/route';
import { getFreeBalances } from '@/lib/binance/account';
import { getConvertPairLimits } from '@/lib/binance/convert';
import { getSolWithdrawConfig } from '@/lib/binance/withdraw';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * What the buy form needs: spendable USDT, the convert minimum, and -- only
 * when auto-withdraw is on -- the SOL withdrawal fee and minimum.
 */
export async function GET(request: Request) {
  return userRoute(
    request,
    'GET /api/buy/info',
    async (user) => {
      const account = await prisma.user.findUnique({ where: { id: user.id } });
      const [balances, limits, withdraw] = await Promise.all([
        getFreeBalances(),
        getConvertPairLimits('USDT', 'SOL'),
        account?.autoWithdraw ? getSolWithdrawConfig() : Promise.resolve(null),
      ]);
      return {
        usdtFree: balances.USDT ?? '0',
        solFree: balances.SOL ?? '0',
        minUsdt: limits.fromAssetMinAmount,
        withdraw,
      };
    },
    { binance: true },
  );
}
