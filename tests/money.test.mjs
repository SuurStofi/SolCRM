import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Money conversion, in the three shapes the providers actually send.
 *
 * These are the functions that decide how much money the UI reports, so they
 * are checked against exact integers rather than approximate floats. Every
 * case here is one a float would get wrong or could get wrong.
 */

/** Monobank and the bank store: integer minor units. */
function minorToDecimal(minor) {
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** Privat AutoClient: decimal strings in major units. */
function majorToMinor(value) {
  if (!value) return 0n;
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const digits = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ''] = digits.split('.');
  const cents = (fraction + '00').slice(0, 2);
  const minor = BigInt(whole || '0') * 100n + BigInt(cents || '0');
  return negative ? -minor : minor;
}

/** PYUSD: 6 decimals. */
const PYUSD_DECIMALS = 6;
function pyusdToBaseUnits(amount) {
  const [whole, fraction = ''] = amount.trim().split('.');
  const padded = (fraction + '000000').slice(0, PYUSD_DECIMALS);
  return BigInt(whole || '0') * BigInt(10 ** PYUSD_DECIMALS) + BigInt(padded || '0');
}

test('minor units render exactly', () => {
  assert.equal(minorToDecimal(1005000n), '10050.00');
  assert.equal(minorToDecimal(1n), '0.01');
  assert.equal(minorToDecimal(-24500n), '-245.00');
  assert.equal(minorToDecimal(0n), '0.00');
});

test('Privat major-unit strings convert without float drift', () => {
  assert.equal(majorToMinor('1234.56'), 123456n);
  assert.equal(majorToMinor('0.01'), 1n);
  assert.equal(majorToMinor('1000'), 100000n);
  assert.equal(majorToMinor('-245.00'), -24500n);
  assert.equal(majorToMinor('5.5'), 550n, 'one decimal place pads to two');
  assert.equal(majorToMinor(''), 0n);
  // The case a float gets wrong: 99999999.99 * 100 is not an integer.
  assert.equal(majorToMinor('99999999.99'), 9999999999n);
});

test('PYUSD converts and round-trips at six decimals', () => {
  assert.equal(pyusdToBaseUnits('1'), 1000000n);
  assert.equal(pyusdToBaseUnits('0.000001'), 1n, 'smallest unit survives');
  assert.equal(pyusdToBaseUnits('100.5'), 100500000n);
  assert.equal(pyusdToBaseUnits('1234.567890'), 1234567890n);
});

test("a credit limit is not the holder's money", () => {
  // Monobank reports balance INCLUDING the credit limit. Counting the raw
  // balance would show borrowed money as the user's own.
  const balance = 1005000n;
  const creditLimit = 500000n;
  assert.equal(minorToDecimal(balance - creditLimit), '5050.00');
  assert.notEqual(minorToDecimal(balance), '5050.00');
});
