import { NextResponse } from 'next/server';
import { userRoute } from '@/lib/auth/route';
import { normalizeAddress } from '@/lib/auth/siws';
import { runWithdraw, refreshWithdraw } from '@/lib/buy/withdraw';

export const dynamic = 'force-dynamic';

/**
 * The withdrawal leg of a purchase, driven by hand:
 *
 *   action: 'send'  -- { id, destination? } withdraw (or retry) to a linked wallet
 *   action: 'check' -- { id } ask Binance where a requested withdrawal stands
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id ?? '');
  if (!id || (body.action !== 'send' && body.action !== 'check')) {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  if (body.action === 'check') {
    return userRoute(request, 'POST /api/buy/withdraw (check)', (user) => refreshWithdraw(user.id, id), {
      binance: true,
    });
  }

  return userRoute(
    request,
    'POST /api/buy/withdraw (send)',
    (user) =>
      runWithdraw(
        user.id,
        id,
        body.destination === undefined ? undefined : normalizeAddress(body.destination),
      ),
    { binance: true },
  );
}
