import { NextResponse } from 'next/server';
import { userRoute } from '@/lib/auth/route';
import { isCryptoId } from '@/lib/bestchange/market';
import { compare } from '@/lib/compare';

export const dynamic = 'force-dynamic';

const FIAT = /^[A-Z]{3}$/;
const AMOUNT = /^\d+(\.\d+)?$/;

/**
 * Buy or sell a crypto against one fiat across BestChange dealers and
 * Binance P2P, on one price scale. Signed-in only: it spends both the Binance
 * IP budget and the shared BestChange key.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const crypto = params.get('crypto') ?? 'SOL';
  const side = params.get('side') ?? 'sell';
  const fiat = (params.get('fiat') ?? '').trim().toUpperCase();
  const amount = params.get('amount')?.trim() || null;

  if (!isCryptoId(crypto) || (side !== 'sell' && side !== 'buy')) {
    return NextResponse.json({ ok: false, error: 'Unknown crypto or side.' }, { status: 400 });
  }
  if (!FIAT.test(fiat)) {
    return NextResponse.json(
      { ok: false, error: 'Fiat must be a 3-letter currency code, e.g. UAH.' },
      { status: 400 },
    );
  }
  if (amount !== null && (!AMOUNT.test(amount) || Number(amount) <= 0)) {
    return NextResponse.json({ ok: false, error: 'Invalid amount.' }, { status: 400 });
  }

  return userRoute(request, 'GET /api/compare', () =>
    compare({ crypto, side, fiat, amount: amount !== null ? Number(amount) : null }),
  );
}
