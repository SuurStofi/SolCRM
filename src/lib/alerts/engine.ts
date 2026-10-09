import 'server-only';

import { prisma } from '../db';
import { safeLog, redact } from '../binance/redact';
import { compare, type ComparisonRow } from '../compare';
import type { CryptoId, Side } from '../bestchange/market';
import { notify } from './notify';

/**
 * Price alerts: watch the market, tell the user, let them trade by hand.
 *
 * Works for everyone, merchant or not, because it publishes nothing. That is
 * the whole point -- Auto-sell needs merchant status, this needs none.
 *
 * RATE LIMITS
 *
 * Alerts are grouped by what they need before anything is fetched: every
 * alert on the same (asset, side, fiat, source) shares one comparison. Ten
 * alerts on SOL/UAH cost one round of requests, not ten. Without this a
 * handful of users would exhaust the Binance weight budget in a single cycle.
 */

/** One market, and the alerts waiting on it. */
interface Group {
  crypto: CryptoId;
  side: Side;
  fiat: string;
  source: string;
  alerts: AlertRow[];
}

interface AlertRow {
  id: string;
  userId: string;
  asset: string;
  side: string;
  fiat: string;
  source: string;
  target: string;
  payMethod: string | null;
  merchantOnly: boolean;
  repeat: boolean;
  cooldownUntil: Date | null;
}

/** The most alerts one account may keep active. */
export const MAX_ACTIVE_ALERTS = 10;

/** How long a repeating alert stays quiet after firing. */
export const COOLDOWN_MS = 60 * 60 * 1000;

function groupKey(alert: AlertRow): string {
  return `${alert.asset}|${alert.side}|${alert.fiat}|${alert.source}`;
}

/**
 * What the user actually gets from a row: the fee-adjusted price where the
 * venue publishes one, the headline otherwise.
 *
 * Dealers report an effectivePrice and Binance P2P rows do not, so a mixed
 * comparison must be ranked on this rather than on the headline -- otherwise
 * the best-looking row and the row judged against the target can differ, and
 * a dealer with a worse headline but a better net price is never considered.
 * This is why the shared byBestPrice (which sorts on price) is not used here.
 */
export function netPrice(row: ComparisonRow): number {
  return row.effectivePrice ?? row.price;
}

/** Best first for the side: highest when selling, lowest when buying. */
export function byNetPrice(side: string) {
  return (a: ComparisonRow, b: ComparisonRow) =>
    side === 'sell' ? netPrice(b) - netPrice(a) : netPrice(a) - netPrice(b);
}

/**
 * Does this row satisfy the alert?
 *
 * Selling waits for a price at or above the target; buying waits for one at
 * or below. Exported because the comparison is the part worth testing without
 * a network.
 */
export function rowMeetsTarget(row: ComparisonRow, side: string, target: number): boolean {
  // The fee-adjusted price, because that is what the user actually receives;
  // alerting on the headline price would overpromise.
  const price = netPrice(row);
  return side === 'sell' ? price >= target : price <= target;
}

export function rowMatchesFilters(row: ComparisonRow, alert: AlertRow): boolean {
  if (alert.merchantOnly && row.source.startsWith('p2p') && !row.merchant) return false;
  if (alert.payMethod) {
    const needle = alert.payMethod.toLowerCase();
    if (!row.method.toLowerCase().includes(needle)) return false;
  }
  return true;
}

/** Whether an alert should be looked at this cycle. */
export function isDue(alert: AlertRow, now = new Date()): boolean {
  if (alert.cooldownUntil && alert.cooldownUntil > now) return false;
  return true;
}

/**
 * One pass over every active alert. Never throws: a failure on one market
 * must not stop the others.
 */
export async function checkAlerts(): Promise<void> {
  const active = await prisma.priceAlert.findMany({
    where: { status: 'active' },
    select: {
      id: true,
      userId: true,
      asset: true,
      side: true,
      fiat: true,
      source: true,
      target: true,
      payMethod: true,
      merchantOnly: true,
      repeat: true,
      cooldownUntil: true,
    },
  });
  if (active.length === 0) return;

  const now = new Date();
  const due = active.filter((alert) => isDue(alert, now));
  if (due.length === 0) return;

  // Group first, fetch once per market.
  const groups = new Map<string, Group>();
  for (const alert of due) {
    const key = groupKey(alert);
    const existing = groups.get(key);
    if (existing) {
      existing.alerts.push(alert);
    } else {
      groups.set(key, {
        crypto: alert.asset as CryptoId,
        side: alert.side as Side,
        fiat: alert.fiat,
        source: alert.source,
        alerts: [alert],
      });
    }
  }

  safeLog.info(
    `[alerts] ${due.length} alert(s) across ${groups.size} market(s) this cycle`,
  );

  for (const group of groups.values()) {
    try {
      await checkGroup(group);
    } catch (error) {
      // One market failing is not a reason to skip the rest.
      safeLog.warn(`[alerts] ${groupKey(group.alerts[0])} failed: ${redact(error)}`);
    }
  }
}

async function checkGroup(group: Group): Promise<void> {
  const comparison = await compare({
    crypto: group.crypto,
    side: group.side,
    fiat: group.fiat,
    amount: null,
  });

  const rows = comparison.rows.filter((row) => {
    if (group.source === 'binance') return row.source.startsWith('p2p');
    if (group.source === 'exchanger') return row.source === 'exchanger';
    return true;
  });

  for (const alert of group.alerts) {
    const target = Number(alert.target);
    const candidates = rows.filter((row) => rowMatchesFilters(row, alert));
    const best = [...candidates].sort(byNetPrice(group.side))[0];

    const bestPrice = best ? netPrice(best) : null;

    // Recorded whether or not it fired, so the UI can show how close it is.
    await prisma.priceAlert.update({
      where: { id: alert.id },
      data: {
        lastPrice: bestPrice === null ? null : String(bestPrice),
        lastCheckedAt: new Date(),
      },
    });

    if (!best || !rowMeetsTarget(best, alert.side, target)) continue;

    await fire(alert, best, bestPrice as number);
  }
}

async function fire(alert: AlertRow, row: ComparisonRow, price: number): Promise<void> {
  const direction = alert.side === 'sell' ? 'pays' : 'asks';
  const title = `${alert.asset} at ${price} ${alert.fiat}`;
  const body =
    `${row.venue} ${direction} ${price} ${alert.fiat} for 1 ${alert.asset}` +
    (row.method ? ` via ${row.method}` : '') +
    '. You trade by hand — SolCRM cannot do this part for you.';

  await notify(alert.userId, {
    type: 'price_alert',
    title,
    body,
    link: row.url,
  });

  // A repeating alert goes quiet for the cooldown rather than off, so a price
  // sitting at the target cannot notify every minute.
  await prisma.priceAlert.update({
    where: { id: alert.id },
    data: alert.repeat
      ? { cooldownUntil: new Date(Date.now() + COOLDOWN_MS), triggeredAt: new Date() }
      : { status: 'triggered', triggeredAt: new Date() },
  });

  safeLog.info(`[alerts] ${alert.id} fired at ${price} ${alert.fiat}`);
}
