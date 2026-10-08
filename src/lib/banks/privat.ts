import 'server-only';

import { SafeError } from '../binance/redact';
import type {
  BankProviderAdapter,
  ProviderAccount,
  ProviderClientInfo,
  ProviderTransaction,
} from './types';

/**
 * PrivatBank AutoClient -- Privat24 **for Business** only.
 *
 * Verified against the live API on 2026-10-08:
 *
 *   GET /statements/balance?startDate=DD-MM-YYYY
 *   GET /statements/transactions?startDate=DD-MM-YYYY
 *   headers: `id` and `token`
 *
 * Both header names were confirmed by sending dummy values and getting
 * `VE014 Bad token format` -- the server reached token validation, so it had
 * accepted the header names. `startDate=2026-01-01` is rejected while
 * `01-01-2026` passes, which fixes the date format as DD-MM-YYYY.
 *
 * LEGAL: AutoClient exists only for business (FOP / company) accounts. There is
 * no public API for a personal PrivatBank card, and this file does not pretend
 * otherwise -- personal cards go through statement import instead.
 */

const BASE = 'https://acp.privatbank.ua/api';

/**
 * AutoClient publishes no per-minute figure the way Monobank does. A
 * conservative floor is applied anyway so a refresh loop cannot hammer the
 * bank, and so the UI behaves the same for both providers.
 */
const MIN_REQUEST_INTERVAL_MS = 10_000;

/** No documented cap; 31 days keeps requests small and matches Monobank's UI. */
const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

const lastRequestAt = new Map<string, number>();

/**
 * The credential is stored as one opaque string so the interface stays the
 * same across providers. AutoClient needs two parts, so they travel as JSON.
 */
export interface PrivatCredential {
  id: string;
  token: string;
}

export function encodePrivatCredential(credential: PrivatCredential): string {
  return JSON.stringify(credential);
}

function decodeCredential(raw: string): PrivatCredential {
  try {
    const parsed = JSON.parse(raw) as Partial<PrivatCredential>;
    if (!parsed.id || !parsed.token) throw new Error('incomplete');
    return { id: parsed.id, token: parsed.token };
  } catch {
    throw new SafeError('Stored Privat24 credentials are unreadable. Reconnect the bank.', {
      status: 400,
    });
  }
}

function credentialKey(raw: string): string {
  return raw.slice(-8);
}

export function msUntilAllowedPrivat(raw: string): number {
  const last = lastRequestAt.get(credentialKey(raw));
  if (last === undefined) return 0;
  return Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - last));
}

/** AutoClient wants DD-MM-YYYY; an ISO date is rejected outright. */
function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${date.getFullYear()}`;
}

interface RawBalance {
  acc: string;
  currency: string;
  balanceIn?: string;
  balanceOut?: string;
  /** Available balance; the field AutoClient uses for "what you can spend". */
  balanceOutEq?: string;
  nameACC?: string;
}

interface RawTransaction {
  REF: string;
  AUT_MY_ACC?: string;
  AUT_CNTR_NAM?: string;
  AUT_CNTR_ACC?: string;
  CCY?: string;
  SUM?: string;
  SUM_E?: string;
  OSND?: string;
  DAT_OD?: string;
  DATE_TIME_DAT_OD_TIM_P?: string;
  TRANTYPE?: string;
}

interface RawResponse<T> {
  status?: string;
  code?: string;
  message?: string;
  appErrorCode?: string;
  balances?: T[];
  transactions?: T[];
  exist_next_page?: boolean;
  next_page_id?: string;
}

async function request<T>(raw: string, path: string): Promise<RawResponse<T>> {
  const wait = msUntilAllowedPrivat(raw);
  if (wait > 0) {
    throw new SafeError(
      `Privat24 was just asked. Try again in ${Math.ceil(wait / 1000)} seconds.`,
      { status: 429 },
    );
  }
  lastRequestAt.set(credentialKey(raw), Date.now());

  const credential = decodeCredential(raw);

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: {
        id: credential.id,
        token: credential.token,
        'Content-Type': 'application/json;charset=utf8',
      },
      cache: 'no-store',
    });
  } catch {
    // The cause is omitted deliberately: a fetch error can carry the request
    // headers, and those hold the token.
    throw new SafeError('Could not reach Privat24. Check your connection and try again.');
  }

  // The balance endpoint answers with charset=cp1251, so the bytes are decoded
  // explicitly rather than trusting response.text() to guess right.
  const buffer = await response.arrayBuffer();
  const charset = /charset=([\w-]+)/i.exec(response.headers.get('content-type') ?? '')?.[1];
  const decoder = new TextDecoder(
    charset && charset.toLowerCase() !== 'utf8' ? charset : 'utf-8',
  );
  const text = decoder.decode(buffer);

  let body: RawResponse<T>;
  try {
    body = JSON.parse(text) as RawResponse<T>;
  } catch {
    throw new SafeError('Privat24 returned an unreadable response.');
  }

  if (body.status === 'ERROR' || !response.ok) {
    if (body.appErrorCode === 'VE014') {
      throw new SafeError(
        'Privat24 rejected these credentials. Check the AutoClient id and token in Privat24 for Business.',
        { status: 401 },
      );
    }
    throw new SafeError(
      `Privat24 returned an error${body.message ? `: ${body.message}` : ''}.`,
      { status: 502 },
    );
  }

  return body;
}

/** ISO-4217 alphabetic (what AutoClient sends) to numeric (what we store). */
const CURRENCY_TO_NUMERIC: Record<string, number> = {
  UAH: 980,
  USD: 840,
  EUR: 978,
  GBP: 826,
  PLN: 985,
};

function toNumericCurrency(code: string | undefined): number {
  return CURRENCY_TO_NUMERIC[(code ?? 'UAH').toUpperCase()] ?? 980;
}

/**
 * AutoClient reports money as a decimal string in MAJOR units ("1234.56"),
 * where Monobank uses integer minor units. Converted here via string handling
 * so the value never passes through a float.
 */
function majorToMinor(value: string | undefined): bigint {
  if (!value) return BigInt(0);
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const digits = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ''] = digits.split('.');
  const cents = (fraction + '00').slice(0, 2);
  const minor = BigInt(whole || '0') * BigInt(100) + BigInt(cents || '0');
  return negative ? -minor : minor;
}

function toAccount(raw: RawBalance): ProviderAccount {
  const available = raw.balanceOutEq ?? raw.balanceOut ?? '0';
  return {
    externalId: raw.acc,
    // AutoClient deals in accounts, not cards, so there is no PAN to mask.
    iban: raw.acc,
    currencyCode: toNumericCurrency(raw.currency),
    balance: majorToMinor(available),
    creditLimit: BigInt(0),
    accountType: 'fop',
  };
}

function toTransaction(raw: RawTransaction): ProviderTransaction {
  // DAT_OD is DD-MM-YYYY; the fuller timestamp is preferred when present.
  const stamp = raw.DATE_TIME_DAT_OD_TIM_P ?? raw.DAT_OD ?? '';
  const match = /^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/.exec(stamp);
  const time = match
    ? new Date(
        Number(match[3]),
        Number(match[2]) - 1,
        Number(match[1]),
        Number(match[4] ?? 0),
        Number(match[5] ?? 0),
        Number(match[6] ?? 0),
      )
    : new Date();

  const magnitude = majorToMinor(raw.SUM);
  // TRANTYPE 'D' is debit (money out); 'C' is credit.
  const signed = raw.TRANTYPE === 'D' ? -magnitude : magnitude;

  return {
    externalId: raw.REF,
    time,
    amount: signed,
    currencyCode: toNumericCurrency(raw.CCY),
    description: raw.OSND?.trim() || 'Payment',
    hold: false,
    counterName: raw.AUT_CNTR_NAM?.trim() || undefined,
    counterIban: raw.AUT_CNTR_ACC?.trim() || undefined,
  };
}

async function fetchAccounts(raw: string): Promise<ProviderClientInfo> {
  // Balance needs a date; today is enough to get the current figure.
  const today = formatDate(new Date());
  const body = await request<RawBalance>(raw, `/statements/balance?startDate=${today}`);
  return {
    name: 'Privat24 for Business',
    accounts: (body.balances ?? []).map(toAccount),
  };
}

export const privatBusinessAdapter: BankProviderAdapter = {
  provider: 'privat_business',
  displayName: 'Privat24 for Business',
  minRequestIntervalMs: MIN_REQUEST_INTERVAL_MS,
  maxWindowMs: MAX_WINDOW_MS,

  msUntilAllowed: msUntilAllowedPrivat,
  verify: fetchAccounts,
  fetchAccounts,

  async fetchTransactions(raw, accountExternalId, from, to) {
    if (to.getTime() - from.getTime() > MAX_WINDOW_MS) {
      throw new SafeError('Ask for at most 31 days of statement at a time.', { status: 400 });
    }
    const params = new URLSearchParams({
      startDate: formatDate(from),
      endDate: formatDate(to),
      limit: '100',
    });
    if (accountExternalId) params.set('acc', accountExternalId);

    const body = await request<RawTransaction>(
      raw,
      `/statements/transactions?${params.toString()}`,
    );
    return (body.transactions ?? []).map(toTransaction);
  },
};
