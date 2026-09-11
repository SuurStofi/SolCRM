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
    throw new SafeError(
      'Binance API credentials are not configured. Copy .env.example to .env.local and fill in BINANCE_API_KEY / BINANCE_API_SECRET.',
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
      // Network-level failure: the error may embed the full URL (with
      // signature), so scrub before it propagates.
      throw new SafeError(`Network error calling Binance ${path}: ${redact(cause)}`);
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

      // Transient server-side errors are worth one retry.
      if (response.status >= 500 && attempt < MAX_RETRIES) {
        const waitMs = 2 ** attempt * 500;
        safeLog.warn(`[binance] ${response.status} on ${path}; retrying in ${waitMs}ms`);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sample Binance server time and record the offset so signed requests carry a
 * timestamp Binance accepts.
 */
export async function syncServerTime(): Promise<number> {
  const before = Date.now();
  const { serverTime } = await binanceRequest<{ serverTime: number }>('/api/v3/time');
  // Compensate for round-trip: assume the response reflects the midpoint.
  const rtt = Date.now() - before;
  const offset = serverTime - (before + rtt / 2);
  setServerTimeOffset(offset);
  safeLog.info(`[binance] server time offset: ${Math.round(offset)}ms (rtt ${rtt}ms)`);
  return offset;
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
