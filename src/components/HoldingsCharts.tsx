'use client';

import { useCallback, useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { getWalletSnapshot } from '@/lib/solana/read';
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
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const { account } = useAuth();
  const hasBinanceKey = Boolean(account?.binance);

  const [binance, setBinance] = useState<Holding[] | null>(null);
  const [wallet, setWallet] = useState<Holding[] | null>(null);
  const [loadingBinance, setLoadingBinance] = useState(false);
  const [loadingWallet, setLoadingWallet] = useState(false);

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

  const loadWallet = useCallback(async () => {
    if (!connected || !publicKey) {
      setWallet(null);
      return;
    }
    setLoadingWallet(true);
    try {
      const snapshot = await getWalletSnapshot(connection, publicKey);
      setWallet([
        { label: 'SOL', value: snapshot.solBalance, display: snapshot.solBalance.toFixed(6) },
        ...snapshot.tokens.map((token) => ({
          // No token registry in this app, so the mint is the only reliable
          // identifier; shortened to stay readable in a legend.
          label: `${token.mint.slice(0, 4)}…${token.mint.slice(-4)}`,
          value: token.amount,
          display: token.amount.toLocaleString(undefined, {
            maximumFractionDigits: Math.min(token.decimals, 4),
          }),
        })),
      ]);
    } catch {
      setWallet([]);
    } finally {
      setLoadingWallet(false);
    }
  }, [connection, connected, publicKey]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return Promise.all([loadBinance(), loadWallet()]);
    });
    return () => {
      active = false;
    };
  }, [loadBinance, loadWallet]);

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
        action={<RefreshButton onClick={loadWallet} loading={loadingWallet} />}
        empty={
          connected
            ? loadingWallet
              ? 'Loading…'
              : 'Nothing in this wallet yet.'
            : 'Connect your wallet to see this.'
        }
      />
    </div>
  );
}
