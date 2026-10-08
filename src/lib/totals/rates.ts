import 'server-only';

import { SafeError } from '../binance/redact';

/**
 * Exchange rates for the total-balance page.
 *
 * Fiat rates come from Monobank's public `/bank/currency`, which needs no
 * token and carries its own timestamp, so the page can say where a number came
 * from and how old it is. Using it also avoids spending Binance's shared IP
 * weight on something unauthenticated.
 *
 * Verified 2026-10-08: public, no auth, ISO-4217 numeric codes, Unix-second
 * timestamps, ~107 pairs.
 */

export interface Rate {
  /** How many units of the quote currency one unit of the base is worth. */
  rate: number;
  /** When the source last updated it. */
  asOf: Date;
  source: string;
}

export const USD = 840;
export const UAH = 980;
export const EUR = 978;

interface MonoRate {
  currencyCodeA: number;
  currencyCodeB: number;
  date: number;
  rateBuy?: number;
  rateSell?: number;
  rateCross?: number;
}

/**
 * Cached for 10 minutes. The bank updates a few times a day, and the page is
 * refreshed far more often than that.
 */
let cache: { rates: MonoRate[]; fetchedAt: number } | null = null;
const CACHE_MS = 10 * 60 * 1000;

async function fetchRates(): Promise<MonoRate[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache.rates;

  let response: Response;
  try {
    response = await fetch('https://api.monobank.ua/bank/currency', { cache: 'no-store' });
  } catch {
    throw new SafeError('Could not reach the exchange-rate source.');
  }
  if (!response.ok) {
    // Monobank rate-limits this endpoint too; a stale cache beats no page.
    if (cache) return cache.rates;
    throw new SafeError('The exchange-rate source is unavailable right now.');
  }
  const rates = (await response.json()) as MonoRate[];
  cache = { rates: Array.isArray(rates) ? rates : [], fetchedAt: Date.now() };
  return cache.rates;
}

/**
 * Rate from one currency to another.
 *
 * Uses the midpoint of buy and sell when both exist: a total is neither a
 * purchase nor a sale, so quoting either side would bias every figure in one
 * direction.
 */
export async function getRate(from: number, to: number): Promise<Rate | null> {
  if (from === to) {
    return { rate: 1, asOf: new Date(), source: 'same currency' };
  }

  const rates = await fetchRates();
  const source = 'Monobank';

  const direct = rates.find((r) => r.currencyCodeA === from && r.currencyCodeB === to);
  if (direct) {
    const value = midpoint(direct);
    if (value) return { rate: value, asOf: new Date(direct.date * 1000), source };
  }

  const inverse = rates.find((r) => r.currencyCodeA === to && r.currencyCodeB === from);
  if (inverse) {
    const value = midpoint(inverse);
    if (value) return { rate: 1 / value, asOf: new Date(inverse.date * 1000), source };
  }

  // Cross via UAH, which every pair in this feed quotes against.
  if (from !== UAH && to !== UAH) {
    const [fromUah, toUah] = await Promise.all([getRate(from, UAH), getRate(to, UAH)]);
    if (fromUah && toUah && toUah.rate !== 0) {
      return {
        rate: fromUah.rate / toUah.rate,
        asOf: fromUah.asOf < toUah.asOf ? fromUah.asOf : toUah.asOf,
        source: `${source} (via UAH)`,
      };
    }
  }

  return null;
}

function midpoint(row: MonoRate): number | null {
  if (row.rateBuy && row.rateSell) return (row.rateBuy + row.rateSell) / 2;
  return row.rateCross ?? row.rateSell ?? row.rateBuy ?? null;
}

/** The currencies the total can be shown in. Easy to extend. */
export const DISPLAY_CURRENCIES = [
  { code: USD, name: 'USD', symbol: '$' },
  { code: UAH, name: 'UAH', symbol: '₴' },
  { code: EUR, name: 'EUR', symbol: '€' },
] as const;

export function isDisplayCurrency(code: number): boolean {
  return DISPLAY_CURRENCIES.some((entry) => entry.code === code);
}
