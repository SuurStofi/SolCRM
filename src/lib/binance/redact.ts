/**
 * Secret scrubbing. Every log line and error message in this app passes
 * through here before it is emitted.
 *
 * Binance secrets leak in more places than people expect: query strings
 * (`?...&signature=`), the X-MBX-APIKEY header echoed back in error dumps,
 * and axios/fetch error objects that serialize the whole request config.
 */

/** Values registered at startup so we can scrub them by exact match. */
const secrets = new Set<string>();

export function registerSecret(value: string | undefined | null): void {
  // Short strings would cause absurd over-matching (e.g. scrubbing "1").
  if (value && value.length >= 8) secrets.add(value);
}

const PATTERNS: Array<[RegExp, string]> = [
  // signature=... in a query string
  [/([?&]signature=)[A-Fa-f0-9]+/g, '$1<redacted>'],
  // apiKey / secret / token in JSON or query form
  [/(["']?(?:api[-_]?key|secret[-_]?key|secretKey|apiSecret|token)["']?\s*[:=]\s*["']?)([A-Za-z0-9\-_]{8,})/gi, '$1<redacted>'],
  // Bare 64-char Binance-style keys appearing anywhere
  [/\b[A-Za-z0-9]{64}\b/g, '<redacted:64>'],
];

export function redact(input: unknown): string {
  let text =
    typeof input === 'string'
      ? input
      : input instanceof Error
        ? `${input.name}: ${input.message}\n${input.stack ?? ''}`
        : safeStringify(input);

  for (const secret of secrets) {
    // Exact-match scrub of known secrets, whatever shape they appear in.
    text = text.split(secret).join('<redacted>');
  }
  for (const [pattern, replacement] of PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, replacerDroppingCircular());
  } catch {
    return String(value);
  }
}

function replacerDroppingCircular() {
  const seen = new WeakSet<object>();
  return (_key: string, value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '<circular>';
      seen.add(value);
    }
    return value;
  };
}

/** Use instead of console.* anywhere that might touch Binance data. */
export const safeLog = {
  info: (...parts: unknown[]) => console.log(parts.map(redact).join(' ')),
  warn: (...parts: unknown[]) => console.warn(parts.map(redact).join(' ')),
  error: (...parts: unknown[]) => console.error(parts.map(redact).join(' ')),
};

/**
 * Error that is safe to surface to the UI: the message has already been
 * scrubbed, so it can be rendered without leaking credentials.
 */
export class SafeError extends Error {
  readonly status?: number;
  readonly binanceCode?: number;

  constructor(message: string, opts: { status?: number; binanceCode?: number } = {}) {
    super(redact(message));
    this.name = 'SafeError';
    this.status = opts.status;
    this.binanceCode = opts.binanceCode;
  }
}
