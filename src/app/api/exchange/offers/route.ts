import { NextResponse } from 'next/server';
import { userRoute } from '@/lib/auth/route';
import { SafeError } from '@/lib/binance/redact';
import { directionUrl, isCryptoId, listOffers, listRails } from '@/lib/bestchange/market';
import { binanceReference } from '@/lib/compare';

export const dynamic = 'force-dynamic';

/**
 * Dealer offers for one crypto, side and rail, plus the best Binance
 * prices in the same fiat so each offer can be judged against them.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const crypto = params.get('crypto') ?? 'SOL';
  const side = params.get('side') ?? 'sell';
  const rail = Number(params.get('rail'));
  if (!isCryptoId(crypto) || (side !== 'sell' && side !== 'buy')) {
    return NextResponse.json({ ok: false, error: 'Unknown crypto or side.' }, { status: 400 });
  }
  if (!Number.isInteger(rail) || rail <= 0) {
    return NextResponse.json({ ok: false, error: 'Pick a payment method.' }, { status: 400 });
  }

  return userRoute(request, 'GET /api/exchange/offers', async () => {
    const found = (await listRails(crypto, side)).find((r) => r.id === rail);
    if (!found) {
      throw new SafeError('BestChange has no offers for that payment method any more.', {
        status: 404,
      });
    }

    const [offers, binance, listingUrl] = await Promise.all([
      listOffers(crypto, side, [rail]).then((all) => all.get(rail) ?? []),
      found.fiat ? binanceReference(crypto, side, found.fiat) : Promise.resolve(null),
      directionUrl(crypto, side, found),
    ]);

    return { rail: found, offers, binance, listingUrl };
  });
}
