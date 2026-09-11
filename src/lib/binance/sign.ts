import crypto from 'node:crypto';

/**
 * Binance HMAC-SHA256 request signing.
 *
 * IMPORTANT (breaking change, effective 2026-01-15): Binance requires payloads
 * to be percent-encoded BEFORE the signature is computed. Most older tutorials
 * and client libraries sign the raw, unencoded query string.
 *
 * The failure mode is nasty: you get a signature-invalid error, which looks
 * identical to clock skew / recvWindow problems, so it is routinely
 * misdiagnosed. It only shows up on params that actually need encoding
 * (symbols with commas, JSON-ish values), so simple calls pass and complex
 * ones fail -- which reads like a flaky endpoint rather than a signing bug.
 *
 * The invariant that keeps this correct: build the encoded string ONCE, sign
 * exactly those bytes, and send exactly those bytes. Never re-encode after
 * signing (URLSearchParams.toString() in a later layer would do exactly that,
 * silently invalidating the signature).
 *
 * Ref: https://developers.binance.com/docs/c2c/change-log (2025-12-26 entry)
 */

export type Params = Record<string, string | number | boolean | undefined | null>;

/**
 * RFC 3986 percent-encoding. encodeURIComponent leaves !'()* unescaped, which
 * Binance's encoder does escape; mismatch there breaks the signature.
 */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/**
 * Serialize params to an encoded query string. Insertion order is preserved
 * (Binance does not require sorting -- it signs the literal string sent).
 * Undefined/null params are dropped so optional args can be passed freely.
 */
export function buildQueryString(params: Params): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(String(v))}`)
    .join('&');
}

/**
 * Returns the exact payload string to transmit, with the signature appended.
 * Callers MUST send this verbatim -- do not parse and re-serialize it.
 */
export function signPayload(params: Params, apiSecret: string): string {
  const queryString = buildQueryString(params);
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(queryString)
    .digest('hex');
  return `${queryString}&signature=${signature}`;
}

/**
 * Clock-skew handling. Binance rejects a request when
 * `timestamp` is outside `recvWindow` of server time, so we track the observed
 * offset between our clock and theirs and correct for it.
 *
 * We deliberately do NOT call /api/v3/time on every request (wasted weight and
 * latency); it is sampled and cached by the client instead.
 */
let serverTimeOffsetMs = 0;

export function setServerTimeOffset(offsetMs: number): void {
  serverTimeOffsetMs = offsetMs;
}

export function getServerTimeOffset(): number {
  return serverTimeOffsetMs;
}

/** Current time corrected to Binance server time. */
export function signedTimestamp(): number {
  return Date.now() + serverTimeOffsetMs;
}

/**
 * Binance caps recvWindow at 60000ms. 5s is a sane default: long enough to
 * absorb normal network jitter, short enough that a replayed request expires
 * quickly.
 */
export const DEFAULT_RECV_WINDOW = 5000;

export function withAuthParams(params: Params, recvWindow = DEFAULT_RECV_WINDOW): Params {
  return { ...params, timestamp: signedTimestamp(), recvWindow };
}
