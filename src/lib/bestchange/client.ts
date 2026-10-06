import 'server-only';

import { SafeError, registerSecret, safeLog } from '../binance/redact';

/**
 * BestChange API v2 client (https://bestchange.app, OpenAPI at /en/openapi.yaml).
 *
 * Checked against the published spec and the live server on 2026-09-28:
 *
 *   - every path is /v2/{apiKey}/..., and the key is a partner key from
 *     https://www.bestchange.com/partner/ -- one per server, not per user, so
 *     it lives in BESTCHANGE_API_KEY rather than the account store
 *   - a bad key answers HTTP 200 with `{"error":"Invalid API key"}`, so the
 *     body has to be checked, not only the status
 *   - a malformed key (not 32 characters) is a bare nginx 404
 *   - rates for up to 500 pairs come back from one call joined with "+", and
 *     repeating the same pair within a second only hits their cache
 *   - the server allows 30 requests per second; mirrors 1-4 exist for regions
 *     that cannot reach the main host
 *   - `rate` is FROM units per 1 TO unit, the reverse of "fiat per SOL"; see
 *     `perUnit` in ./market.ts
 */

const HOSTS = [
  'https://bestchange.app',
  'https://mirror1.bestchange.app',
  'https://mirror2.bestchange.app',
];

const TIMEOUT_MS = 15_000;

export function bestChangeKey(): string | null {
  const key = process.env.BESTCHANGE_API_KEY?.trim();
  if (!key) return null;
  // The key sits in the URL path, so any error that echoes the URL would
  // carry it. Registering it makes redact() scrub it everywhere.
  registerSecret(key);
  return key;
}

export class BestChangeNotConfigured extends SafeError {
  constructor() {
    super(
      'BestChange is not configured: set BESTCHANGE_API_KEY in .env.local (a free partner key from bestchange.com/partner) and restart the server.',
      { status: 503 },
    );
  }
}

interface ErrorBody {
  error?: string;
}

export async function bestChangeRequest<T extends object>(path: string): Promise<T> {
  const key = bestChangeKey();
  if (!key) throw new BestChangeNotConfigured();

  let lastProblem = 'no host answered';

  // Mirrors exist because some networks cannot reach the main host. Only a
  // connection failure moves on to the next one: an answer from any host is
  // the answer, and asking a mirror again would just double the load.
  for (const host of HOSTS) {
    let response: Response;
    try {
      response = await fetch(`${host}/v2/${key}${path}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (cause) {
      lastProblem = cause instanceof Error ? cause.message : String(cause);
      safeLog.warn(`[bestchange] ${host} unreachable for ${path}: ${lastProblem}`);
      continue;
    }

    if (response.status === 404) {
      throw new SafeError(
        'BestChange answered 404. The API key is probably malformed — it should be the 32-character key from bestchange.com/partner.',
        { status: 502 },
      );
    }
    if (response.status === 429) {
      throw new SafeError('BestChange rate limit reached. Wait a few seconds and try again.', {
        status: 429,
      });
    }

    const text = await response.text();
    let body: T & ErrorBody;
    try {
      body = JSON.parse(text) as T & ErrorBody;
    } catch {
      throw new SafeError(`BestChange returned a non-JSON response (HTTP ${response.status}).`);
    }

    if (typeof body.error === 'string') {
      throw new SafeError(
        body.error === 'Invalid API key'
          ? 'BestChange rejected BESTCHANGE_API_KEY as invalid. Check the key in .env.local.'
          : `BestChange error: ${body.error}`,
        { status: 502 },
      );
    }
    if (!response.ok) {
      throw new SafeError(`BestChange returned HTTP ${response.status}.`);
    }
    return body;
  }

  throw new SafeError(`Could not reach BestChange or its mirrors: ${lastProblem}`);
}

/**
 * Memoise a loader for `ttlMs`, sharing one in-flight request between
 * concurrent callers so a burst of page loads costs one upstream call.
 */
export function cached<T>(ttlMs: number, load: () => Promise<T>): () => Promise<T> {
  let value: { at: number; data: T } | null = null;
  let pending: Promise<T> | null = null;

  return () => {
    if (value && Date.now() - value.at < ttlMs) return Promise.resolve(value.data);
    if (pending) return pending;

    pending = load()
      .then((data) => {
        value = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}
