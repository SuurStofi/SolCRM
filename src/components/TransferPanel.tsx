'use client';

import { useCallback, useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { sendSolTransfer } from '@/lib/solana/transfer';
import { explorerTxUrl, shortenAddress } from '@/lib/solana/read';
import {
  STATE_LABELS,
  isFailure,
  resumeAction,
  type FlowState,
} from '@/lib/flow/machine';
import {
  Panel,
  SectionLabel,
  ErrorNote,
  Spinner,
  Chip,
  EmptyRow,
  ExtLink,
  RefreshButton,
} from './ui';

interface FlowEvent {
  id: string;
  fromState: string | null;
  toState: string;
  note: string | null;
  createdAt: string;
}

interface Flow {
  id: string;
  state: FlowState;
  amountSol: string;
  depositAddress: string | null;
  txSignature: string | null;
  chainConfirmedAt: string | null;
  binanceCreditedAt: string | null;
  creditedAmount: string | null;
  convertQuoteId: string | null;
  usdtReceived: string | null;
  lastError: string | null;
  createdAt: string;
  events: FlowEvent[];
}

interface Quote {
  quoteId: string;
  ratio: string;
  toAmount: string;
  fromAmount: string;
  validTimestamp: number;
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

export function TransferPanel() {
  const { connection } = useConnection();
  const { publicKey, connected, sendTransaction } = useWallet();

  const [flows, setFlows] = useState<Flow[]>([]);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<{ flowId: string; quote: Quote } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setFlows(await api<Flow[]>('/api/flow/list', undefined, 'GET'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load history.');
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return refresh();
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  /** Full transfer leg: create intent -> sign in wallet -> confirm -> record. */
  const startTransfer = useCallback(async () => {
    if (!publicKey || !sendTransaction) return;
    setBusy('transfer');
    setError(null);
    let flowId: string | null = null;
    try {
      const { flow } = await api<{ flow: Flow }>('/api/flow/create', { amountSol: amount });
      flowId = flow.id;
      await refresh();

      if (!flow.depositAddress) throw new Error('No deposit address returned.');

      const { signature } = await sendSolTransfer(
        connection,
        publicKey,
        flow.depositAddress,
        amount,
        sendTransaction,
      );

      await api('/api/flow/submitted', { id: flow.id, signature });
      // Chain confirmation already happened inside sendSolTransfer.
      await api('/api/flow/check-credit', { id: flow.id, state: 'CHAIN_CONFIRMED' }, 'PATCH');
      setAmount('');
      await refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Transfer failed.';
      setError(message);
      // Record the failure so the flow does not sit in a misleading state.
      if (flowId) {
        await api('/api/flow/submitted', { id: flowId, failed: true }).catch(
          () => undefined,
        );
        await refresh();
      }
    } finally {
      setBusy(null);
    }
  }, [amount, connection, publicKey, sendTransaction, refresh]);

  const checkCredit = useCallback(
    async (flowId: string) => {
      setBusy(flowId);
      setError(null);
      try {
        const result = await api<{ credited: boolean }>('/api/flow/check-credit', {
          id: flowId,
        });
        if (!result.credited) {
          setError('Binance has not credited this deposit yet. Credit can lag by several minutes.');
        }
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Credit check failed.');
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const requestQuote = useCallback(
    async (flowId: string) => {
      setBusy(flowId);
      setError(null);
      try {
        const result = await api<{ quote: Quote }>('/api/flow/convert', {
          id: flowId,
          action: 'quote',
        });
        setQuote({ flowId, quote: result.quote });
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not get a quote.');
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const acceptQuote = useCallback(
    async (flowId: string, quoteId: string) => {
      setBusy(flowId);
      setError(null);
      try {
        await api('/api/flow/convert', { id: flowId, action: 'accept', quoteId });
        setQuote(null);
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Convert failed.');
        await refresh();
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  return (
    <Panel
      title="Transfer & Convert"
      subtitle="SOL → Binance → USDT"
      icon={<ArrowsMark />}
      action={<RefreshButton onClick={refresh} loading={busy !== null} />}
    >
      <div className="space-y-6">
        {error && <ErrorNote title="Something went wrong">{error}</ErrorNote>}

        {/* New transfer */}
        <div>
          <SectionLabel>Send SOL to Binance</SectionLabel>
          <div className="flex gap-2">
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              disabled={!connected || busy !== null}
              className="tabular w-full rounded-lg border border-border bg-surface-subtle px-3 py-2 text-sm outline-none transition placeholder:text-faint focus:border-accent disabled:opacity-50"
            />
            <button
              type="button"
              onClick={startTransfer}
              disabled={!connected || busy !== null || !amount}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
            >
              {busy === 'transfer' && <Spinner className="border-t-accent-fg" />}
              Send
            </button>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
            {connected
              ? 'You approve the transaction in your wallet. A small SOL reserve is kept for fees.'
              : 'Connect your wallet to send.'}
          </p>
        </div>

        {/* History */}
        <div>
          <SectionLabel>Recent runs</SectionLabel>
          {flows.length === 0 ? (
            <EmptyRow>No transfers yet</EmptyRow>
          ) : (
            <ul className="space-y-2.5">
              {flows.slice(0, 6).map((flow) => (
                <FlowCard
                  key={flow.id}
                  flow={flow}
                  busy={busy === flow.id}
                  quote={quote?.flowId === flow.id ? quote.quote : null}
                  onCheckCredit={() => checkCredit(flow.id)}
                  onQuote={() => requestQuote(flow.id)}
                  onAccept={(quoteId) => acceptQuote(flow.id, quoteId)}
                  onCancelQuote={() => setQuote(null)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

function FlowCard({
  flow,
  busy,
  quote,
  onCheckCredit,
  onQuote,
  onAccept,
  onCancelQuote,
}: {
  flow: Flow;
  busy: boolean;
  quote: Quote | null;
  onCheckCredit: () => void;
  onQuote: () => void;
  onAccept: (quoteId: string) => void;
  onCancelQuote: () => void;
}) {
  const failed = isFailure(flow.state);
  const resume = resumeAction(flow.state);

  return (
    <li className="rounded-lg border border-border bg-surface-subtle px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="tabular text-sm font-semibold">{flow.amountSol} SOL</span>
            <Chip tone={failed ? 'bad' : flow.state === 'CONVERTED' ? 'good' : 'accent'}>
              {STATE_LABELS[flow.state]}
            </Chip>
          </div>
          <p className="mt-0.5 text-[11px] text-faint">
            {new Date(flow.createdAt).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>
        {flow.txSignature && (
          <ExtLink href={explorerTxUrl(flow.txSignature)} mono>
            {shortenAddress(flow.txSignature, 4)}
          </ExtLink>
        )}
      </div>

      {/* On-chain and Binance credit shown separately: credit lags the chain,
          and conflating them would imply funds are tradeable before they are. */}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <StepChip done={!!flow.chainConfirmedAt} label="on-chain" />
        <StepChip done={!!flow.binanceCreditedAt} label="credited" />
        <StepChip done={!!flow.usdtReceived} label="converted" />
        {flow.usdtReceived && (
          <Chip tone="good">{flow.usdtReceived} USDT</Chip>
        )}
      </div>

      {flow.lastError && (
        <p className="mt-2 text-[11px] leading-relaxed text-bad">{flow.lastError}</p>
      )}

      {/* Quote confirmation: the accept step is irreversible, so it is never
          triggered by the same click that fetched the rate. */}
      {quote && (
        <div className="mt-3 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2.5">
          <p className="text-xs">
            <span className="font-semibold">{quote.fromAmount} SOL</span> →{' '}
            <span className="font-semibold">{quote.toAmount} USDT</span>
            <span className="ml-1.5 text-faint">@ {quote.ratio}</span>
          </p>
          <p className="mt-1 text-[11px] text-faint">
            This executes immediately and cannot be undone.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => onAccept(quote.quoteId)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
            >
              {busy && <Spinner className="border-t-accent-fg" />}
              Confirm convert
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

      {!quote && resume && (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={
              flow.state === 'BINANCE_CREDITED' || flow.state === 'CONVERT_FAILED'
                ? onQuote
                : onCheckCredit
            }
            disabled={busy || flow.state === 'CHAIN_FAILED'}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:border-border-strong disabled:opacity-40"
          >
            {busy && <Spinner />}
            {resume}
          </button>
        </div>
      )}
    </li>
  );
}

function StepChip({ done, label }: { done: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
        done
          ? 'border-good/25 bg-good-bg text-good'
          : 'border-border bg-surface text-faint'
      }`}
    >
      <span
        className={`h-1 w-1 rounded-full ${done ? 'bg-good' : 'bg-faint'}`}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

function ArrowsMark() {
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
