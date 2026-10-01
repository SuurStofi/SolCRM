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
import { Segmented } from './market-ui';

interface Advertiser {
  nickName: string;
  userType: string;
  monthOrderCount: number;
  monthFinishRate: number;
  positiveRate: number;
  advertiserNo: string | null;
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
  /** Merchant page when known, else the ad itself. */
  link: string;
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
      title="Find an offer"
      subtitle="Real people on Binance P2P · best price first"
      icon={<PeopleMark />}
    >
      <div className="space-y-5">
        {error && <ErrorNote title="Could not search">{error}</ErrorNote>}

        <div className="space-y-3">
          <Field label="I want to">
            <Segmented
              value={tradeType}
              onChange={setTradeType}
              options={[
                { id: 'SELL', label: `Sell ${asset || 'crypto'}` },
                { id: 'BUY', label: `Buy ${asset || 'crypto'}` },
              ]}
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Crypto">
              <input
                value={asset}
                onChange={(event) => setAsset(event.target.value.toUpperCase())}
                list="p2p-assets"
                placeholder="USDT"
                className={inputClass}
              />
              <datalist id="p2p-assets">
                {['USDT', 'SOL', 'BTC', 'ETH', 'USDC'].map((code) => (
                  <option key={code} value={code} />
                ))}
              </datalist>
            </Field>
            <Field label="Paid in (your money)">
              <input
                value={fiat}
                onChange={(event) => setFiat(event.target.value.toUpperCase())}
                list="p2p-fiats"
                placeholder="UAH"
                className={inputClass}
              />
              <datalist id="p2p-fiats">
                {['UAH', 'USD', 'EUR', 'KZT', 'PLN', 'GEL', 'TRY'].map((code) => (
                  <option key={code} value={code} />
                ))}
              </datalist>
            </Field>
            <Field label={`Amount, ${asset || 'crypto'} (optional)`}>
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                placeholder="any amount"
                className={inputClass}
              />
            </Field>
            <Field label="Bank or payment app (optional)">
              <input
                value={payMethod}
                onChange={(event) => setPayMethod(event.target.value)}
                placeholder="e.g. Monobank"
                className={inputClass}
              />
            </Field>
          </div>

          <button
            type="button"
            onClick={search}
            disabled={loading || !asset.trim() || !fiat.trim()}
            className="inline-flex h-[36px] w-full items-center justify-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
          >
            {loading && <Spinner className="border-t-accent-fg" />}
            <span>Show offers</span>
          </button>
        </div>

        {result && (
          <div>
            <SectionLabel
              trailing={
                <ExtLink href={result.boardUrl}>Open on Binance</ExtLink>
              }
            >
              {result.ads.length > 0 ? `${result.ads.length} offers` : 'Results'}
            </SectionLabel>

            {result.ads.length > 0 ? (
              <>
                <ul className="space-y-2">
                  {result.ads.map((ad, index) => (
                    <AdCard key={ad.adNo} ad={ad} best={index === 0} />
                  ))}
                </ul>
                {/* Measured, not assumed: the endpoint ignores page and rows
                    alike, so this really is everything it will ever return. */}
                <p className="mt-2 text-[11px] leading-relaxed text-faint">
                  Binance shows at most 10 offers. To see others, enter an amount or a bank.
                </p>
              </>
            ) : (
              <EmptyRow>
                No offers for {asset} in {fiat}. Check the currency code (for example UAH, USD,
                EUR). Some currencies, such as RUB, are not available at all.
              </EmptyRow>
            )}
          </div>
        )}

        <p className="border-t border-border pt-3 text-[11px] leading-relaxed text-faint">
          The deal itself happens in the Binance app: Binance does not let other apps start
          one for you. Press <b>Open on Binance</b> on an offer, trade there, then save the
          deal in My deals if you want a record.
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

function AdCard({ ad, best }: { ad: Ad; best: boolean }) {
  const advertiser = ad.advertiser;
  // Completion rate is the number that predicts a wasted hour, so it decides
  // whether the advertiser reads as reliable.
  const reliable =
    advertiser !== null && advertiser.monthFinishRate >= 0.95 && advertiser.positiveRate >= 0.95;

  return (
    <li
      className={`rounded-lg border bg-surface-subtle px-3.5 py-3 ${
        best ? 'border-good/40' : 'border-border'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="tabular text-base font-semibold">
              1 {ad.asset} = {ad.fiatSymbol || ''}
              {ad.price} {ad.fiat}
            </span>
            {best && <Chip tone="good">best price</Chip>}
          </div>
          <p className="tabular mt-1 text-[11px] leading-relaxed text-muted">
            One deal: {ad.minTransAmount}–{ad.maxTransAmount} {ad.asset} · available{' '}
            {ad.tradableAmount} {ad.asset} · payment within {ad.payTimeLimit} min
          </p>
        </div>
        <a
          href={ad.link}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-[30px] shrink-0 items-center rounded-md bg-accent px-2.5 text-xs font-medium text-accent-fg transition hover:brightness-110"
        >
          Open on Binance
        </a>
      </div>

      {advertiser && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <ExtLink href={ad.link}>
            <span className="text-xs font-medium">{advertiser.nickName}</span>
          </ExtLink>
          <Chip tone={reliable ? 'good' : 'warn'}>{reliable ? 'reliable' : 'check reviews'}</Chip>
          {advertiser.userType === 'merchant' && <Chip tone="accent">verified merchant</Chip>}
          <span className="text-[11px] text-faint">
            {advertiser.monthOrderCount} deals this month · {percent(advertiser.monthFinishRate)}{' '}
            finished · {percent(advertiser.positiveRate)} good reviews
          </span>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {ad.tradeMethods.length > 0 ? (
          <p className="text-[11px] leading-relaxed text-muted">
            <span className="text-faint">Payment: </span>
            {ad.tradeMethods.join(' · ')}
          </p>
        ) : (
          <span />
        )}
        <span className="flex items-center gap-0.5 text-[10px] text-faint">
          ad no. <span className="font-mono">{ad.adNo.slice(0, 6)}…</span>
          <CopyButton value={ad.adNo} />
        </span>
      </div>
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
