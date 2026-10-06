'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

/**
 * Account state for the browser.
 *
 * Sign-in is Sign-In With Solana: the server hands out a one-time message,
 * the connected wallet signs it (a message, not a transaction -- nothing is
 * broadcast), and the server checks the signature. Linking another wallet is
 * the same round trip with purpose LINK, signed by the wallet being added.
 *
 * The session itself lives in an httpOnly cookie this code cannot read; all
 * it holds is the account summary the server chose to return.
 */

export interface Account {
  id: string;
  createdAt: string;
  /** Bought SOL is withdrawn to a linked wallet automatically. */
  autoWithdraw: boolean;
  wallets: Array<{ address: string; label: string | null; createdAt: string }>;
  /** Permission flags are a snapshot from when the key was saved. */
  binance: {
    apiKeyHint: string;
    updatedAt: string;
    canTrade: boolean;
    canWithdraw: boolean;
    ipRestricted: boolean;
  } | null;
}

export interface KeyPermissions {
  canRead: boolean;
  canTrade: boolean;
  canWithdraw: boolean;
  ipRestricted: boolean;
}

interface AuthContextValue {
  account: Account | null;
  /** True until the first /api/auth/me answer arrives. */
  loading: boolean;
  /** Whether the wallet connected right now is linked to the account. */
  connectedWalletLinked: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  linkConnectedWallet: () => Promise<void>;
  unlinkWallet: (address: string) => Promise<void>;
  saveBinanceKey: (apiKey: string, apiSecret: string) => Promise<KeyPermissions>;
  removeBinanceKey: () => Promise<void>;
  setAutoWithdraw: (on: boolean) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await response.json()) as { ok: boolean; data?: T; error?: string };
  if (!json.ok) throw new Error(json.error ?? 'Request failed');
  return json.data as T;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { publicKey, signMessage } = useWallet();
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    call<Account | null>('/api/auth/me')
      .then((me) => {
        if (active) setAccount(me);
      })
      .catch(() => {
        if (active) setAccount(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  /** Challenge -> sign in wallet -> verify. Shared by sign-in and linking. */
  const proveWallet = useCallback(
    async (purpose: 'LOGIN' | 'LINK'): Promise<Account> => {
      if (!publicKey) throw new Error('Connect a wallet first.');
      if (!signMessage) {
        throw new Error('This wallet cannot sign messages. Use Phantom or another wallet that can.');
      }

      const { nonce, message } = await call<{ nonce: string; message: string }>(
        '/api/auth/challenge',
        'POST',
        { address: publicKey.toBase58(), purpose },
      );
      const signature = await signMessage(new TextEncoder().encode(message));
      return call<Account>('/api/auth/verify', 'POST', {
        nonce,
        purpose,
        signature: toBase64(signature),
      });
    },
    [publicKey, signMessage],
  );

  const signIn = useCallback(async () => {
    setAccount(await proveWallet('LOGIN'));
  }, [proveWallet]);

  const linkConnectedWallet = useCallback(async () => {
    setAccount(await proveWallet('LINK'));
  }, [proveWallet]);

  const signOut = useCallback(async () => {
    await call('/api/auth/logout', 'POST', {});
    setAccount(null);
  }, []);

  const unlinkWallet = useCallback(async (address: string) => {
    setAccount(await call<Account>('/api/account/wallets', 'DELETE', { address }));
  }, []);

  const saveBinanceKey = useCallback(async (apiKey: string, apiSecret: string) => {
    const result = await call<{ account: Account; permissions: KeyPermissions }>(
      '/api/account/binance',
      'PUT',
      { apiKey, apiSecret },
    );
    setAccount(result.account);
    return result.permissions;
  }, []);

  const removeBinanceKey = useCallback(async () => {
    const result = await call<{ account: Account }>('/api/account/binance', 'DELETE', {});
    setAccount(result.account);
  }, []);

  const setAutoWithdraw = useCallback(async (on: boolean) => {
    setAccount(await call<Account>('/api/account/settings', 'PATCH', { autoWithdraw: on }));
  }, []);

  const connected = publicKey?.toBase58() ?? null;
  const connectedWalletLinked =
    connected !== null && (account?.wallets.some((w) => w.address === connected) ?? false);

  const value = useMemo<AuthContextValue>(
    () => ({
      account,
      loading,
      connectedWalletLinked,
      signIn,
      signOut,
      linkConnectedWallet,
      unlinkWallet,
      saveBinanceKey,
      removeBinanceKey,
      setAutoWithdraw,
    }),
    [
      account,
      loading,
      connectedWalletLinked,
      signIn,
      signOut,
      linkConnectedWallet,
      unlinkWallet,
      saveBinanceKey,
      removeBinanceKey,
      setAutoWithdraw,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
