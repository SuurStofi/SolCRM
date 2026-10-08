'use client';

import { useCallback, useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { getWalletSnapshot } from '@/lib/solana/read';
import { Panel, SectionLabel, Row, ErrorNote, Spinner, Chip, EmptyRow, RefreshButton } from './ui';

interface SourceLine {
  id: string;
  kind: string;
  label: string;
  amount: number;
  currencyCode: number;
  converted: number | null;
  asOf: string | null;
  stale: boolean;
  staleReason?: string;
  liveness: 'live' | 'from-statement' | 'entered-by-you' | 'transfers-only';
  excludedFromTotal?: boolean;
}

interface ActivityItem {
  id: string;
  source: 'wallet' | 'binance' | 'bank' | 'paypal' | 'p2p';
  title: string;
  detail?: string;
  amount?: string;
  unit?: string;
  at: string;
  signature?: string;
  failed?: boolean;
}

interface Totals {
  displayCurrency: number;
  total: number;
  sources: SourceLine[];
  inTransit: Array<{ id: string; label: string; amount: number; currencyCode: number }>;
  unconvertible: string[];
  rate: { source: string; asOf: string | null };
  activity: ActivityItem[];
  currencies: ReadonlyArray<{ code: number; name: string; symbol: string }>;
}

const SYMBOLS: Record<number, string> = { 840: '$', 980: '₴', 978: '€' };

function money(value: number, currencyCode: number): string {
  const symbol = SYMBOLS[currencyCode] ?? '';
  return `${symbol}${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

const LIVENESS_LABEL: Record<SourceLine['liveness'], string> = {
  live: 'Live',
  'from-statement': 'From statement',
  'entered-by-you': 'Entered by you',
  'transfers-only': 'Not connected — transfers only',
};

/**
 * Everything the user has, in one currency.
 *
 * The wallet is read in the browser because the connection lives there; the
 * rest is read on the server and merged. Sources that could not be refreshed
 * keep their last value and say so, rather than disappearing and making the
 * total silently fall.
 */
export function TotalsPanel() {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();

  const [currency, setCurrency] = useState(840);
  const [data, setData] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // The wallet half is gathered here and posted: the server has no wallet
      // connection, and this app never holds a key.
      let wallet:
        | { address: string; sol: number; tokens: Array<{ mint: string; amount: number }> }
        | undefined;
      if (connected && publicKey) {
        const snapshot = await getWalletSnapshot(connection, publicKey);
        wallet = {
          address: snapshot.address,
          sol: snapshot.solBalance,
          // Mints, not tickers: the server matches known stablecoin mints and
          // ignores everything else rather than pricing a token by its name.
          tokens: snapshot.tokens.map((token) => ({
            mint: token.mint,
            amount: token.amount,
          })),
        };
      }

      const response = await fetch('/api/totals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currency, wallet }),
      });
      const json = (await response.json()) as { ok: boolean; data?: Totals; error?: string };
      if (!json.ok || !json.data) throw new Error(json.error ?? 'Could not build your total.');
      setData(json.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not build your total.');
    } finally {
      setLoading(false);
    }
  }, [connection, connected, publicKey, currency]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  const included = data?.sources.filter((line) => !line.excludedFromTotal) ?? [];
  const excluded = data?.sources.filter((line) => line.excludedFromTotal) ?? [];

  return (
    <Panel
      title="Total balance"
      subtitle="Everything you have, in one place"
      icon={<SumMark />}
      action={
        <div className="flex items-center gap-2">
          <select
            value={currency}
            onChange={(event) => setCurrency(Number(event.target.value))}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs font-medium outline-none focus:border-accent"
          >
            {(data?.currencies ?? [{ code: 840, name: 'USD', symbol: '$' }]).map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.name}
              </option>
            ))}
          </select>
          <RefreshButton onClick={load} loading={loading} />
        </div>
      }
    >
      <div className="space-y-6">
        {error && <ErrorNote title="Something went wrong">{error}</ErrorNote>}

        {!data ? (
          <div className="flex items-center gap-2 py-8 text-sm text-faint">
            <Spinner /> Adding everything up…
          </div>
        ) : included.length === 0 && excluded.length === 0 ? (
          <EmptyRow>Connect a wallet, exchange or card to see your total.</EmptyRow>
        ) : (
          <>
            <div>
              <div className="tabular text-[2rem] font-semibold leading-none tracking-tight">
                {money(data.total, data.displayCurrency)}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-faint">
                Across {included.length} source{included.length === 1 ? '' : 's'}.
                {data.rate.asOf && (
                  <> Rates from {data.rate.source}, {ago(data.rate.asOf)}.</>
                )}
              </p>
              {data.unconvertible.length > 0 && (
                <p className="mt-1 text-[11px] leading-relaxed text-warn">
                  Not included, no price available: {data.unconvertible.join(', ')}.
                </p>
              )}
            </div>

            <div>
              <SectionLabel>Where it is</SectionLabel>
              {included.length === 0 ? (
                <EmptyRow>Nothing connected yet.</EmptyRow>
              ) : (
                <div>
                  {included.map((line) => (
                    <Row key={line.id}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{line.label}</span>
                        <span className="flex items-center gap-1.5 text-[11px] text-faint">
                          {line.stale ? (
                            <Chip tone="warn">stale</Chip>
                          ) : (
                            <span>{LIVENESS_LABEL[line.liveness]}</span>
                          )}
                          {line.asOf && <span>· {ago(line.asOf)}</span>}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="tabular block text-sm font-medium">
                          {line.converted === null
                            ? '—'
                            : money(line.converted, data.displayCurrency)}
                        </span>
                        {line.currencyCode !== data.displayCurrency && (
                          <span className="tabular block text-[11px] text-faint">
                            {money(line.amount, line.currencyCode)}
                          </span>
                        )}
                      </span>
                    </Row>
                  ))}
                </div>
              )}
            </div>

            {data.inTransit.length > 0 && (
              <div>
                <SectionLabel>In transit</SectionLabel>
                <div>
                  {data.inTransit.map((item) => (
                    <Row key={item.id}>
                      <span className="text-sm">{item.label}</span>
                      <span className="tabular text-sm text-muted">{item.amount} SOL</span>
                    </Row>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
                  Left one place, not arrived at the next. Shown separately so it is not
                  counted twice.
                </p>
              </div>
            )}

            {excluded.length > 0 && (
              <div>
                <SectionLabel>Not counted</SectionLabel>
                <div>
                  {excluded.map((line) => (
                    <Row key={line.id}>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm">{line.label}</span>
                        <span className="text-[11px] text-faint">
                          {LIVENESS_LABEL[line.liveness]}
                        </span>
                      </span>
                      <span className="tabular text-sm text-faint">—</span>
                    </Row>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
                  PayPal publishes no way to read your balance, so this app cannot know it.
                  Only PYUSD moved through SolCRM is visible, and it is not added to the
                  total.
                </p>
              </div>
            )}
            <div>
              <SectionLabel>Recent activity</SectionLabel>
              {data.activity.length === 0 ? (
                <EmptyRow>Nothing has moved yet.</EmptyRow>
              ) : (
                <div>
                  {data.activity.slice(0, 12).map((item) => {
                    const outgoing = item.amount?.startsWith('-');
                    return (
                      <Row key={item.id}>
                        <span className="flex min-w-0 flex-1 items-start gap-2">
                          <span
                            aria-hidden="true"
                            className="mt-[3px] shrink-0 text-faint"
                            title={SOURCE_NAMES[item.source]}
                          >
                            {SOURCE_ICONS[item.source]}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm">{item.title}</span>
                            <span className="block truncate text-[11px] text-faint">
                              {ago(item.at)}
                              {item.detail ? ` · ${item.detail}` : ''}
                            </span>
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {item.failed && <Chip tone="bad">failed</Chip>}
                          {item.amount && (
                            <span
                              className={`tabular text-sm font-medium ${
                                outgoing ? '' : 'text-good'
                              }`}
                            >
                              {item.amount} {item.unit}
                            </span>
                          )}
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

/** One glyph per source, so a row's origin reads at a glance. */
const SOURCE_ICONS: Record<ActivityItem['source'], string> = {
  wallet: '◎',
  binance: '◆',
  bank: '■',
  paypal: '●',
  p2p: '▲',
};

const SOURCE_NAMES: Record<ActivityItem['source'], string> = {
  wallet: 'Wallet',
  binance: 'Binance',
  bank: 'Bank card',
  paypal: 'PayPal',
  p2p: 'P2P deal',
};

function SumMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M17 5H7l5.5 7L7 19h10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
