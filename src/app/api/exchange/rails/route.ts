import { NextResponse } from 'next/server';
import { userRoute } from '@/lib/auth/route';
import { bestChangeKey } from '@/lib/bestchange/client';
import { isCryptoId, listRails } from '@/lib/bestchange/market';

export const dynamic = 'force-dynamic';

/**
 * Every e-money, bank account and card rail BestChange has offers for, for
 * one crypto and side, with its best price. The Exchanger tab's picker.
 *
 * Signed-in only, like P2P search: all accounts share one BestChange key and
 * its rate limit.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const crypto = params.get('crypto') ?? 'SOL';
  const side = params.get('side') ?? 'sell';
  if (!isCryptoId(crypto) || (side !== 'sell' && side !== 'buy')) {
    return NextResponse.json({ ok: false, error: 'Unknown crypto or side.' }, { status: 400 });
  }

  return userRoute(request, 'GET /api/exchange/rails', async () => {
    // Missing configuration is a state of the server, not a failure of the
    // request, so the UI gets to explain it instead of showing an error.
    if (!bestChangeKey()) return { configured: false, rails: [] };
    return { configured: true, rails: await listRails(crypto, side) };
  });
}
