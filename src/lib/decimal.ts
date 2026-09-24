/**
 * Minimal exact arithmetic on non-negative decimal strings.
 *
 * Money in this app is carried as decimal strings end to end; these helpers
 * compare and round them through BigInt so nothing passes through a float.
 * Scientific notation (Binance's `9E+24` maxima) is rejected, not guessed at.
 */

const DECIMAL = /^\d+(\.\d+)?$/;

function parts(value: string): [bigint, number] {
  if (!DECIMAL.test(value)) throw new Error(`Not a plain decimal: ${value}`);
  const [whole, fraction = ''] = value.split('.');
  return [BigInt(whole + fraction), fraction.length];
}

function scaleTo(value: string, scale: number): bigint {
  const [digits, own] = parts(value);
  return digits * BigInt(10) ** BigInt(scale - own);
}

function toString(digits: bigint, scale: number): string {
  if (scale === 0) return digits.toString();
  const padded = digits.toString().padStart(scale + 1, '0');
  const whole = padded.slice(0, -scale);
  const fraction = padded.slice(-scale).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/** -1, 0 or 1. */
export function compareDecimal(a: string, b: string): number {
  const scale = Math.max(parts(a)[1], parts(b)[1]);
  const x = scaleTo(a, scale);
  const y = scaleTo(b, scale);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function minDecimal(a: string, b: string): string {
  return compareDecimal(a, b) <= 0 ? a : b;
}

/** Round down to a multiple of `step` (e.g. "0.00000001"). */
export function floorToStep(value: string, step: string): string {
  if (compareDecimal(step, '0') === 0) return toString(...parts(value));
  const scale = Math.max(parts(value)[1], parts(step)[1]);
  const v = scaleTo(value, scale);
  const s = scaleTo(step, scale);
  return toString((v / s) * s, scale);
}

export function isPositiveDecimal(value: string): boolean {
  return DECIMAL.test(value) && compareDecimal(value, '0') > 0;
}
