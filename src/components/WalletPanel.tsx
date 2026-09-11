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
  ExtLink,
  CopyButton,
} from './ui';

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
      setError(cause instanceof Error ? cause.message : 'Failed to load wallet data.');
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
      subtitle="Solana · read only"
      icon={<SolanaMark />}
      action={
        <div className="flex items-center gap-2">
          {connected && <RefreshButton onClick={load} loading={loading} />}
          <WalletMultiButton />
        </div>
      }
    >
      {!connected ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          {error && <ErrorNote title="Could not load wallet data">{error}</ErrorNote>}

          {/* Headline balance */}
          <div>
            <div className="flex items-baseline gap-2">
              {activeSnapshot ? (
                <span className="tabular text-[2rem] font-semibold leading-none tracking-tight">
                  {formatSol(activeSnapshot.solBalance)}
                </span>
              ) : (
                <Skeleton className="h-8 w-36" />
              )}
              <span className="text-sm font-medium text-muted">SOL</span>
              {loading && activeSnapshot && <Spinner className="ml-1" />}
            </div>

            {address && (
              <div className="mt-2 flex items-center gap-0.5">
                <ExtLink href={explorerAddressUrl(address)} mono>
                  {shortenAddress(address, 6)}
                </ExtLink>
                <CopyButton value={address} />
              </div>
            )}
          </div>

          {/* Tokens */}
          <div>
            <SectionLabel
              trailing={
                activeSnapshot && activeSnapshot.tokens.length > 0 ? (
                  <Chip>{activeSnapshot.tokens.length}</Chip>
                ) : null
              }
            >
              SPL tokens
            </SectionLabel>

            {activeSnapshot ? (
              activeSnapshot.tokens.length > 0 ? (
                <div>
                  {activeSnapshot.tokens.slice(0, 6).map((token) => (
                    <Row key={token.mint}>
                      {/* No token registry in Phase 1, so the mint is the only
                          reliable identifier available. */}
                      <ExtLink href={explorerAddressUrl(token.mint)} mono>
                        {shortenAddress(token.mint, 5)}
                      </ExtLink>
                      <span className="tabular font-medium">
                        {token.amount.toLocaleString(undefined, {
                          maximumFractionDigits: Math.min(token.decimals, 6),
                        })}
                      </span>
                    </Row>
                  ))}
                  {activeSnapshot.tokens.length > 6 && (
                    <p className="pt-2 text-xs text-faint">
                      +{activeSnapshot.tokens.length - 6} more
                    </p>
                  )}
                </div>
              ) : (
                <EmptyRow>No token balances</EmptyRow>
              )
            ) : (
              <SkeletonRows />
            )}
          </div>

          {/* Transactions */}
          <div>
            <SectionLabel>Recent activity</SectionLabel>
            {activeSnapshot ? (
              activeTransactions.length > 0 ? (
                <div>
                  {activeTransactions.slice(0, 6).map((tx) => (
                    <Row key={tx.signature}>
                      <span className="flex items-center gap-2">
                        <ExtLink href={explorerTxUrl(tx.signature)} mono>
                          {shortenAddress(tx.signature, 6)}
                        </ExtLink>
                        {tx.err && <Chip tone="bad">failed</Chip>}
                      </span>
                      <span className="text-xs text-faint">
                        {tx.blockTime ? relativeTime(tx.blockTime) : 'unknown'}
                      </span>
                    </Row>
                  ))}
                </div>
              ) : (
                <EmptyRow>No recent transactions</EmptyRow>
              )
            ) : (
              <SkeletonRows />
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

/** Trim trailing zeros so small balances stay readable. */
function formatSol(value: number): string {
  if (value === 0) return '0';
  if (value < 0.000001) return value.toExponential(2);
  return value.toFixed(6).replace(/\.?0+$/, '');
}

function relativeTime(unixSeconds: number): string {
  const seconds = Math.floor(Date.now() / 1000) - unixSeconds;
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function SkeletonRows() {
  return (
    <div className="space-y-2 py-1">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center justify-between">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-16" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-subtle text-faint">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
          <path
            d="M3 8.5A2.5 2.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V9M3 8.5V17a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-2M3 8.5C3 9.9 4.1 11 5.5 11H20a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-3.5a2.5 2.5 0 0 1 0-5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div>
        <p className="text-sm font-medium">Connect your wallet</p>
        <p className="mx-auto mt-1 max-w-[16rem] text-xs leading-relaxed text-muted">
          Read-only. Your private key stays in Phantom — this app never sees it.
        </p>
      </div>
    </div>
  );
}

function SolanaMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M6 8.5h11L15 6H4l2 2.5ZM6 15.5h11L15 18H4l2-2.5ZM18 12H7l2-2.5h11L18 12Z"
        fill="currentColor"
      />
    </svg>
  );
}
