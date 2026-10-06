import 'server-only';

import { searchAds, p2pBoardUrl, adLink, type P2PAd } from './binance/p2p';
import { spotPrice } from './binance/market';
import { redact } from './binance/redact';
import { bestChangeKey } from './bestchange/client';
import {
  CRYPTOS,
  listRails,
  listOffers,
  type CryptoId,
  type ExchangerOffer,
  type Side,
} from './bestchange/market';

/**
 * Every way this app knows to sell a crypto for a fiat, or buy it with one,
 * on one scale: fiat per 1 unit of the crypto.
 *
 *   exchanger  an exchanger found on BestChange, paid in / paying out through
 *              an e-wallet, bank account or card
 *   p2p        a Binance P2P ad for the crypto itself
 *   p2p-usdt   SOL only: via USDT -- sell SOL for USDT at spot and the USDT on
 *              P2P (this app's own sell route), or buy USDT on P2P and
 *              convert it to SOL at spot
 *
 * The numbers are display-only. Binance figures leave out the Convert spread
 * and network fees; exchanger figures are what the exchanger advertises.
 */

export type RouteSource = 'exchanger' | 'p2p' | 'p2p-usdt';

export interface ComparisonRow {
  id: string;
  source: RouteSource;
  /** Exchanger or P2P advertiser. */
  venue: string;
  merchant: boolean;
  /** How fiat moves: bank / wallet name or P2P payment methods. */
  method: string;
  price: number;
  /** Fee-adjusted price where the venue publishes one. */
  effectivePrice: number | null;
  /** Limits of one trade, in fiat. */
  minFiat: number | null;
  maxFiat: number | null;
  /** Whether the requested amount fits the limits; null without an amount. */
  fits: boolean | null;
  trust: string;
  notes: string[];
  url: string;
}

export interface Comparison {
  crypto: CryptoId;
  side: Side;
  fiat: string;
  amount: number | null;
  spotSolUsdt: number | null;
  rows: ComparisonRow[];
  /** Per-venue failures; the rest of the comparison still stands. */
  errors: Partial<Record<RouteSource, string>>;
  exchangerConfigured: boolean;
}

export interface BinanceReference {
  fiat: string;
  /** Only ads that can take a trade of this many units are counted. */
  minUnits: number;
  spotSolUsdt: number | null;
  bestP2P: number | null;
  bestUsdtRoute: number | null;
  boardUrl: string;
  errors: string[];
}

/** Better price first: more fiat when selling, less when buying. */
export function byBestPrice(side: Side) {
  return (a: { price: number }, b: { price: number }) =>
    side === 'sell' ? b.price - a.price : a.price - b.price;
}

function fits(amountFiat: number | null, min: number | null, max: number | null): boolean | null {
  if (amountFiat === null) return null;
  if (min !== null && amountFiat < min) return false;
  if (max !== null && amountFiat > max) return false;
  return true;
}

function reason(cause: unknown): string {
  return cause instanceof Error ? redact(cause.message) : redact(cause);
}

function exchangerRow(
  offer: ExchangerOffer,
  method: string,
  railId: number,
  amount: number | null,
): ComparisonRow {
  return {
    id: `x-${offer.changerId}-${railId}`,
    source: 'exchanger',
    venue: offer.changerName,
    merchant: false,
    method,
    price: offer.price,
    effectivePrice: offer.effectivePrice,
    minFiat: offer.minFiat,
    maxFiat: offer.maxFiat,
    fits: fits(amount !== null ? amount * offer.price : null, offer.minFiat, offer.maxFiat),
    trust: `${offer.positiveReviews} positive · ${offer.claims} claims`,
    notes: offer.marks,
    url: offer.url,
  };
}

/**
 * Fiat limits of one P2P ad. Binance sends them in the ad's asset (SOL,
 * USDT), not fiat: 9.5396 SOL at 104.826 EUR is exactly a 1,000 EUR minimum.
 * The remaining tradable amount caps the maximum as well.
 */
export function adFiatLimits(ad: P2PAd): { minFiat: number | null; maxFiat: number | null } {
  const cap =
    ad.maxTransAmount && ad.tradableAmount
      ? Math.min(ad.maxTransAmount, ad.tradableAmount)
      : ad.maxTransAmount || ad.tradableAmount;
  return {
    minFiat: ad.minTransAmount ? ad.minTransAmount * ad.price : null,
    maxFiat: cap ? cap * ad.price : null,
  };
}

function p2pRow(
  ad: P2PAd,
  source: 'p2p' | 'p2p-usdt',
  pricePerUnit: number,
  amount: number | null,
): ComparisonRow {
  const advertiser = ad.advertiser;
  const { minFiat, maxFiat } = adFiatLimits(ad);

  return {
    id: `${source}-${ad.adNo}`,
    source,
    venue: advertiser?.nickName ?? 'unknown',
    merchant: advertiser?.userType === 'merchant',
    method: ad.tradeMethods.join(', ') || '—',
    price: pricePerUnit,
    effectivePrice: null,
    minFiat,
    maxFiat,
    fits: fits(amount !== null ? amount * pricePerUnit : null, minFiat, maxFiat),
    trust: advertiser
      ? `${Math.round(advertiser.monthFinishRate * 100)}% completion · ${advertiser.monthOrderCount} orders/30d`
      : '',
    notes: [`ad ${ad.adNo}`, ...(source === 'p2p-usdt' ? [`${ad.price} ${ad.fiat}/USDT`] : [])],
    url: adLink(ad),
  };
}

/**
 * Binance's routes for one crypto, side and fiat. Each fails on its own.
 *
 * Binance's `tradeType` is from the searcher's side, as is ours: selling
 * crypto lists buyers' ads, buying lists sellers'.
 */
async function binanceRoutes(crypto: CryptoId, side: Side, fiat: string, amount: number | null) {
  const asset = CRYPTOS[crypto].binanceAsset;
  const tradeType = side === 'sell' ? 'SELL' : 'BUY';
  const viaUsdt = crypto === 'SOL';
  const errors: Partial<Record<RouteSource, string>> = {};

  const [direct, usdt, spot] = await Promise.allSettled([
    searchAds({ asset, fiat, tradeType }),
    viaUsdt ? searchAds({ asset: 'USDT', fiat, tradeType }) : Promise.resolve([]),
    viaUsdt ? spotPrice('SOLUSDT') : Promise.resolve(null),
  ]);

  const rows: ComparisonRow[] = [];
  const board = p2pBoardUrl(asset, fiat, tradeType);

  if (direct.status === 'fulfilled') {
    for (const ad of direct.value) rows.push(p2pRow(ad, 'p2p', ad.price, amount));
  } else {
    errors.p2p = reason(direct.reason);
  }

  const spotSolUsdt = spot.status === 'fulfilled' ? spot.value : null;
  if (viaUsdt) {
    if (usdt.status === 'rejected') {
      errors['p2p-usdt'] = reason(usdt.reason);
    } else if (spotSolUsdt === null) {
      errors['p2p-usdt'] = `No SOL/USDT spot price: ${reason((spot as PromiseRejectedResult).reason)}`;
    } else {
      for (const ad of usdt.value) {
        rows.push(p2pRow(ad, 'p2p-usdt', ad.price * spotSolUsdt, amount));
      }
    }
  }

  return { rows, errors, spotSolUsdt, board };
}

export async function compare(options: {
  crypto: CryptoId;
  side: Side;
  fiat: string;
  amount: number | null;
}): Promise<Comparison> {
  const { crypto, side, fiat, amount } = options;
  const exchangerConfigured = bestChangeKey() !== null;

  const exchangerWork = async (): Promise<ComparisonRow[]> => {
    if (!exchangerConfigured) return [];
    const rails = (await listRails(crypto, side)).filter((rail) => rail.fiat === fiat);
    if (rails.length === 0) return [];

    const offers = await listOffers(crypto, side, rails.map((rail) => rail.id));
    return rails.flatMap((rail) =>
      (offers.get(rail.id) ?? []).map((offer) => exchangerRow(offer, rail.name, rail.id, amount)),
    );
  };

  const [exchanger, binance] = await Promise.all([
    exchangerWork().then(
      (rows) => ({ rows, error: null as string | null }),
      (cause: unknown) => ({ rows: [] as ComparisonRow[], error: reason(cause) }),
    ),
    binanceRoutes(crypto, side, fiat, amount),
  ]);

  const errors = { ...binance.errors };
  if (exchanger.error) errors.exchanger = exchanger.error;

  return {
    crypto,
    side,
    fiat,
    amount,
    spotSolUsdt: binance.spotSolUsdt,
    rows: [...exchanger.rows, ...binance.rows].sort(byBestPrice(side)),
    errors,
    exchangerConfigured,
  };
}

/**
 * Size of trade a reference ad must be able to take. Without it the best
 * Binance price is often an ad for a few dollars, which would make every
 * exchanger look worse than anything actually on offer. Its minimum may be
 * higher -- that is still a price on offer, for a larger trade.
 */
const REFERENCE_UNITS: Record<CryptoId, number> = { SOL: 1, USDT: 100, USDC: 100 };

/** Best Binance prices for `fiat`, shown next to exchanger offers. */
export async function binanceReference(
  crypto: CryptoId,
  side: Side,
  fiat: string,
): Promise<BinanceReference> {
  const { rows, errors, spotSolUsdt, board } = await binanceRoutes(crypto, side, fiat, null);
  const units = REFERENCE_UNITS[crypto];
  const best = (source: RouteSource) =>
    rows
      .filter((r) => r.source === source && (r.maxFiat === null || r.maxFiat >= r.price * units))
      .sort(byBestPrice(side))[0]?.price ?? null;

  return {
    fiat,
    minUnits: units,
    spotSolUsdt,
    bestP2P: best('p2p'),
    bestUsdtRoute: crypto === 'SOL' ? best('p2p-usdt') : null,
    boardUrl: board,
    errors: Object.values(errors),
  };
}
