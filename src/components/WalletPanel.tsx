'use client';

import { useCallback, useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import {
  getWalletSnapshot,
  getRecentTransactions,
  explorerTxUrl,
  explorerAddressUrl,
  shortenAddress,
  type WalletSnapshot,
  type TxSummary,
} from '@/lib/solana/read';
import { Panel, ErrorNote, Spinner, RefreshButton } from './ui';

export function WalletPanel() {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();

  const [snapshot, setSnapshot] = useState<WalletSnapshot | null>(null);
  const [transactions, setTransactions] = useState<TxSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const address = publicKey?.toBase58() ?? null;

  // Derived during render rather than cleared in an effect: on disconnect (or
  // a switch to another wallet) this drops data belonging to the previous key
  // immediately, with no intermediate frame showing the wrong account.
  const activeSnapshot = snapshot && snapshot.address === address ? snapshot : null;
  const activeTransactions = activeSnapshot ? transactions : [];

  const load = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    setError(null);
    try {
      const [snap, txs] = await Promise.all([
        getWalletSnapshot(connection, publicKey),
        getRecentTransactions(connection, publicKey),
      ]);
      setSnapshot(snap);
      setTransactions(txs);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `${cause.message} -- if this is a rate limit, set NEXT_PUBLIC_SOLANA_RPC_URL to a Helius endpoint (see README).`
          : 'Failed to load wallet data.',
      );
    } finally {
      setLoading(false);
    }
  }, [connection, publicKey]);

  useEffect(() => {
    if (!connected || !publicKey) return;

    // Deferred to a microtask so the initial setLoading(true) inside load()
    // lands after the commit rather than synchronously during the effect
    // (which would trigger a cascading re-render).
    //
    // `active` guards against a disconnect or wallet switch: an in-flight
    // fetch can otherwise resolve after teardown and write stale results.
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return load();
    });
    return () => {
      active = false;
    };
  }, [connected, publicKey, load]);

  return (
    <Panel
      title="Wallet"
      subtitle="Solana - read only"
      action={
        <div className="flex items-center gap-2">
          {connected && <RefreshButton onClick={load} disabled={loading} />}
          <WalletMultiButton
            style={{
              height: 34,
              fontSize: 13,
              lineHeight: '34px',
              padding: '0 14px',
              borderRadius: 8,
              backgroundColor: '#171717',
            }}
          />
        </div>
      }
    >
      {!connected ? (
        <EmptyState />
      ) : (
        <div className="space-y-5">
          {error && <ErrorNote>{error}</ErrorNote>}

          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-500">
              SOL balance
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums">
                {activeSnapshot
                  ? activeSnapshot.solBalance.toFixed(6)
                  : loading
                    ? '--'
                    : '0'}
              </span>
              <span className="text-sm text-neutral-500">SOL</span>
              {loading && <Spinner />}
            </div>
            {address && (
              <a
                href={explorerAddressUrl(address)}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block font-mono text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200"
              >
                {shortenAddress(address, 6)} ↗
              </a>
            )}
          </div>

          <Section
            title={`SPL tokens${activeSnapshot ? ` (${activeSnapshot.tokens.length})` : ''}`}
          >
            {activeSnapshot && activeSnapshot.tokens.length > 0 ? (
              <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {activeSnapshot.tokens.slice(0, 8).map((token) => (
                  <li
                    key={token.mint}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    {/* No token registry lookup in Phase 1, so the mint is the
                        only reliable identifier available. */}
                    <span className="font-mono text-xs text-neutral-600 dark:text-neutral-400">
                      {shortenAddress(token.mint, 5)}
                    </span>
                    <span className="tabular-nums">
                      {token.amount.toLocaleString(undefined, {
                        maximumFractionDigits: Math.min(token.decimals, 6),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Muted>{loading ? 'Loading...' : 'No token balances'}</Muted>
            )}
          </Section>

          <Section title="Recent transactions">
            {activeTransactions.length > 0 ? (
              <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {activeTransactions.slice(0, 8).map((tx) => (
                  <li
                    key={tx.signature}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <a
                      href={explorerTxUrl(tx.signature)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                    >
                      {shortenAddress(tx.signature, 6)} ↗
                    </a>
                    <span className="flex items-center gap-2 text-xs text-neutral-500">
                      {tx.blockTime
                        ? new Date(tx.blockTime * 1000).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'unknown time'}
                      {tx.err && (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950 dark:text-red-400">
                          failed
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Muted>{loading ? 'Loading...' : 'No recent transactions'}</Muted>
            )}
          </Section>
        </div>
      )}
    </Panel>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Connect Phantom to view balances.
      </p>
      <p className="max-w-xs text-xs text-neutral-500">
        Read-only. This app never sees your private key -- you sign every
        transaction in your wallet.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">{title}</div>
      {children}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-sm text-neutral-500">{children}</p>;
}
