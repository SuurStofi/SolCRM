import { userRoute } from '@/lib/auth/route';
import {
  checkMerchantStatus,
  cachedMerchantStatus,
  MERCHANT_APPLICATION_URL,
} from '@/lib/autotrade/merchant';

export const dynamic = 'force-dynamic';

/**
 * Whether this account may publish Binance P2P ads.
 *
 * GET returns the cached answer when there is one, so opening the page does
 * not spend Binance weight. POST forces a fresh check, for "Check again".
 */
export async function GET(request: Request) {
  return userRoute(request, 'GET /api/autotrade/merchant', async (user) => {
    const status = cachedMerchantStatus(user.id) ?? (await checkMerchantStatus(user.id));
    return { ...status, applyUrl: MERCHANT_APPLICATION_URL };
  });
}

export async function POST(request: Request) {
  return userRoute(request, 'POST /api/autotrade/merchant', async (user) => {
    const status = await checkMerchantStatus(user.id, { force: true });
    return { ...status, applyUrl: MERCHANT_APPLICATION_URL };
  });
}
