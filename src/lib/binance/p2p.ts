import 'server-only';

import { binanceRequest, P2P_PUBLIC_BASE } from './client';
import { SafeError } from './redact';

/**
 * Public P2P ad search -- unauthenticated, and on www.binance.com rather than
 * api.binance.com.
 *
 * Everything below was measured against the live endpoint on 2026-09-21
 * rather than taken from documentation, and several points contradict what a
 * reasonable reading of the docs would suggest:
 *
 *   - the payload is `{ data: { items: [...] } }`, not a bare array
 *   - at most 10 ads come back, and BOTH `page` and `rows` are ignored --
 *     page=2 returns the same first ad as page=1, so there is no pagination to
 *     build on and no way to see the 11th-best ad
 *   - `tradeMethodIdentifiers` does filter server-side, and must be a single
 *     plain string ("PrivatBank"); an unknown identifier returns zero ads
 *   - an unsupported market returns success with zero items, not an error, so
 *     a typo in `fiat` is indistinguishable from a thin market. RUB currently
 *     returns nothing at all, for any asset or direction
 *   - prices and amounts arrive as JSON numbers, not the decimal strings this
 *     app uses everywhere money is arithmetic. They are display-only here
 *
 * Results arrive already ranked best-first from the searcher's point of view
 * (highest price when selling, lowest when buying), so the order is preserved
 * rather than re-sorted.
 */

/** Ceiling the endpoint applies whatever `rows` asks for. */
export const MAX_ADS = 10;

export type TradeSide = 'BUY' | 'SELL';

export interface P2PAdvertiser {
  nickName: string;
  /** "user" or "merchant". */
  userType: string;
  monthOrderCount: number;
  /** 0..1 completion rate over the last 30 days. */
  monthFinishRate: number;
  /** 0..1 positive feedback rate. */
  positiveRate: number;
}

export interface P2PAd {
  adNo: string;
  price: number;
  fiat: string;
  fiatSymbol: string;
  asset: string;
  minTransAmount: number;
  maxTransAmount: number;
  tradableAmount: number;
  /** Minutes the buyer has to pay. */
  payTimeLimit: number;
  tradeMethods: string[];
  advertiser: P2PAdvertiser | null;
}

interface RawAd {
  adNo?: string;
  price?: number;
  fiat?: string;
  fiatSymbol?: string;
  asset?: string;
  minTransAmount?: number;
  maxTransAmount?: number;
  tradableAmount?: number;
  payTimeLimit?: number;
  tradeMethods?: unknown;
  advertiser?: {
    nickName?: string;
    userType?: string;
    monthOrderCount?: number;
    monthFinishRate?: number;
    positiveRate?: number;
  };
}

interface AdListResponse {
  code?: string;
  message?: string | null;
  success?: boolean;
  data?: { items?: RawAd[] };
}

export async function searchAds(options: {
  asset: string;
  fiat: string;
  tradeType: TradeSide;
  payMethod?: string;
  transAmount?: string;
}): Promise<P2PAd[]> {
  const payload = await binanceRequest<AdListResponse>(
    '/bapi/c2c/v1/public/c2c/agent/ad-list',
    {
      base: P2P_PUBLIC_BASE,
      params: {
        asset: options.asset,
        fiat: options.fiat,
        tradeType: options.tradeType,
        transAmount: options.transAmount,
        tradeMethodIdentifiers: options.payMethod,
      },
    },
  );

  // This endpoint answers 200 even when it refuses the request, so the
  // envelope has to be checked rather than the HTTP status alone.
  if (payload.success === false) {
    throw new SafeError(
      `Binance P2P search failed: ${payload.message ?? payload.code ?? 'no reason given'}`,
    );
  }

  return (payload.data?.items ?? [])
    .filter((ad): ad is RawAd & { adNo: string } => typeof ad.adNo === 'string')
    .map(mapAd);
}

function mapAd(ad: RawAd & { adNo: string }): P2PAd {
  return {
    adNo: ad.adNo,
    price: ad.price ?? 0,
    fiat: ad.fiat ?? '',
    fiatSymbol: ad.fiatSymbol ?? '',
    asset: ad.asset ?? '',
    minTransAmount: ad.minTransAmount ?? 0,
    maxTransAmount: ad.maxTransAmount ?? 0,
    tradableAmount: ad.tradableAmount ?? 0,
    payTimeLimit: ad.payTimeLimit ?? 0,
    tradeMethods: Array.isArray(ad.tradeMethods)
      ? ad.tradeMethods.filter((method): method is string => typeof method === 'string')
      : [],
    advertiser: ad.advertiser
      ? {
          nickName: ad.advertiser.nickName ?? 'unknown',
          userType: ad.advertiser.userType ?? 'user',
          monthOrderCount: ad.advertiser.monthOrderCount ?? 0,
          monthFinishRate: ad.advertiser.monthFinishRate ?? 0,
          positiveRate: ad.advertiser.positiveRate ?? 0,
        }
      : null,
  };
}

/**
 * Link into Binance's own P2P UI, where the order actually gets created.
 *
 * Deliberately NOT an adNo deep link: `/en/adDetail?adNo=...` answers 404, and
 * the advertiser page keys off an `advertiserNo` this endpoint never returns.
 * Rather than ship a URL that silently lands on the wrong page, this narrows
 * the board to the right asset, fiat and side and leaves the user to match the
 * ad number, which the UI shows next to each result.
 */
export function p2pBoardUrl(asset: string, fiat: string, tradeType: TradeSide): string {
  const side = tradeType === 'SELL' ? 'sell' : 'buy';
  return `https://p2p.binance.com/en/trade/${side}/${encodeURIComponent(
    asset,
  )}?fiat=${encodeURIComponent(fiat)}`;
}
