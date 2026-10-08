import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Bank response parsing, against mocked payloads.
 *
 * No real bank is ever called from a test, and no real token appears in this
 * file: the payloads below are hand-written in the shape the providers
 * document, with invented ids and amounts.
 */

// --- Monobank -------------------------------------------------------------

function monoAccount(raw) {
  return {
    externalId: raw.id,
    // Monobank sends an array; the first entry is the primary card.
    maskedPan: raw.maskedPan?.[0],
    currencyCode: raw.currencyCode,
    balance: BigInt(Math.round(raw.balance)),
    creditLimit: BigInt(Math.round(raw.creditLimit ?? 0)),
    accountType: raw.type,
  };
}

function monoTransaction(raw) {
  return {
    externalId: raw.id,
    time: new Date(raw.time * 1000),
    amount: BigInt(Math.round(raw.amount)),
    hold: raw.hold ?? false,
    // Monobank calls this `balance`, not `balanceAfter`.
    balance: raw.balance === undefined ? undefined : BigInt(Math.round(raw.balance)),
  };
}

test('Monobank client-info maps to accounts without exposing a full PAN', () => {
  const account = monoAccount({
    id: 'kKGVoZuHWzqVoZuH',
    balance: 1005000,
    creditLimit: 500000,
    type: 'black',
    currencyCode: 980,
    maskedPan: ['537541******4417'],
  });

  assert.equal(account.externalId, 'kKGVoZuHWzqVoZuH');
  assert.equal(account.currencyCode, 980);
  assert.equal(account.balance, 1005000n);
  assert.match(account.maskedPan, /\*/, 'the stored number must stay masked');
  assert.equal(account.balance - account.creditLimit, 505000n, "own funds exclude the limit");
});

test('Monobank statement items use `balance`, not `balanceAfter`', () => {
  const tx = monoTransaction({
    id: 'ZuHWzqVoZuHWzqVo',
    time: 1791400000,
    description: 'Groceries',
    amount: -24500,
    currencyCode: 980,
    balance: 980500,
  });

  assert.equal(tx.amount, -24500n, 'negative is money out');
  assert.equal(tx.balance, 980500n);
  assert.equal(tx.time.getTime(), 1791400000 * 1000, 'times arrive in seconds');
});

test('Monobank allows one request per minute, enforced before the call', () => {
  const MIN_INTERVAL = 60_000;
  const seen = new Map();
  const key = (token) => token.slice(-8);
  const waitFor = (token, now) => {
    const last = seen.get(key(token));
    return last === undefined ? 0 : Math.max(0, MIN_INTERVAL - (now - last));
  };

  const token = 'uTESTTESTTESTTESTTESTTESTabcd1234';
  const t0 = 1_000_000;

  assert.equal(waitFor(token, t0), 0, 'first call is allowed');
  seen.set(key(token), t0);
  assert.equal(waitFor(token, t0 + 1000), 59_000, 'a second call waits');
  assert.equal(waitFor(token, t0 + 61_000), 0, 'allowed again after a minute');

  // The budget is per token: another user's token is unaffected.
  assert.equal(waitFor('uOTHEROTHEROTHERwxyz9876', t0 + 1000), 0);
});

test('Monobank statements are capped at 31 days + 1 hour', () => {
  const MAX_WINDOW_MS = 2_682_000 * 1000;
  const day = 24 * 60 * 60 * 1000;

  assert.ok(30 * day < MAX_WINDOW_MS, '30 days fits');
  assert.ok(32 * day > MAX_WINDOW_MS, '32 days does not');
  // A wider request is clamped rather than sent and rejected.
  assert.equal(Math.min(90 * day, MAX_WINDOW_MS), MAX_WINDOW_MS);
});

// --- Privat24 AutoClient --------------------------------------------------

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

function privatDate(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${date.getFullYear()}`;
}

test('Privat balances arrive as major-unit strings and become minor units', () => {
  const balance = {
    acc: 'UA733220010000026001234567890',
    currency: 'UAH',
    balanceOutEq: '15230.45',
  };
  assert.equal(majorToMinor(balance.balanceOutEq), 1523045n);
});

test('Privat wants DD-MM-YYYY, which an ISO date is not', () => {
  // The live API rejects 2026-01-05 and accepts 05-01-2026.
  assert.equal(privatDate(new Date(2026, 0, 5)), '05-01-2026');
  assert.equal(privatDate(new Date(2026, 11, 31)), '31-12-2026');
});

test('Privat transaction direction comes from TRANTYPE, not the amount sign', () => {
  const sign = (raw) => {
    const magnitude = majorToMinor(raw.SUM);
    return raw.TRANTYPE === 'D' ? -magnitude : magnitude;
  };
  // Both arrive as positive strings; only TRANTYPE distinguishes them.
  assert.equal(sign({ SUM: '245.00', TRANTYPE: 'D' }), -24500n, 'D is debit');
  assert.equal(sign({ SUM: '1000.00', TRANTYPE: 'C' }), 100000n, 'C is credit');
});

test('a Privat credential hint shows the token, not the JSON wrapper', () => {
  // The credential is stored as JSON because AutoClient needs two parts.
  // Slicing the stored string would show `ef"}` rather than anything useful.
  const hintFor = (credential) => {
    try {
      const parsed = JSON.parse(credential);
      if (typeof parsed.token === 'string') return parsed.token.slice(-4);
    } catch {
      /* a plain token */
    }
    return credential.slice(-4);
  };

  assert.equal(hintFor(JSON.stringify({ id: 'client-123', token: 'tok-abcdef' })), 'cdef');
  assert.equal(hintFor('plain-token-1234'), '1234');
});
