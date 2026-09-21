import { NextResponse } from 'next/server';
import { findRedeemablePosition, redeemFlexibleToSpot } from '@/lib/binance/earn';
import { handleRoute } from '@/lib/binance/route-helpers';

export const dynamic = 'force-dynamic';

/**
 * Move a Simple Earn Flexible position back to Spot, where Convert can reach
 * it. Omitting `amount` redeems the whole position.
 *
 * This moves real balance and is not undone by a second call -- re-subscribing
 * to Earn is a separate action in Binance's own UI.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    asset?: unknown;
    amount?: unknown;
  };

  const asset = String(body.asset ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,20}$/.test(asset)) {
    return NextResponse.json({ ok: false, error: 'Invalid asset.' }, { status: 400 });
  }

  // Kept as a decimal string: parsing to a float would lose precision on the
  // value that decides how much moves.
  const amount = body.amount === undefined ? undefined : String(body.amount).trim();
  if (amount !== undefined && (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0)) {
    return NextResponse.json({ ok: false, error: 'Invalid amount.' }, { status: 400 });
  }

  return handleRoute('POST /api/binance/earn/redeem', async () => {
    const position = await findRedeemablePosition(asset);
    const result = await redeemFlexibleToSpot({ productId: position.productId, amount });
    return { result, asset, redeemed: amount ?? position.totalAmount };
  });
}
