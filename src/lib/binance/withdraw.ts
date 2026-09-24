import 'server-only';

import { binanceRequest, ensureTimeSynced } from './client';
import { SafeError } from './redact';

/**
 * SOL withdrawals from Binance to a wallet.
 *
 * Requires "Enable Withdrawals" on the key, which Binance only allows on
 * IP-restricted keys. The app only uses this when the account has switched
 * auto-withdraw on (see User.autoWithdraw), and only to a linked wallet.
 *
 * NOT verified against a live key yet -- see README, "Buying SOL".
 */

export interface WithdrawConfig {
  withdrawEnable: boolean;
  withdrawFee: string;
  withdrawMin: string;
  /** Smallest step an amount may be expressed in, e.g. "0.00000001". */
  withdrawIntegerMultiple: string;
}

interface RawCoinConfig {
  coin: string;
  networkList?: Array<{
    network: string;
    withdrawEnable?: boolean;
    withdrawFee?: string;
    withdrawMin?: string;
    withdrawIntegerMultiple?: string;
  }>;
}

/** Fee, minimum and availability for SOL on the Solana network. Weight 10. */
export async function getSolWithdrawConfig(): Promise<WithdrawConfig> {
  await ensureTimeSynced();
  const coins = await binanceRequest<RawCoinConfig[]>('/sapi/v1/capital/config/getall', {
    signed: true,
  });
  const network = coins
    .find((c) => c.coin === 'SOL')
    ?.networkList?.find((n) => n.network === 'SOL');
  if (!network) {
    throw new SafeError('Binance did not report a SOL network for withdrawals.', { status: 502 });
  }
  return {
    withdrawEnable: network.withdrawEnable ?? false,
    withdrawFee: network.withdrawFee ?? '0',
    withdrawMin: network.withdrawMin ?? '0',
    withdrawIntegerMultiple: network.withdrawIntegerMultiple || '0.00000001',
  };
}

/**
 * Request a SOL withdrawal. Weight 900 (UID). MOVES MONEY OFF BINANCE.
 *
 * `withdrawOrderId` is our own id for the request: it is what lets a later
 * status check find this withdrawal when the response never arrived.
 * noServerRetry: a 5xx may still have executed, so it is never re-sent here.
 */
export async function applySolWithdraw(input: {
  address: string;
  amount: string;
  withdrawOrderId: string;
}): Promise<{ id: string }> {
  await ensureTimeSynced();
  return binanceRequest<{ id: string }>('/sapi/v1/capital/withdraw/apply', {
    method: 'POST',
    signed: true,
    noServerRetry: true,
    params: {
      coin: 'SOL',
      network: 'SOL',
      address: input.address,
      amount: input.amount,
      withdrawOrderId: input.withdrawOrderId,
    },
  });
}

export interface WithdrawRecord {
  id: string;
  amount: string;
  transactionFee: string;
  status: number;
  txId?: string;
  withdrawOrderId?: string;
  info?: string;
}

/**
 * Look a withdrawal up by our own order id. A heavy endpoint in Binance's
 * limits, so it is only called on an explicit status check or retry.
 */
export async function findSolWithdraw(withdrawOrderId: string): Promise<WithdrawRecord | null> {
  await ensureTimeSynced();
  const rows = await binanceRequest<WithdrawRecord[]>('/sapi/v1/capital/withdraw/history', {
    signed: true,
    params: { coin: 'SOL', withdrawOrderId },
  });
  return rows.find((row) => row.withdrawOrderId === withdrawOrderId) ?? null;
}

/**
 * Binance withdrawal statuses: 0 email sent, 1 cancelled, 2 awaiting
 * approval, 3 rejected, 4 processing, 5 failure, 6 completed.
 */
export function isWithdrawFailed(status: number): boolean {
  return status === 1 || status === 3 || status === 5;
}

export function isWithdrawCompleted(status: number): boolean {
  return status === 6;
}

/**
 * Whether an error proves Binance did NOT execute the request: it answered
 * with a 4xx (rejected, rate limited, banned). A network failure or a 5xx
 * leaves the outcome unknown.
 */
export function provablyNotExecuted(error: unknown): boolean {
  if (!(error instanceof SafeError) || error.status === undefined) return false;
  return error.status >= 400 && error.status < 500;
}
