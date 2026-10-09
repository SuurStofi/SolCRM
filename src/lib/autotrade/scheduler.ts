import 'server-only';

import { safeLog } from '../binance/redact';
import { checkAll, CHECK_INTERVAL_MS } from './engine';
import { checkAlerts } from '../alerts/engine';

/**
 * The one background timer, shared by Auto-sell and price alerts.
 *
 * Kept on globalThis because Next.js dev reloads modules on every edit: a
 * module-level timer would be started again on each reload. The timer calls
 * whatever `check` the latest module load stored, so an edit takes effect
 * without a second timer.
 *
 * It lives only as long as the server process. src/instrumentation.ts pokes a
 * route at startup so it starts without waiting for a page view; the alerts
 * and autotrade routes also call ensureScheduler, so whichever feature the
 * user reaches first gets the timer running.
 */
const state = globalThis as unknown as {
  __solcrmTimer?: ReturnType<typeof setInterval>;
  __solcrmCheck?: () => Promise<void>;
};

export function ensureScheduler(): void {
  // Auto-sell and price alerts share one timer rather than running two. They
  // hit the same rate-limited APIs, so a second schedule would double the
  // spend for no benefit. Each is awaited separately so one failing does not
  // skip the other.
  state.__solcrmCheck = async () => {
    await checkAll().catch((error: unknown) => {
      safeLog.warn(`[autotrade] cycle failed: ${String(error)}`);
    });
    await checkAlerts().catch((error: unknown) => {
      safeLog.warn(`[alerts] cycle failed: ${String(error)}`);
    });
  };
  if (state.__solcrmTimer) return;

  state.__solcrmTimer = setInterval(() => {
    void state.__solcrmCheck?.();
  }, CHECK_INTERVAL_MS);
  safeLog.info(`[scheduler] autotrade + alerts every ${CHECK_INTERVAL_MS / 1000}s`);
}
