'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { explorerTxUrl, shortenAddress } from '@/lib/solana/read';
import { BUY_STATE_LABELS, isBuyFailure, type BuyState } from '@/lib/buy/machine';
import { useAuth } from './AuthProvider';
import {
  Panel,
  SectionLabel,
  ErrorNote,
  Spinner,
  Chip,
  EmptyRow,
  ExtLink,
  RefreshButton,
  ShowMore,
  useSecondsLeft,
} from './ui';

/** Purchases shown before the list has to be expanded. */
const BUY_PREVIEW = 6;

interface Buy {
  id: string;
  state: BuyState;
  usdtAmount: string;
  convertOrderId: string | null;
  solReceived: string | null;
  destination: string | null;
  withdrawAmount: string | null;
  withdrawFee: string | null;
  withdrawTxId: string | null;
  lastError: string | null;
  createdAt: string;
}

interface Quote {
  quoteId: string;
  ratio: string;
  toAmount: string;
  fromAmount: string;
  validForMs: number;
}

interface ActiveQuote {
  flowId: string;
  quote: Quote;
  /** Browser-clock deadline derived from the server-measured lifetime. */
  expiresAt: number;
}

interface BuyInfo {
  usdtFree: string;
  solFree: string;
  minUsdt: string;
  withdraw: { withdrawEnable: boolean; withdrawFee: string; withdrawMin: string } | null;
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
 * Buy SOL with USDT on the user's own Binance account. With auto-withdraw on
 * (Account panel), the SOL is then withdrawn to a linked wallet; with it off,
 * it stays on Binance.
 */
export function BuyPanel() {
  const { publicKey } = useWallet();
  const { account } = useAuth();
  const hasKey = Boolean(account?.binance);
  const autoWithdraw = account?.autoWithdraw ?? false;
  const keyVersion = account?.binance?.updatedAt ?? null;

  const [buys, setBuys] = useState<Buy[]>([]);
  const [info, setInfo] = useState<BuyInfo | null>(null);
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState<string | null>(null);
  const [quote, setQuote] = useState<ActiveQuote | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  // Default destination: the connected wallet if it is linked, else the first.
  const wallets = account?.wallets ?? [];
  const connected = publicKey?.toBase58() ?? null;
  const defaultDestination =
    wallets.find((w) => w.address === connected)?.address ?? wallets[0]?.address ?? null;
  const chosenDestination =
    destination && wallets.some((w) => w.address === destination) ? destination : defaultDestination;

  const refresh = useCallback(async () => {
    try {
      setBuys(await api<Buy[]>('/api/buy/list', undefined, 'GET'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load purchases.');
    }
  }, []);

  const loadInfo = useCallback(async () => {
    if (keyVersion === null) {
      setInfo(null);
      return;
    }
    try {
      setInfo(await api<BuyInfo>('/api/buy/info', undefined, 'GET'));
    } catch {
      // Non-fatal: the form still works, it just cannot show Max or fees.
      setInfo(null);
    }
  }, [keyVersion]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      await refresh();
      if (active) await loadInfo();
    });
    return () => {
      active = false;
    };
    // autoWithdraw is not read here, but flipping it changes what /api/buy/info
    // returns (withdrawal fees), so it has to trigger a reload.
  }, [refresh, loadInfo, autoWithdraw]);

  const amountValid = /^\d+(\.\d+)?$/.test(amount.trim()) && Number(amount) > 0;
  const overBalance = info !== null && amountValid && Number(amount) > Number(info.usdtFree);
  const underMin = info !== null && amountValid && Number(amount) < Number(info.minUsdt);
  const canQuote =
    hasKey && amountValid && !overBalance && !underMin && (!autoWithdraw || chosenDestination !== null);

  /** Runs one server action for a purchase and reloads. */
  const act = useCallback(
    async (key: string, work: () => Promise<unknown>) => {
      setBusy(key);
      setError(null);
      try {
        await work();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Something went wrong.');
      } finally {
        await refresh();
        setBusy(null);
      }
    },
    [refresh],
  );

  const startQuote = () =>
    act('new', async () => {
      const result = await api<{ quote: Quote; flow: Buy }>('/api/buy/convert', {
        action: 'quote',
        usdtAmount: amount.trim(),
        destination: autoWithdraw ? chosenDestination : undefined,
      });
      setQuote({ flowId: result.flow.id, quote: result.quote, expiresAt: Date.now() + result.quote.validForMs });
      setAmount('');
    });

  const requote = (id: string) =>
    act(id, async () => {
      const result = await api<{ quote: Quote }>('/api/buy/convert', { action: 'quote', id });
      setQuote({ flowId: id, quote: result.quote, expiresAt: Date.now() + result.quote.validForMs });
    });

  const accept = (id: string, quoteId: string) =>
    act(id, async () => {
      setQuote(null);
      await api('/api/buy/convert', { action: 'accept', id, quoteId });
      await loadInfo();
    });

  const checkOrder = (id: string) => act(id, () => api('/api/buy/convert', { action: 'status', id }));

  const withdraw = (id: string, fallback: string | null) =>
    act(id, async () => {
      await api('/api/buy/withdraw', { action: 'send', id, destination: fallback ?? undefined });
      await loadInfo();
    });

  const checkWithdraw = (id: string) => act(id, () => api('/api/buy/withdraw', { action: 'check', id }));

  return (
    <Panel
      title="Buy SOL"
      subtitle={autoWithdraw ? 'USDT → Solana → Phantom' : 'USDT → Solana · stays on Binance'}
      icon={<CartMark />}
      action={
        <RefreshButton onClick={() => void Promise.all([refresh(), loadInfo()])} loading={busy !== null} />
      }
    >
      <div className="space-y-6">
        {error && <ErrorNote title="Something went wrong">{error}</ErrorNote>}

        <BuyRoute autoWithdraw={autoWithdraw} />

        <div>
          <SectionLabel
            trailing={
              info && (
                <span className="tabular text-[11px] text-faint">
                  you have {info.usdtFree} USDT
                </span>
              )
            }
          >
            How much USDT to spend
          </SectionLabel>

          <div className="flex gap-2">
            <div
              className={`flex w-full items-center rounded-lg border bg-surface-subtle px-3 transition focus-within:border-accent ${
                overBalance || underMin || (amount.trim() !== '' && !amountValid) ? 'border-bad' : 'border-border'
              }`}
            >
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                disabled={!hasKey || busy !== null}
                className="tabular w-full bg-transparent py-2 text-sm outline-none placeholder:text-faint disabled:opacity-50"
              />
              <span className="mr-2 text-xs font-medium text-faint">USDT</span>
              <button
                type="button"
                onClick={() => info && setAmount(info.usdtFree)}
                disabled={!hasKey || busy !== null || !info || Number(info.usdtFree) <= 0}
                className="shrink-0 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-40"
              >
                Max
              </button>
            </div>
            <button
              type="button"
              onClick={() => void startQuote()}
              disabled={!canQuote || busy !== null}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
            >
              {busy === 'new' && <Spinner className="border-t-accent-fg" />}
              <span>See price</span>
            </button>
          </div>

          {autoWithdraw && wallets.length > 0 && (
            <label className="mt-2 flex items-center justify-between gap-3 text-[11px]">
              <span className="text-faint">Send the SOL to</span>
              <select
                value={chosenDestination ?? ''}
                onChange={(event) => setDestination(event.target.value)}
                disabled={busy !== null}
                className="rounded-md border border-border bg-surface-subtle px-2 py-1 font-mono text-[11px] outline-none focus:border-accent"
              >
                {wallets.map((w) => (
                  <option key={w.address} value={w.address}>
                    {shortenAddress(w.address, 6)}
                    {w.address === connected ? ' (connected)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

          {autoWithdraw && info?.withdraw && (
            <div className="mt-2 space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-faint">Binance fee to send it to your wallet</span>
                <span className="tabular text-muted">{info.withdraw.withdrawFee} SOL</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-faint">Smallest amount Binance will send</span>
                <span className="tabular text-muted">{info.withdraw.withdrawMin} SOL</span>
              </div>
            </div>
          )}

          <p className={`mt-2 text-[11px] leading-relaxed ${overBalance || underMin ? 'text-bad' : 'text-faint'}`}>
            {!hasKey
              ? 'Connect your Binance account first (My account).'
              : overBalance
                ? `Not enough USDT on Binance — ${info?.usdtFree} available.`
                : underMin
                  ? `Binance needs at least ${info?.minUsdt} USDT for this.`
                  : autoWithdraw
                    ? 'You see the price first and nothing happens until you confirm. Then the SOL is sent to the chosen wallet.'
                    : 'You see the price first and nothing happens until you confirm. The SOL stays on your Binance — to send it to your wallet automatically, turn on auto-withdraw in My account.'}
          </p>
          {autoWithdraw && info?.withdraw && !info.withdraw.withdrawEnable && (
            <p className="mt-1 text-[11px] text-warn">
              Binance has paused sending SOL out right now. What you buy will wait on Binance until it resumes.
            </p>
          )}
        </div>

        <div>
          <SectionLabel>Recent purchases</SectionLabel>
          {buys.length === 0 ? (
            <EmptyRow>No purchases yet</EmptyRow>
          ) : (
            <ul className="space-y-2.5">
              {(showAll ? buys : buys.slice(0, BUY_PREVIEW)).map((buy) => (
                <BuyCard
                  key={buy.id}
                  buy={buy}
                  busy={busy === buy.id}
                  autoWithdraw={autoWithdraw}
                  quote={quote?.flowId === buy.id ? quote : null}
                  onRequote={() => void requote(buy.id)}
                  onAccept={(quoteId) => void accept(buy.id, quoteId)}
                  onCancelQuote={() => setQuote(null)}
                  onCheckOrder={() => void checkOrder(buy.id)}
                  onWithdraw={() => void withdraw(buy.id, buy.destination ? null : chosenDestination)}
                  onCheckWithdraw={() => void checkWithdraw(buy.id)}
                />
              ))}
            </ul>
          )}
          <ShowMore
            expanded={showAll}
            total={buys.length}
            previewCount={BUY_PREVIEW}
            onToggle={() => setShowAll((current) => !current)}
          />
        </div>
      </div>
    </Panel>
  );
}

function BuyCard({
  buy,
  busy,
  autoWithdraw,
  quote,
  onRequote,
  onAccept,
  onCancelQuote,
  onCheckOrder,
  onWithdraw,
  onCheckWithdraw,
}: {
  buy: Buy;
  busy: boolean;
  autoWithdraw: boolean;
  quote: ActiveQuote | null;
  onRequote: () => void;
  onAccept: (quoteId: string) => void;
  onCancelQuote: () => void;
  onCheckOrder: () => void;
  onWithdraw: () => void;
  onCheckWithdraw: () => void;
}) {
  const secondsLeft = useSecondsLeft(quote?.expiresAt ?? null);
  const expired = quote !== null && secondsLeft <= 0;
  const failed = isBuyFailure(buy.state);
  const done = buy.state === 'WITHDRAWN' || (buy.state === 'CONVERTED' && !autoWithdraw);

  // One next step per state, so the card never offers two conflicting actions.
  let next: { label: string; run: () => void } | null = null;
  if (!quote) {
    if (buy.state === 'CONVERT_QUOTED' && buy.convertOrderId) next = { label: 'Check status', run: onCheckOrder };
    else if (buy.state === 'CONVERT_QUOTED' || buy.state === 'CONVERT_FAILED') next = { label: 'Get a new price', run: onRequote };
    else if (buy.state === 'CONVERTED' && autoWithdraw) next = { label: 'Send to my wallet', run: onWithdraw };
    else if (buy.state === 'WITHDRAW_FAILED') next = { label: 'Try sending again', run: onWithdraw };
    else if (buy.state === 'WITHDRAW_REQUESTED') next = { label: 'Check if it arrived', run: onCheckWithdraw };
  }

  return (
    <li className="rounded-lg border border-border bg-surface-subtle px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="tabular text-sm font-semibold">{buy.usdtAmount} USDT</span>
            <Chip tone={failed ? 'bad' : done ? 'good' : 'accent'}>{BUY_STATE_LABELS[buy.state]}</Chip>
          </div>
          <p className="mt-0.5 text-[11px] text-faint">
            {new Date(buy.createdAt).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
            {buy.destination && <span> · to {shortenAddress(buy.destination, 4)}</span>}
          </p>
        </div>
        {buy.withdrawTxId && (
          <ExtLink href={explorerTxUrl(buy.withdrawTxId)} mono>
            {shortenAddress(buy.withdrawTxId, 4)}
          </ExtLink>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {buy.solReceived && <Chip tone="good">{buy.solReceived} SOL bought</Chip>}
        {buy.withdrawAmount && (
          <Chip tone={buy.state === 'WITHDRAWN' ? 'good' : 'neutral'}>
            {buy.withdrawAmount} SOL sent to wallet · fee {buy.withdrawFee}
          </Chip>
        )}
      </div>

      {buy.lastError && <p className="mt-2 text-[11px] leading-relaxed text-bad">{buy.lastError}</p>}

      {/* The accept step is irreversible, so it is never the same click that
          fetched the rate. */}
      {quote && (
        <div className="mt-3 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs">
              You pay <span className="font-semibold">{quote.quote.fromAmount} USDT</span>, you
              get <span className="font-semibold">{quote.quote.toAmount} SOL</span>
            </p>
            <Chip tone={expired ? 'bad' : secondsLeft <= 10 ? 'warn' : 'accent'}>
              {expired ? 'price expired' : `price holds ${secondsLeft}s`}
            </Chip>
          </div>
          <p className="mt-1 text-[11px] text-faint">
            {expired
              ? 'This price is no longer valid. Get a new one to continue.'
              : `${solPrice(quote.quote)} Happens right away and cannot be undone${
                  autoWithdraw ? '; then the SOL is sent to your wallet.' : '.'
                }`}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={expired ? onRequote : () => onAccept(quote.quote.quoteId)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
            >
              {busy && <Spinner className="border-t-accent-fg" />}
              <span>{expired ? 'Get new price' : 'Confirm and buy'}</span>
            </button>
            <button
              type="button"
              onClick={onCancelQuote}
              disabled={busy}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition hover:text-foreground disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {next && (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={next.run}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:border-border-strong disabled:opacity-40"
          >
            {busy && <Spinner />}
            <span>{next.label}</span>
          </button>
        </div>
      )}

      {buy.state === 'CONVERTED' && !autoWithdraw && (
        <p className="mt-2 text-[11px] text-faint">
          The SOL is on your Binance. To send it to your wallet from here, turn on auto-withdraw in
          My account.
        </p>
      )}
    </li>
  );
}

/** "1 SOL = x USDT", worked out from the amounts so it reads the same way as on Sell. */
function solPrice(quote: Quote): string {
  const perSol = Number(quote.fromAmount) / Number(quote.toAmount);
  return Number.isFinite(perSol) ? `1 SOL = ${perSol.toFixed(2)} USDT.` : '';
}

/**
 * The route the money takes: USDT on Binance, converted to SOL on the Solana
 * network, then withdrawn to the Phantom wallet.
 *
 * The third stage is conditional on purpose. With auto-withdraw off the SOL
 * stays on Binance, and drawing an arrow to Phantom would promise a step that
 * never happens.
 */
function BuyRoute({ autoWithdraw }: { autoWithdraw: boolean }) {
  const stages = [
    { key: 'usdt', label: 'USDT', sub: 'on Binance' },
    { key: 'sol', label: 'SOL', sub: 'Solana network' },
    autoWithdraw
      ? { key: 'phantom', label: 'Phantom', sub: 'your wallet' }
      : { key: 'binance', label: 'Binance', sub: 'stays there' },
  ];

  return (
    <div className="flex items-stretch gap-1.5">
      {stages.map((stage, index) => (
        <div key={stage.key} className="flex flex-1 items-center gap-1.5">
          <div
            className={`flex-1 rounded-lg border px-2.5 py-2 text-center ${
              index === stages.length - 1 && !autoWithdraw
                ? 'border-border bg-surface-subtle'
                : 'border-accent/25 bg-accent/5'
            }`}
          >
            <div className="text-xs font-semibold leading-tight">{stage.label}</div>
            <div className="text-[10px] leading-tight text-faint">{stage.sub}</div>
          </div>
          {index < stages.length - 1 && (
            <span aria-hidden="true" className="shrink-0 text-faint">
              →
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function CartMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M3 4h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h7.9a1.5 1.5 0 0 0 1.5-1.1L20 8H6.2M10 20h.01M17 20h.01"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
