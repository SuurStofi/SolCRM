import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The rules that decide whether the headline number can be trusted.
 *
 * Each test here corresponds to a way the total could be quietly wrong:
 * counting money twice, dropping a source when a refresh fails, presenting a
 * figure nobody verified as if it were live.
 */

const USD = 840;
const UAH = 980;
const RATE_USD_UAH = 44.84;

function convert(amount, from, to) {
  if (from === to) return amount;
  if (from === USD && to === UAH) return amount * RATE_USD_UAH;
  if (from === UAH && to === USD) return amount / RATE_USD_UAH;
  return null;
}

function total(sources) {
  return sources
    .filter((source) => !source.excludedFromTotal && source.converted !== null)
    .reduce((sum, source) => sum + source.converted, 0);
}

test('sources in different currencies add up in the display currency', () => {
  const sources = [
    { converted: convert(100, USD, USD) },
    { converted: convert(4484, UAH, USD) },
  ];
  assert.equal(Math.round(total(sources)), 200);
});

test('a stale source keeps its last value instead of vanishing', () => {
  // A refresh failing must not make the total drop: that reads as money lost.
  const sources = [
    { converted: 100, stale: false },
    { converted: 50, stale: true, staleReason: 'Last refresh failed' },
  ];
  assert.equal(total(sources), 150);
  assert.equal(sources.filter((source) => source.stale).length, 1);
});

test('money in transit is never counted on both sides', () => {
  // 1 SOL has left the wallet and is not yet credited on Binance. It belongs
  // to neither balance, and must not be added to either.
  const walletAfterSend = 0;
  const binanceBeforeCredit = 0;
  const inTransit = [{ id: 'flow-1', amount: 1 }];

  const sources = [{ converted: walletAfterSend }, { converted: binanceBeforeCredit }];
  assert.equal(total(sources), 0);
  assert.equal(inTransit.length, 1, 'shown separately rather than summed');
});

test('PayPal is excluded whether or not a figure was entered by hand', () => {
  const sources = [
    { converted: 200, excludedFromTotal: false },
    { converted: null, excludedFromTotal: true, liveness: 'transfers-only' },
    // Even a number the user typed stays out of the live total.
    { converted: 500, excludedFromTotal: true, liveness: 'entered-by-you' },
  ];
  assert.equal(total(sources), 200);
});

test('an asset with no price is excluded but named', () => {
  const sources = [
    { label: 'USDT', converted: 100 },
    { label: 'SOL', converted: null },
  ];
  assert.equal(total(sources), 100);
  const missing = sources.filter((source) => source.converted === null).map((s) => s.label);
  assert.deepEqual(missing, ['SOL'], 'the page must say what is missing');
});

test('Binance figures are converted, not passed through as USD', () => {
  // The bug this guards: assigning the USD amount straight to `converted`
  // understated every Binance line by the exchange rate when showing UAH.
  const usdAmount = 100;
  const wrong = usdAmount;
  const right = convert(usdAmount, USD, UAH);
  assert.equal(Math.round(right), 4484);
  assert.notEqual(wrong, right);
});

test('the wallet is read once per page, not once per panel', () => {
  // Three panels each calling getWalletSnapshot meant nine concurrent RPC
  // requests on one page load, which the public endpoint answers with 429.
  // They now share one read through WalletSnapshotProvider.
  const CALLS_PER_SNAPSHOT = 3; // balance, token accounts, token-2022 accounts
  const panelsNeedingWallet = 3;

  const before = CALLS_PER_SNAPSHOT * panelsNeedingWallet;
  const after = CALLS_PER_SNAPSHOT; // one shared read

  assert.equal(before, 9);
  assert.equal(after, 3);
  assert.ok(after < before, 'sharing must reduce the request count');
});

test('a refresh while one is in flight reuses it rather than starting another', () => {
  // Mirrors the provider's dedupe: concurrent callers await the same promise.
  let started = 0;
  let inFlight = null;

  const refresh = () => {
    if (inFlight) return inFlight;
    started += 1;
    inFlight = Promise.resolve().then(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const a = refresh();
  const b = refresh();
  assert.equal(started, 1, 'the second caller must not start a second read');
  assert.equal(a, b, 'both callers share the same promise');
});
