import { handleRoute } from '@/lib/binance/route-helpers';
import { listFlows } from '@/lib/flow/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handleRoute('GET /api/flow/list', () => listFlows());
}
