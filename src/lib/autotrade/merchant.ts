import 'server-only';

import { getPublishableCategories } from '../binance/c2c';
import { loadBinanceCredentials } from '../binance/credentials';
import { withBinanceCredentials } from '../binance/client';

/**
 * Whether an account may publish Binance P2P ads.
 *
 * HOW THIS IS CHECKED, AND WHY
 *
 * There is no endpoint that reports merchant status. Checked on 2026-10-09
 * against Binance's own first-party P2P reference
 * (github.com/binance/binance-skills-hub, skills/binance/p2p/SKILL.md), which
 * says plainly that no dedicated status endpoint exists and recommends
 * calling "get available ad categories" and catching the permission error.
 *
 * So the check is `getAvailableAdsCategory`, which is READ-ONLY: it lists
 * which ad categories the account may publish and creates, changes and
 * deletes nothing. The alternative the reference also mentions -- attempting
 * an actual ad post -- is destructive and is never used here.
 *
 * An empty category list counts as NOT a merchant: the endpoint answers for
 * non-merchants too, and an account that may publish nothing cannot publish.
 */

export type MerchantState = 'merchant' | 'not-merchant' | 'unknown' | 'no-key';

export interface MerchantStatus {
  state: MerchantState;
  /** Categories the account may publish, when it may publish any. */
  categories: string[];
  /** Why the check could not decide, in plain language. */
  reason?: string;
  checkedAt: Date;
}

/**
 * Cached per account for 10 minutes. The answer changes when Binance approves
 * a merchant application -- a thing that happens over days, not seconds -- and
 * every check spends the shared IP weight.
 */
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, MerchantStatus>();

export function cachedMerchantStatus(userId: string): MerchantStatus | null {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.checkedAt.getTime() > CACHE_MS) {
    cache.delete(userId);
    return null;
  }
  return entry;
}

export function clearMerchantStatus(userId: string): void {
  cache.delete(userId);
}

/**
 * Ask Binance whether this account can publish ads.
 *
 * Never throws: an unreachable Binance or an unexpected answer resolves to
 * `unknown`, which callers must treat exactly like `not-merchant`. Letting a
 * failed check read as success is how money moves on a false premise.
 */
export async function checkMerchantStatus(
  userId: string,
  options: { force?: boolean } = {},
): Promise<MerchantStatus> {
  if (!options.force) {
    const cached = cachedMerchantStatus(userId);
    if (cached) return cached;
  }

  const credentials = await loadBinanceCredentials(userId);
  if (!credentials) {
    const status: MerchantStatus = {
      state: 'no-key',
      categories: [],
      reason: 'No Binance key is connected.',
      checkedAt: new Date(),
    };
    cache.set(userId, status);
    return status;
  }

  let status: MerchantStatus;
  try {
    const categories = await withBinanceCredentials(credentials, () =>
      getPublishableCategories(),
    );
    status =
      categories.length > 0
        ? { state: 'merchant', categories, checkedAt: new Date() }
        : {
            state: 'not-merchant',
            categories: [],
            reason: 'Binance lists no ad categories this account may publish.',
            checkedAt: new Date(),
          };
  } catch (error) {
    // A refusal and an outage are indistinguishable from here, and guessing
    // either way is worse than saying so.
    status = {
      state: 'unknown',
      categories: [],
      reason:
        error instanceof Error
          ? error.message
          : 'Binance did not answer the merchant check.',
      checkedAt: new Date(),
    };
  }

  cache.set(userId, status);
  return status;
}

/**
 * The single gate Auto-sell asks before doing anything.
 *
 * `unknown` and `no-key` are refused alongside `not-merchant`: an uncertain
 * status is not permission.
 */
export function canPublishAds(status: MerchantStatus): boolean {
  return status.state === 'merchant';
}

/** Where to apply. Confirmed reachable on 2026-10-09. */
export const MERCHANT_APPLICATION_URL = 'https://c2c.binance.com/en/merchantApplication';
