import 'server-only';

import { SafeError } from '../binance/redact';
import { bestChangeRequest, cached } from './client';

/**
 * Buying and selling crypto through exchangers listed on BestChange.
 *
 * Only e-money and bank rails are offered, chosen by BestChange's own
 * currency groups rather than a hand-kept list, so new banks show up without
 * a code change. See PAYOUT_GROUPS.
 *
 * All amounts are JSON numbers from BestChange and are display-only here, as
 * with Binance P2P ads -- nothing in this module moves money.
 */

const LANG = 'en';

/**
 * BestChange groups that are e-money, bank accounts and cards, as listed by
 * /groups on 2026-09-28:
 *
 *   0 Cryptocurrencies        -- not a fiat rail
 *   1 Digital currencies      -- e-money: PayPal, WebMoney, YooMoney, Alipay ...
 *   2 Bank accounts and cards -- cards, SEPA, wires, SBP
 *   3 Online banking          -- named banks: Sberbank, Monobank, Kaspi ...
 *   4 Money transfers         -- WU, MoneyGram, Ria: collected as cash
 *   5 Cash
 *
 * The `crypto` and `cash` flags are checked as well, in case a currency is
 * ever filed under the wrong group.
 */
const RAIL_GROUPS = new Set([1, 2, 3]);

const REFERENCE_TTL_MS = 60 * 60 * 1000;
const RATES_TTL_MS = 15 * 1000;
/** BestChange's own ceiling for one batched rates request. */
const MAX_PAIRS_PER_REQUEST = 500;

/**
 * The crypto this app trades, by BestChange code. USDT and USDC are the
 * Solana-network tokens, so they land in the same wallets as SOL.
 */
export const CRYPTOS = {
  SOL: { code: 'SOL', label: 'SOL', binanceAsset: 'SOL' },
  USDT: { code: 'USDTSOL', label: 'USDT (Solana)', binanceAsset: 'USDT' },
  USDC: { code: 'USDCSOL', label: 'USDC (Solana)', binanceAsset: 'USDC' },
} as const;

export type CryptoId = keyof typeof CRYPTOS;
export type Side = 'sell' | 'buy';

export function isCryptoId(value: unknown): value is CryptoId {
  return typeof value === 'string' && value in CRYPTOS;
}

interface RawCurrency {
  id: number;
  name?: string;
  urlname?: string;
  viewname?: string;
  code?: string;
  crypto?: boolean;
  cash?: boolean;
  ps?: number;
  group?: number;
}

interface RawChanger {
  id: number;
  name?: string;
  pages?: Record<string, string>;
  rating?: number;
  active?: boolean;
  reviews?: { positive?: number; neutral?: number; closed?: number; claim?: number };
}

interface RawPresence {
  pair?: string;
  best?: number;
  count?: number;
}

interface RawRate {
  changer?: number;
  rate?: number | string;
  rankrate?: number | string;
  reserve?: number | string;
  inmin?: number | string;
  inmax?: number | string;
  marks?: unknown;
}

/** One fiat rail: a payment system in one currency, e.g. "Bank card" + "UAH". */
export interface Rail {
  id: number;
  name: string;
  code: string;
  /** ISO currency the rail pays in; null when there is none (rare). */
  fiat: string | null;
  group: string;
  /** Payment system, e.g. "Bank card", "PayPal", "WebMoney". */
  system: string;
  /** What distinguishes it within the system, e.g. "USD", "WMZ". */
  variant: string;
  urlname: string;
  /** Best price in fiat per 1 unit of crypto. */
  best: number | null;
  count: number;
}

export interface ExchangerOffer {
  changerId: number;
  changerName: string;
  /** Fiat per 1 unit of crypto. */
  price: number;
  /**
   * Same, after the extra fees BestChange knows of, computed for a $300
   * exchange. Null when BestChange did not send it.
   */
  effectivePrice: number | null;
  /** Limits of one exchange in fiat, already capped by the reserve. */
  minFiat: number | null;
  maxFiat: number | null;
  marks: string[];
  rating: number | null;
  positiveReviews: number;
  claims: number;
  /** Starts the exchange on the exchanger's site for this exact direction. */
  url: string;
  /** BestChange's page about the exchanger (reviews, reserves). */
  infoUrl: string | null;
}

const loadCurrencies = cached(REFERENCE_TTL_MS, async () => {
  const body = await bestChangeRequest<{ currencies?: RawCurrency[] }>(`/currencies/${LANG}`);
  return new Map((body.currencies ?? []).map((currency) => [currency.id, currency]));
});

const loadGroups = cached(REFERENCE_TTL_MS, async () => {
  const body = await bestChangeRequest<{ groups?: Array<{ id: number; name?: string }> }>(
    `/groups/${LANG}`,
  );
  return new Map((body.groups ?? []).map((group) => [group.id, group.name ?? '']));
});

const loadChangers = cached(REFERENCE_TTL_MS, async () => {
  const body = await bestChangeRequest<{ changers?: RawChanger[] }>(`/changers/${LANG}`);
  return new Map((body.changers ?? []).map((changer) => [changer.id, changer]));
});

async function cryptoCurrency(crypto: CryptoId): Promise<RawCurrency> {
  const currencies = await loadCurrencies();
  const code = CRYPTOS[crypto].code;
  const found = [...currencies.values()].find((c) => c.crypto && c.code === code);
  if (!found) throw new SafeError(`BestChange does not list ${CRYPTOS[crypto].label} right now.`);
  return found;
}

function isRail(currency: RawCurrency): boolean {
  return !currency.crypto && !currency.cash && RAIL_GROUPS.has(currency.group ?? -1);
}

const ISO_CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

/** E-money units pegged 1:1 to a fiat, whose codes do not say so. */
const PEGGED: Record<string, string> = { WMZ: 'USD', WME: 'EUR' };

/**
 * BestChange codes end in the ISO currency for fiat rails (SBERRUB, CARDUAH,
 * PPUSD, WIREEUR). The few that do not are either pegged e-money (WMZ) or
 * left unknown rather than guessed, and are then kept out of comparisons.
 */
export function fiatOf(code: string): string | null {
  if (PEGGED[code]) return PEGGED[code];
  const suffix = code.slice(-3).toUpperCase();
  return ISO_CURRENCIES.has(suffix) ? suffix : null;
}

/**
 * Split each rail's name into payment system and variant, the way
 * BestChange's own picker groups them ("Bank card" -> USD, RUB, UAH ...).
 *
 * Rails of one system share a `ps` number; their common name prefix is the
 * system ("WebMoney WMZ" + "WebMoney WME" -> "WebMoney"). A system with a
 * single rail drops its trailing currency code instead ("YooMoney RUB").
 */
const loadSystems = cached(REFERENCE_TTL_MS, async () => {
  const rails = [...(await loadCurrencies()).values()].filter(isRail);
  const byPs = new Map<number, RawCurrency[]>();
  for (const rail of rails) {
    const key = rail.ps ?? -rail.id;
    byPs.set(key, [...(byPs.get(key) ?? []), rail]);
  }

  const split = new Map<number, { system: string; variant: string }>();
  const alone = (name: string, code: string) => {
    const words = name.split(' ');
    const last = words.at(-1) ?? '';
    return words.length > 1 && ISO_CURRENCIES.has(last)
      ? { system: words.slice(0, -1).join(' '), variant: last }
      : { system: name, variant: fiatOf(code) ?? name };
  };

  for (const members of byPs.values()) {
    const named = members.map((m) => ({ id: m.id, code: m.code ?? '', words: (m.name ?? m.code ?? '').split(' ') }));

    // Common leading WORDS, not characters: "Alfa-Bank RUB" and "Alfa
    // cash-in RUB" share no word, and must not become "Alfa" + "-Bank RUB".
    let shared = named[0].words.length - 1;
    for (const { words } of named) {
      let i = 0;
      while (i < shared && words[i] === named[0].words[i]) i++;
      shared = i;
    }

    for (const member of named) {
      const name = member.words.join(' ');
      split.set(
        member.id,
        members.length > 1 && shared > 0
          ? { system: member.words.slice(0, shared).join(' '), variant: member.words.slice(shared).join(' ') }
          : alone(name, member.code),
      );
    }
  }
  return split;
});

function toNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Fiat per 1 unit of crypto from a BestChange rate.
 *
 * Measured on 2026-09-28: `rate` (and `rankrate`, and a presence's `best`) is
 * always units of the FROM currency given per 1 unit of the TO currency.
 * Buying (fiat -> crypto) that is already fiat per crypto -- Sberbank RUB ->
 * SOL came back as 10,585. Selling (crypto -> fiat) it is the inverse --
 * SOL -> Sberbank RUB was 0.0000916, i.e. ~10,900 RUB per SOL.
 */
function fiatPerUnit(rate: unknown, side: Side): number | null {
  const value = toNumber(rate);
  if (value === null) return null;
  return side === 'buy' ? value : 1 / value;
}

function pairOf(cryptoId: number, railId: number, side: Side): string {
  return side === 'sell' ? `${cryptoId}-${railId}` : `${railId}-${cryptoId}`;
}

/** Every e-money / bank / card rail with offers for this crypto and side. */
export async function listRails(crypto: CryptoId, side: Side): Promise<Rail[]> {
  const coin = await cryptoCurrency(crypto);
  const query = side === 'sell' ? `${coin.id}-0` : `0-${coin.id}`;
  const [currencies, groups, systems, presences] = await Promise.all([
    loadCurrencies(),
    loadGroups(),
    loadSystems(),
    bestChangeRequest<{ presences?: RawPresence[] }>(`/presences/${query}`),
  ]);

  const rails: Rail[] = [];
  for (const presence of presences.presences ?? []) {
    const [from, to] = (presence.pair ?? '').split('-').map(Number);
    const railId = side === 'sell' ? to : from;
    if ((side === 'sell' ? from : to) !== coin.id || !railId) continue;

    const currency = currencies.get(railId);
    if (!currency || !isRail(currency)) continue;

    const code = currency.code ?? '';
    const naming = systems.get(currency.id);
    rails.push({
      id: currency.id,
      name: currency.name ?? code,
      code,
      fiat: fiatOf(code),
      group: groups.get(currency.group ?? -1) ?? 'Other',
      system: naming?.system ?? currency.name ?? code,
      variant: naming?.variant ?? code,
      urlname: currency.urlname ?? '',
      best: fiatPerUnit(presence.best, side),
      count: presence.count ?? 0,
    });
  }

  return rails.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const rateCache = new Map<string, { at: number; rows: RawRate[] }>();

/** Raw rate rows per pair ("from-to"), batched and briefly cached. */
async function ratesFor(pairs: string[]): Promise<Map<string, RawRate[]>> {
  const result = new Map<string, RawRate[]>();
  const missing: string[] = [];

  for (const pair of pairs) {
    const hit = rateCache.get(pair);
    if (hit && Date.now() - hit.at < RATES_TTL_MS) result.set(pair, hit.rows);
    else missing.push(pair);
  }

  for (let i = 0; i < missing.length; i += MAX_PAIRS_PER_REQUEST) {
    const chunk = missing.slice(i, i + MAX_PAIRS_PER_REQUEST);
    const body = await bestChangeRequest<{ rates?: Record<string, RawRate[]> }>(
      `/rates/${chunk.join('+')}`,
    );
    for (const pair of chunk) {
      const rows = body.rates?.[pair] ?? [];
      rateCache.set(pair, { at: Date.now(), rows });
      result.set(pair, rows);
    }
  }

  return result;
}

function minPositive(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/**
 * Current offers per rail, best first: highest price when selling, lowest
 * when buying. Exchangers BestChange has taken out of monitoring are dropped.
 */
export async function listOffers(
  crypto: CryptoId,
  side: Side,
  railIds: number[],
): Promise<Map<number, ExchangerOffer[]>> {
  const coin = await cryptoCurrency(crypto);
  const [rates, changers] = await Promise.all([
    ratesFor(railIds.map((id) => pairOf(coin.id, id, side))),
    loadChangers(),
  ]);

  const offers = new Map<number, ExchangerOffer[]>();
  for (const railId of railIds) {
    const list: ExchangerOffer[] = [];

    for (const row of rates.get(pairOf(coin.id, railId, side)) ?? []) {
      const changer = changers.get(row.changer ?? -1);
      const price = fiatPerUnit(row.rate, side);
      if (!changer || changer.active === false || price === null) continue;

      // inmin/inmax are in the FROM currency and reserve in the TO currency
      // (measured: 3.9285 SOL minimum = exactly 20,000 UAH at the offer's
      // rate). Both are brought to fiat here, and the reserve caps the max.
      const inmin = toNumber(row.inmin);
      const inmax = toNumber(row.inmax);
      const reserve = toNumber(row.reserve);
      const [minFiat, maxFiat] =
        side === 'sell'
          ? [inmin && inmin * price, minPositive(inmax && inmax * price, reserve)]
          : [inmin, minPositive(inmax, reserve && reserve * price)];

      const [from, to] = side === 'sell' ? [coin.id, railId] : [railId, coin.id];
      list.push({
        changerId: changer.id,
        changerName: changer.name ?? `Exchanger ${changer.id}`,
        price,
        effectivePrice: fiatPerUnit(row.rankrate, side),
        minFiat,
        maxFiat,
        marks: Array.isArray(row.marks)
          ? row.marks.filter((mark): mark is string => typeof mark === 'string')
          : [],
        rating: changer.rating ?? null,
        positiveReviews: changer.reviews?.positive ?? 0,
        claims: changer.reviews?.claim ?? 0,
        url: `https://www.bestchange.com/click.php?id=${changer.id}&from=${from}&to=${to}&city=0`,
        infoUrl: changer.pages?.[LANG] ?? null,
      });
    }

    // Rank by the fee-adjusted figure when there is one, as BestChange does.
    const rank = (offer: ExchangerOffer) => offer.effectivePrice ?? offer.price;
    list.sort((a, b) => (side === 'sell' ? rank(b) - rank(a) : rank(a) - rank(b)));
    offers.set(railId, list);
  }

  return offers;
}

/** BestChange's own listing for the direction, to check an offer by hand. */
export async function directionUrl(crypto: CryptoId, side: Side, rail: Rail): Promise<string> {
  const coin = await cryptoCurrency(crypto);
  const [from, to] = side === 'sell' ? [coin.urlname, rail.urlname] : [rail.urlname, coin.urlname];
  return `https://www.bestchange.com/${from}-to-${to}.html`;
}
