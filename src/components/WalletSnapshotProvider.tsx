'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { getWalletSnapshot, type WalletSnapshot } from '@/lib/solana/read';

/**
 * One wallet read, shared by every panel that needs it.
 *
 * Three components used to call getWalletSnapshot independently, and each
 * snapshot is three RPC calls, so opening Home fired nine requests at once and
 * the public endpoint answered 429. The retry backoff then stretched that into
 * a visible stall.
 *
 * Everything that needs the wallet now reads this one result. A refresh is
 * also deduplicated: callers that ask while a read is in flight get the same
 * promise rather than starting another.
 */

interface SnapshotState {
  snapshot: WalletSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const Context = createContext<SnapshotState>({
  snapshot: null,
  loading: false,
  error: null,
  refresh: async () => {},
});

export function useWalletSnapshot(): SnapshotState {
  return useContext(Context);
}

export function WalletSnapshotProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();

  const [snapshot, setSnapshot] = useState<WalletSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Holds the read currently in flight, so concurrent callers share it.
  const inFlight = useRef<Promise<void> | null>(null);

  const address = publicKey?.toBase58() ?? null;

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setSnapshot(null);
      return;
    }
    if (inFlight.current) return inFlight.current;

    const run = (async () => {
      setLoading(true);
      setError(null);
      try {
        setSnapshot(await getWalletSnapshot(connection, publicKey));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not read your wallet.');
      } finally {
        setLoading(false);
        inFlight.current = null;
      }
    })();

    inFlight.current = run;
    return run;
  }, [connection, publicKey]);

  useEffect(() => {
    if (!connected || !publicKey) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return refresh();
    });
    return () => {
      active = false;
    };
  }, [connected, publicKey, refresh]);

  // Derived during render: a snapshot from a previous wallet must never show
  // against the current one, even for a frame.
  const current = snapshot && snapshot.address === address ? snapshot : null;

  return (
    <Context.Provider value={{ snapshot: current, loading, error, refresh }}>
      {children}
    </Context.Provider>
  );
}
