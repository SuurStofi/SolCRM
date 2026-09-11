import 'server-only';

import { binanceRequest, ensureTimeSynced } from './client';

/**
 * Phase 1 read-only Binance queries. Everything here works with a key that has
 * ONLY "Enable Reading" -- no trading permission, no withdrawals.
 */

interface RawBalance {
  asset: string;
  free: string;
  locked: string;
}

interface AccountInfo {
  balances: RawBalance[];
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  accountType?: string;
  updateTime?: number;
}

export interface Balance {
  asset: string;
  free: string;
  locked: string;
  total: number;
}

export interface AccountSnapshot {
  balances: Balance[];
  /** Permissions of the API KEY itself -- see getKeyRestrictions. */
  permissions: KeyRestrictions;
  hiddenZeroCount: number;
}

export interface KeyRestrictions {
  canRead: boolean;
  canTrade: boolean;
  canWithdraw: boolean;
  ipRestricted: boolean;
}

interface RawApiRestrictions {
  enableReading?: boolean;
  enableSpotAndMarginTrading?: boolean;
  enableWithdrawals?: boolean;
  ipRestrict?: boolean;
}

/**
 * Permissions of the API KEY. Weight 1.
 *
 * This is deliberately NOT read from /api/v3/account: that endpoint's
 * canTrade/canWithdraw describe the ACCOUNT's own capabilities, not what this
 * key is allowed to do. An account with withdrawals available reports
 * canWithdraw:true even when the key has withdrawals disabled -- which is
 * exactly backwards for a safety indicator.
 */
export async function getKeyRestrictions(): Promise<KeyRestrictions> {
  await ensureTimeSynced();
  const raw = await binanceRequest<RawApiRestrictions>(
    '/sapi/v1/account/apiRestrictions',
    { signed: true },
  );
  return {
    canRead: raw.enableReading ?? false,
    canTrade: raw.enableSpotAndMarginTrading ?? false,
    canWithdraw: raw.enableWithdrawals ?? false,
    ipRestricted: raw.ipRestrict ?? false,
  };
}

/**
 * Spot account balances. Weight 20.
 *
 * `omitZeroBalances=true` asks Binance to drop zero rows server-side; a real
 * account otherwise returns 400+ assets, almost all empty.
 */
export async function getAccountSnapshot(): Promise<AccountSnapshot> {
  await ensureTimeSynced();
  const [account, permissions] = await Promise.all([
    binanceRequest<AccountInfo>('/api/v3/account', {
      signed: true,
      params: { omitZeroBalances: 'true' },
    }),
    getKeyRestrictions(),
  ]);

  const balances: Balance[] = (account.balances ?? [])
    .map((b) => ({
      asset: b.asset,
      free: b.free,
      locked: b.locked,
      // Parsed only for sorting/display. All arithmetic that matters stays on
      // the decimal strings.
      total: Number(b.free) + Number(b.locked),
    }))
    .filter((b) => b.total > 0)
    .sort((a, b) => b.total - a.total);

  return {
    balances,
    permissions,
    hiddenZeroCount: Math.max(0, (account.balances?.length ?? 0) - balances.length),
  };
}

export interface DepositAddress {
  address: string;
  /** Some networks require a memo/tag; sending without it can lose funds. */
  tag?: string;
  coin: string;
  network: string;
  url?: string;
}

/**
 * Deposit address for a coin on a given network. Weight 10.
 *
 * The network parameter matters: requesting SOL without it can return an
 * address on a different chain. Always pass it explicitly.
 */
export async function getDepositAddress(
  coin: string,
  network: string,
): Promise<DepositAddress> {
  await ensureTimeSynced();
  const result = await binanceRequest<{
    address: string;
    tag?: string;
    coin: string;
    url?: string;
  }>('/sapi/v1/capital/deposit/address', {
    signed: true,
    params: { coin, network },
  });

  return {
    address: result.address,
    tag: result.tag || undefined,
    coin: result.coin,
    network,
    url: result.url,
  };
}

export interface DepositRecord {
  amount: string;
  coin: string;
  network: string;
  /** 0 = pending, 6 = credited but cannot withdraw, 1 = success. */
  status: number;
  address: string;
  txId: string;
  insertTime: number;
  confirmTimes?: string;
}

/**
 * Recent deposits. Weight 1.
 *
 * Phase 1 displays these; Phase 2 uses the same call to detect when a transfer
 * has actually been credited (which lags on-chain confirmation).
 */
export async function getRecentDeposits(coin?: string): Promise<DepositRecord[]> {
  await ensureTimeSynced();
  return binanceRequest<DepositRecord[]>('/sapi/v1/capital/deposit/hisrec', {
    signed: true,
    params: { coin, limit: 20 },
  });
}

export const DEPOSIT_STATUS_LABELS: Record<number, string> = {
  0: 'Pending',
  1: 'Success',
  2: 'Rejected',
  6: 'Credited (withdrawal locked)',
  7: 'Wrong deposit',
  8: 'Waiting user confirm',
};
