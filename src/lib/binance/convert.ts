import 'server-only';

import { binanceRequest, ensureTimeSynced } from './client';
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
  return binanceRequest<ConvertQuote>('/sapi/v1/convert/getQuote', {
    method: 'POST',
    signed: true,
    params: {
      fromAsset,
      toAsset,
      fromAmount,
      walletType: 'SPOT',
      validTime: '30s',
    },
  });
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
    throw new SafeError(`Binance does not support converting ${fromAsset} to ${toAsset}.`);
  }
  return pair;
}

/** Terminal success state for a convert order. */
export function isConvertComplete(status: string): boolean {
  return status === 'SUCCESS';
}

export function isConvertFailed(status: string): boolean {
  return status === 'FAIL' || status === 'CANCEL' || status === 'EXPIRED';
}
