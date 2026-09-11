'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Panel,
  SectionLabel,
  Row,
  ErrorNote,
  Spinner,
  RefreshButton,
  Chip,
  Skeleton,
  EmptyRow,
} from './ui';

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
      subtitle="Spot account · read only"
      icon={<BinanceMark />}
      action={<RefreshButton onClick={load} loading={loading} />}
    >
      <div className="space-y-6">
        {error && (
          <ErrorNote title="Could not load Binance account">
            <p>{error}</p>
            <p className="mt-2 opacity-80">
              Check that <code className="font-mono">.env.local</code> has your key and
              secret, that the key has &quot;Enable Reading&quot;, and that your IP is
              allowlisted.
            </p>
          </ErrorNote>
        )}

        {account && (
          <>
            {/* Withdrawals should be OFF for what this app does. Surfacing it
                here makes an over-scoped key impossible to miss. */}
            {account.permissions.canWithdraw && (
              <div className="rounded-lg border border-warn/30 bg-warn-bg px-3.5 py-2.5 text-xs leading-relaxed text-warn">
                <span className="font-semibold">Withdrawals are enabled</span> on this API
                key. Nothing here withdraws — turning it off in Binance limits the damage
                if the key ever leaks.
              </div>
            )}

            <div>
              <SectionLabel
                trailing={
                  <div className="flex gap-1">
                    <Chip tone={account.permissions.canTrade ? 'accent' : 'neutral'}>
                      {account.permissions.canTrade ? 'trade' : 'read only'}
                    </Chip>
                    <Chip tone={account.permissions.canWithdraw ? 'bad' : 'good'}>
                      {account.permissions.canWithdraw ? 'withdraw on' : 'withdraw off'}
                    </Chip>
                  </div>
                }
              >
                Balances
              </SectionLabel>

              {account.balances.length > 0 ? (
                <div>
                  {account.balances.slice(0, 8).map((balance) => {
                    // "LD"-prefixed assets are Simple Earn Flexible positions,
                    // not spot balance. They cannot be traded or converted
                    // until redeemed, so flag them rather than showing a
                    // ticker that looks spendable.
                    const isEarn = balance.asset.startsWith('LD');
                    return (
                      <Row key={balance.asset}>
                        <span className="flex items-center gap-1.5 font-medium">
                          {isEarn ? balance.asset.slice(2) : balance.asset}
                          {isEarn && <Chip tone="warn">Earn</Chip>}
                        </span>
                        <span className="text-right">
                          <span className="tabular font-medium">{balance.free}</span>
                          {Number(balance.locked) > 0 && (
                            <span className="tabular ml-2 text-xs text-warn">
                              +{balance.locked} locked
                            </span>
                          )}
                        </span>
                      </Row>
                    );
                  })}
                </div>
              ) : (
                <EmptyRow>No non-zero balances</EmptyRow>
              )}
            </div>

            <div>
              <SectionLabel>Recent SOL deposits</SectionLabel>
              {deposits.length > 0 ? (
                <div>
                  {deposits.slice(0, 5).map((deposit) => (
                    <Row key={deposit.txId || deposit.insertTime}>
                      <span className="tabular font-medium">
                        {deposit.amount} {deposit.coin}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-faint">
                          {new Date(deposit.insertTime).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                        <Chip tone={deposit.status === 1 ? 'good' : 'warn'}>
                          {DEPOSIT_STATUS_LABELS[deposit.status] ??
                            `status ${deposit.status}`}
                        </Chip>
                      </span>
                    </Row>
                  ))}
                </div>
              ) : (
                <EmptyRow>No recent SOL deposits</EmptyRow>
              )}
            </div>
          </>
        )}

        {loading && !account && !error && (
          <div className="space-y-6">
            <div className="space-y-2">
              <Skeleton className="h-3 w-20" />
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center justify-between">
                  <Skeleton className="h-3.5 w-16" />
                  <Skeleton className="h-3.5 w-24" />
                </div>
              ))}
            </div>
            <p className="flex items-center gap-2 text-xs text-faint">
              <Spinner /> Contacting Binance…
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}

function BinanceMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="m12 3 2.6 2.6L12 8.2 9.4 5.6 12 3ZM6.6 8.4 9.2 11l-2.6 2.6L4 11l2.6-2.6ZM17.4 8.4 20 11l-2.6 2.6L14.8 11l2.6-2.6ZM12 9.4 14.6 12 12 14.6 9.4 12 12 9.4ZM12 15.8l2.6 2.6L12 21l-2.6-2.6 2.6-2.6Z"
        fill="currentColor"
      />
    </svg>
  );
}
