import { NextResponse } from 'next/server';
import { userRoute } from '@/lib/auth/route';
import { SafeError } from '@/lib/binance/redact';
import { getFreeBalances } from '@/lib/binance/account';
import {
  getConvertQuote,
  acceptConvertQuote,
  getConvertOrderStatus,
  getConvertPairLimits,
  isConvertFailed,
} from '@/lib/binance/convert';

export const dynamic = 'force-dynamic';

const ASSET_SHAPE = /^[A-Z0-9]{2,20}$/;

/**
 * Free-form convert between any two assets Binance supports.
 *
 * Split into two calls, like the SOL flows:
 *   action: 'quote'  -> fetch a rate, executes nothing
 *   action: 'accept' -> execute the trade, IRREVERSIBLE
 *
 * Unlike the SOL sell/buy flows this keeps no state machine: a convert is a
 * single atomic step with nothing to resume. There is no on-chain leg and no
 * deposit to wait for, so a failure leaves the balances untouched.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    action?: unknown;
    fromAsset?: unknown;
    toAsset?: unknown;
    amount?: unknown;
    quoteId?: unknown;
  };

  const action = String(body.action ?? '');
  if (action !== 'quote' && action !== 'accept') {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  if (action === 'accept') {
    const quoteId = String(body.quoteId ?? '');
    if (!quoteId) {
      return NextResponse.json({ ok: false, error: 'Missing quote id.' }, { status: 400 });
    }

    return userRoute(
      request,
      'POST /api/convert/trade (accept)',
      async () => {
        const acceptance = await acceptConvertQuote(quoteId);

        // acceptQuote often returns PROCESS rather than a final state, so the
        // outcome is confirmed rather than assumed.
        let status = await getConvertOrderStatus(acceptance.orderId);
        if (status.orderStatus === 'PROCESS') {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          status = await getConvertOrderStatus(acceptance.orderId);
        }

        if (isConvertFailed(status.orderStatus)) {
          throw new SafeError(`Binance reported the conversion as ${status.orderStatus}.`, {
            status: 502,
          });
        }

        return { status };
      },
      { binance: true },
    );
  }

  const fromAsset = String(body.fromAsset ?? '').trim().toUpperCase();
  const toAsset = String(body.toAsset ?? '').trim().toUpperCase();
  const amount = String(body.amount ?? '').trim();

  if (!ASSET_SHAPE.test(fromAsset) || !ASSET_SHAPE.test(toAsset)) {
    return NextResponse.json({ ok: false, error: 'Pick both assets.' }, { status: 400 });
  }
  if (fromAsset === toAsset) {
    return NextResponse.json(
      { ok: false, error: 'Pick two different assets.' },
      { status: 400 },
    );
  }
  // Decimal string, never parsed to float: this value decides how much moves.
  if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) {
    return NextResponse.json(
      { ok: false, error: 'Enter a positive amount.' },
      { status: 400 },
    );
  }

  return userRoute(
    request,
    'POST /api/convert/trade (quote)',
    async () => {
      const [balances, limits] = await Promise.all([
        getFreeBalances(),
        getConvertPairLimits(fromAsset, toAsset),
      ]);

      const free = balances[fromAsset] ?? '0';
      if (Number(amount) > Number(free)) {
        throw new SafeError(
          `Not enough ${fromAsset}. Spendable balance is ${free} ${fromAsset}.`,
          { status: 400 },
        );
      }
      if (Number(amount) < Number(limits.fromAssetMinAmount)) {
        throw new SafeError(
          `Binance's minimum for ${fromAsset} to ${toAsset} is ${limits.fromAssetMinAmount} ${fromAsset}.`,
          { status: 400 },
        );
      }

      const quote = await getConvertQuote(fromAsset, toAsset, amount);
      return { quote, limits, free };
    },
    { binance: true },
  );
}
