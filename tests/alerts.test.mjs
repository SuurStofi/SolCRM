import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Price alerts: the price comparison, and the grouping that keeps a handful of
 * alerts from exhausting the Binance weight budget.
 *
 * Both mirror src/lib/alerts/engine.ts. The engine itself imports the Prisma
 * client and the live comparison, so the logic worth testing is restated here
 * rather than reached through a network and a database.
 */

const COOLDOWN_MS = 60 * 60 * 1000;
const MAX_ACTIVE_ALERTS = 10;

/** Mirrors rowMeetsTarget. */
function rowMeetsTarget(row, side, target) {
  const price = row.effectivePrice ?? row.price;
  return side === 'sell' ? price >= target : price <= target;
}

/** Mirrors rowMatchesFilters. */
function rowMatchesFilters(row, alert) {
  if (alert.merchantOnly && row.source.startsWith('p2p') && !row.merchant) return false;
  if (alert.payMethod) {
    const needle = alert.payMethod.toLowerCase();
    if (!row.method.toLowerCase().includes(needle)) return false;
  }
  return true;
}

/** Mirrors isDue. */
function isDue(alert, now = new Date()) {
  if (alert.cooldownUntil && alert.cooldownUntil > now) return false;
  return true;
}

/** Mirrors groupKey. */
function groupKey(alert) {
  return `${alert.asset}|${alert.side}|${alert.fiat}|${alert.source}`;
}

const row = (overrides = {}) => ({
  source: 'p2p',
  venue: 'Binance P2P',
  method: 'Monobank',
  price: 41,
  effectivePrice: null,
  merchant: false,
  ...overrides,
});

test('selling fires at or above the target', () => {
  assert.equal(rowMeetsTarget(row({ price: 42 }), 'sell', 42), true, 'exactly at target counts');
  assert.equal(rowMeetsTarget(row({ price: 42.5 }), 'sell', 42), true);
  assert.equal(rowMeetsTarget(row({ price: 41.99 }), 'sell', 42), false);
});

test('buying fires at or below the target', () => {
  assert.equal(rowMeetsTarget(row({ price: 40 }), 'buy', 40), true, 'exactly at target counts');
  assert.equal(rowMeetsTarget(row({ price: 39 }), 'buy', 40), true);
  assert.equal(rowMeetsTarget(row({ price: 40.01 }), 'buy', 40), false);
});

test('the fee-adjusted price decides, not the headline one', () => {
  // A dealer advertising 42 but paying 41.2 after fees must not fire a 42
  // alert: the user would open the link and find a worse price than promised.
  const dressed = row({ price: 42, effectivePrice: 41.2 });
  assert.equal(rowMeetsTarget(dressed, 'sell', 42), false);

  // And the reverse: a headline below target that nets above it should fire.
  const honest = row({ price: 41.9, effectivePrice: 42.1 });
  assert.equal(rowMeetsTarget(honest, 'sell', 42), true);
});

/** Mirrors netPrice/byNetPrice in the engine. */
function netPrice(row) {
  return row.effectivePrice ?? row.price;
}
function byNetPrice(side) {
  return (a, b) =>
    side === 'sell' ? netPrice(b) - netPrice(a) : netPrice(a) - netPrice(b);
}

test('the best row is chosen by net price, not by headline', () => {
  // Regression: ranking with the shared byBestPrice (headline) while judging
  // the winner on effectivePrice made the two disagree. A dealer netting 42.5
  // was passed over for a P2P ad showing 43 that nets 43 -- fine -- but a
  // dealer showing 44 and netting 40 won and then failed the target, so the
  // alert never fired even though a qualifying offer existed.
  const dealerDressedUp = { source: 'exchanger', method: 'card', price: 44, effectivePrice: 40, merchant: false };
  const dealerHonest = { source: 'exchanger', method: 'card', price: 42.6, effectivePrice: 42.5, merchant: false };

  const best = [dealerDressedUp, dealerHonest].sort(byNetPrice('sell'))[0];
  assert.equal(best, dealerHonest, 'the row that actually pays most wins');
  assert.equal(rowMeetsTarget(best, 'sell', 42), true, 'and it fires the alert');

  // Ranking by headline would have picked the other row and reported no match.
  const byHeadline = [dealerDressedUp, dealerHonest].sort((a, b) => b.price - a.price)[0];
  assert.equal(rowMeetsTarget(byHeadline, 'sell', 42), false, 'the old ordering missed it');
});

test('buying ranks the cheapest net price first', () => {
  const cheapHeadlineCostlyNet = { price: 39, effectivePrice: 41.5 };
  const trueCheapest = { price: 40, effectivePrice: 40.2 };
  const best = [cheapHeadlineCostlyNet, trueCheapest].sort(byNetPrice('buy'))[0];
  assert.equal(best, trueCheapest);
});

test('a Binance row with no published fee ranks on its headline price', () => {
  // effectivePrice is null for P2P, so netPrice must fall through rather than
  // treating the row as free.
  assert.equal(netPrice({ price: 41, effectivePrice: null }), 41);
});

test('merchant-only skips unverified P2P sellers but not dealers', () => {
  const alert = { merchantOnly: true, payMethod: null };
  assert.equal(rowMatchesFilters(row({ source: 'p2p', merchant: false }), alert), false);
  assert.equal(rowMatchesFilters(row({ source: 'p2p', merchant: true }), alert), true);
  // A dealer is not a P2P counterparty, so the merchant flag cannot apply.
  assert.equal(rowMatchesFilters(row({ source: 'exchanger' }), alert), true);
});

test('the payment-method filter matches loosely and ignores case', () => {
  const alert = { merchantOnly: false, payMethod: 'mono' };
  assert.equal(rowMatchesFilters(row({ method: 'Monobank' }), alert), true);
  assert.equal(rowMatchesFilters(row({ method: 'PrivatBank' }), alert), false);
});

test('an alert in cooldown is skipped', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  const cooling = { cooldownUntil: new Date(now.getTime() + 60_000) };
  const expired = { cooldownUntil: new Date(now.getTime() - 1) };

  assert.equal(isDue(cooling, now), false);
  assert.equal(isDue(expired, now), true);
  assert.equal(isDue({ cooldownUntil: null }, now), true);
});

test('ten alerts on one market cost one fetch, not ten', () => {
  // This is the whole reason grouping exists: the comparison is rate limited,
  // so the cost must scale with markets watched and not alerts held.
  const alerts = Array.from({ length: 10 }, (_, index) => ({
    id: `a${index}`,
    asset: 'SOL',
    side: 'sell',
    fiat: 'UAH',
    source: 'both',
    target: String(40 + index),
  }));

  const groups = new Map();
  for (const alert of alerts) {
    const key = groupKey(alert);
    const existing = groups.get(key);
    if (existing) existing.push(alert);
    else groups.set(key, [alert]);
  }

  assert.equal(groups.size, 1, 'one market means one comparison');
  assert.equal(groups.get('SOL|sell|UAH|both').length, 10, 'all ten still evaluated');
});

test('alerts differing in any market dimension are fetched separately', () => {
  const base = { asset: 'SOL', side: 'sell', fiat: 'UAH', source: 'both' };
  const keys = new Set([
    groupKey(base),
    groupKey({ ...base, asset: 'USDT' }),
    groupKey({ ...base, side: 'buy' }),
    groupKey({ ...base, fiat: 'USD' }),
    groupKey({ ...base, source: 'binance' }),
  ]);
  assert.equal(keys.size, 5, 'each dimension is part of the market identity');
});

test('the per-alert filters are not part of the group key', () => {
  // Payment method and merchant-only are applied to rows already fetched, so
  // they must not split a group and double the requests.
  const a = { asset: 'SOL', side: 'sell', fiat: 'UAH', source: 'both', payMethod: 'mono', merchantOnly: true };
  const b = { asset: 'SOL', side: 'sell', fiat: 'UAH', source: 'both', payMethod: null, merchantOnly: false };
  assert.equal(groupKey(a), groupKey(b));
});

test('a repeating alert goes quiet for an hour instead of off', () => {
  const firedAt = new Date('2026-10-09T12:00:00Z');
  const next = (alert) =>
    alert.repeat
      ? { status: 'active', cooldownUntil: new Date(firedAt.getTime() + COOLDOWN_MS) }
      : { status: 'triggered', cooldownUntil: null };

  const repeating = next({ repeat: true });
  assert.equal(repeating.status, 'active', 'still watching');
  assert.equal(
    isDue(repeating, new Date(firedAt.getTime() + 60_000)),
    false,
    'a price parked at the target cannot notify every minute',
  );
  assert.equal(isDue(repeating, new Date(firedAt.getTime() + COOLDOWN_MS + 1)), true);

  // A one-shot alert stops instead, so it needs no cooldown.
  assert.equal(next({ repeat: false }).status, 'triggered');
});

test('the source filter selects the venues it names', () => {
  const rows = [
    row({ source: 'p2p' }),
    row({ source: 'p2p-ads' }),
    row({ source: 'exchanger' }),
  ];
  const pick = (source) =>
    rows.filter((candidate) => {
      if (source === 'binance') return candidate.source.startsWith('p2p');
      if (source === 'exchanger') return candidate.source === 'exchanger';
      return true;
    });

  assert.equal(pick('binance').length, 2);
  assert.equal(pick('exchanger').length, 1);
  assert.equal(pick('both').length, 3);
});

test('the active-alert cap counts only running alerts', () => {
  // Turned-off and triggered alerts cost no requests, so holding them must not
  // block creating a new one.
  const alerts = [
    ...Array.from({ length: MAX_ACTIVE_ALERTS }, () => ({ status: 'off' })),
    ...Array.from({ length: 3 }, () => ({ status: 'triggered' })),
    { status: 'active' },
  ];
  const active = alerts.filter((alert) => alert.status === 'active').length;
  assert.equal(active, 1);
  assert.ok(active < MAX_ACTIVE_ALERTS, 'room remains despite 13 stored alerts');
});

test('no matching row records a price of null rather than firing', () => {
  // Every alert with no candidate still updates lastCheckedAt, so the UI can
  // distinguish "watching, nothing yet" from "never checked".
  const candidates = [];
  const best = candidates[0];
  const bestPrice = best ? (best.effectivePrice ?? best.price) : null;

  assert.equal(bestPrice, null);
  assert.equal(Boolean(best), false, 'nothing fires without a row');
});
