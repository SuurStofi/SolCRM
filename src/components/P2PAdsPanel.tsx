'use client';

import { useCallback, useState } from 'react';
import {
  Panel,
  SectionLabel,
  ErrorNote,
  Spinner,
  Chip,
  EmptyRow,
  ExtLink,
  CopyButton,
} from './ui';

interface Advertiser {
  nickName: string;
  userType: string;
  monthOrderCount: number;
  monthFinishRate: number;
  positiveRate: number;
}

interface Ad {
  adNo: string;
  price: number;
  fiat: string;
  fiatSymbol: string;
  asset: string;
  minTransAmount: number;
  maxTransAmount: number;
  tradableAmount: number;
  payTimeLimit: number;
  tradeMethods: string[];
  advertiser: Advertiser | null;
}

interface SearchResult {
  ads: Ad[];
  boardUrl: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = (await response.json()) as { ok: boolean; data?: T; error?: string };
  if (!body.ok || body.data === undefined) throw new Error(body.error ?? 'Request failed');
  return body.data;
}

export function P2PAdsPanel() {
  const [asset, setAsset] = useState('USDT');
  const [fiat, setFiat] = useState('USD');
  const [tradeType, setTradeType] = useState<'BUY' | 'SELL'>('SELL');
  const [payMethod, setPayMethod] = useState('');
  const [amount, setAmount] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ asset, fiat, tradeType });
      if (payMethod.trim()) params.set('payMethod', payMethod.trim());
      if (amount.trim()) params.set('transAmount', amount.trim());
      setResult(await fetchJson<SearchResult>(`/api/p2p/ads?${params.toString()}`));
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : 'Search failed.');
    } finally {
      setLoading(false);
    }
  }, [asset, fiat, tradeType, payMethod, amount]);

  return (
    <Panel
      title="P2P ads"
      subtitle="Discovery only · orders are created on Binance"
      icon={<PeopleMark />}
    >
      <div className="space-y-5">
        {error && <ErrorNote title="Could not search ads">{error}</ErrorNote>}

        <div>
          <SectionLabel>Find ads</SectionLabel>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label="Asset">
              <input
                value={asset}
                onChange={(event) => setAsset(event.target.value.toUpperCase())}
                className={inputClass}
              />
            </Field>
            <Field label="Fiat">
              <input
                value={fiat}
                onChange={(event) => setFiat(event.target.value.toUpperCase())}
                className={inputClass}
              />
            </Field>
            <Field label="I want to">
              <select
                value={tradeType}
                onChange={(event) => setTradeType(event.target.value as 'BUY' | 'SELL')}
                className={inputClass}
              >
                <option value="SELL">Sell</option>
                <option value="BUY">Buy</option>
              </select>
            </Field>
            <Field label="Amount">
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                placeholder="any"
                className={inputClass}
              />
            </Field>
          </div>

          <div className="mt-2 flex gap-2">
            <Field label="Payment method" className="w-full">
              <input
                value={payMethod}
                onChange={(event) => setPayMethod(event.target.value)}
                placeholder="e.g. PrivatBank — exact identifier"
                className={inputClass}
              />
            </Field>
            <button
              type="button"
              onClick={search}
              disabled={loading || !asset.trim() || !fiat.trim()}
              className="mt-[18px] inline-flex h-[34px] shrink-0 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
            >
              {loading && <Spinner className="border-t-accent-fg" />}
              <span>Search</span>
            </button>
          </div>
        </div>

        {result && (
          <div>
            <SectionLabel
              trailing={
                <ExtLink href={result.boardUrl}>Open on Binance</ExtLink>
              }
            >
              {result.ads.length > 0 ? `Top ${result.ads.length} ads` : 'Results'}
            </SectionLabel>

            {result.ads.length > 0 ? (
              <>
                <ul className="space-y-2">
                  {result.ads.map((ad) => (
                    <AdCard key={ad.adNo} ad={ad} />
                  ))}
                </ul>
                {/* Measured, not assumed: the endpoint ignores page and rows
                    alike, so this really is everything it will ever return. */}
                <p className="mt-2 text-[11px] leading-relaxed text-faint">
                  Binance caps this search at 10 ads and ignores paging, so there is no
                  next page — narrow by amount or payment method to see different ones.
                </p>
              </>
            ) : (
              <EmptyRow>
                No ads for {asset}/{fiat}. Binance answers an unsupported market the same
                way it answers a thin one, so check the fiat code — RUB currently returns
                nothing at all, whatever the asset or direction.
              </EmptyRow>
            )}
          </div>
        )}

        <p className="border-t border-border pt-3 text-[11px] leading-relaxed text-faint">
          Orders cannot be created through the API — that is a Binance limit, not a
          missing feature. Match the ad number on Binance, trade there, then archive the
          order number below.
        </p>
      </div>
    </Panel>
  );
}

const inputClass =
  'h-[34px] w-full rounded-lg border border-border bg-surface-subtle px-2.5 text-sm outline-none transition focus:border-accent placeholder:text-faint';

function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-faint">
        {label}
      </span>
      {children}
    </label>
  );
}

function AdCard({ ad }: { ad: Ad }) {
  const advertiser = ad.advertiser;

  return (
    <li className="rounded-lg border border-border bg-surface-subtle px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="tabular text-sm font-semibold">
            {ad.fiatSymbol || ''}
            {ad.price} {ad.fiat}
          </span>
          <p className="tabular mt-0.5 text-[11px] text-faint">
            {ad.minTransAmount}–{ad.maxTransAmount} {ad.fiat} · {ad.tradableAmount}{' '}
            {ad.asset} available · {ad.payTimeLimit} min to pay
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-0.5">
          <span className="font-mono text-[10px] text-faint">
            {ad.adNo.slice(0, 6)}…
          </span>
          <CopyButton value={ad.adNo} />
        </span>
      </div>

      {advertiser && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium">{advertiser.nickName}</span>
          {advertiser.userType === 'merchant' && <Chip tone="accent">merchant</Chip>}
          {/* Completion rate is the number that predicts a wasted hour, so it
              is shown rather than buried behind the order count. */}
          <Chip tone={advertiser.monthFinishRate >= 0.95 ? 'good' : 'warn'}>
            {percent(advertiser.monthFinishRate)} completion
          </Chip>
          <Chip>{advertiser.monthOrderCount} orders/30d</Chip>
          <Chip tone={advertiser.positiveRate >= 0.95 ? 'good' : 'warn'}>
            {percent(advertiser.positiveRate)} positive
          </Chip>
        </div>
      )}

      {ad.tradeMethods.length > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          {ad.tradeMethods.join(' · ')}
        </p>
      )}
    </li>
  );
}

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function PeopleMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.5 19a5.5 5.5 0 0 1 11 0M16 11.5a2.5 2.5 0 1 0 0-5M17.5 19a5 5 0 0 0-2-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
