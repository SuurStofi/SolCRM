import 'server-only';

import { binanceRequest, ensureTimeSynced } from './client';
import { SafeError } from './redact';

/**
 * Simple Earn Flexible positions and redemption.
 *
 * Spot balances that come back prefixed "LD" are Flexible Earn positions, not
 * spendable balance: Convert cannot touch them until they are redeemed back to
 * Spot, which is why a transfer can look funded and still fail to convert.
 */

export interface FlexiblePosition {
  asset: string;
  productId: string;
  totalAmount: string;
  canRedeem: boolean;
}

interface RawPositionRow {
  asset?: string;
  productId?: string;
  totalAmount?: string;
  canRedeem?: boolean;
}

/** Flexible positions, optionally narrowed to one asset. Weight 150 (IP). */
export async function getFlexiblePositions(asset?: string): Promise<FlexiblePosition[]> {
  await ensureTimeSynced();
  const result = await binanceRequest<{ rows?: RawPositionRow[] }>(
    '/sapi/v1/simple-earn/flexible/position',
    { signed: true, params: { asset, size: 100 } },
  );

  return (result.rows ?? [])
    .filter(
      (row): row is RawPositionRow & { asset: string; productId: string } =>
        typeof row.asset === 'string' && typeof row.productId === 'string',
    )
    .map((row) => ({
      asset: row.asset,
      productId: row.productId,
      totalAmount: row.totalAmount ?? '0',
      // Absent means redeemable; only an explicit false is a block.
      canRedeem: row.canRedeem !== false,
    }));
}

/**
 * The position for an asset, or a clear error saying why it cannot be
 * redeemed. Resolving the product id here keeps it off the browser, which only
 * ever names the coin.
 */
export async function findRedeemablePosition(asset: string): Promise<FlexiblePosition> {
  const position = (await getFlexiblePositions(asset)).find((row) => row.asset === asset);

  if (!position) {
    throw new SafeError(
      `No Simple Earn Flexible position found for ${asset}. If the balance shows as LD${asset} in Spot, it may be a Locked product, which this app does not redeem.`,
      { status: 404 },
    );
  }
  if (!position.canRedeem) {
    throw new SafeError(
      `Binance reports the ${asset} Flexible position as not redeemable right now.`,
      { status: 409 },
    );
  }
  return position;
}

export interface RedeemResult {
  redeemId: number;
  success: boolean;
}

/**
 * Redeem a Flexible position back to the Spot wallet. Weight 1 (UID).
 *
 * `type: 'FAST'` settles immediately where the product allows it; 'NORMAL'
 * settles the next day, which would leave the funds unconvertible today.
 * Binance rejects FAST outright rather than silently downgrading, and that
 * error is surfaced verbatim rather than retried as NORMAL -- next-day
 * settlement is a decision for the user, not a fallback.
 */
export async function redeemFlexibleToSpot(options: {
  productId: string;
  amount?: string;
}): Promise<RedeemResult> {
  await ensureTimeSynced();
  return binanceRequest<RedeemResult>('/sapi/v1/simple-earn/flexible/redeem', {
    method: 'POST',
    signed: true,
    params: {
      productId: options.productId,
      // redeemAll and amount are mutually exclusive; sending both is rejected.
      redeemAll: options.amount === undefined ? true : undefined,
      amount: options.amount,
      destAccount: 'SPOT',
      type: 'FAST',
    },
  });
}
