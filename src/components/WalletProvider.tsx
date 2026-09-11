'use client';

import { useMemo, type ReactNode } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';

import '@solana/wallet-adapter-react-ui/styles.css';

/**
 * Wallet plumbing. Strictly client-side: the private key never leaves the
 * wallet extension, and this app never sees it. Every transaction is signed by
 * the user in Phantom.
 *
 * No adapters are passed to `wallets`. Phantom (and other modern wallets)
 * implement the Wallet Standard and are auto-discovered by the adapter, so
 * listing them explicitly would only add a large dependency and duplicate
 * entries in the picker.
 */
export function SolanaProviders({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => {
    const configured = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    if (configured) return configured;
    // Public RPC works but is heavily rate-limited; the README explains how to
    // point this at Helius instead.
    return 'https://api.mainnet-beta.solana.com';
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: 'confirmed' }}>
      {/* autoConnect: reconnects a previously approved wallet on reload. */}
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
