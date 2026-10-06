import 'server-only';

import { prisma } from '../db';
import { redact, safeLog, SafeError } from '../binance/redact';
import { withBinanceCredentials } from '../binance/client';
import { loadBinanceCredentials } from '../binance/credentials';
import { searchAds, type P2PAd } from '../binance/p2p';
import { spotPrice } from '../binance/market';
import { getFreeBalances } from '../binance/account';
import {
  acceptConvertQuote,
  getConvertOrderStatus,
  getConvertPairLimits,
  getConvertQuote,
  isConvertFailed,
} from '../binance/convert';
import { getMyPayMethods, getPublishableCategories, postSellAd } from '../binance/c2c';
import { provablyNotExecuted } from '../binance/withdraw';
import { compareDecimal, floorToStep } from '../decimal';
import { claimRun, getConfig, patchRun, recordCheck, requireRun, transitionRun } from './store';

/**
 * Autotrade: watch Binance P2P for a USDT buyer at or above the user's price,
 * then convert SOL to USDT and publish a SELL ad at that buyer's price.
 *
 * Why an ad of our own: Binance has no API for placing an order on someone
 * else's ad, so "selling to that buyer" directly is impossible. Publishing an
 * ad at the price the market just showed is the closest automatic step; the
 * buyer (or another) then orders on it, and releasing the USDT stays manual
 * in Binance, as it must.
 *
 * Nothing moves until every precondition that can be checked has been: the
 * account may publish ads (merchant), has payment methods for the ad, holds
 * the SOL, and the amount clears Convert's minimum. Otherwise autotrade
 * switches off and says why, instead of converting SOL into an ad it cannot
 * publish.
 */

/** Room for Convert's spread when sizing the USDT from the spot price. */
const CONVERT_SLIPPAGE = 0.995;

export interface Trigger {
  ad: P2PAd;
  expectedUsdt: number;
  spot: number;
}

export type CheckResult =
  | { kind: 'disabled' }
  | { kind: 'busy'; runId: string }
  | { kind: 'no-buyer'; message: string }
  | { kind: 'blocked'; message: string }
  | { kind: 'started'; runId: string; message: string };

interface Settings {
  fiat: string;
  minPrice: string;
  amountSol: string;
  buyerMethod: string | null;
  payIds: number[];
  minOrderFiat: string;
  payTimeLimit: number;
}

export function parsePayIds(json: string): number[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v): v is number => Number.isInteger(v)) : [];
  } catch {
    return [];
  }
}

/** The best buyer who pays at least minPrice and can take the whole amount. */
export async function findTrigger(settings: Settings): Promise<{ trigger: Trigger | null; note: string }> {
  const [ads, spot] = await Promise.all([
    searchAds({
      asset: 'USDT',
      fiat: settings.fiat,
      tradeType: 'SELL',
      payMethod: settings.buyerMethod ?? undefined,
    }),
    spotPrice('SOLUSDT'),
  ]);

  const expectedUsdt = Number(settings.amountSol) * spot * CONVERT_SLIPPAGE;
  const minPrice = Number(settings.minPrice);

  // Limits on this endpoint are in USDT, not fiat (see binance/p2p.ts).
  const takesAmount = (ad: P2PAd) => {
    const max = Math.min(ad.maxTransAmount || Infinity, ad.tradableAmount || Infinity);
    return (ad.minTransAmount || 0) <= expectedUsdt && expectedUsdt <= max;
  };

  const eligible = ads.filter((ad) => ad.price >= minPrice && takesAmount(ad));
  const best = eligible.sort((a, b) => b.price - a.price)[0];
  if (best) {
    return {
      trigger: { ad: best, expectedUsdt, spot },
      note: `Buyer ${best.advertiser?.nickName ?? best.adNo} pays ${best.price} ${settings.fiat}/USDT for ~${expectedUsdt.toFixed(2)} USDT`,
    };
  }

  const topFitting = ads.filter(takesAmount).sort((a, b) => b.price - a.price)[0];
  return {
    trigger: null,
    note: topFitting
      ? `No buyer at ≥ ${settings.minPrice} ${settings.fiat}. Best for ~${expectedUsdt.toFixed(2)} USDT: ${topFitting.price}.`
      : `No buyer takes ~${expectedUsdt.toFixed(2)} USDT in ${settings.fiat} right now.`,
  };
}

/**
 * Everything checkable before money moves. Throws a SafeError naming the
 * first thing that is missing. Runs with the user's Binance key.
 */
async function preflight(settings: Settings, trigger: Trigger): Promise<void> {
  const categories = await getPublishableCategories().catch((error: unknown) => {
    throw new SafeError(
      `Could not confirm this account may publish P2P ads (merchant permission): ${redact(error instanceof Error ? error.message : error)}`,
    );
  });
  if (!categories.includes('mass')) {
    throw new SafeError(
      'This Binance account cannot publish P2P ads — ad publishing through the API needs P2P merchant status.',
    );
  }

  if (settings.payIds.length === 0) {
    throw new SafeError('Pick at least one of your Binance payment methods for the ad.');
  }
  const mine = new Set((await getMyPayMethods()).map((m) => m.payId));
  const unknown = settings.payIds.filter((id) => !mine.has(id));
  if (unknown.length > 0) {
    throw new SafeError('A payment method chosen for the ad is no longer on your Binance account.');
  }

  const free = (await getFreeBalances()).SOL ?? '0';
  if (compareDecimal(free, settings.amountSol) < 0) {
    throw new SafeError(`Not enough SOL on Binance: ${free} free, ${settings.amountSol} needed.`);
  }

  const limits = await getConvertPairLimits('SOL', 'USDT');
  if (compareDecimal(settings.amountSol, limits.fromAssetMinAmount) < 0) {
    throw new SafeError(`Binance's minimum SOL → USDT conversion is ${limits.fromAssetMinAmount} SOL.`);
  }

  const maxOrder = trigger.expectedUsdt * trigger.ad.price;
  if (Number(settings.minOrderFiat) > maxOrder) {
    throw new SafeError(
      `The ad's minimum order (${settings.minOrderFiat} ${settings.fiat}) is more than the whole ad would be worth (~${Math.floor(maxOrder)}).`,
    );
  }
}

function settingsOf(config: NonNullable<Awaited<ReturnType<typeof getConfig>>>): Settings {
  return {
    fiat: config.fiat,
    minPrice: config.minPrice,
    amountSol: config.amountSol,
    buyerMethod: config.buyerMethod,
    payIds: parsePayIds(config.payIds),
    minOrderFiat: config.minOrderFiat,
    payTimeLimit: config.payTimeLimit,
  };
}

/** One check for one user; starts a run when a buyer qualifies. */
export async function checkUser(userId: string): Promise<CheckResult> {
  const config = await getConfig(userId);
  if (!config?.enabled) return { kind: 'disabled' };

  const open = await prisma.autoTradeRun.findFirst({
    where: { userId, state: { notIn: ['AD_POSTED', 'CONVERT_FAILED'] } },
  });
  if (open) {
    await recordCheck(userId, 'Waiting: an earlier run needs attention first.');
    return { kind: 'busy', runId: open.id };
  }

  const settings = settingsOf(config);
  const { trigger, note } = await findTrigger(settings);
  if (!trigger) {
    await recordCheck(userId, note);
    return { kind: 'no-buyer', message: note };
  }

  const creds = await loadBinanceCredentials(userId);
  if (!creds) {
    await disableWith(userId, 'Switched off: no Binance API key is linked.');
    return { kind: 'blocked', message: 'No Binance API key is linked.' };
  }

  return withBinanceCredentials(creds, async () => {
    try {
      await preflight(settings, trigger);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Off rather than retried every minute: none of these fix themselves.
      await disableWith(userId, `Switched off — ${note}, but: ${message}`);
      return { kind: 'blocked' as const, message };
    }

    const run = await claimRun({
      userId,
      fiat: settings.fiat,
      amountSol: settings.amountSol,
      triggerAdNo: trigger.ad.adNo,
      triggerPrice: String(trigger.ad.price),
      triggerAdvertiser: trigger.ad.advertiser?.nickName ?? null,
      note,
    });
    if (!run) return { kind: 'disabled' as const };

    await recordCheck(userId, `Started: ${note}. Autotrade is now off until you re-arm it.`);
    await executeConvert(userId, run.id);
    return { kind: 'started' as const, runId: run.id, message: note };
  });
}

async function disableWith(userId: string, text: string) {
  await prisma.autoTradeConfig.updateMany({
    where: { userId },
    data: { enabled: false, lastCheck: redact(text), lastCheckAt: new Date() },
  });
}

/**
 * Quote, accept, settle -- the same care as the buy flow: an accept with no
 * answer is recorded and left for "Check order", never re-quoted.
 * Must run inside withBinanceCredentials.
 */
async function executeConvert(userId: string, runId: string) {
  const run = await requireRun(userId, runId);

  let quoteId: string;
  try {
    const quote = await getConvertQuote('SOL', 'USDT', run.amountSol);
    quoteId = quote.quoteId;
    await patchRun(userId, runId, { convertQuoteId: quoteId });
  } catch (error) {
    // No quote, nothing accepted: the SOL did not move.
    await transitionRun(userId, runId, 'CONVERT_FAILED', { lastError: text(error) }, 'Could not get a quote');
    return;
  }

  let orderId: string;
  try {
    orderId = (await acceptConvertQuote(quoteId)).orderId;
  } catch (error) {
    if (provablyNotExecuted(error)) {
      await transitionRun(userId, runId, 'CONVERT_FAILED', { lastError: text(error) }, 'Binance rejected the convert');
    } else {
      await patchRun(userId, runId, {
        lastError: `No answer from Binance — this convert may have gone through. Use "Check order". (${text(error)})`,
      });
    }
    return;
  }

  await patchRun(userId, runId, { convertOrderId: orderId });
  await settleConvert(userId, runId);
}

/** Read an accepted convert order back and move the run on. */
export async function settleConvert(userId: string, runId: string) {
  const run = await requireRun(userId, runId);
  if (run.state !== 'CONVERT_QUOTED' || !run.convertOrderId) return run;

  let status;
  try {
    status = await getConvertOrderStatus(run.convertOrderId);
    if (status.orderStatus === 'PROCESS') {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      status = await getConvertOrderStatus(run.convertOrderId);
    }
  } catch (error) {
    return patchRun(userId, runId, {
      lastError: `Order ${run.convertOrderId} was accepted but its result could not be read. Use "Check order". (${text(error)})`,
    });
  }

  if (status.orderStatus === 'PROCESS') {
    return patchRun(userId, runId, {
      lastError: `Order ${run.convertOrderId} is still processing. Use "Check order" in a moment.`,
    });
  }
  if (isConvertFailed(status.orderStatus)) {
    return transitionRun(userId, runId, 'CONVERT_FAILED', { lastError: `Convert ${status.orderStatus}` }, `Convert ${status.orderStatus}`);
  }

  await transitionRun(
    userId,
    runId,
    'CONVERTED',
    { usdtReceived: status.toAmount, lastError: null },
    `Converted ${run.amountSol} SOL -> ${status.toAmount} USDT`,
  );
  return publishAd(userId, runId);
}

/**
 * Publish the SELL ad for a converted run (or retry a refused one).
 * Must run inside withBinanceCredentials.
 */
export async function publishAd(userId: string, runId: string) {
  const run = await requireRun(userId, runId);
  if (run.state !== 'CONVERTED' && run.state !== 'AD_FAILED') return run;
  if (!run.usdtReceived) throw new SafeError('This run has no converted USDT to sell.');

  const config = await getConfig(userId);
  if (!config) throw new SafeError('Autotrade settings are missing.');
  const settings = settingsOf(config);

  const amount = floorToStep(run.usdtReceived, '0.01');
  const maxOrderFiat = String(Math.floor(Number(amount) * Number(run.triggerPrice)));

  // Recorded before sending: a lost answer leaves the run here, visibly.
  await transitionRun(userId, runId, 'AD_REQUESTED', { lastError: null }, `Publishing ${amount} USDT at ${run.triggerPrice} ${run.fiat}`);

  try {
    const advNo = await postSellAd({
      asset: 'USDT',
      fiat: run.fiat,
      price: run.triggerPrice,
      amount,
      minOrderFiat: settings.minOrderFiat,
      maxOrderFiat,
      payIds: settings.payIds,
      payTimeLimitMinutes: settings.payTimeLimit,
    });
    return transitionRun(userId, runId, 'AD_POSTED', { advNo, lastError: null }, `Ad ${advNo} online`);
  } catch (error) {
    if (provablyNotExecuted(error)) {
      return transitionRun(userId, runId, 'AD_FAILED', { lastError: text(error) }, 'Binance refused the ad');
    }
    return patchRun(userId, runId, {
      lastError: `No answer from Binance — the ad may have been published. Check your ads on Binance before retrying. (${text(error)})`,
    });
  }
}

/** The user checked Binance and the ad is not there: allow a retry. */
export async function reportAdMissing(userId: string, runId: string) {
  const run = await requireRun(userId, runId);
  if (run.state !== 'AD_REQUESTED') {
    throw new SafeError('Only an ad whose publication is unconfirmed can be reported missing.', { status: 409 });
  }
  return transitionRun(userId, runId, 'AD_FAILED', { lastError: 'Reported missing on Binance by the user.' }, 'Ad reported missing');
}

// ---------------------------------------------------------------------------
// Background checks
// ---------------------------------------------------------------------------

/** How often the server checks armed accounts. */
export const CHECK_INTERVAL_MS = 60_000;

const running = new Set<string>();

/**
 * checkUser, but never two at once for one account -- the timer and a
 * "Check now" click must not both reach claimRun with the same buyer.
 * (claimRun's compare-and-set would stop the second anyway; this keeps it
 * from even spending the Binance calls.)
 */
export async function checkUserOnce(userId: string): Promise<CheckResult | { kind: 'in-progress' }> {
  if (running.has(userId)) return { kind: 'in-progress' };
  running.add(userId);
  try {
    return await checkUser(userId);
  } finally {
    running.delete(userId);
  }
}

/** One pass over every armed account. Never throws. */
export async function checkAll(): Promise<void> {
  const armed = await prisma.autoTradeConfig.findMany({ where: { enabled: true }, select: { userId: true } });
  for (const { userId } of armed) {
    try {
      await checkUserOnce(userId);
    } catch (error) {
      safeLog.error(`[autotrade] check for ${userId} failed: ${redact(error)}`);
      await recordCheck(userId, `Check failed: ${text(error)}`).catch(() => undefined);
    }
  }
}

function text(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
