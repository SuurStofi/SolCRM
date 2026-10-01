import 'server-only';

import { binanceRequest, ensureTimeSynced } from './client';
import { signedTimestamp } from './sign';
import { SafeError } from './redact';

/**
 * Binance Convert (quote -> accept).
 *
 * Requires "Enable Spot & Margin Trading" on the API key. Without it every
 * call here returns -1002, which reads as a generic authorization failure --
 * see explainBinanceError in client.ts for the clarified message.
 */

export interface ConvertQuote {
  quoteId: string;
  ratio: string;
  inverseRatio: string;
  validTimestamp: number;
  toAmount: string;
  fromAmount: string;
  /**
   * How long the quote still has, rather than when it expires. Derived here
   * because `validTimestamp` is an instant in Binance's clock: a browser whose
   * own clock is off would otherwise render a meaningless countdown.
   */
  validForMs: number;
}

/**
 * Request a quote. Weight 200 (UID). Does NOT execute anything -- the quote
 * must be accepted separately, and expires quickly.
 *
 * `validTime: '30s'` rather than the 10s default: a human has to read the rate
 * and click confirm, and 10s routinely expires mid-decision.
 */
export async function getConvertQuote(
  fromAsset: string,
  toAsset: string,
  fromAmount: string,
): Promise<ConvertQuote> {
  await ensureTimeSynced();
  const quote = await binanceRequest<Omit<ConvertQuote, 'validForMs'>>(
    '/sapi/v1/convert/getQuote',
    {
      method: 'POST',
      signed: true,
      params: {
        fromAsset,
        toAsset,
        fromAmount,
        walletType: 'SPOT',
        validTime: '30s',
      },
    },
  );

  return {
    ...quote,
    validForMs: Math.max(0, quote.validTimestamp - signedTimestamp()),
  };
}

export interface ConvertAcceptance {
  orderId: string;
  createTime: number;
  orderStatus: string;
}

/**
 * Accept a quote. Weight 500 (UID). THIS EXECUTES THE TRADE and is
 * irreversible -- callers must confirm with the user first.
 */
export async function acceptConvertQuote(quoteId: string): Promise<ConvertAcceptance> {
  await ensureTimeSynced();
  return binanceRequest<ConvertAcceptance>('/sapi/v1/convert/acceptQuote', {
    method: 'POST',
    signed: true,
    params: { quoteId },
  });
}

export interface ConvertOrderStatus {
  orderId: string;
  orderStatus: string;
  fromAsset: string;
  fromAmount: string;
  toAsset: string;
  toAmount: string;
  ratio: string;
  createTime: number;
}

/**
 * Poll a convert order. Weight 100 (UID).
 *
 * acceptQuote often returns PROCESS rather than a final state, so the result
 * has to be confirmed here rather than assumed from the acceptance response.
 */
export async function getConvertOrderStatus(orderId: string): Promise<ConvertOrderStatus> {
  await ensureTimeSynced();
  return binanceRequest<ConvertOrderStatus>('/sapi/v1/convert/orderStatus', {
    signed: true,
    params: { orderId },
  });
}

export interface ConvertPairLimits {
  fromAsset: string;
  toAsset: string;
  fromAssetMinAmount: string;
  fromAssetMaxAmount: string;
  toAssetMinAmount: string;
  toAssetMaxAmount: string;
}

/**
 * Min/max convertible amounts for a pair. Weight 100.
 *
 * Checked before quoting so an under-minimum amount fails with a clear message
 * instead of a raw Binance error code.
 */
export async function getConvertPairLimits(
  fromAsset: string,
  toAsset: string,
): Promise<ConvertPairLimits> {
  await ensureTimeSynced();
  const result = await binanceRequest<ConvertPairLimits[] | ConvertPairLimits>(
    '/sapi/v1/convert/exchangeInfo',
    { params: { fromAsset, toAsset } },
  );
  const pair = Array.isArray(result) ? result[0] : result;
  if (!pair) {
    throw new SafeError(`Binance does not support converting ${fromAsset} to ${toAsset}.`, {
      status: 404,
    });
  }
  return pair;
}

/**
 * Every convertible pair Binance offers (~6,400 of them, ~430 assets).
 *
 * Unsigned and large, so it is cached per process: the list changes when
 * Binance lists or delists an asset, not minute to minute, and refetching it
 * on every page load would waste the weight budget.
 */
let pairCache: { pairs: ConvertPairLimits[]; fetchedAt: number } | null = null;
const PAIR_CACHE_MS = 30 * 60 * 1000;

export async function getAllConvertPairs(): Promise<ConvertPairLimits[]> {
  if (pairCache && Date.now() - pairCache.fetchedAt < PAIR_CACHE_MS) {
    return pairCache.pairs;
  }
  const result = await binanceRequest<ConvertPairLimits[]>('/sapi/v1/convert/exchangeInfo');
  const pairs = Array.isArray(result) ? result : [];
  pairCache = { pairs, fetchedAt: Date.now() };
  return pairs;
}

export interface ConvertibleAsset {
  asset: string;
  /** Spendable amount on the spot wallet, '0' when none is held. */
  free: string;
  /** Assets this one can be converted into. */
  to: string[];
}

/**
 * The asset menu for a free-form exchange: what Binance can convert, annotated
 * with what the user actually holds.
 *
 * Assets with a balance are listed first so the realistic choices are at the
 * top of a 400-entry list.
 */
export async function getConvertibleAssets(
  balances: Record<string, string>,
): Promise<ConvertibleAsset[]> {
  const pairs = await getAllConvertPairs();

  const targets = new Map<string, Set<string>>();
  for (const pair of pairs) {
    if (!targets.has(pair.fromAsset)) targets.set(pair.fromAsset, new Set());
    targets.get(pair.fromAsset)!.add(pair.toAsset);
  }

  const assets: ConvertibleAsset[] = [...targets.entries()].map(([asset, to]) => ({
    asset,
    free: balances[asset] ?? '0',
    to: [...to].sort(),
  }));

  return assets.sort((a, b) => {
    const aHas = Number(a.free) > 0;
    const bHas = Number(b.free) > 0;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas && bHas) return Number(b.free) - Number(a.free);
    return a.asset.localeCompare(b.asset);
  });
}

/** Terminal success state for a convert order. */
export function isConvertComplete(status: string): boolean {
  return status === 'SUCCESS';
}

export function isConvertFailed(status: string): boolean {
  return status === 'FAIL' || status === 'CANCEL' || status === 'EXPIRED';
}
