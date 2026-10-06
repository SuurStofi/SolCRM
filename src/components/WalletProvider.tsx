'use client';

import { useMemo, type ReactNode } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { AuthProvider } from './AuthProvider';

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
    // A browser-usable RPC (e.g. Helius) can be called directly.
    const configured = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    if (configured) return configured;

    // Otherwise go through our own proxy. Public endpoints such as
    // api.mainnet-beta.solana.com return 403 "Access forbidden" to any request
    // carrying an Origin header, so the browser cannot call them directly --
    // the proxy re-issues the call server-side where no Origin is sent.
    //
    // Connection requires an absolute URL, and window is undefined while the
    // page prerenders, so fall back to a placeholder that is never called:
    // every RPC request originates from a browser event after hydration.
    return typeof window === 'undefined'
      ? 'https://api.mainnet-beta.solana.com'
      : `${window.location.origin}/api/solana/rpc`;
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: 'confirmed' }}>
      {/* autoConnect: reconnects a previously approved wallet on reload. */}
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>
          {/* Inside the wallet context: signing in needs the wallet to sign. */}
          <AuthProvider>{children}</AuthProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
