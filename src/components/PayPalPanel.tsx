'use client';

import { useCallback, useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import QRCode from 'qrcode';
import {
  getPyusdBalance,
  buildPyusdTransfer,
  formatPyusd,
  parseSolanaAddress,
  PYUSD_MINT,
} from '@/lib/solana/pyusd';
import { explorerTxUrl, shortenAddress } from '@/lib/solana/read';
import {
  Panel,
  SectionLabel,
  Row,
  ErrorNote,
  Spinner,
  EmptyRow,
  ExtLink,
  CopyButton,
} from './ui';

interface PayoutAddress {
  id: string;
  address: string;
  label: string;
  kind: string;
}

async function api<T>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await response.json()) as { ok: boolean; data?: T; error?: string };
  if (!json.ok || json.data === undefined) throw new Error(json.error ?? 'Request failed');
  return json.data;
}

type Tab = 'receive' | 'send';

/**
 * Moving money between PayPal and a wallet the user controls, using PYUSD on
 * Solana.
 *
 * There is no PayPal API here. PayPal publishes none for reading a consumer's
 * balance or history, so this app never asks for a PayPal login and never
 * claims to know what is in the account -- it only handles the on-chain half,
 * which the user signs themselves.
 */
export function PayPalPanel() {
  const { connection } = useConnection();
  const { publicKey, connected, signTransaction, sendTransaction } = useWallet();

  const [tab, setTab] = useState<Tab>('receive');
  const [balance, setBalance] = useState<bigint | null>(null);
  const [hasAccount, setHasAccount] = useState(true);
  // Keyed by the address it encodes, so a wallet switch cannot leave the
  // previous address's QR on screen while the new one renders.
  const [qr, setQr] = useState<{ address: string; url: string } | null>(null);
  const [addresses, setAddresses] = useState<PayoutAddress[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Send form
  const [newAddress, setNewAddress] = useState('');
  const [newLabel, setNewLabel] = useState('My PayPal');
  const [target, setTarget] = useState('');
  const [amount, setAmount] = useState('');
  const [signature, setSignature] = useState<string | null>(null);

  const address = publicKey?.toBase58() ?? null;

  const loadBalance = useCallback(async () => {
    if (!publicKey) {
      setBalance(null);
      return;
    }
    try {
      const result = await getPyusdBalance(connection, publicKey);
      setBalance(result.amount);
      setHasAccount(result.hasAccount);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read your PYUSD balance.');
    }
  }, [connection, publicKey]);

  const loadAddresses = useCallback(async () => {
    try {
      const data = await api<{ addresses: PayoutAddress[] }>(
        '/api/paypal/addresses',
        undefined,
        'GET',
      );
      setAddresses(data.addresses);
      if (data.addresses.length > 0 && !target) setTarget(data.addresses[0].address);
    } catch {
      // Not signed in yet, or no addresses: the empty state covers it.
    }
  }, [target]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      await Promise.all([loadBalance(), loadAddresses()]);
    });
    return () => {
      active = false;
    };
  }, [loadBalance, loadAddresses]);

  // The QR encodes the bare address: wallet apps and PayPal read that, where a
  // solana: URI is not universally understood.
  useEffect(() => {
    if (!address) return;
    let active = true;
    void QRCode.toDataURL(address, { margin: 1, width: 180 })
      .then((url) => {
        if (active) setQr({ address, url });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [address]);

  // Derived during render: a stale QR belongs to a different address and must
  // not be shown, even for one frame.
  const qrUrl = qr && qr.address === address ? qr.url : null;

  const checkDeposits = async () => {
    setBusy('check');
    setError(null);
    setNotice(null);
    const before = balance;
    try {
      await loadBalance();
      const after = await getPyusdBalance(connection, publicKey!);
      if (before !== null && after.amount > before) {
        setNotice(`Received ${formatPyusd(after.amount - before)} PYUSD.`);
      } else {
        setNotice('Nothing new yet. PayPal transfers usually arrive within a few minutes.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not check.');
    } finally {
      setBusy(null);
    }
  };

  const saveAddress = async () => {
    setBusy('save');
    setError(null);
    try {
      const data = await api<{ addresses: PayoutAddress[] }>('/api/paypal/addresses', {
        address: newAddress.trim(),
        label: newLabel.trim(),
      });
      setAddresses(data.addresses);
      setTarget(newAddress.trim());
      setNewAddress('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that address.');
    } finally {
      setBusy(null);
    }
  };

  const removeAddress = async (id: string) => {
    setBusy(id);
    try {
      const data = await api<{ addresses: PayoutAddress[] }>(
        `/api/paypal/addresses?id=${encodeURIComponent(id)}`,
        undefined,
        'DELETE',
      );
      setAddresses(data.addresses);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove that address.');
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (!publicKey) return;
    setBusy('send');
    setError(null);
    setNotice(null);
    setSignature(null);
    try {
      const to = parseSolanaAddress(target);
      const built = await buildPyusdTransfer(connection, publicKey, to, amount.trim());

      // Signed in the wallet, submitted by us: the adapter's combined
      // sendTransaction hands the wallet a Connection pointing at this app's
      // own RPC proxy, which the extension cannot reach.
      let sig: string;
      if (signTransaction) {
        const signed = await signTransaction(built.transaction);
        sig = await connection.sendRawTransaction(signed.serialize(), {
          preflightCommitment: 'confirmed',
        });
      } else {
        sig = await sendTransaction(built.transaction, connection);
      }

      setSignature(sig);
      setNotice(`Sent ${amount} PYUSD. It should appear in PayPal shortly.`);
      setAmount('');
      await loadBalance();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The transfer failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      title="PayPal"
      subtitle="Move money with PYUSD on Solana"
      icon={<PayPalMark />}
      action={
        connected && (
          <span className="tabular text-xs text-muted">
            {balance === null ? '—' : `${formatPyusd(balance)} PYUSD`}
          </span>
        )
      }
    >
      <div className="space-y-5">
        {error && <ErrorNote title="Something went wrong">{error}</ErrorNote>}
        {notice && (
          <div className="rounded-lg border border-good/30 bg-good-bg px-3.5 py-2.5 text-xs text-good">
            {notice}
            {signature && (
              <span className="ml-1.5">
                <ExtLink href={explorerTxUrl(signature)} mono>
                  {shortenAddress(signature, 5)}
                </ExtLink>
              </span>
            )}
          </div>
        )}

        {!connected ? (
          <EmptyRow>Connect your wallet to move PYUSD to or from PayPal.</EmptyRow>
        ) : (
          <>
            <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
              {(
                [
                  ['receive', 'From PayPal', 'PayPal → your wallet'],
                  ['send', 'To PayPal', 'your wallet → PayPal'],
                ] as const
              ).map(([id, label, hint]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`flex flex-1 flex-col items-center rounded-md px-2 py-2 transition ${
                    tab === id
                      ? 'bg-accent text-accent-fg'
                      : 'text-muted hover:bg-surface-subtle hover:text-foreground'
                  }`}
                >
                  <span className="text-sm font-medium">{label}</span>
                  <span
                    className={`text-[10px] leading-tight ${tab === id ? 'text-accent-fg/80' : 'text-faint'}`}
                  >
                    {hint}
                  </span>
                </button>
              ))}
            </div>

            {tab === 'receive' ? (
              <div className="space-y-4">
                <ol className="grid gap-2">
                  {[
                    'In the PayPal app: Crypto → PYUSD → Send.',
                    'Choose the Solana network. This matters — another network loses the money.',
                    'Paste the address below, or scan the code.',
                  ].map((step, index) => (
                    <li key={step} className="flex gap-2.5 text-xs leading-relaxed text-muted">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-fg">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>

                <div className="flex flex-wrap items-center gap-4">
                  {qrUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={qrUrl}
                      alt="QR code of your wallet address"
                      className="h-[150px] w-[150px] shrink-0 rounded-lg bg-white p-2"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <SectionLabel>Your wallet address</SectionLabel>
                    <div className="flex items-center gap-1">
                      <span className="min-w-0 break-all font-mono text-xs">{address}</span>
                      {address && <CopyButton value={address} />}
                    </div>
                    {!hasAccount && (
                      <p className="mt-2 text-[11px] leading-relaxed text-muted">
                        This wallet has no PYUSD account yet. The first transfer creates one
                        automatically.
                      </p>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-warn/30 bg-warn-bg px-3.5 py-2.5 text-xs leading-relaxed text-warn">
                  Crypto transfers cannot be reversed. Send only PYUSD, and only on the
                  Solana network. PayPal crypto is not available in every country —{' '}
                  <a
                    href="https://www.paypal.com/us/cshelp/article/help1005"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    check availability
                  </a>
                  .
                </div>

                <button
                  type="button"
                  onClick={checkDeposits}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium transition hover:border-border-strong disabled:opacity-40"
                >
                  {busy === 'check' && <Spinner />}
                  Check for deposits
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <SectionLabel>Where to send</SectionLabel>
                  {addresses.length === 0 ? (
                    <EmptyRow>
                      Add your PayPal PYUSD receive address. Find it in the PayPal app under
                      Crypto → PYUSD → Receive.
                    </EmptyRow>
                  ) : (
                    <div>
                      {addresses.map((entry) => (
                        <Row key={entry.id}>
                          <label className="flex min-w-0 flex-1 items-center gap-2">
                            <input
                              type="radio"
                              name="paypal-target"
                              checked={target === entry.address}
                              onChange={() => setTarget(entry.address)}
                            />
                            <span className="min-w-0">
                              <span className="block text-sm">{entry.label}</span>
                              <span className="block truncate font-mono text-[11px] text-faint">
                                {shortenAddress(entry.address, 6)}
                              </span>
                            </span>
                          </label>
                          <button
                            type="button"
                            onClick={() => removeAddress(entry.id)}
                            disabled={busy !== null}
                            className="rounded-md border border-border px-2 py-1 text-[11px] text-muted transition hover:text-bad disabled:opacity-40"
                          >
                            Remove
                          </button>
                        </Row>
                      ))}
                    </div>
                  )}

                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <input
                      value={newAddress}
                      onChange={(event) => setNewAddress(event.target.value)}
                      placeholder="PayPal PYUSD address"
                      className="min-w-0 flex-1 rounded-lg border border-border bg-surface-subtle px-3 py-2 font-mono text-xs outline-none focus:border-accent"
                    />
                    <input
                      value={newLabel}
                      onChange={(event) => setNewLabel(event.target.value)}
                      placeholder="Label"
                      className="w-28 rounded-lg border border-border bg-surface-subtle px-3 py-2 text-xs outline-none focus:border-accent"
                    />
                    <button
                      type="button"
                      onClick={saveAddress}
                      disabled={busy !== null || !newAddress.trim()}
                      className="rounded-lg border border-border px-3 py-2 text-xs font-medium transition hover:border-border-strong disabled:opacity-40"
                    >
                      Save
                    </button>
                  </div>
                </div>

                <div>
                  <SectionLabel
                    trailing={
                      balance !== null ? (
                        <button
                          type="button"
                          onClick={() => setAmount(formatPyusd(balance))}
                          className="text-[11px] font-medium text-muted hover:text-foreground"
                        >
                          Max {formatPyusd(balance)}
                        </button>
                      ) : undefined
                    }
                  >
                    How much PYUSD
                  </SectionLabel>
                  <input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="tabular w-full rounded-lg border border-border bg-surface-subtle px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                </div>

                <div className="rounded-lg border border-warn/30 bg-warn-bg px-3.5 py-2.5 text-xs leading-relaxed text-warn">
                  Check the address against the PayPal app before sending. Crypto transfers
                  cannot be reversed. PayPal may reject amounts below its own minimum, which
                  differs by country — see{' '}
                  <a
                    href="https://www.paypal.com/us/cshelp/article/help1005"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    PayPal&apos;s help page
                  </a>
                  .
                </div>

                <button
                  type="button"
                  onClick={send}
                  disabled={busy !== null || !target || !amount.trim()}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
                >
                  {busy === 'send' && <Spinner className="border-t-accent-fg" />}
                  Review in wallet and send
                </button>
              </div>
            )}

            <p className="border-t border-border pt-3 text-[11px] leading-relaxed text-faint">
              This app never sees your PayPal account. It cannot read your PayPal balance or
              history — only the PYUSD you move through this wallet.{' '}
              <ExtLink href={`https://solscan.io/token/${PYUSD_MINT.toBase58()}`} mono>
                PYUSD
              </ExtLink>{' '}
              is issued by Paxos, who can freeze or move tokens on any account.
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}

function PayPalMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M7 19 9 5h5.5a3.5 3.5 0 0 1 0 7H10l-1 7H7Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M11 15h3.5a3.5 3.5 0 0 0 3.45-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
