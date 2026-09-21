import 'server-only';

import { SafeError, redact, safeLog, registerSecret } from './redact';
import {
  buildQueryString,
  signPayload,
  withAuthParams,
  setServerTimeOffset,
  type Params,
} from './sign';

/**
 * Server-side-only Binance REST client.
 *
 * This module must never be imported from a client component -- it reads the
 * API secret from the environment. The `server-only` import above turns a
 * mistaken client import into a build error rather than a credential leak.
 */

const SPOT_BASE = 'https://api.binance.com';

/**
 * P2P ad search lives on a DIFFERENT host than the rest of the API
 * (www.binance.com, not api.binance.com) and takes no authentication.
 * Ref: binance/binance-skills-hub skills/binance/p2p/SKILL.md
 */
export const P2P_PUBLIC_BASE = 'https://www.binance.com';

function credentials(): { apiKey: string; apiSecret: string } {
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;
  if (!apiKey || !apiSecret) {
    // 500, not the 502 default: nothing was sent to Binance, so this is this
    // server being unconfigured rather than the exchange failing.
    throw new SafeError(
      'Binance API credentials are not configured. Copy .env.example to .env.local and fill in BINANCE_API_KEY / BINANCE_API_SECRET.',
      { status: 500 },
    );
  }
  // Ensure these values are scrubbed from any future log output.
  registerSecret(apiKey);
  registerSecret(apiSecret);
  return { apiKey, apiSecret };
}

/**
 * Set when Binance returns HTTP 418 (IP banned). This is a hard stop: retrying
 * while banned extends the ban, so we refuse all further calls until the
 * process is restarted and the ban has expired.
 */
let ipBanUntil: number | null = null;

export function ipBanStatus(): { banned: boolean; until: number | null } {
  if (ipBanUntil && Date.now() > ipBanUntil) ipBanUntil = null;
  return { banned: ipBanUntil !== null, until: ipBanUntil };
}

/**
 * What the client is currently waiting on.
 *
 * The backoff below is invisible from the outside: a request simply takes
 * several seconds longer, which in the UI is indistinguishable from a hung
 * spinner. Recording it lets the dashboard say which one is happening.
 */
let backoffUntil: number | null = null;
let backoffReason: string | null = null;

function beginBackoff(waitMs: number, reason: string): void {
  const until = Date.now() + waitMs;
  // Several calls can be waiting at once; report the one that ends last, so
  // the indicator does not clear while something is still sleeping.
  if (backoffUntil === null || until > backoffUntil) {
    backoffUntil = until;
    backoffReason = reason;
  }
}

export interface RateLimitStatus {
  banned: boolean;
  bannedUntil: number | null;
  backingOff: boolean;
  backoffUntil: number | null;
  reason: string | null;
}

export function rateLimitStatus(): RateLimitStatus {
  const ban = ipBanStatus();
  if (backoffUntil !== null && Date.now() > backoffUntil) {
    backoffUntil = null;
    backoffReason = null;
  }

  return {
    banned: ban.banned,
    bannedUntil: ban.until,
    backingOff: backoffUntil !== null,
    backoffUntil,
    reason: ban.banned
      ? 'Binance has banned this IP (HTTP 418). Every call is refused until it expires — retrying would extend it.'
      : backoffReason,
  };
}

const MAX_RETRIES = 3;

interface RequestOptions {
  method?: 'GET' | 'POST';
  signed?: boolean;
  params?: Params;
  base?: string;
}

export async function binanceRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', signed = false, params = {}, base = SPOT_BASE } = options;

  const ban = ipBanStatus();
  if (ban.banned) {
    throw new SafeError(
      `Binance has temporarily banned this IP (HTTP 418). Not retrying -- retrying during a ban extends it. Ban observed until ~${new Date(ban.until!).toISOString()}. Wait for it to expire before using the app again.`,
      { status: 418 },
    );
  }

  let attempt = 0;
  // Retry loop handles 429 (rate limited) and transient 5xx only.
  for (;;) {
    const headers: Record<string, string> = {};
    let payload: string;

    if (signed) {
      const { apiKey, apiSecret } = credentials();
      headers['X-MBX-APIKEY'] = apiKey;
      // Timestamp is regenerated per attempt: a retry after backoff would
      // otherwise carry a stale timestamp and fail recvWindow validation.
      payload = signPayload(withAuthParams(params), apiSecret);
    } else {
      payload = buildQueryString(params);
    }

    // The signed payload is sent verbatim. Re-encoding it here (e.g. via
    // URLSearchParams) would invalidate the signature -- see sign.ts.
    const url = `${base}${path}${payload ? `?${payload}` : ''}`;

    let response: Response;
    try {
      response = await fetch(url, { method, headers, cache: 'no-store' });
    } catch (cause) {
      // A connection that was never established is safe to retry even for a
      // POST: nothing reached Binance, so nothing can execute twice.
      if (isUndeliveredRequest(cause) && attempt < MAX_RETRIES) {
        const waitMs = 2 ** attempt * 500;
        safeLog.warn(
          `[binance] could not reach ${path}; retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
        );
        beginBackoff(waitMs, 'Could not reach Binance — retrying.');
        await sleep(waitMs);
        attempt += 1;
        continue;
      }

      // Network-level failure: the error may embed the full URL (with
      // signature), so scrub before it propagates.
      throw new SafeError(
        `Network error calling Binance ${path}: ${describeNetworkError(cause)}`,
      );
    }

    if (response.status === 418) {
      const retryAfter = Number(response.headers.get('Retry-After') ?? 0);
      ipBanUntil = Date.now() + (retryAfter > 0 ? retryAfter * 1000 : 60 * 60 * 1000);
      throw new SafeError(
        'Binance returned HTTP 418: this IP is banned for sending too many requests. Stopping. Do not retry -- further requests extend the ban.',
        { status: 418 },
      );
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After') ?? 0);
      if (attempt >= MAX_RETRIES) {
        throw new SafeError(
          `Binance rate limit (HTTP 429) persisted after ${MAX_RETRIES} retries on ${path}. Back off and try again later.`,
          { status: 429 },
        );
      }
      // Honour Retry-After when present; otherwise exponential backoff.
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
      safeLog.warn(
        `[binance] 429 on ${path}; waiting ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
      beginBackoff(waitMs, 'Rate limited by Binance (HTTP 429) — waiting before the next try.');
      await sleep(waitMs);
      attempt += 1;
      continue;
    }

    const bodyText = await response.text();

    if (!response.ok) {
      // Binance error bodies look like {"code":-1021,"msg":"..."}.
      let code: number | undefined;
      let message = bodyText;
      try {
        const parsed = JSON.parse(bodyText) as { code?: number; msg?: string };
        code = parsed.code;
        if (parsed.msg) message = parsed.msg;
      } catch {
        /* non-JSON error body; use the raw text */
      }

      // A stale clock offset poisons every signed request until it is
      // recomputed, and Binance names the problem explicitly. Take it at its
      // word and resample rather than failing for the life of the process.
      // Unsigned calls are excluded so the time sync cannot recurse into this.
      if (code === -1021 && signed && attempt < MAX_RETRIES) {
        safeLog.warn(`[binance] -1021 on ${path}; resyncing server time and retrying`);
        resetTimeSync();
        await ensureTimeSynced();
        attempt += 1;
        continue;
      }

      // Transient server-side errors are worth one retry.
      if (response.status >= 500 && attempt < MAX_RETRIES) {
        const waitMs = 2 ** attempt * 500;
        safeLog.warn(`[binance] ${response.status} on ${path}; retrying in ${waitMs}ms`);
        beginBackoff(waitMs, `Binance returned ${response.status} — retrying.`);
        await sleep(waitMs);
        attempt += 1;
        continue;
      }

      throw new SafeError(explainBinanceError(code, message, path), {
        status: response.status,
        binanceCode: code,
      });
    }

    try {
      return JSON.parse(bodyText) as T;
    } catch {
      throw new SafeError(`Binance returned a non-JSON response for ${path}.`);
    }
  }
}

/**
 * Turn Binance's terse error codes into something actionable. These are the
 * codes most likely to come up while setting this app up.
 */
function explainBinanceError(code: number | undefined, msg: string, path: string): string {
  switch (code) {
    case -1021:
      return `Binance rejected the request timestamp (clock skew) on ${path}. The app syncs to Binance server time automatically; if this persists, sync your system clock. Original: ${msg}`;
    case -1022:
      return `Binance rejected the request signature on ${path}. Since 2026-01-15 payloads must be percent-encoded before signing -- verify no layer re-encodes the payload after signPayload(). Original: ${msg}`;
    case -2015:
      return `Binance rejected the API key on ${path}: invalid key, missing permission, or IP not on the allowlist. Check that the key has "Enable Reading" and that your current IP is allowlisted. Original: ${msg}`;
    case -1002:
      return `Binance says this key is not authorized for ${path}. For Convert endpoints this commonly means "Enable Spot & Margin Trading" is off (or has not propagated yet). Original: ${msg}`;
    default:
      return `Binance error on ${path}${code !== undefined ? ` (code ${code})` : ''}: ${msg}`;
  }
}

/**
 * Failures that prove the request never reached Binance.
 *
 * Only these may be retried automatically. Anything that failed mid-flight --
 * a reset or a timeout after the request was sent -- is deliberately excluded:
 * acceptQuote and the Earn redemption both execute on receipt, and re-sending
 * one that may have landed is worse than reporting a failure.
 */
const UNDELIVERED_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

function isUndeliveredRequest(error: unknown): boolean {
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
  const code = cause instanceof Error ? (cause as { code?: string }).code : undefined;
  return code !== undefined && UNDELIVERED_CODES.has(code);
}

/**
 * Describe a failed fetch.
 *
 * undici answers every network problem with the same opaque "fetch failed" and
 * puts the actual reason -- DNS, TLS, connection reset, timeout -- on `.cause`.
 * Reporting only the outer message makes those indistinguishable, so the cause
 * and its errno code are unwrapped here. The stack is left out: it adds noise
 * to a message that is rendered in the UI.
 */
function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return redact(error);

  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code;
    return redact(`${error.message} (${code ? `${code}: ` : ''}${cause.message})`);
  }
  return redact(error.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sample Binance server time and record the offset so signed requests carry a
 * timestamp Binance accepts.
 */
/** Most samples to take before settling for the best one seen. */
const TIME_SAMPLES = 3;

/**
 * A round trip slower than this cannot support a midpoint estimate.
 *
 * The midpoint assumption -- that the response was generated halfway through
 * the round trip -- only holds when the elapsed time is symmetric network
 * latency. It is badly wrong when most of it was something else: binanceRequest
 * retries and sleeps internally, so a single sample can span a 10s connect
 * timeout plus a backoff, and halving that puts the estimate seconds off.
 */
const MAX_USABLE_RTT_MS = 2_000;

export async function syncServerTime(): Promise<number> {
  let best: { offset: number; rtt: number } | null = null;

  for (let i = 0; i < TIME_SAMPLES; i++) {
    const before = Date.now();
    const { serverTime } = await binanceRequest<{ serverTime: number }>('/api/v3/time');
    const rtt = Date.now() - before;

    // Guard against a malformed response. If serverTime were undefined the
    // offset would be NaN, every later signed request would carry
    // `timestamp=NaN`, and Binance would answer -1102 "malformed parameter" --
    // an error that points nowhere near the actual cause.
    if (typeof serverTime !== 'number' || !Number.isFinite(serverTime)) {
      throw new SafeError(
        'Binance returned an unusable server time; cannot sign requests safely.',
      );
    }

    // Keep the fastest exchange rather than averaging: a sample inflated by a
    // retry carries no information about the real offset, and averaging it in
    // would drag the estimate away from the truth instead of smoothing it.
    const offset = serverTime - (before + rtt / 2);
    if (best === null || rtt < best.rtt) best = { offset, rtt };

    // One clean sample is enough; further calls would only spend weight.
    if (best.rtt <= MAX_USABLE_RTT_MS) break;
  }

  if (best === null) {
    throw new SafeError('Could not sample Binance server time.');
  }
  if (best.rtt > MAX_USABLE_RTT_MS) {
    safeLog.warn(
      `[binance] best clock sample still took ${best.rtt}ms; the offset may be imprecise. A -1021 will trigger a resync.`,
    );
  }

  setServerTimeOffset(best.offset);
  safeLog.info(
    `[binance] server time offset: ${Math.round(best.offset)}ms (rtt ${best.rtt}ms)`,
  );
  return best.offset;
}

let timeSyncPromise: Promise<number> | null = null;

/** Sync once per process; concurrent callers reuse the in-flight promise. */
export function ensureTimeSynced(): Promise<number> {
  if (!timeSyncPromise) {
    timeSyncPromise = syncServerTime().catch((error: unknown) => {
      timeSyncPromise = null; // allow retry on next call
      throw error;
    });
  }
  return timeSyncPromise;
}

/**
 * Force the next ensureTimeSynced() to resample.
 *
 * Without this a single bad offset is permanent: the promise is cached for the
 * life of the process, so every signed request keeps failing with -1021 until
 * the server is restarted.
 */
export function resetTimeSync(): void {
  timeSyncPromise = null;
}
