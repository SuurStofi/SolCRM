'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthProvider';
import {
  Panel,
  SectionLabel,
  ErrorNote,
  Spinner,
  RefreshButton,
  Chip,
  EmptyRow,
  useSecondsLeft,
} from './ui';

interface ConvertibleAsset {
  asset: string;
  free: string;
  to: string[];
}

interface Quote {
  quoteId: string;
  ratio: string;
  inverseRatio: string;
  toAmount: string;
  fromAmount: string;
  validForMs: number;
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
 * Convert between any two assets Binance supports, on the user's own account.
 *
 * Distinct from the Sell/Buy flows in Transfer: nothing moves on-chain here, so
 * there is no deposit to wait for and no state to resume. It is one atomic
 * step on Binance.
 */
export function ConvertPanel() {
  const { account } = useAuth();
  const hasKey = Boolean(account?.binance);

  const [assets, setAssets] = useState<ConvertibleAsset[]>([]);
  const [fromAsset, setFromAsset] = useState('USDT');
  const [toAsset, setToAsset] = useState('SOL');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const secondsLeft = useSecondsLeft(deadline);
  const expired = quote !== null && secondsLeft <= 0;

  const load = useCallback(async () => {
    if (!hasKey) return;
    setError(null);
    try {
      const data = await api<{ assets: ConvertibleAsset[] }>(
        '/api/convert/assets',
        undefined,
        'GET',
      );
      setAssets(data.assets);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load assets.');
    }
  }, [hasKey]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  const from = useMemo(
    () => assets.find((a) => a.asset === fromAsset) ?? null,
    [assets, fromAsset],
  );

  // Only assets Binance can actually convert this one into. Offering the full
  // 400-asset list for every source would mostly produce unsupported pairs.
  const targets = from?.to ?? [];

  // Resolved during render rather than corrected in an effect: changing the
  // source can strand the chosen target on a pair Binance does not support,
  // and fixing that in an effect would render one frame with an invalid pair.
  const effectiveTo =
    targets.length === 0 || targets.includes(toAsset)
      ? toAsset
      : targets.includes('USDT')
        ? 'USDT'
        : targets[0];

  const free = from?.free ?? '0';
  const amountValid = /^\d+(\.\d+)?$/.test(amount.trim()) && Number(amount) > 0;
  const overBalance = amountValid && Number(amount) > Number(free);

  const clearQuote = () => {
    setQuote(null);
    setDeadline(null);
  };

  const getQuote = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const data = await api<{ quote: Quote }>('/api/convert/trade', {
        action: 'quote',
        fromAsset,
        toAsset: effectiveTo,
        amount: amount.trim(),
      });
      setQuote(data.quote);
      setDeadline(Date.now() + data.quote.validForMs);
    } catch (cause) {
      clearQuote();
      setError(cause instanceof Error ? cause.message : 'Could not get a price.');
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    if (!quote) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ status: { toAmount: string; toAsset: string } }>(
        '/api/convert/trade',
        { action: 'accept', quoteId: quote.quoteId },
      );
      setDone(`Received ${data.status.toAmount} ${data.status.toAsset}.`);
      clearQuote();
      setAmount('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The conversion failed.');
      clearQuote();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Exchange"
      subtitle="Any coin → any coin · on Binance"
      icon={<SwapMark />}
      action={<RefreshButton onClick={load} loading={busy} />}
    >
      <div className="space-y-5">
        {error && <ErrorNote title="Something went wrong">{error}</ErrorNote>}

        {done && (
          <div className="rounded-lg border border-good/30 bg-good-bg px-3.5 py-2.5 text-xs text-good">
            {done}
          </div>
        )}

        {!hasKey ? (
          <EmptyRow>Connect your Binance account first (Home → My account).</EmptyRow>
        ) : assets.length === 0 ? (
          <div className="flex items-center gap-2 py-6 text-sm text-faint">
            <Spinner /> Loading assets…
          </div>
        ) : (
          <>
            <div>
              <SectionLabel
                trailing={
                  <span className="tabular text-[11px] text-faint">
                    you have {free} {fromAsset}
                  </span>
                }
              >
                From
              </SectionLabel>
              <div className="flex gap-2">
                <div className="flex flex-1 items-center rounded-lg border border-border bg-surface-subtle px-3 focus-within:border-accent">
                  <input
                    id="convert-amount"
                    value={amount}
                    onChange={(event) => {
                      setAmount(event.target.value);
                      clearQuote();
                    }}
                    inputMode="decimal"
                    placeholder="0.00"
                    disabled={busy}
                    className="tabular w-full bg-transparent py-2 text-sm outline-none placeholder:text-faint disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setAmount(free);
                      clearQuote();
                    }}
                    disabled={busy || Number(free) <= 0}
                    className="shrink-0 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-40"
                  >
                    Max
                  </button>
                </div>
                <AssetSelect
                  id="convert-from"
                  value={fromAsset}
                  options={assets.map((a) => a.asset)}
                  balances={assets}
                  disabled={busy}
                  onChange={(value) => {
                    setFromAsset(value);
                    clearQuote();
                  }}
                />
              </div>
            </div>

            <div>
              <SectionLabel>To</SectionLabel>
              <div className="flex gap-2">
                <div className="tabular flex flex-1 items-center rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted">
                  {quote && !expired ? (
                    <span className="font-medium text-foreground">{quote.toAmount}</span>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </div>
                <AssetSelect
                  id="convert-to"
                  value={effectiveTo}
                  options={targets}
                  disabled={busy}
                  onChange={(value) => {
                    setToAsset(value);
                    clearQuote();
                  }}
                />
              </div>
            </div>

            {overBalance && (
              <p className="text-[11px] text-bad">
                Not enough {fromAsset}. You have {free}.
              </p>
            )}

            {/* The quote is shown for confirmation before anything executes:
                accepting is irreversible, so it is never the same click that
                fetched the price. */}
            {quote && (
              <div
                className={`rounded-lg border px-3.5 py-3 ${
                  expired ? 'border-border bg-surface-subtle' : 'border-accent/30 bg-accent/5'
                }`}
              >
                <p className="text-xs">
                  <span className="font-semibold">
                    {quote.fromAmount} {fromAsset}
                  </span>{' '}
                  →{' '}
                  <span className="font-semibold">
                    {quote.toAmount} {effectiveTo}
                  </span>
                  <span className="ml-1.5 text-faint">
                    1 {fromAsset} = {quote.ratio} {effectiveTo}
                  </span>
                </p>
                <div className="mt-2 flex items-center gap-2">
                  {expired ? (
                    <>
                      <Chip tone="warn">Price expired</Chip>
                      <button
                        type="button"
                        onClick={getQuote}
                        disabled={busy}
                        className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
                      >
                        Get a new price
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={accept}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
                      >
                        {busy && <Spinner className="border-t-accent-fg" />}
                        Confirm exchange
                      </button>
                      <button
                        type="button"
                        onClick={clearQuote}
                        disabled={busy}
                        className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition hover:text-foreground disabled:opacity-40"
                      >
                        Cancel
                      </button>
                      <span className="tabular text-[11px] text-faint">
                        {secondsLeft}s left
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}

            {!quote && (
              <button
                type="button"
                onClick={getQuote}
                disabled={busy || !amountValid || overBalance || fromAsset === effectiveTo}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
              >
                {busy && <Spinner className="border-t-accent-fg" />}
                See price
              </button>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

/**
 * Asset picker. A native select on purpose: the list runs to ~430 entries, and
 * the browser's own list is searchable by typing and works on mobile.
 */
function AssetSelect({
  id,
  value,
  options,
  balances,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  options: readonly string[];
  balances?: ConvertibleAsset[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const held = balances?.filter((a) => Number(a.free) > 0).map((a) => a.asset) ?? [];
  const rest = options.filter((a) => !held.includes(a));

  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="shrink-0 rounded-lg border border-border bg-surface px-2.5 py-2 text-sm font-medium outline-none transition focus:border-accent disabled:opacity-50"
    >
      {held.length > 0 && (
        <optgroup label="You hold">
          {held.map((asset) => (
            <option key={asset} value={asset}>
              {asset}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label={held.length > 0 ? 'All assets' : 'Assets'}>
        {rest.map((asset) => (
          <option key={asset} value={asset}>
            {asset}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

function SwapMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M4 8h13m0 0-3.5-3.5M17 8l-3.5 3.5M20 16H7m0 0 3.5-3.5M7 16l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
