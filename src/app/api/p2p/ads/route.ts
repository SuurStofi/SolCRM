import { NextResponse } from 'next/server';
import { searchAds, p2pBoardUrl, type TradeSide } from '@/lib/binance/p2p';
import { handleRoute } from '@/lib/binance/route-helpers';

export const dynamic = 'force-dynamic';

const TICKER = /^[A-Z0-9]{2,10}$/;
const PAY_METHOD = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * Search public P2P ads. Unauthenticated upstream, but proxied here anyway so
 * the browser is not making cross-origin calls to Binance and so the response
 * is normalised before it reaches the UI.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const asset = (params.get('asset') ?? 'USDT').trim().toUpperCase();
  const fiat = (params.get('fiat') ?? '').trim().toUpperCase();
  const tradeType = (params.get('tradeType') ?? 'SELL').trim().toUpperCase();
  const payMethod = params.get('payMethod')?.trim() || undefined;
  const transAmount = params.get('transAmount')?.trim() || undefined;

  if (!TICKER.test(asset) || !TICKER.test(fiat)) {
    return NextResponse.json(
      { ok: false, error: 'Asset and fiat must be ticker codes, e.g. USDT and UAH.' },
      { status: 400 },
    );
  }
  if (tradeType !== 'BUY' && tradeType !== 'SELL') {
    return NextResponse.json(
      { ok: false, error: 'tradeType must be BUY or SELL.' },
      { status: 400 },
    );
  }
  if (payMethod !== undefined && !PAY_METHOD.test(payMethod)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid payment method identifier.' },
      { status: 400 },
    );
  }
  if (transAmount !== undefined && !/^\d+(\.\d+)?$/.test(transAmount)) {
    return NextResponse.json({ ok: false, error: 'Invalid amount.' }, { status: 400 });
  }

  const side = tradeType as TradeSide;

  return handleRoute('GET /api/p2p/ads', async () => ({
    ads: await searchAds({ asset, fiat, tradeType: side, payMethod, transAmount }),
    boardUrl: p2pBoardUrl(asset, fiat, side),
  }));
}
