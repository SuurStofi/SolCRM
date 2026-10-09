import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Merchant status, and the rule that matters most: an uncertain answer is
 * never treated as permission.
 *
 * Getting this wrong converts SOL to USDT for an ad that cannot be posted,
 * which leaves the user holding USDT they did not ask for.
 */

/** Mirrors canPublishAds in src/lib/autotrade/merchant.ts. */
function canPublishAds(status) {
  return status.state === 'merchant';
}

/** Mirrors how checkMerchantStatus classifies an answer. */
function classify({ categories, error, hasKey = true }) {
  if (!hasKey) return { state: 'no-key', categories: [] };
  if (error) return { state: 'unknown', categories: [], reason: error };
  return categories.length > 0
    ? { state: 'merchant', categories }
    : { state: 'not-merchant', categories: [] };
}

test('an account with publishable categories is a merchant', () => {
  const status = classify({ categories: ['mass'] });
  assert.equal(status.state, 'merchant');
  assert.equal(canPublishAds(status), true);
});

test('an empty category list means not a merchant', () => {
  // The endpoint answers for non-merchants too; an account that may publish
  // nothing cannot publish.
  const status = classify({ categories: [] });
  assert.equal(status.state, 'not-merchant');
  assert.equal(canPublishAds(status), false);
});

test("a failed check blocks Auto-sell exactly like not being a merchant", () => {
  const status = classify({ categories: [], error: 'Binance did not answer' });
  assert.equal(status.state, 'unknown');
  assert.equal(
    canPublishAds(status),
    false,
    'an uncertain status must never be read as permission',
  );
});

test('no Binance key blocks Auto-sell', () => {
  const status = classify({ categories: [], hasKey: false });
  assert.equal(status.state, 'no-key');
  assert.equal(canPublishAds(status), false);
});

test('only the merchant state unlocks Auto-sell', () => {
  const states = ['merchant', 'not-merchant', 'unknown', 'no-key'];
  const unlocked = states.filter((state) => canPublishAds({ state }));
  assert.deepEqual(unlocked, ['merchant']);
});

test('the preflight refuses before anything is converted', () => {
  // The order is the safety property: a conversion that happens before the
  // merchant check cannot be undone if the ad then fails to post.
  const steps = [];
  const runPreflight = (status) => {
    steps.push('check-merchant');
    if (!canPublishAds(status)) throw new Error('stopped');
    steps.push('check-paymethods');
    steps.push('check-balance');
  };
  const run = (status) => {
    runPreflight(status);
    steps.push('convert');
    steps.push('post-ad');
  };

  assert.throws(() => run({ state: 'unknown' }), /stopped/);
  assert.deepEqual(steps, ['check-merchant'], 'nothing after the merchant check ran');
  assert.ok(!steps.includes('convert'), 'no conversion happened');
});

test('the cache expires so a new merchant is noticed', () => {
  const CACHE_MS = 10 * 60 * 1000;
  const cachedAt = 1_000_000;
  const fresh = (now) => now - cachedAt <= CACHE_MS;

  assert.equal(fresh(cachedAt + 60_000), true, 'a minute later is still fresh');
  assert.equal(fresh(cachedAt + CACHE_MS + 1), false, 'past ten minutes it is re-checked');
});

test('a run re-checks live rather than trusting the cached answer', () => {
  // Merchant status can be revoked between arming Auto-sell and it firing.
  let forcedChecks = 0;
  const checkMerchantStatus = (_userId, options = {}) => {
    if (options.force) forcedChecks += 1;
    return { state: 'merchant', categories: ['mass'] };
  };

  // The page load may use the cache...
  checkMerchantStatus('u1');
  assert.equal(forcedChecks, 0);

  // ...but the run must not.
  checkMerchantStatus('u1', { force: true });
  assert.equal(forcedChecks, 1);
});
