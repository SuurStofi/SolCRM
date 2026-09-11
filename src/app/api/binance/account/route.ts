import { getAccountSnapshot } from '@/lib/binance/account';
import { handleRoute } from '@/lib/binance/route-helpers';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handleRoute('GET /api/binance/account', () => getAccountSnapshot());
}
