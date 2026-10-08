'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWalletSnapshot } from './WalletSnapshotProvider';
import { useAuth } from './AuthProvider';
import { HoldingsChart, type Holding } from './HoldingsChart';
import { RefreshButton } from './ui';

interface Balance {
  asset: string;
  free: string;
  locked: string;
  total: number;
}

/**
 * What you hold, on Binance and in the wallet, side by side.
 *
 * Both charts weight slices by each coin's own amount, NOT by value: pricing
 * every asset would need a quote per coin on every load, and the two charts
 * would still not be comparable with each other. Each one says so in its note
 * rather than implying the shares are portfolio value.
 */
export function HoldingsCharts() {
  // Shares the one wallet read rather than making its own: three panels each
  // fetching a snapshot is what tripped the RPC rate limit.
  const { snapshot, loading: loadingWallet, refresh: refreshWallet } = useWalletSnapshot();
  const { account } = useAuth();
  const hasBinanceKey = Boolean(account?.binance);

  const [binance, setBinance] = useState<Holding[] | null>(null);
  const [loadingBinance, setLoadingBinance] = useState(false);

  const loadBinance = useCallback(async () => {
    if (!hasBinanceKey) {
      setBinance(null);
      return;
    }
    setLoadingBinance(true);
    try {
      const response = await fetch('/api/binance/account');
      const body = (await response.json()) as {
        ok?: boolean;
        data?: { balances: Balance[] };
      };
      if (!body.ok || !body.data) throw new Error('unavailable');
      setBinance(
        body.data.balances.map((balance) => ({
          // "LD" assets are Simple Earn positions; strip the prefix so they
          // read as the coin, and mark them so they are not mistaken for spot.
          label: balance.asset.startsWith('LD')
            ? `${balance.asset.slice(2)} (Earn)`
            : balance.asset,
          value: balance.total,
          display: balance.free,
        })),
      );
    } catch {
      setBinance([]);
    } finally {
      setLoadingBinance(false);
    }
  }, [hasBinanceKey]);

  // Derived from the shared snapshot rather than fetched here.
  const wallet: Holding[] | null = snapshot
    ? [
        {
          label: 'SOL',
          value: snapshot.solBalance,
          display: snapshot.solBalance.toFixed(6),
        },
        ...snapshot.tokens.map((token) => ({
          // No token registry in this app, so the mint is the only reliable
          // identifier; shortened to stay readable in a legend.
          label: `${token.mint.slice(0, 4)}…${token.mint.slice(-4)}`,
          value: token.amount,
          display: token.amount.toLocaleString(undefined, {
            maximumFractionDigits: Math.min(token.decimals, 4),
          }),
        })),
      ]
    : null;

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return loadBinance();
    });
    return () => {
      active = false;
    };
  }, [loadBinance]);

  return (
    <div className="mb-5 grid items-start gap-5 lg:grid-cols-2">
      <HoldingsChart
        title="On Binance"
        note="Share of each coin by amount held, not by value"
        holdings={binance ?? []}
        action={<RefreshButton onClick={loadBinance} loading={loadingBinance} />}
        empty={
          hasBinanceKey
            ? loadingBinance
              ? 'Loading…'
              : 'No balances on your Binance account.'
            : 'Connect your Binance account to see this.'
        }
      />

      <HoldingsChart
        title="In your wallet"
        note="Share of each token by amount held, not by value"
        holdings={wallet ?? []}
        action={<RefreshButton onClick={() => void refreshWallet()} loading={loadingWallet} />}
        empty={
          snapshot
            ? loadingWallet
              ? 'Loading…'
              : 'Nothing in this wallet yet.'
            : 'Connect your wallet to see this.'
        }
      />
    </div>
  );
}
