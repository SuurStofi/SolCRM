import 'server-only';

import { binanceRequest, P2P_PUBLIC_BASE } from './client';
import { SafeError, safeLog, redact } from './redact';

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
 *   - (2026-09-28) minTransAmount / maxTransAmount are in the ASSET, not the
 *     fiat: a SOL/EUR ad's 9.5396 at 104.826 EUR is exactly a 1,000 EUR
 *     minimum. Multiply by `price` for fiat
 *   - (2026-09-28) `transAmount` is ignored: 2, 500, 2000 and 100000 all
 *     returned the same ten ads as no amount at all
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
  /**
   * Binance's id for the advertiser ("userNo"), which keys their profile page.
   * Null when it could not be looked up -- see advertiserNumbers().
   */
  advertiserNo: string | null;
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
  const [ads, numbers] = await Promise.all([listAds(options), advertiserNumbers(options)]);
  return ads.map((ad) =>
    ad.advertiser
      ? { ...ad, advertiser: { ...ad.advertiser, advertiserNo: numbers.get(ad.adNo) ?? null } }
      : ad,
  );
}

async function listAds(options: {
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
          advertiserNo: null,
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

/** Host of Binance's own P2P site, whose search the site itself uses. */
const P2P_WEB_BASE = 'https://p2p.binance.com';

interface WebSearchResponse {
  success?: boolean;
  data?: Array<{ adv?: { advNo?: string }; advertiser?: { userNo?: string } }>;
}

/**
 * adNo -> advertiser number, for linking each ad to its merchant's page.
 *
 * The documented ad list above never returns the advertiser's number, so it
 * is looked up in the search p2p.binance.com itself runs
 * (POST /bapi/c2c/v2/friendly/c2c/adv/search). That endpoint is NOT
 * documented. Measured on 2026-09-28: it answers `data[].adv.advNo` and
 * `data[].advertiser.userNo`, filters by `payTypes`, and for USDT/UAH,
 * SOL/UAH, SOL/EUR and USDC/EUR its first 20 rows contained every one of the
 * ad list's (up to 10) ads.
 *
 * Best effort by design: any failure yields an empty map, and the ads then
 * link to themselves instead of to the merchant.
 */
async function advertiserNumbers(options: {
  asset: string;
  fiat: string;
  tradeType: TradeSide;
  payMethod?: string;
}): Promise<Map<string, string>> {
  try {
    const body = await binanceRequest<WebSearchResponse>('/bapi/c2c/v2/friendly/c2c/adv/search', {
      base: P2P_WEB_BASE,
      method: 'POST',
      json: {
        asset: options.asset,
        fiat: options.fiat,
        tradeType: options.tradeType,
        page: 1,
        rows: 20,
        payTypes: options.payMethod ? [options.payMethod] : [],
      },
    });
    const numbers = new Map<string, string>();
    for (const row of body.data ?? []) {
      if (row.adv?.advNo && row.advertiser?.userNo) numbers.set(row.adv.advNo, row.advertiser.userNo);
    }
    return numbers;
  } catch (error) {
    safeLog.warn(`[p2p] advertiser lookup failed, linking ads instead: ${redact(error)}`);
    return new Map();
  }
}

/** The advertiser's profile on Binance P2P: their ads, stats and reviews. */
export function advertiserUrl(advertiserNo: string): string {
  return `${P2P_WEB_BASE}/en/advertiserDetail?advertiserNo=${encodeURIComponent(advertiserNo)}`;
}

/**
 * One ad on Binance, where the order is placed. Format from Binance's P2P
 * skill reference ("provide a direct link to the specific ad using the adNo").
 */
export function adUrl(adNo: string): string {
  return `https://c2c.binance.com/en/adv?code=${encodeURIComponent(adNo)}`;
}

/** Merchant page when known, else the ad itself. */
export function adLink(ad: P2PAd): string {
  const no = ad.advertiser?.advertiserNo;
  return no ? advertiserUrl(no) : adUrl(ad.adNo);
}
