'use client';

import { useCallback, useEffect, useState } from 'react';
import { Panel, SectionLabel, Row, ErrorNote, Spinner, Chip, EmptyRow, RefreshButton } from './ui';
import { CRYPTO_OPTIONS, fetchJson, onMount } from './market-ui';

interface AlertList {
  alerts: Alert[];
  max: number;
}

interface Alert {
  id: string;
  asset: string;
  side: string;
  fiat: string;
  source: string;
  target: string;
  payMethod: string | null;
  merchantOnly: boolean;
  status: string;
  repeat: boolean;
  cooldownUntil: string | null;
  lastPrice: string | null;
  lastCheckedAt: string | null;
  triggeredAt: string | null;
}

/** Thin wrapper over the shared fetchJson for this route's verbs. */
function api<T>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  return fetchJson<T>(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function ago(iso: string | null): string {
  if (!iso) return 'not yet';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  return `${Math.floor(seconds / 3600)} h ago`;
}

/**
 * Price alerts: we watch, the user trades.
 *
 * Deliberately the easy half of Auto-sell -- it publishes nothing, so it needs
 * no merchant status and works for every account.
 */
export function PriceAlertsPanel() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [max, setMax] = useState(10);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [asset, setAsset] = useState('USDT');
  const [side, setSide] = useState('sell');
  const [fiat, setFiat] = useState('UAH');
  const [source, setSource] = useState('both');
  const [target, setTarget] = useState('');
  const [payMethod, setPayMethod] = useState('');
  const [merchantOnly, setMerchantOnly] = useState(false);
  const [repeat, setRepeat] = useState(false);

  const apply = useCallback((data: AlertList) => {
    setAlerts(data.alerts);
    setMax(data.max);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      apply(await api<AlertList>('/api/alerts', undefined, 'GET'));
    } catch (cause) {
      setAlerts([]);
      setError(cause instanceof Error ? cause.message : 'Could not load your alerts.');
    }
  }, [apply]);

  useEffect(() => onMount(load), [load]);

  // Every mutating route answers with the whole list, so the new state comes
  // from the same response rather than a second request.
  const act = async (key: string, work: () => Promise<AlertList>) => {
    setBusy(key);
    setError(null);
    try {
      apply(await work());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  };

  const create = () =>
    act('create', async () => {
      const next = await api<AlertList>('/api/alerts', {
        asset,
        side,
        fiat,
        source,
        target: target.trim(),
        payMethod: payMethod.trim(),
        merchantOnly,
        repeat,
      });
      setTarget('');
      setPayMethod('');
      return next;
    });

  const activeCount = alerts?.filter((a) => a.status === 'active').length ?? 0;
  const atLimit = activeCount >= max;

  return (
    <Panel
      title="Price alerts"
      subtitle="We watch, you trade · works for everyone"
      icon={<BellMark />}
      action={<RefreshButton onClick={load} loading={busy !== null} />}
    >
      <div className="space-y-6">
        {error && <ErrorNote title="Something went wrong">{error}</ErrorNote>}

        <div>
          <SectionLabel
            trailing={
              <span className="text-[11px] text-faint">
                {activeCount} of {max} running
              </span>
            }
          >
            Tell me when
          </SectionLabel>

          <div className="space-y-2.5 rounded-xl border border-border bg-surface-subtle px-3.5 py-3.5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <select
                value={side}
                onChange={(e) => setSide(e.target.value)}
                className="rounded-lg border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-accent"
              >
                <option value="sell">I want to sell</option>
                <option value="buy">I want to buy</option>
              </select>
              <select
                value={asset}
                onChange={(e) => setAsset(e.target.value)}
                className="rounded-lg border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-accent"
              >
                {CRYPTO_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.id}
                  </option>
                ))}
              </select>
              <span className="text-muted">for at {side === 'sell' ? 'least' : 'most'}</span>
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                inputMode="decimal"
                placeholder="42"
                className="tabular w-20 rounded-lg border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-accent"
              />
              <select
                value={fiat}
                onChange={(e) => setFiat(e.target.value)}
                className="rounded-lg border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-accent"
              >
                {['UAH', 'USD', 'EUR', 'PLN'].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="rounded-lg border border-border bg-surface px-2.5 py-2 text-xs outline-none focus:border-accent"
              >
                <option value="both">Binance P2P and dealers</option>
                <option value="binance">Binance P2P only</option>
                <option value="exchanger">Dealers only</option>
              </select>
              <input
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
                placeholder="Payment method (optional)"
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 py-2 text-xs outline-none focus:border-accent"
              />
            </div>

            <div className="flex flex-wrap gap-4 text-xs text-muted">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={merchantOnly}
                  onChange={(e) => setMerchantOnly(e.target.checked)}
                />
                Binance merchants only
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={repeat}
                  onChange={(e) => setRepeat(e.target.checked)}
                />
                Keep telling me (once an hour)
              </label>
            </div>

            <p className="text-[11px] leading-relaxed text-faint">
              {target
                ? `We'll tell you when someone ${side === 'sell' ? 'pays at least' : 'asks at most'} ${target} ${fiat} for 1 ${asset}.`
                : 'We check every minute and tell you when the price is right. You make the trade yourself.'}
            </p>

            <button
              type="button"
              onClick={create}
              disabled={busy !== null || !target.trim() || atLimit}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
            >
              {busy === 'create' && <Spinner className="border-t-accent-fg" />}
              {atLimit ? `Limit of ${max} reached` : 'Tell me when'}
            </button>
          </div>
        </div>

        <div>
          <SectionLabel>Your alerts</SectionLabel>
          {alerts === null ? (
            <div className="flex items-center gap-2 py-4 text-sm text-faint">
              <Spinner /> Loading…
            </div>
          ) : alerts.length === 0 ? (
            <EmptyRow>No alerts yet. Set one above and we will watch for you.</EmptyRow>
          ) : (
            <div>
              {alerts.map((alert) => {
                const waiting = alert.status === 'active';
                const cooling =
                  alert.cooldownUntil && new Date(alert.cooldownUntil) > new Date();
                return (
                  <Row key={alert.id}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {alert.side === 'sell' ? 'Sell' : 'Buy'} {alert.asset} at{' '}
                        {alert.side === 'sell' ? '≥' : '≤'} {alert.target} {alert.fiat}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
                        {alert.lastPrice ? (
                          <>best now {alert.lastPrice} {alert.fiat}</>
                        ) : (
                          <>no price seen yet</>
                        )}
                        <span>· checked {ago(alert.lastCheckedAt)}</span>
                        {alert.payMethod && <span>· {alert.payMethod}</span>}
                        {alert.merchantOnly && <span>· merchants only</span>}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Chip
                        tone={
                          alert.status === 'triggered'
                            ? 'good'
                            : !waiting
                              ? 'neutral'
                              : cooling
                                ? 'warn'
                                : 'accent'
                        }
                      >
                        {alert.status === 'triggered'
                          ? 'triggered'
                          : cooling
                            ? 'cooling down'
                            : waiting
                              ? 'watching'
                              : 'off'}
                      </Chip>
                      <button
                        type="button"
                        onClick={() =>
                          act(alert.id, () =>
                            api<AlertList>(
                              '/api/alerts',
                              { id: alert.id, status: waiting ? 'off' : 'active' },
                              'PATCH',
                            ),
                          )
                        }
                        disabled={busy !== null}
                        className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted transition hover:text-foreground disabled:opacity-40"
                      >
                        {waiting ? 'Turn off' : 'Turn on'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          act(alert.id, () =>
                            api<AlertList>(
                              `/api/alerts?id=${encodeURIComponent(alert.id)}`,
                              undefined,
                              'DELETE',
                            ),
                          )
                        }
                        disabled={busy !== null}
                        className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-bad transition hover:border-bad/40 disabled:opacity-40"
                      >
                        Delete
                      </button>
                    </span>
                  </Row>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function BellMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10.5 19a2 2 0 0 0 3 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
