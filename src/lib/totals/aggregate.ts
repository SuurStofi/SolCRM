import 'server-only';

import { prisma } from '../db';
import { getRate, type Rate } from './rates';

/**
 * One place showing everything the user has.
 *
 * The rules that make the number trustworthy, rather than merely large:
 *
 *  - only sources the user actually connected are counted, and the page says
 *    which ones;
 *  - a source that failed to refresh keeps its last value and is marked stale,
 *    rather than silently vanishing and making the total drop;
 *  - money in transit between two sources is shown separately, never counted
 *    on both sides;
 *  - PayPal is never presented as live. There is no API to read a consumer's
 *    PayPal balance, so the page shows only PYUSD moved through this app, and
 *    a hand-entered figure stays labelled as hand-entered.
 */

export type SourceKind =
  | 'wallet'
  | 'binance'
  | 'bank'
  | 'paypal_transfers'
  | 'paypal_manual';

export interface SourceLine {
  id: string;
  kind: SourceKind;
  label: string;
  /** What the source itself reports, in its own currency. */
  amount: number;
  currencyCode: number;
  /** Converted into the display currency, or null when no rate exists. */
  converted: number | null;
  /** When this figure was last refreshed from the source. */
  asOf: Date | null;
  /** True when the last refresh failed and this is the previous value. */
  stale: boolean;
  /** Why it is stale, in plain language. */
  staleReason?: string;
  /** How the page should describe its freshness. */
  liveness: 'live' | 'from-statement' | 'entered-by-you' | 'transfers-only';
  /** Excluded from the total, but still shown. */
  excludedFromTotal?: boolean;
}

export interface TotalsResult {
  displayCurrency: number;
  /** Sum of every included, convertible source. */
  total: number;
  sources: SourceLine[];
  /** Money that has left one source but not arrived at the next. */
  inTransit: Array<{ id: string; label: string; amount: number; currencyCode: number }>;
  /** Sources that could not be converted, so are absent from the total. */
  unconvertible: string[];
  rate: { source: string; asOf: Date | null };
}

/** ISO-4217 numeric for the stablecoins that are dollars for display purposes. */
const USD_CODE = 840;

/**
 * Dollar stablecoins, keyed by MINT rather than symbol.
 *
 * The wallet read returns mints, not tickers -- there is no token registry
 * here -- so matching on a symbol would silently count nothing. A mint is also
 * the only unforgeable identifier: anyone can mint a token calling itself
 * "USDC", and matching by name would price a worthless one at a dollar.
 *
 * Each verified on-chain on 2026-10-08 (all 6 decimals).
 */
const STABLE_MINTS: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo': 'PYUSD',
};

export async function buildTotals(
  userId: string,
  displayCurrency: number,
  input: {
    /** From the browser: it holds the wallet connection, the server does not. */
    wallet?: { address: string; sol: number; tokens: Array<{ mint: string; amount: number }> };
    /** Market price of SOL in USD, when available. */
    solUsd?: number | null;
  },
): Promise<TotalsResult> {
  const sources: SourceLine[] = [];
  const unconvertible: string[] = [];
  let rateSource = 'Monobank';
  let rateAsOf: Date | null = null;

  const convert = async (amount: number, currencyCode: number): Promise<number | null> => {
    const rate: Rate | null = await getRate(currencyCode, displayCurrency);
    if (!rate) return null;
    if (!rateAsOf || rate.asOf < rateAsOf) {
      rateAsOf = rate.asOf;
      rateSource = rate.source;
    }
    return amount * rate.rate;
  };

  // --- Solana wallet -------------------------------------------------------
  if (input.wallet) {
    if (input.wallet.sol > 0) {
      // SOL needs a market price; without one it is counted as unconvertible
      // rather than guessed at.
      const usd = input.solUsd ? input.wallet.sol * input.solUsd : null;
      const converted = usd === null ? null : await convert(usd, USD_CODE);
      if (converted === null) unconvertible.push('SOL');
      sources.push({
        id: 'wallet-sol',
        kind: 'wallet',
        label: 'SOL in your wallet',
        amount: input.wallet.sol,
        currencyCode: USD_CODE,
        converted,
        asOf: new Date(),
        stale: false,
        liveness: 'live',
      });
    }

    for (const token of input.wallet.tokens) {
      const symbol = STABLE_MINTS[token.mint];
      if (!symbol || token.amount <= 0) continue;
      sources.push({
        id: `wallet-${symbol}`,
        kind: 'wallet',
        label: `${symbol} in your wallet`,
        amount: token.amount,
        currencyCode: USD_CODE,
        converted: await convert(token.amount, USD_CODE),
        asOf: new Date(),
        stale: false,
        liveness: 'live',
      });
    }
  }

  // --- Banks ---------------------------------------------------------------
  const connections = await prisma.bankConnection.findMany({
    where: { userId },
    include: { accounts: true },
  });

  for (const connection of connections) {
    for (const account of connection.accounts) {
      // Monobank's balance includes the credit limit, so the user's own money
      // is the difference. Counting the limit would inflate the total with
      // money that is not theirs.
      const own = Number(account.balance - account.creditLimit) / 100;
      if (own === 0) continue;

      const failed = connection.status === 'error';
      const converted = await convert(own, account.currencyCode);
      if (converted === null) unconvertible.push(connection.label ?? connection.provider);

      sources.push({
        id: `bank-${account.id}`,
        kind: 'bank',
        label: `${connection.label ?? connection.provider}${
          account.maskedPan ? ` •• ${account.maskedPan.slice(-4)}` : ''
        }`,
        amount: own,
        currencyCode: account.currencyCode,
        converted,
        asOf: account.balanceUpdatedAt,
        // Kept with its last value rather than dropped: a total that silently
        // falls because a refresh failed is worse than one marked stale.
        stale: failed,
        staleReason: failed ? (connection.lastError ?? 'Last refresh failed') : undefined,
        liveness: connection.provider === 'privat_import' ? 'from-statement' : 'live',
      });
    }
  }

  // --- PayPal --------------------------------------------------------------
  // There is no API for a consumer's PayPal balance, so nothing here is live.
  // Only PYUSD moved through this app is known, and it is NOT counted: those
  // tokens already left the wallet, and the receiving address belongs to
  // PayPal rather than the user.
  const payoutAddresses = await prisma.payoutAddress.findMany({
    where: { userId, kind: 'paypal' },
    select: { id: true, label: true },
  });
  if (payoutAddresses.length > 0) {
    sources.push({
      id: 'paypal',
      kind: 'paypal_transfers',
      label: 'PayPal',
      amount: 0,
      currencyCode: USD_CODE,
      converted: null,
      asOf: null,
      stale: false,
      liveness: 'transfers-only',
      excludedFromTotal: true,
    });
  }

  // --- In transit ----------------------------------------------------------
  // A transfer that has left the wallet but has not been credited on Binance
  // exists in neither balance. Showing it separately stops the total from
  // dipping for the minutes a transfer takes, without counting it twice.
  const movingFlows = await prisma.transferFlow.findMany({
    where: { userId, state: { in: ['SUBMITTED', 'CHAIN_CONFIRMED', 'CREDIT_TIMEOUT'] } },
    select: { id: true, amountSol: true },
  });
  const inTransit = movingFlows.map((flow) => ({
    id: flow.id,
    label: 'SOL on its way to Binance',
    amount: Number(flow.amountSol),
    currencyCode: USD_CODE,
  }));

  const total = sources
    .filter((line) => !line.excludedFromTotal && line.converted !== null)
    .reduce((sum, line) => sum + (line.converted ?? 0), 0);

  return {
    displayCurrency,
    total,
    sources,
    inTransit,
    unconvertible: [...new Set(unconvertible)],
    rate: { source: rateSource, asOf: rateAsOf },
  };
}
