'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { shortenAddress } from '@/lib/solana/read';
import { useAuth } from './AuthProvider';
import { AccountPanel } from './AccountPanel';
import { WalletPanel } from './WalletPanel';
import { BinancePanel } from './BinancePanel';
import { TransferPanel } from './TransferPanel';
import { BuyPanel } from './BuyPanel';
import { P2PAdsPanel } from './P2PAdsPanel';
import { P2POrdersPanel } from './P2POrdersPanel';
import { RateLimitBanner } from './RateLimitBanner';
import { ErrorNote, Spinner } from './ui';

/**
 * Chooses between the sign-in screen and the dashboard. Every panel below the
 * account reads per-user data, so none of them mount until there is a session.
 */
export function Dashboard() {
  const { account, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Spinner />
      </div>
    );
  }

  if (!account) return <SignIn />;

  return (
    <>
      <RateLimitBanner />

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <AccountPanel />
        <WalletPanel />
      </div>

      <div className="mt-5">
        <BinancePanel />
      </div>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
        <TransferPanel />
        <BuyPanel />
      </div>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
        <P2PAdsPanel />
        <P2POrdersPanel />
      </div>
    </>
  );
}

/** Header badge: which account is signed in. */
export function AccountBadge() {
  const { account } = useAuth();
  if (!account) return null;
  const first = account.wallets[0]?.address;
  return (
    <span className="rounded-md border border-border bg-surface-subtle px-2 py-1 font-mono text-[11px] font-medium text-muted">
      {first ? shortenAddress(first, 4) : 'signed in'}
    </span>
  );
}

function SignIn() {
  const { connected, publicKey } = useWallet();
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rise mx-auto flex max-w-sm flex-col items-center gap-5 rounded-xl border border-border bg-surface px-6 py-10 text-center shadow-[var(--shadow-card)]">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-lg font-bold text-accent-fg">
        S
      </span>
      <div>
        <h2 className="text-base font-semibold tracking-tight">Sign in with your wallet</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          Your wallet is your account — no password. New wallets get an account automatically.
          You sign a message, not a transaction: nothing is sent and no fee is paid.
        </p>
      </div>

      {error && (
        <div className="w-full text-left">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {connected && publicKey ? (
        <div className="flex w-full flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSignIn()}
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-50"
          >
            {busy && <Spinner className="border-t-accent-fg" />}
            <span>Sign in as {shortenAddress(publicKey.toBase58(), 4)}</span>
          </button>
          <WalletMultiButton />
        </div>
      ) : (
        <WalletMultiButton />
      )}
    </div>
  );
}
