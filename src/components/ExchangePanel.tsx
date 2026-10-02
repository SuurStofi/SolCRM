'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Panel,
  SectionLabel,
  ErrorNote,
  Chip,
  EmptyRow,
  ExtLink,
  RefreshButton,
  Skeleton,
} from './ui';
import {
  advantage,
  cryptoLabel,
  fetchJson,
  Field,
  FilterGroup,
  inputClass,
  money,
  onMount,
  SideAndCrypto,
  unitOf,
  type CryptoId,
  type Side,
} from './market-ui';

interface Rail {
  id: number;
  name: string;
  code: string;
  fiat: string | null;
  group: string;
  system: string;
  variant: string;
  best: number | null;
  count: number;
}

interface Offer {
  changerId: number;
  changerName: string;
  price: number;
  effectivePrice: number | null;
  minFiat: number | null;
  maxFiat: number | null;
  marks: string[];
  rating: number | null;
  positiveReviews: number;
  claims: number;
  url: string;
  infoUrl: string | null;
}

interface BinanceReference {
  fiat: string;
  minUnits: number;
  spotSolUsdt: number | null;
  bestP2P: number | null;
  bestUsdtRoute: number | null;
  boardUrl: string;
  errors: string[];
}

interface OffersResult {
  rail: Rail;
  offers: Offer[];
  binance: BinanceReference | null;
  listingUrl: string;
}

/** One payment system with its currency variants, as BestChange lists it. */
interface SystemEntry {
  system: string;
  group: string;
  rails: Rail[];
  count: number;
}

/** BestChange's marks, in words a trader cares about. */
const MARKS: Record<string, { label: string; tone: 'warn' | 'neutral' }> = {
  manual: { label: 'manual', tone: 'warn' },
  verifying: { label: 'may ask for KYC', tone: 'warn' },
  cardverify: { label: 'card check', tone: 'warn' },
  reg: { label: 'registration', tone: 'neutral' },
  floating: { label: 'rate not fixed', tone: 'warn' },
  percent: { label: 'extra fee', tone: 'warn' },
  unstable: { label: 'rate jumped', tone: 'warn' },
  delay: { label: 'delayed', tone: 'warn' },
  otherin: { label: 'third-party pay-in', tone: 'neutral' },
  otherout: { label: 'third-party payout', tone: 'neutral' },
  official: { label: 'company transfer', tone: 'neutral' },
  card2card: { label: 'card-to-card', tone: 'neutral' },
  purse: { label: 'wallet, needs account', tone: 'neutral' },
};

/** Systems people look for first get pinned to the top, like on BestChange. */
const POPULAR = ['Bank card', 'PayPal', 'WebMoney', 'YooMoney', 'Volet', 'Alipay', 'Wise', 'Revolut'];

export function ExchangePanel() {
  const [side, setSide] = useState<Side>('sell');
  const [crypto, setCrypto] = useState<CryptoId>('SOL');
  const [rails, setRails] = useState<Rail[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [group, setGroup] = useState('');
  const [fiat, setFiat] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Rail | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ crypto, side });
      const data = await fetchJson<{ configured: boolean; rails: Rail[] }>(
        `/api/exchange/rails?${params.toString()}`,
      );
      setConfigured(data.configured);
      setRails(data.rails);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load dealers.');
    } finally {
      setLoading(false);
    }
  }, [crypto, side]);

  useEffect(() => onMount(load), [load]);

  const groups = useMemo(() => [...new Set((rails ?? []).map((r) => r.group))].sort(), [rails]);
  const fiats = useMemo(
    () => [...new Set((rails ?? []).map((r) => r.fiat).filter((f): f is string => !!f))].sort(),
    [rails],
  );

  const systems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const bySystem = new Map<string, SystemEntry>();
    for (const rail of rails ?? []) {
      if (group && rail.group !== group) continue;
      if (fiat && rail.fiat !== fiat) continue;
      if (
        needle &&
        !`${rail.name} ${rail.code} ${rail.system}`.toLowerCase().includes(needle)
      ) {
        continue;
      }
      const entry = bySystem.get(rail.system) ?? {
        system: rail.system,
        group: rail.group,
        rails: [],
        count: 0,
      };
      entry.rails.push(rail);
      entry.count += rail.count;
      bySystem.set(rail.system, entry);
    }
    const rank = (s: SystemEntry) => {
      const i = POPULAR.indexOf(s.system);
      return i === -1 ? POPULAR.length : i;
    };
    return [...bySystem.values()]
      .map((entry) => ({
        ...entry,
        rails: entry.rails.sort((a, b) => b.count - a.count || a.variant.localeCompare(b.variant)),
      }))
      .sort((a, b) => rank(a) - rank(b) || b.count - a.count);
  }, [rails, group, fiat, query]);

  if (selected) {
    return (
      <OffersView
        rail={selected}
        side={side}
        crypto={crypto}
        onBack={() => setSelected(null)}
      />
    );
  }

  const verb = side === 'sell' ? 'You receive' : 'You pay with';

  return (
    <Panel
      title="Dealer"
      subtitle={`${side === 'sell' ? 'Sell' : 'Buy'} ${cryptoLabel(crypto)} · e-money, bank accounts and cards · via BestChange`}
      icon={<SwapMark />}
      action={configured ? <RefreshButton onClick={() => void load()} loading={loading} /> : undefined}
    >
      <div className="space-y-5">
        {error && <ErrorNote title="Could not load BestChange">{error}</ErrorNote>}

        {!configured ? (
          <SetupNote />
        ) : (
          <>
            {/* Two groups rather than five flat fields: the first decides what
                is being traded and reloads the rails, the second only narrows
                the list that comes back. */}
            <div className="grid gap-3 lg:grid-cols-[auto_1fr]">
              <FilterGroup title="Trade">
                <div className="flex flex-wrap items-end gap-3">
                  <SideAndCrypto
                    side={side}
                    crypto={crypto}
                    onSide={(next) => {
                      setSide(next);
                      setRails(null);
                    }}
                    onCrypto={(next) => {
                      setCrypto(next);
                      setRails(null);
                    }}
                  />
                </div>
              </FilterGroup>

              <FilterGroup title="Narrow down" hint="optional">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Field label="Search">
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="PayPal, Sberbank, card…"
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Currency">
                    <select
                      value={fiat}
                      onChange={(e) => setFiat(e.target.value)}
                      className={inputClass}
                    >
                      <option value="">Any currency</option>
                      {fiats.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Type">
                    <select
                      value={group}
                      onChange={(e) => setGroup(e.target.value)}
                      className={inputClass}
                    >
                      <option value="">E-money, banks and cards</option>
                      {groups.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </FilterGroup>
            </div>

            <div>
              <SectionLabel>
                {rails ? `${verb} · ${systems.length} payment systems` : 'Payment systems'}
              </SectionLabel>

              {!rails ? (
                <div className="space-y-2">
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                </div>
              ) : systems.length === 0 ? (
                <EmptyRow>No dealer offers that right now.</EmptyRow>
              ) : (
                <ul className="divide-y divide-border/60">
                  {systems.map((entry) => (
                    <li key={entry.system} className="py-2.5">
                      <div className="mb-1.5 flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium">{entry.system}</span>
                        <span className="text-[11px] text-faint">
                          {entry.group} · {entry.count} offers
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {entry.rails.map((rail) => (
                          <button
                            key={rail.id}
                            type="button"
                            onClick={() => setSelected(rail)}
                            title={`${rail.name} · ${rail.count} dealers`}
                            className="inline-flex items-baseline gap-1.5 rounded-md border border-border bg-surface-subtle px-2 py-1 text-xs transition hover:border-accent hover:text-foreground"
                          >
                            <span className="font-semibold">{rail.variant}</span>
                            {rail.best !== null && (
                              <span className="tabular text-faint">
                                {money(rail.best)}
                                {rail.fiat && rail.fiat !== rail.variant ? ` ${rail.fiat}` : ''}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="border-t border-border pt-3 text-[11px] leading-relaxed text-faint">
              Prices are per 1 {unitOf(crypto)}, best dealer first. Pick a currency to see every
              dealer and how it compares with Binance. The exchange itself happens on the
              dealer&apos;s site — this app only finds it.
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}

function OffersView({
  rail,
  side,
  crypto,
  onBack,
}: {
  rail: Rail;
  side: Side;
  crypto: CryptoId;
  onBack: () => void;
}) {
  const [result, setResult] = useState<OffersResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ crypto, side, rail: String(rail.id) });
      setResult(await fetchJson<OffersResult>(`/api/exchange/offers?${params.toString()}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load offers.');
    } finally {
      setLoading(false);
    }
  }, [crypto, side, rail.id]);

  useEffect(() => onMount(load), [load]);

  const fiat = rail.fiat ?? rail.code;
  const unit = unitOf(crypto);
  const parsed = Number(amount);
  const units = amount.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : null;

  const binance = result?.binance ?? null;
  const references = [binance?.bestP2P, binance?.bestUsdtRoute].filter(
    (p): p is number => typeof p === 'number',
  );
  const binanceBest =
    references.length === 0 ? null : side === 'sell' ? Math.max(...references) : Math.min(...references);

  return (
    <Panel
      title={rail.name}
      subtitle={`${side === 'sell' ? 'Sell' : 'Buy'} ${cryptoLabel(crypto)} · ${
        side === 'sell' ? 'receive' : 'pay with'
      } ${rail.system} ${rail.variant}`}
      icon={<SwapMark />}
      action={
        <div className="flex gap-2">
          <RefreshButton onClick={() => void load()} loading={loading} />
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-[34px] items-center rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-muted transition hover:border-border-strong hover:text-foreground"
          >
            ← Payment systems
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && <ErrorNote title="Could not load offers">{error}</ErrorNote>}

        <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
          <Field label={`Amount to ${side}, ${unit}`}>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="optional"
              className={inputClass}
            />
          </Field>

          <BinanceCard
            reference={binance}
            fiat={rail.fiat}
            unit={unit}
            side={side}
            crypto={crypto}
            loading={!result && loading}
          />
        </div>

        <div>
          <SectionLabel
            trailing={result ? <ExtLink href={result.listingUrl}>Open on BestChange</ExtLink> : undefined}
          >
            {result ? `${result.offers.length} dealers, best first` : 'Dealers'}
          </SectionLabel>

          {!result ? (
            loading ? (
              <div className="space-y-2">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : null
          ) : result.offers.length === 0 ? (
            <EmptyRow>No dealer is offering this right now.</EmptyRow>
          ) : (
            <ul className="space-y-2">
              {result.offers.map((offer) => (
                <OfferCard
                  key={offer.changerId}
                  offer={offer}
                  fiat={fiat}
                  unit={unit}
                  side={side}
                  units={units}
                  binanceBest={binanceBest}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

function BinanceCard({
  reference,
  fiat,
  unit,
  side,
  crypto,
  loading,
}: {
  reference: BinanceReference | null;
  fiat: string | null;
  unit: string;
  side: Side;
  crypto: CryptoId;
  loading: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-subtle px-3.5 py-2.5">
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-faint">
        Binance P2P, per 1 {unit}
      </p>
      {loading ? (
        <Skeleton className="h-8" />
      ) : !fiat ? (
        <p className="text-xs text-muted">
          This payment method has no ISO currency, so there is no Binance price to set beside it.
        </p>
      ) : !reference ? null : (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              <span className="text-xs text-muted">{unit} directly: </span>
              <span className="tabular font-semibold">
                {reference.bestP2P !== null ? `${money(reference.bestP2P)} ${fiat}` : 'no ads'}
              </span>
            </span>
            {crypto === 'SOL' && (
              <span>
                <span className="text-xs text-muted">
                  {side === 'sell' ? 'Convert → USDT → P2P' : 'P2P USDT → Convert'}:{' '}
                </span>
                <span className="tabular font-semibold">
                  {reference.bestUsdtRoute !== null
                    ? `${money(reference.bestUsdtRoute)} ${fiat}`
                    : 'no ads'}
                </span>
              </span>
            )}
          </div>
          {reference.errors.length > 0 && (
            <p className="mt-1 text-[11px] text-bad">{reference.errors.join(' · ')}</p>
          )}
          <p className="mt-1 text-[11px] text-faint">
            Best ad on each route that takes at least {reference.minUnits} {unit}
            {reference.spotSolUsdt !== null && ` · spot SOL/USDT ${money(reference.spotSolUsdt)}`}
            {' · '}
            <ExtLink href={reference.boardUrl}>P2P board</ExtLink>
          </p>
        </>
      )}
    </div>
  );
}

function OfferCard({
  offer,
  fiat,
  unit,
  side,
  units,
  binanceBest,
}: {
  offer: Offer;
  fiat: string;
  unit: string;
  side: Side;
  units: number | null;
  binanceBest: number | null;
}) {
  const total = units !== null ? units * offer.price : null;
  const tooSmall = total !== null && offer.minFiat !== null && total < offer.minFiat;
  const tooBig = total !== null && offer.maxFiat !== null && total > offer.maxFiat;
  const diff = binanceBest !== null ? advantage(offer.price, binanceBest, side) : null;

  return (
    <li
      className={`rounded-lg border border-border bg-surface-subtle px-3.5 py-3 ${
        tooSmall || tooBig ? 'opacity-55' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="tabular text-sm font-semibold">
            {money(offer.price)} {fiat}
          </span>
          <span className="text-xs text-muted"> per {unit}</span>
          {diff !== null && <DiffChip diff={diff} />}
          {offer.effectivePrice !== null &&
            Math.abs(offer.effectivePrice / offer.price - 1) > 0.001 && (
              <p className="tabular mt-0.5 text-[11px] text-faint">
                {money(offer.effectivePrice)} {fiat} after known fees (on a $300 exchange)
              </p>
            )}
          <p className="tabular mt-0.5 text-[11px] text-faint">{limitText(offer, fiat)}</p>
          {total !== null && (
            <p className="tabular mt-0.5 text-xs">
              {tooSmall
                ? `Below this dealer's minimum of ${money(offer.minFiat!)} ${fiat}`
                : tooBig
                  ? `Above what this dealer can take (${money(offer.maxFiat!)} ${fiat})`
                  : side === 'sell'
                    ? `You receive ≈ ${money(total)} ${fiat}`
                    : `You pay ≈ ${money(total)} ${fiat}`}
            </p>
          )}
        </div>
        <a
          href={offer.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-[30px] shrink-0 items-center rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg transition hover:brightness-110"
        >
          Exchange
        </a>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {offer.infoUrl ? (
          <ExtLink href={offer.infoUrl}>
            <span className="text-xs font-medium">{offer.changerName}</span>
          </ExtLink>
        ) : (
          <span className="text-xs font-medium">{offer.changerName}</span>
        )}
        <Chip tone={offer.claims === 0 ? 'good' : 'warn'}>
          {offer.positiveReviews} positive · {offer.claims} claims
        </Chip>
        {offer.marks.map((mark) => {
          const known = MARKS[mark];
          return known ? (
            <Chip key={mark} tone={known.tone}>
              {known.label}
            </Chip>
          ) : null;
        })}
      </div>
    </li>
  );
}

function DiffChip({ diff }: { diff: number }) {
  const text = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}% vs Binance`;
  return (
    <span className="ml-2 align-middle">
      <Chip tone={diff >= 0 ? 'good' : 'bad'}>{text}</Chip>
    </span>
  );
}

function limitText(offer: Offer, fiat: string): string {
  const min = offer.minFiat !== null ? money(offer.minFiat) : null;
  const max = offer.maxFiat !== null ? money(offer.maxFiat) : null;
  if (min && max) return `${min}–${max} ${fiat} per exchange`;
  if (min) return `from ${min} ${fiat}`;
  if (max) return `up to ${max} ${fiat}`;
  return 'no stated limits';
}

function SetupNote() {
  return (
    <div className="rounded-lg border border-warn/30 bg-warn-bg px-3.5 py-3 text-sm text-warn">
      <p className="mb-1 font-semibold">BestChange is not connected</p>
      <div className="space-y-1.5 text-xs leading-relaxed">
        <p>
          BestChange only serves rates to partners. Get a free API key at{' '}
          <span className="font-mono">bestchange.com/partner</span> (Profile → API to get exchange
          rates), then add it to <span className="font-mono">.env.local</span> on the server:
        </p>
        <p className="font-mono">BESTCHANGE_API_KEY=your_32_character_key</p>
        <p>Restart the server afterwards. The Compare tab still shows Binance meanwhile.</p>
      </div>
    </div>
  );
}

function SwapMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
