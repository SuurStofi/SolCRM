'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Panel, SectionLabel, ErrorNote, Spinner, Chip, EmptyRow, ShowMore } from './ui';
import {
  cryptoLabel,
  fetchJson,
  Field,
  inputClass,
  money,
  onMount,
  SideAndCrypto,
  unitOf,
  type CryptoId,
  type Side,
} from './market-ui';

type Source = 'exchanger' | 'p2p' | 'p2p-usdt';

interface Row {
  id: string;
  source: Source;
  venue: string;
  merchant: boolean;
  method: string;
  price: number;
  effectivePrice: number | null;
  minFiat: number | null;
  maxFiat: number | null;
  fits: boolean | null;
  trust: string;
  notes: string[];
  url: string;
}

interface Comparison {
  crypto: CryptoId;
  side: Side;
  fiat: string;
  amount: number | null;
  spotSolUsdt: number | null;
  rows: Row[];
  errors: Partial<Record<Source, string>>;
  exchangerConfigured: boolean;
}

function sourceInfo(source: Source, crypto: CryptoId, side: Side) {
  switch (source) {
    case 'exchanger':
      return { label: 'Dealers (BestChange)', short: 'Dealer', tone: 'accent' as const };
    case 'p2p':
      return { label: `Binance P2P · ${unitOf(crypto)}`, short: `P2P · ${unitOf(crypto)}`, tone: 'good' as const };
    case 'p2p-usdt':
      return {
        label: side === 'sell' ? 'Binance Convert → USDT → P2P' : 'Binance P2P USDT → Convert',
        short: 'P2P · via USDT',
        tone: 'neutral' as const,
      };
  }
}

/** Offered before BestChange has answered, and when it is not configured. */
const DEFAULT_FIATS = ['UAH', 'KZT', 'USD', 'EUR', 'RUB'];

/** A busy fiat returns 1000+ dealer rows; render the top of the sort. */
const PREVIEW_ROWS = 50;

export function ComparePanel() {
  const [side, setSide] = useState<Side>('sell');
  const [crypto, setCrypto] = useState<CryptoId>('SOL');
  const [fiat, setFiat] = useState('UAH');
  const [amount, setAmount] = useState('');
  const [fiats, setFiats] = useState<string[]>(DEFAULT_FIATS);
  const [result, setResult] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [bestFirst, setBestFirst] = useState(true);
  const [shown, setShown] = useState<Record<Source, boolean>>({
    exchanger: true,
    p2p: true,
    'p2p-usdt': true,
  });
  const [onlyFitting, setOnlyFitting] = useState(false);
  const [merchantsOnly, setMerchantsOnly] = useState(false);
  const [method, setMethod] = useState('');
  const [expanded, setExpanded] = useState(false);

  // The fiat list comes from what BestChange actually trades in. Failing to
  // load it is not worth an error: the defaults still work.
  const loadFiats = useCallback(async () => {
    try {
      const params = new URLSearchParams({ crypto, side });
      const data = await fetchJson<{ rails: Array<{ fiat: string | null }> }>(
        `/api/exchange/rails?${params.toString()}`,
      );
      const found = data.rails.map((r) => r.fiat).filter((f): f is string => !!f);
      setFiats([...new Set([...DEFAULT_FIATS, ...found])].sort());
    } catch {
      /* keep the defaults */
    }
  }, [crypto, side]);

  useEffect(() => onMount(loadFiats), [loadFiats]);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setExpanded(false);
    try {
      const params = new URLSearchParams({ crypto, side, fiat: fiat.trim().toUpperCase() });
      if (amount.trim()) params.set('amount', amount.trim());
      setResult(await fetchJson<Comparison>(`/api/compare?${params.toString()}`));
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : 'Comparison failed.');
    } finally {
      setLoading(false);
    }
  }, [crypto, side, fiat, amount]);

  const rows = useMemo(() => {
    if (!result) return [];
    const needle = method.trim().toLowerCase();
    // "Best" flips with the side: most fiat when selling, least when buying.
    const better = (a: Row, b: Row) => (result.side === 'sell' ? b.price - a.price : a.price - b.price);
    return result.rows
      .filter(
        (row) =>
          shown[row.source] &&
          (!onlyFitting || row.fits !== false) &&
          // Merchant status only exists on Binance; dealers are all
          // businesses and stay in.
          (!merchantsOnly || row.source === 'exchanger' || row.merchant) &&
          (!needle || row.method.toLowerCase().includes(needle)),
      )
      .sort((a, b) => (bestFirst ? better(a, b) : -better(a, b)));
  }, [result, shown, onlyFitting, merchantsOnly, method, bestFirst]);

  const bestBySource = useMemo(() => {
    const best: Partial<Record<Source, number>> = {};
    if (!result) return best;
    for (const row of result.rows) {
      const current = best[row.source];
      const isBetter = result.side === 'sell' ? row.price > (current ?? -Infinity) : row.price < (current ?? Infinity);
      if (isBetter) best[row.source] = row.price;
    }
    return best;
  }, [result]);

  const topPrice =
    rows.length === 0 || !result
      ? null
      : result.side === 'sell'
        ? Math.max(...rows.map((r) => r.price))
        : Math.min(...rows.map((r) => r.price));

  const unit = unitOf(crypto);

  return (
    <Panel
      title="Compare"
      subtitle={`${side === 'sell' ? 'Sell' : 'Buy'} ${cryptoLabel(crypto)}: dealers vs Binance P2P, per 1 ${unit}`}
      icon={<ScaleMark />}
    >
      <div className="space-y-5">
        {error && <ErrorNote title="Could not compare">{error}</ErrorNote>}

        <div className="flex flex-wrap items-end gap-3">
          <SideAndCrypto
            side={side}
            crypto={crypto}
            onSide={(next) => {
              setSide(next);
              setResult(null);
            }}
            onCrypto={(next) => {
              setCrypto(next);
              setResult(null);
            }}
          />
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <Field label={side === 'sell' ? 'Receive in' : 'Pay in'} className="w-28">
            <input
              value={fiat}
              onChange={(e) => setFiat(e.target.value.toUpperCase())}
              list="compare-fiats"
              maxLength={3}
              className={inputClass}
            />
            <datalist id="compare-fiats">
              {fiats.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </Field>
          <Field label={`Amount, ${unit}`} className="w-36">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="optional"
              className={inputClass}
            />
          </Field>
          <button
            type="button"
            onClick={() => void run()}
            disabled={loading || !/^[A-Za-z]{3}$/.test(fiat.trim())}
            className="inline-flex h-[34px] items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
          >
            {loading && <Spinner className="border-t-accent-fg" />}
            <span>Compare</span>
          </button>
        </div>

        {result && (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              {(Object.keys(shown) as Source[])
                .filter((source) => source !== 'p2p-usdt' || result.crypto === 'SOL')
                .map((source) => (
                  <SourceSummary
                    key={source}
                    info={sourceInfo(source, result.crypto, result.side)}
                    best={bestBySource[source]}
                    fiat={result.fiat}
                    error={result.errors[source]}
                    notConfigured={source === 'exchanger' && !result.exchangerConfigured}
                    checked={shown[source]}
                    onToggle={() => setShown((s) => ({ ...s, [source]: !s[source] }))}
                  />
                ))}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <Field label="Payment method contains" className="w-56">
                <input
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  placeholder="card, PayPal, Monobank…"
                  className={inputClass}
                />
              </Field>
              <label className="flex h-[34px] cursor-pointer items-center gap-1.5 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={merchantsOnly}
                  onChange={(e) => setMerchantsOnly(e.target.checked)}
                />
                Binance merchants only
              </label>
              {result.amount !== null && (
                <label className="flex h-[34px] cursor-pointer items-center gap-1.5 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={onlyFitting}
                    onChange={(e) => setOnlyFitting(e.target.checked)}
                  />
                  Only what fits {result.amount} {unit}
                </label>
              )}
              <select
                value={bestFirst ? 'best' : 'worst'}
                onChange={(e) => setBestFirst(e.target.value === 'best')}
                className="h-[34px] rounded-lg border border-border bg-surface-subtle px-2 text-xs outline-none"
              >
                <option value="best">Best price first</option>
                <option value="worst">Worst price first</option>
              </select>
            </div>

            <div>
              <SectionLabel>{rows.length} offers</SectionLabel>

              {rows.length === 0 ? (
                <EmptyRow>
                  Nothing to show for {result.fiat}
                  {result.fiat === 'RUB' && ' — Binance P2P currently returns no RUB ads at all'}.
                </EmptyRow>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-faint">
                        <th className="py-1.5 font-medium">
                          <button
                            type="button"
                            onClick={() => setBestFirst((b) => !b)}
                            className="uppercase tracking-wide hover:text-foreground"
                          >
                            Per 1 {unit} {bestFirst === (result.side === 'sell') ? '↓' : '↑'}
                          </button>
                        </th>
                        <th className="py-1.5 font-medium">Route</th>
                        <th className="py-1.5 font-medium">Who</th>
                        <th className="py-1.5 font-medium">{result.side === 'sell' ? 'Paid to' : 'Paid with'}</th>
                        <th className="py-1.5 text-right font-medium">Limits, {result.fiat}</th>
                        {result.amount !== null && (
                          <th className="py-1.5 text-right font-medium">
                            {result.side === 'sell' ? 'You receive' : 'You pay'}
                          </th>
                        )}
                        <th className="py-1.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {(expanded ? rows : rows.slice(0, PREVIEW_ROWS)).map((row) => (
                        <CompareRow
                          key={row.id}
                          row={row}
                          result={result}
                          topPrice={topPrice}
                        />
                      ))}
                    </tbody>
                  </table>
                  <ShowMore
                    expanded={expanded}
                    total={rows.length}
                    previewCount={PREVIEW_ROWS}
                    onToggle={() => setExpanded((e) => !e)}
                  />
                </div>
              )}
            </div>

            <p className="border-t border-border pt-3 text-[11px] leading-relaxed text-faint">
              Binance figures leave out network fees and the Convert spread
              {result.spotSolUsdt !== null &&
                ` (the USDT route uses spot SOL/USDT ${money(result.spotSolUsdt)})`}
              . Dealer figures are what the dealer advertises; where BestChange knows of
              extra fees the fee-adjusted price is shown underneath. Binance shows at most 10 ads
              per route, and P2P orders are placed on Binance itself.
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}

function SourceSummary({
  info,
  best,
  fiat,
  error,
  notConfigured,
  checked,
  onToggle,
}: {
  info: ReturnType<typeof sourceInfo>;
  best: number | undefined;
  fiat: string;
  error: string | undefined;
  notConfigured: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 transition ${
        checked ? 'border-border bg-surface-subtle' : 'border-border/60 opacity-60'
      }`}
    >
      <input type="checkbox" checked={checked} onChange={onToggle} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-[11px] text-muted">{info.label}</span>
        {notConfigured ? (
          <span className="block text-xs text-warn">Not connected — see the Dealer tab</span>
        ) : error ? (
          <span className="block text-xs text-bad">{error}</span>
        ) : best !== undefined ? (
          <span className="tabular block text-sm font-semibold">
            best {money(best)} {fiat}
          </span>
        ) : (
          <span className="block text-xs text-faint">no offers</span>
        )}
      </span>
    </label>
  );
}

function CompareRow({
  row,
  result,
  topPrice,
}: {
  row: Row;
  result: Comparison;
  topPrice: number | null;
}) {
  const gap =
    topPrice !== null && row.price !== topPrice
      ? Math.abs(row.price / topPrice - 1) * 100
      : null;
  const info = sourceInfo(row.source, result.crypto, result.side);

  return (
    <tr className={`border-t border-border/60 align-top ${row.fits === false ? 'opacity-50' : ''}`}>
      <td className="py-2.5 pr-3">
        <span className="tabular font-semibold">{money(row.price)}</span>
        {gap !== null && (
          <span className="tabular ml-1.5 text-[11px] text-faint">−{gap.toFixed(1)}%</span>
        )}
        {row.effectivePrice !== null && Math.abs(row.effectivePrice / row.price - 1) > 0.001 && (
          <span className="tabular block text-[11px] text-faint">
            {money(row.effectivePrice)} after fees
          </span>
        )}
      </td>
      <td className="py-2.5 pr-3">
        <Chip tone={info.tone}>{info.short}</Chip>
      </td>
      <td className="py-2.5 pr-3">
        <span className="font-medium">{row.venue}</span>
        {row.merchant && (
          <span className="ml-1.5 align-middle">
            <Chip tone="accent">merchant</Chip>
          </span>
        )}
        {row.trust && <span className="block text-[11px] text-faint">{row.trust}</span>}
      </td>
      <td className="max-w-[200px] py-2.5 pr-3 text-xs text-muted">{row.method}</td>
      <td className="tabular py-2.5 pr-3 text-right text-xs text-muted">{limits(row)}</td>
      {result.amount !== null && (
        <td className="tabular py-2.5 pr-3 text-right">
          {row.fits === false ? (
            <span className="text-xs text-faint">outside limits</span>
          ) : (
            `${money(result.amount * row.price)} ${result.fiat}`
          )}
        </td>
      )}
      <td className="py-2.5 text-right">
        <a
          href={row.url}
          target="_blank"
          rel="noreferrer"
          title={row.notes.join(' · ')}
          className="text-xs font-medium text-accent hover:underline"
        >
          {row.source === 'exchanger'
            ? 'Exchange'
            : row.url.includes('advertiserDetail')
              ? 'Merchant'
              : 'Open ad'}
        </a>
      </td>
    </tr>
  );
}

function limits(row: Row): string {
  const min = row.minFiat !== null ? money(row.minFiat) : null;
  const max = row.maxFiat !== null ? money(row.maxFiat) : null;
  if (min && max) return `${min}–${max}`;
  if (min) return `from ${min}`;
  if (max) return `up to ${max}`;
  return '—';
}

function ScaleMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M12 4v16M7 20h10M5 8h14M5 8l-3 6a3 3 0 0 0 6 0L5 8Zm14 0-3 6a3 3 0 0 0 6 0l-3-6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
