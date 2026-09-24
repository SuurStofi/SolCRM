import { NextResponse } from 'next/server';
import { SafeError } from '@/lib/binance/redact';
import { createOrder, listOrders, updateOrder, isP2PStatus } from '@/lib/p2p/store';
import { userRoute } from '@/lib/auth/route';
import { isUniqueViolation } from '@/lib/account/store';

export const dynamic = 'force-dynamic';

const ORDER_NUMBER = /^[A-Za-z0-9_-]{4,64}$/;
const TICKER = /^[A-Z0-9]{2,10}$/;
const DECIMAL = /^\d+(\.\d+)?$/;
const MAX_TEXT = 500;

export async function GET(request: Request) {
  return userRoute(request, 'GET /api/p2p/orders', (user) => listOrders(user.id));
}

/**
 * Archive an order that was created by hand in Binance's UI. The order number
 * is the key: it is what makes the record findable again on Binance's side,
 * and duplicates are rejected rather than silently merged.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const orderNumber = text(body.orderNumber);
  if (!orderNumber || !ORDER_NUMBER.test(orderNumber)) {
    return NextResponse.json(
      { ok: false, error: 'Enter the order number exactly as Binance shows it.' },
      { status: 400 },
    );
  }

  const fiat = (text(body.fiat) ?? '').toUpperCase();
  const asset = (text(body.asset) ?? 'USDT').toUpperCase();
  if (!TICKER.test(fiat) || !TICKER.test(asset)) {
    return NextResponse.json(
      { ok: false, error: 'Asset and fiat must be ticker codes, e.g. USDT and UAH.' },
      { status: 400 },
    );
  }

  const tradeType = (text(body.tradeType) ?? 'SELL').toUpperCase();
  if (tradeType !== 'BUY' && tradeType !== 'SELL') {
    return NextResponse.json(
      { ok: false, error: 'tradeType must be BUY or SELL.' },
      { status: 400 },
    );
  }

  // Money stays a decimal string end to end; parsing to a float here would
  // lose precision on the figure the record exists to preserve.
  const amount = text(body.amount);
  const price = text(body.price);
  const totalFiat = text(body.totalFiat);
  for (const value of [amount, price, totalFiat]) {
    if (value !== null && !DECIMAL.test(value)) {
      return NextResponse.json(
        { ok: false, error: 'Amount, price and total must be plain decimal numbers.' },
        { status: 400 },
      );
    }
  }

  return userRoute(request, 'POST /api/p2p/orders', async (user) => {
    try {
      return await createOrder(user.id, {
        orderNumber,
        fiat,
        asset,
        tradeType,
        adNo: text(body.adNo),
        amount,
        price,
        totalFiat,
        payMethod: text(body.payMethod),
        counterpartyName: text(body.counterpartyName),
        notes: text(body.notes),
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new SafeError(`Order ${orderNumber} is already archived.`, { status: 409 });
      }
      throw error;
    }
  });
}

/** Update the status or notes of an archived order. */
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const id = text(body.id);
  if (!id) {
    return NextResponse.json({ ok: false, error: 'Missing order id.' }, { status: 400 });
  }

  const status = text(body.status);
  if (status !== null && !isP2PStatus(status)) {
    return NextResponse.json({ ok: false, error: 'Unknown status.' }, { status: 400 });
  }

  const notes = body.notes === undefined ? undefined : (text(body.notes) ?? '');
  if (status === null && notes === undefined) {
    return NextResponse.json({ ok: false, error: 'Nothing to update.' }, { status: 400 });
  }

  return userRoute(request, 'PATCH /api/p2p/orders', (user) =>
    updateOrder(user.id, id, { status: status ?? undefined, notes }),
  );
}

/** Trim a free-text field to a bounded string, or null when it is empty. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, MAX_TEXT);
  return trimmed === '' ? null : trimmed;
}
