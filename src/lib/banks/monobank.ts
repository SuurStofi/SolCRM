import 'server-only';

import { SafeError } from '../binance/redact';
import type {
  BankProviderAdapter,
  ProviderAccount,
  ProviderClientInfo,
  ProviderTransaction,
} from './types';

/**
 * Monobank personal API.
 *
 * Verified against the published spec at https://api.monobank.ua/docs/ and by
 * calling the live API on 2026-10-08:
 *
 *   GET  /personal/client-info
 *   GET  /personal/statement/{account}/{from}/{to}
 *   POST /personal/webhook
 *
 * Auth is the `X-Token` header. An unauthenticated call answers
 * "Missing one of required headers 'X-Token' or 'X-Key-Id'", which is why the
 * adapter interface takes an opaque credential: `X-Key-Id` is the corporate
 * variant, and swapping to it should not reach the UI.
 *
 * LEGAL: the personal API is for a person's own account. Running it for other
 * people needs Monobank's Corporate API, requested from Monobank directly.
 * The feature is behind BANKS_MONOBANK_ENABLED for that reason.
 */

const BASE = 'https://api.monobank.ua';

/**
 * The documented limit is one request per 60 seconds, per token, on both
 * client-info and statement. It is not a burst allowance: exceeding it answers
 * 429 and repeated offences get the token blocked, so this is enforced
 * client-side rather than discovered.
 */
const MIN_REQUEST_INTERVAL_MS = 60_000;

/**
 * 2682000 seconds = 31 days + 1 hour, straight from the spec. A wider window
 * is rejected outright.
 */
const MAX_WINDOW_MS = 2_682_000 * 1000;

/**
 * Last request time per token, so two browser tabs or a webhook plus a manual
 * refresh cannot spend the same budget twice.
 *
 * In-process only: this app runs as a single Node process. A second instance
 * would need this in the database instead.
 */
const lastRequestAt = new Map<string, number>();

function tokenKey(token: string): string {
  // Keyed by a short suffix so the full token is never a map key that could
  // surface in a heap dump or a debug print.
  return token.slice(-8);
}

export function msUntilAllowed(token: string): number {
  const last = lastRequestAt.get(tokenKey(token));
  if (last === undefined) return 0;
  return Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - last));
}

interface RawAccount {
  id: string;
  sendId?: string;
  balance: number;
  creditLimit: number;
  type?: string;
  currencyCode: number;
  cashbackType?: string;
  maskedPan?: string[];
  iban?: string;
}

interface RawClientInfo {
  clientId?: string;
  name?: string;
  webHookUrl?: string;
  permissions?: string;
  accounts?: RawAccount[];
}

interface RawStatementItem {
  id: string;
  time: number;
  description: string;
  mcc?: number;
  originalMcc?: number;
  hold?: boolean;
  amount: number;
  operationAmount?: number;
  currencyCode: number;
  commissionRate?: number;
  cashbackAmount?: number;
  /** Balance after the transaction. Named `balance`, not `balanceAfter`. */
  balance?: number;
  comment?: string;
  counterName?: string;
  counterIban?: string;
}

async function request<T>(token: string, path: string): Promise<T> {
  const wait = msUntilAllowed(token);
  if (wait > 0) {
    throw new SafeError(
      `Monobank allows one request per minute. Try again in ${Math.ceil(wait / 1000)} seconds.`,
      { status: 429 },
    );
  }
  // Recorded before the call, not after: a request that is in flight has
  // already spent the budget, and a failure does not refund it.
  lastRequestAt.set(tokenKey(token), Date.now());

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: { 'X-Token': token },
      cache: 'no-store',
    });
  } catch {
    // The cause is not included: a fetch error can carry the request headers,
    // and those contain the token.
    throw new SafeError('Could not reach Monobank. Check your connection and try again.');
  }

  const text = await response.text();

  if (!response.ok) {
    let description = '';
    try {
      description = (JSON.parse(text) as { errorDescription?: string }).errorDescription ?? '';
    } catch {
      /* non-JSON error body */
    }

    if (response.status === 403) {
      throw new SafeError(
        'Monobank rejected this token. Generate a new one at api.monobank.ua and paste it again.',
        { status: 401 },
      );
    }
    if (response.status === 429) {
      throw new SafeError(
        'Monobank is rate limiting this token. It allows one request per minute.',
        { status: 429 },
      );
    }
    throw new SafeError(
      `Monobank returned an error${description ? `: ${description}` : ` (HTTP ${response.status})`}.`,
      { status: 502 },
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SafeError('Monobank returned an unreadable response.');
  }
}

function toAccount(raw: RawAccount): ProviderAccount {
  return {
    externalId: raw.id,
    // Monobank sends an array of masked numbers; the first is the primary card.
    maskedPan: raw.maskedPan?.[0],
    iban: raw.iban,
    currencyCode: raw.currencyCode,
    // Already minor units in the API, so this is an exact integer conversion.
    balance: BigInt(Math.round(raw.balance)),
    creditLimit: BigInt(Math.round(raw.creditLimit ?? 0)),
    accountType: raw.type,
  };
}

function toTransaction(raw: RawStatementItem): ProviderTransaction {
  return {
    externalId: raw.id,
    time: new Date(raw.time * 1000),
    amount: BigInt(Math.round(raw.amount)),
    operationAmount:
      raw.operationAmount === undefined ? undefined : BigInt(Math.round(raw.operationAmount)),
    currencyCode: raw.currencyCode,
    description: raw.description ?? '',
    mcc: raw.mcc,
    hold: raw.hold ?? false,
    balance: raw.balance === undefined ? undefined : BigInt(Math.round(raw.balance)),
    counterName: raw.counterName,
    counterIban: raw.counterIban,
    comment: raw.comment,
  };
}

async function clientInfo(token: string): Promise<ProviderClientInfo> {
  const raw = await request<RawClientInfo>(token, '/personal/client-info');
  return {
    name: raw.name,
    accounts: (raw.accounts ?? []).map(toAccount),
  };
}

export const monobankAdapter: BankProviderAdapter = {
  provider: 'monobank',
  displayName: 'Monobank',
  minRequestIntervalMs: MIN_REQUEST_INTERVAL_MS,
  maxWindowMs: MAX_WINDOW_MS,

  msUntilAllowed,
  verify: clientInfo,
  fetchAccounts: clientInfo,

  async fetchTransactions(token, accountExternalId, from, to) {
    if (to.getTime() - from.getTime() > MAX_WINDOW_MS) {
      throw new SafeError(
        'Monobank allows at most 31 days of statement in one request.',
        { status: 400 },
      );
    }
    const fromSec = Math.floor(from.getTime() / 1000);
    const toSec = Math.floor(to.getTime() / 1000);
    const items = await request<RawStatementItem[]>(
      token,
      `/personal/statement/${encodeURIComponent(accountExternalId)}/${fromSec}/${toSec}`,
    );
    return (Array.isArray(items) ? items : []).map(toTransaction);
  },
};
