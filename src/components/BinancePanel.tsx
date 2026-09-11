'use client';

import { useCallback, useEffect, useState } from 'react';
import { Panel, ErrorNote, Spinner, RefreshButton, Chip } from './ui';

interface Balance {
  asset: string;
  free: string;
  locked: string;
  total: number;
}

interface AccountSnapshot {
  balances: Balance[];
  permissions: { canTrade: boolean; canWithdraw: boolean; canDeposit: boolean };
  hiddenZeroCount: number;
}

interface DepositRecord {
  amount: string;
  coin: string;
  network: string;
  status: number;
  txId: string;
  insertTime: number;
}

const DEPOSIT_STATUS_LABELS: Record<number, string> = {
  0: 'Pending',
  1: 'Success',
  2: 'Rejected',
  6: 'Credited',
  7: 'Wrong deposit',
  8: 'Awaiting confirm',
};

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = (await response.json()) as ApiResponse<T>;
  if (!body.ok || body.data === undefined) {
    throw new Error(body.error ?? 'Request failed');
  }
  return body.data;
}

export function BinancePanel() {
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const [deposits, setDeposits] = useState<DepositRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snapshot = await fetchJson<AccountSnapshot>('/api/binance/account');
      setAccount(snapshot);
      // Deposits are secondary: a failure here should not blank the balances.
      try {
        setDeposits(await fetchJson<DepositRecord[]>('/api/binance/deposits?coin=SOL'));
      } catch {
        setDeposits([]);
      }
    } catch (cause) {
      setAccount(null);
      setError(cause instanceof Error ? cause.message : 'Failed to reach Binance.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred to a microtask so the initial setLoading(true) inside load()
    // lands after the commit rather than synchronously during the effect
    // (which would trigger a cascading re-render).
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  return (
    <Panel
      title="Binance"
      subtitle="Spot account - read only"
      action={<RefreshButton onClick={load} disabled={loading} />}
    >
      <div className="space-y-5">
        {error && (
          <ErrorNote>
            <p className="font-medium">Could not load Binance account</p>
            <p className="mt-1 text-xs leading-relaxed">{error}</p>
            <p className="mt-2 text-xs">
              Check that <code className="font-mono">.env.local</code> has your API key
              and secret, that the key has &quot;Enable Reading&quot;, and that your IP is
              allowlisted. See the README.
            </p>
          </ErrorNote>
        )}

        {account && (
          <>
            {/* Surfacing permissions here is a safety check: withdrawals should
                be OFF on this key. If it reads "withdrawals enabled", that key
                is over-scoped for what this app does. */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-neutral-500">Key permissions:</span>
              <Chip tone={account.permissions.canTrade ? 'good' : 'neutral'}>
                {account.permissions.canTrade ? 'trading on' : 'trading off'}
              </Chip>
              <Chip tone={account.permissions.canWithdraw ? 'bad' : 'good'}>
                {account.permissions.canWithdraw
                  ? 'withdrawals ON - disable this'
                  : 'withdrawals off'}
              </Chip>
            </div>

            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
                Balances{' '}
                {account.balances.length > 0 && `(${account.balances.length})`}
                {loading && <Spinner />}
              </div>
              {account.balances.length > 0 ? (
                <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {account.balances.slice(0, 10).map((balance) => (
                    <li
                      key={balance.asset}
                      className="flex items-center justify-between py-2 text-sm"
                    >
                      <span className="font-medium">{balance.asset}</span>
                      <span className="text-right tabular-nums">
                        {balance.free}
                        {Number(balance.locked) > 0 && (
                          <span className="ml-2 text-xs text-amber-600 dark:text-amber-500">
                            +{balance.locked} locked
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-2 text-sm text-neutral-500">No non-zero balances</p>
              )}
            </div>

            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
                Recent SOL deposits
              </div>
              {deposits.length > 0 ? (
                <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {deposits.slice(0, 5).map((deposit) => (
                    <li
                      key={deposit.txId || deposit.insertTime}
                      className="flex items-center justify-between gap-2 py-2 text-sm"
                    >
                      <span className="tabular-nums">
                        {deposit.amount} {deposit.coin}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-neutral-500">
                        {new Date(deposit.insertTime).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                        <Chip tone={deposit.status === 1 ? 'good' : 'warn'}>
                          {DEPOSIT_STATUS_LABELS[deposit.status] ?? `status ${deposit.status}`}
                        </Chip>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-2 text-sm text-neutral-500">
                  {loading ? 'Loading...' : 'No recent SOL deposits'}
                </p>
              )}
            </div>
          </>
        )}

        {loading && !account && !error && (
          <div className="flex items-center gap-2 py-12 text-sm text-neutral-500">
            <Spinner /> Connecting to Binance...
          </div>
        )}
      </div>
    </Panel>
  );
}
