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

interface Available {
  provider: string;
  displayName: string;
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
 * One section per bank, each listing its own connections.
 *
 * Previously there was a single connect form with a provider switcher inside
 * it, and it only appeared while no bank was connected at all -- so Monobank
 * and Privat were mixed together, and after the first connection there was no
 * way to add a second. Each bank now has its own section and its own Add
 * button, and a bank can hold several connections.
 */
export function CardsPanel() {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [available, setAvailable] = useState<Available[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Which provider's connect form is open, if any. */
  const [connectingTo, setConnectingTo] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [clientId, setClientId] = useState('');
  const [label, setLabel] = useState('');
  const [consent, setConsent] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<{ connections: Connection[]; available: Available[] }>(
        '/api/banks/connections',
        undefined,
        'GET',
      );
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

  const resetForm = () => {
    setToken('');
    setClientId('');
    setLabel('');
    setConsent(false);
    setConnectingTo(null);
  };

  const connect = async (provider: string) => {
    setBusy('connect');
    setError(null);
    try {
      await api('/api/banks/connections', {
        provider,
        token: token.trim(),
        clientId: clientId.trim(),
        label: label.trim(),
        consent,
      });
      resetForm();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect.');
    } finally {
      setBusy(null);
    }
  };

  const act = async (id: string, work: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await work();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work.');
      await load();
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

  // Grouped so each bank owns its own section, however many connections it has.
  const byProvider = useMemo(() => {
    const groups = new Map<string, Connection[]>();
    for (const entry of available) groups.set(entry.provider, []);
    for (const connection of connections ?? []) {
      const existing = groups.get(connection.provider) ?? [];
      existing.push(connection);
      groups.set(connection.provider, existing);
    }
    return groups;
  }, [available, connections]);

  return (
    <Panel
      title="My cards"
      subtitle="Bank balances and transactions · read only"
      icon={<CardMark />}
      action={<RefreshButton onClick={load} loading={busy !== null} />}
    >
      <div className="space-y-7">
        {error && <ErrorNote title="Something went wrong">{error}</ErrorNote>}

        {connections === null ? (
          <div className="flex items-center gap-2 py-6 text-sm text-faint">
            <Spinner /> Loading…
          </div>
        ) : available.length === 0 ? (
          <EmptyRow>
            No bank is switched on for this server. Banks are off by default — see the
            README for how to enable them.
          </EmptyRow>
        ) : (
          <>
            {available.map((entry) => {
              const forProvider = byProvider.get(entry.provider) ?? [];
              const isOpen = connectingTo === entry.provider;
              return (
                <section key={entry.provider} className="space-y-3">
                  <SectionLabel
                    trailing={
                      !isOpen && (
                        <button
                          type="button"
                          onClick={() => {
                            resetForm();
                            setConnectingTo(entry.provider);
                          }}
                          disabled={busy !== null}
                          className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-40"
                        >
                          {forProvider.length > 0 ? '+ Add another' : '+ Add'}
                        </button>
                      )
                    }
                  >
                    {entry.displayName}
                  </SectionLabel>

                  {forProvider.length === 0 && !isOpen ? (
                    <EmptyRow>Not connected.</EmptyRow>
                  ) : (
                    forProvider.map((connection) => (
                      <ConnectionCard
                        key={connection.id}
                        connection={connection}
                        busy={busy}
                        onRefresh={() =>
                          act(connection.id, () =>
                            api('/api/banks/sync', { id: connection.id }),
                          )
                        }
                        onLoadPayments={(accountExternalId) =>
                          act(connection.id, () =>
                            api('/api/banks/sync', {
                              id: connection.id,
                              accountId: accountExternalId,
                              days: 30,
                            }),
                          )
                        }
                        onDisconnect={() =>
                          act(connection.id, () =>
                            api(
                              `/api/banks/connections?id=${encodeURIComponent(connection.id)}`,
                              undefined,
                              'DELETE',
                            ),
                          )
                        }
                      />
                    ))
                  )}

                  {isOpen && (
                    <ConnectForm
                      provider={entry.provider}
                      displayName={entry.displayName}
                      token={token}
                      onToken={setToken}
                      clientId={clientId}
                      onClientId={setClientId}
                      label={label}
                      onLabel={setLabel}
                      consent={consent}
                      onConsent={setConsent}
                      busy={busy === 'connect'}
                      onCancel={resetForm}
                      onSubmit={() => connect(entry.provider)}
                    />
                  )}
                </section>
              );
            })}

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

function ConnectionCard({
  connection,
  busy,
  onRefresh,
  onLoadPayments,
  onDisconnect,
}: {
  connection: Connection;
  busy: string | null;
  onRefresh: () => void;
  onLoadPayments: (accountExternalId: string) => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-subtle px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">
            {connection.label ?? connection.provider}
          </span>
          <span className="text-[11px] text-faint">
            {connection.tokenHint && `token …${connection.tokenHint} · `}
            updated {ago(connection.lastSyncedAt)}
          </span>
        </span>
        <span className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy !== null}
            className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted transition hover:text-foreground disabled:opacity-40"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={onDisconnect}
            disabled={busy !== null}
            className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-bad transition hover:border-bad/40 disabled:opacity-40"
          >
            Disconnect
          </button>
        </span>
      </div>

      {connection.lastError && (
        <p className="mt-2 text-[11px] leading-relaxed text-warn">
          Last refresh failed: {connection.lastError}
        </p>
      )}

      {connection.accounts.length === 0 ? (
        <p className="mt-2 text-xs text-faint">No cards on this connection.</p>
      ) : (
        <div className="mt-1">
          {connection.accounts.map((account) => (
            <Row key={account.id}>
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted">
                  {account.maskedPan
                    ? `•• ${account.maskedPan.slice(-4)}`
                    : (account.accountType ?? 'account')}
                </span>
                {account.accountType && <Chip>{account.accountType}</Chip>}
              </span>
              <span className="flex items-center gap-2.5">
                <span className="tabular text-sm font-medium">
                  {money(account.ownFunds, account.currencyCode)}
                </span>
                <button
                  type="button"
                  onClick={() => onLoadPayments(account.externalId)}
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
  );
}

const CONNECT_STEPS: Record<string, string[]> = {
  monobank: [
    'Open api.monobank.ua in your browser and sign in with the app.',
    'Copy the token it gives you.',
    'Paste it below. We check it with the bank before saving.',
  ],
  privat_business: [
    'In Privat24 for Business, open AutoClient and create an application.',
    'Copy the client id and the token it issues.',
    'Paste both below. We check them with the bank before saving.',
  ],
};

function ConnectForm({
  provider,
  displayName,
  token,
  onToken,
  clientId,
  onClientId,
  label,
  onLabel,
  consent,
  onConsent,
  busy,
  onCancel,
  onSubmit,
}: {
  provider: string;
  displayName: string;
  token: string;
  onToken: (value: string) => void;
  clientId: string;
  onClientId: (value: string) => void;
  label: string;
  onLabel: (value: string) => void;
  consent: boolean;
  onConsent: (value: boolean) => void;
  busy: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const isPrivat = provider === 'privat_business';
  const steps = CONNECT_STEPS[provider] ?? CONNECT_STEPS.monobank;

  return (
    <div className="space-y-4 rounded-xl border border-accent/30 bg-surface-subtle px-4 py-4">
      <div>
        <h3 className="text-sm font-semibold">Connect {displayName}</h3>
        <ol className="mt-2.5 grid gap-2">
          {steps.map((step, index) => (
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
          <li>• Reads your balances and recent payments.</li>
          <li>• Never moves money, and cannot: the connection is read-only.</li>
          <li>• Never asks for your bank login, PIN, SMS codes or card number.</li>
          <li>• Stores the credentials encrypted. They never go back to your browser.</li>
          <li>• Disconnecting deletes them and everything read with them.</li>
        </ul>
        {isPrivat ? (
          <p className="mt-2 text-warn">
            AutoClient is only available on Privat24 <strong>for Business</strong> (FOP or
            company). Personal PrivatBank cards have no public API.
          </p>
        ) : (
          <p className="mt-2 text-warn">
            Monobank&apos;s personal token is meant for your own account. Using it for other
            people needs Monobank&apos;s Corporate API.
          </p>
        )}
      </div>

      {isPrivat && (
        <input
          value={clientId}
          onChange={(event) => onClientId(event.target.value)}
          placeholder="AutoClient id"
          autoComplete="off"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      )}

      <input
        value={token}
        onChange={(event) => onToken(event.target.value)}
        type="password"
        placeholder="Paste your token"
        autoComplete="off"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      />

      {/* A name matters once there are several of the same bank. */}
      <input
        value={label}
        onChange={(event) => onLabel(event.target.value)}
        placeholder={`Name it, e.g. "${isPrivat ? 'Company account' : 'Black card'}" (optional)`}
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
          disabled={busy || !token.trim() || !consent || (isPrivat && !clientId.trim())}
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
