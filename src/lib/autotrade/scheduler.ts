import 'server-only';

import { safeLog } from '../binance/redact';
import { checkAll, CHECK_INTERVAL_MS } from './engine';

/**
 * The background timer for autotrade, one per server process.
 *
 * Kept on globalThis because Next.js dev reloads modules on every edit: a
 * module-level timer would be started again on each reload. The timer calls
 * whatever `check` the latest module load stored, so an edit takes effect
 * without a second timer.
 *
 * It lives only as long as the server process. src/instrumentation.ts pokes
 * /api/autotrade at startup so it starts without waiting for a page view.
 */
const state = globalThis as unknown as {
  __autotradeTimer?: ReturnType<typeof setInterval>;
  __autotradeCheck?: () => Promise<void>;
};

export function ensureScheduler(): void {
  state.__autotradeCheck = checkAll;
  if (state.__autotradeTimer) return;

  state.__autotradeTimer = setInterval(() => {
    void state.__autotradeCheck?.();
  }, CHECK_INTERVAL_MS);
  safeLog.info(`[autotrade] background checks every ${CHECK_INTERVAL_MS / 1000}s`);
}
