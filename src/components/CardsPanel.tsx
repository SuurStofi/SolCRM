'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Panel,
  SectionLabel,
  Row,
  ErrorNote,
  Spinner,
  RefreshButton,
  Chip,
  EmptyRow,
} from './ui';

interface Account {
  id: string;
  externalId: string;
  maskedPan: string | null;
  currencyCode: number;
  balance: string;
  creditLimit: string;
  ownFunds: string;
  accountType: string | null;
  balanceUpdatedAt: string | null;
}

interface Connection {
  id: string;
  provider: string;
  label: string | null;
  tokenHint: string | null;
  consentAt: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  status: string;
  accounts: Account[];
}

interface Transaction {
  id: string;
  time: string;
  amount: string;
  currencyCode: number;
  description: string;
  hold: boolean;
  counterName: string | null;
  maskedPan: string | null;
}

const CURRENCY: Record<number, string> = {
  980: '₴',
  840: '$',
  978: '€',
  826: '£',
  985: 'zł',
};

/** Minor units as a decimal string -> a readable amount. */
function money(minorUnits: string, currencyCode: number): string {
  const negative = minorUnits.startsWith('-');
  const digits = negative ? minorUnits.slice(1) : minorUnits;
  const padded = digits.padStart(3, '0');
  const whole = padded.slice(0, -2);
  const cents = padded.slice(-2);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const symbol = CURRENCY[currencyCode] ?? '';
  return `${negative ? '-' : ''}${grouped}.${cents} ${symbol}`.trim();
}

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
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

/**
 * Bank cards: balances and recent transactions, read-only.
 *
 * This panel never offers a way to move money, because the integration cannot:
 * the providers are read-only by contract.
 */
export function CardsPanel() {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [available, setAvailable] = useState<Array<{ provider: string; displayName: string }>>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [token, setToken] = useState('');
  const [consent, setConsent] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<{
        connections: Connection[];
        available: Array<{ provider: string; displayName: string }>;
      }>('/api/banks/connections', undefined, 'GET');
      setConnections(data.connections);
      setAvailable(data.available);
      if (data.connections.length > 0) {
        const txs = await api<{ transactions: Transaction[] }>(
          '/api/banks/transactions?limit=50',
          undefined,
          'GET',
        );
        setTransactions(txs.transactions);
      } else {
        setTransactions([]);
      }
    } catch (cause) {
      setConnections([]);
      setError(cause instanceof Error ? cause.message : 'Could not load your cards.');
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  const connect = async () => {
    setBusy('connect');
    setError(null);
    try {
      await api('/api/banks/connections', {
        provider: available[0]?.provider ?? 'monobank',
        token: token.trim(),
        consent,
      });
      setToken('');
      setConsent(false);
      setConnecting(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect.');
    } finally {
      setBusy(null);
    }
  };

  const refresh = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await api('/api/banks/sync', { id });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not refresh.');
      await load();
    } finally {
      setBusy(null);
    }
  };

  const loadTransactions = async (id: string, accountExternalId: string) => {
    setBusy(id);
    setError(null);
    try {
      await api('/api/banks/sync', { id, accountId: accountExternalId, days: 30 });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load transactions.');
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await api(`/api/banks/connections?id=${encodeURIComponent(id)}`, undefined, 'DELETE');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not disconnect.');
    } finally {
      setBusy(null);
    }
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return transactions;
    return transactions.filter(
      (tx) =>
        tx.description.toLowerCase().includes(needle) ||
        (tx.counterName ?? '').toLowerCase().includes(needle),
    );
  }, [transactions, query]);

  const noBanksEnabled = available.length === 0;

  return (
    <Panel
      title="My cards"
      subtitle="Bank balances and transactions · read only"
      icon={<CardMark />}
      action={<RefreshButton onClick={load} loading={busy !== null} />}
    >
      <div className="space-y-6">
        {error && <ErrorNote title="Something went wrong">{error}</ErrorNote>}

        {connections === null ? (
          <div className="flex items-center gap-2 py-6 text-sm text-faint">
            <Spinner /> Loading…
          </div>
        ) : noBanksEnabled ? (
          <EmptyRow>
            No bank is switched on for this server. Banks are off by default — see the
            README for how to enable Monobank.
          </EmptyRow>
        ) : connections.length === 0 ? (
          <>
            {!connecting ? (
              <div className="space-y-3">
                <p className="text-sm text-muted">
                  Connect a bank to see your card balances and recent payments here.
                </p>
                <button
                  type="button"
                  onClick={() => setConnecting(true)}
                  className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110"
                >
                  Connect {available[0]?.displayName ?? 'a bank'}
                </button>
              </div>
            ) : (
              <ConnectForm
                displayName={available[0]?.displayName ?? 'your bank'}
                token={token}
                onToken={setToken}
                consent={consent}
                onConsent={setConsent}
                busy={busy === 'connect'}
                onCancel={() => setConnecting(false)}
                onSubmit={connect}
              />
            )}
          </>
        ) : (
          <>
            {connections.map((connection) => (
              <div key={connection.id} className="space-y-3">
                <SectionLabel
                  trailing={
                    <span className="flex items-center gap-2">
                      <span className="text-[11px] text-faint">
                        updated {ago(connection.lastSyncedAt)}
                      </span>
                      <button
                        type="button"
                        onClick={() => refresh(connection.id)}
                        disabled={busy !== null}
                        className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted transition hover:text-foreground disabled:opacity-40"
                      >
                        Refresh
                      </button>
                      <button
                        type="button"
                        onClick={() => disconnect(connection.id)}
                        disabled={busy !== null}
                        className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-bad transition hover:border-bad/40 disabled:opacity-40"
                      >
                        Disconnect
                      </button>
                    </span>
                  }
                >
                  {connection.label ?? connection.provider}
                  {connection.tokenHint && (
                    <span className="ml-1.5 font-normal normal-case text-faint">
                      token …{connection.tokenHint}
                    </span>
                  )}
                </SectionLabel>

                {connection.lastError && (
                  <p className="text-[11px] leading-relaxed text-warn">
                    Last refresh failed: {connection.lastError}
                  </p>
                )}

                {connection.accounts.length === 0 ? (
                  <EmptyRow>No cards on this connection.</EmptyRow>
                ) : (
                  <div>
                    {connection.accounts.map((account) => (
                      <Row key={account.id}>
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted">
                            {account.maskedPan
                              ? `•• ${account.maskedPan.slice(-4)}`
                              : account.accountType ?? 'account'}
                          </span>
                          {account.accountType && <Chip>{account.accountType}</Chip>}
                        </span>
                        <span className="flex items-center gap-2.5">
                          <span className="tabular text-sm font-medium">
                            {money(account.ownFunds, account.currencyCode)}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              loadTransactions(connection.id, account.externalId)
                            }
                            disabled={busy !== null}
                            className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted transition hover:text-foreground disabled:opacity-40"
                          >
                            Load payments
                          </button>
                        </span>
                      </Row>
                    ))}
                  </div>
                )}
              </div>
            ))}

            <div>
              <SectionLabel
                trailing={
                  transactions.length > 0 ? (
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search…"
                      className="w-32 rounded-md border border-border bg-surface-subtle px-2 py-1 text-[11px] outline-none focus:border-accent"
                    />
                  ) : undefined
                }
              >
                Recent payments
              </SectionLabel>
              {filtered.length === 0 ? (
                <EmptyRow>
                  {transactions.length === 0
                    ? 'No payments stored yet. Press "Load payments" on a card.'
                    : 'Nothing matches that search.'}
                </EmptyRow>
              ) : (
                <div>
                  {filtered.slice(0, 25).map((tx) => {
                    const incoming = !tx.amount.startsWith('-');
                    return (
                      <Row key={tx.id}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{tx.description}</span>
                          <span className="text-[11px] text-faint">
                            {new Date(tx.time).toLocaleString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                            {tx.maskedPan && ` · •• ${tx.maskedPan.slice(-4)}`}
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          {tx.hold && <Chip tone="warn">pending</Chip>}
                          <span
                            className={`tabular text-sm font-medium ${incoming ? 'text-good' : ''}`}
                          >
                            {money(tx.amount, tx.currencyCode)}
                          </span>
                        </span>
                      </Row>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

function ConnectForm({
  displayName,
  token,
  onToken,
  consent,
  onConsent,
  busy,
  onCancel,
  onSubmit,
}: {
  displayName: string;
  token: string;
  onToken: (value: string) => void;
  consent: boolean;
  onConsent: (value: boolean) => void;
  busy: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface-subtle px-4 py-4">
      <div>
        <h3 className="text-sm font-semibold">Connect {displayName}</h3>
        <ol className="mt-2.5 grid gap-2">
          {[
            'Open api.monobank.ua in your browser and sign in with the app.',
            'Copy the token it gives you.',
            'Paste it below. We check it with the bank before saving.',
          ].map((step, index) => (
            <li key={step} className="flex gap-2.5 text-xs leading-relaxed text-muted">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-fg">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Plain-language consent. The wording is the promise the code keeps:
          read-only, no logins, delete on disconnect. */}
      <div className="rounded-lg border border-border bg-surface px-3.5 py-3 text-xs leading-relaxed text-muted">
        <p className="font-medium text-foreground">What this does</p>
        <ul className="mt-1.5 space-y-1">
          <li>• Reads your card balances and recent payments.</li>
          <li>• Never moves money, and cannot: the connection is read-only.</li>
          <li>• Never asks for your bank login, PIN, SMS codes or card number.</li>
          <li>• Stores the token encrypted. It is never sent back to your browser.</li>
          <li>• Disconnecting deletes the token and everything read with it.</li>
        </ul>
        <p className="mt-2 text-warn">
          Monobank&apos;s personal token is meant for your own account. Using it for other
          people needs Monobank&apos;s Corporate API.
        </p>
      </div>

      <input
        value={token}
        onChange={(event) => onToken(event.target.value)}
        type="password"
        placeholder="Paste your token"
        autoComplete="off"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      />

      <label className="flex items-start gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => onConsent(event.target.checked)}
          className="mt-0.5"
        />
        <span>I understand this is read-only and agree to connect my bank.</span>
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy || !token.trim() || !consent}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
        >
          {busy && <Spinner className="border-t-accent-fg" />}
          Check and connect
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-muted transition hover:text-foreground disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function CardMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <rect
        x="2.5"
        y="5"
        width="19"
        height="14"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M2.5 9.5h19" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 14.5h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
