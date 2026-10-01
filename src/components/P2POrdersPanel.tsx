'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Panel,
  SectionLabel,
  ErrorNote,
  Spinner,
  Chip,
  EmptyRow,
  RefreshButton,
} from './ui';

const STATUSES = ['PENDING', 'PAID', 'COMPLETED', 'CANCELLED', 'DISPUTED'] as const;
type Status = (typeof STATUSES)[number];

/** What each status means in everyday words. */
const STATUS_LABELS: Record<Status, string> = {
  PENDING: 'waiting for payment',
  PAID: 'paid, not released',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  DISPUTED: 'in dispute',
};

const STATUS_TONES: Record<Status, 'neutral' | 'good' | 'warn' | 'bad' | 'accent'> = {
  PENDING: 'warn',
  PAID: 'accent',
  COMPLETED: 'good',
  CANCELLED: 'neutral',
  DISPUTED: 'bad',
};

interface Order {
  id: string;
  orderNumber: string;
  adNo: string | null;
  asset: string;
  fiat: string;
  tradeType: string;
  amount: string | null;
  price: string | null;
  payMethod: string | null;
  counterpartyName: string | null;
  status: string;
  statusFromBinance: boolean;
  notes: string | null;
  createdAt: string;
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

const EMPTY_DRAFT = {
  orderNumber: '',
  fiat: 'USD',
  tradeType: 'SELL',
  amount: '',
  price: '',
  adNo: '',
  counterpartyName: '',
  notes: '',
};

export function P2POrdersPanel() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setOrders(await api<Order[]>('/api/p2p/orders', undefined, 'GET'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load orders.');
    } finally {
      setLoading(false);
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

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      // Empty optional fields are dropped rather than sent as "", which the
      // route would otherwise have to tell apart from a real value.
      const payload = Object.fromEntries(
        Object.entries(draft).filter(([, value]) => value.trim() !== ''),
      );
      await api('/api/p2p/orders', payload);
      setDraft(EMPTY_DRAFT);
      setDetails(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the deal.');
    } finally {
      setSaving(false);
    }
  }, [draft, refresh]);

  const setStatus = useCallback(
    async (id: string, status: Status) => {
      setError(null);
      try {
        await api('/api/p2p/orders', { id, status }, 'PATCH');
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not update the status.');
      }
    },
    [refresh],
  );

  const field = (key: keyof typeof EMPTY_DRAFT) => ({
    value: draft[key],
    onChange: (event: { target: { value: string } }) =>
      setDraft((current) => ({ ...current, [key]: event.target.value })),
  });

  return (
    <Panel
      title="My deals"
      subtitle="Your private notebook · Binance does not fill it in"
      icon={<LedgerMark />}
      action={<RefreshButton onClick={refresh} loading={loading} />}
    >
      <div className="space-y-5">
        {error && <ErrorNote title="Something went wrong">{error}</ErrorNote>}

        <div>
          <SectionLabel>Save a deal</SectionLabel>
          <p className="mb-2.5 text-[11px] leading-relaxed text-faint">
            After a deal on Binance, copy its order number here to keep track of it. Only you
            see this list.
          </p>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Field label="Order number (from Binance)" className="col-span-2 sm:col-span-3">
              <input
                {...field('orderNumber')}
                placeholder="e.g. 22612345678901234567"
                className={inputClass}
              />
            </Field>
            <Field label="Deal type">
              <select {...field('tradeType')} className={inputClass}>
                <option value="SELL">I sold</option>
                <option value="BUY">I bought</option>
              </select>
            </Field>
            <Field label="How much (crypto)">
              <input {...field('amount')} inputMode="decimal" placeholder="optional" className={inputClass} />
            </Field>
            <Field label="Currency">
              <input
                value={draft.fiat}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, fiat: event.target.value.toUpperCase() }))
                }
                className={inputClass}
              />
            </Field>
          </div>

          {details ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label={`Price for 1 coin, ${draft.fiat || 'currency'}`}>
                <input {...field('price')} inputMode="decimal" className={inputClass} />
              </Field>
              <Field label="Other person's name">
                <input {...field('counterpartyName')} className={inputClass} />
              </Field>
              <Field label="Offer (ad) number" className="col-span-2">
                <input {...field('adNo')} className={inputClass} />
              </Field>
              <Field label="Notes" className="col-span-2">
                <textarea
                  {...field('notes')}
                  rows={2}
                  placeholder="Late payment, wrong name on the card, anything worth remembering"
                  className={`${inputClass} h-auto py-2`}
                />
              </Field>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setDetails(true)}
              className="mt-2 text-[11px] font-medium text-muted underline-offset-2 transition hover:text-foreground hover:underline"
            >
              + Add price, name or notes
            </button>
          )}

          <div className="mt-3">
            <button
              type="button"
              onClick={save}
              disabled={saving || draft.orderNumber.trim() === '' || draft.fiat.trim() === ''}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
            >
              {saving && <Spinner className="border-t-accent-fg" />}
              <span>Save deal</span>
            </button>
          </div>
        </div>

        <div>
          <SectionLabel>Saved deals</SectionLabel>
          {orders.length === 0 ? (
            <EmptyRow>
              {loading ? 'Loading…' : 'Nothing saved yet.'}
            </EmptyRow>
          ) : (
            <ul className="space-y-2">
              {orders.map((order) => (
                <OrderCard key={order.id} order={order} onStatus={setStatus} />
              ))}
            </ul>
          )}
        </div>
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

function OrderCard({
  order,
  onStatus,
}: {
  order: Order;
  onStatus: (id: string, status: Status) => void;
}) {
  const tone = STATUS_TONES[order.status as Status] ?? 'neutral';

  return (
    <li className="rounded-lg border border-border bg-surface-subtle px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="tabular text-sm font-semibold">
            {order.tradeType === 'SELL' ? 'Sold' : 'Bought'}
            {order.amount ? ` ${order.amount} ${order.asset}` : ` ${order.asset}`}
          </span>
          <p className="tabular mt-0.5 text-[11px] text-faint">
            {order.price ? `1 ${order.asset} = ${order.price} ${order.fiat} · ` : ''}
            order <span className="font-mono">{order.orderNumber}</span>
            {' · '}
            {new Date(order.createdAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <Chip tone={tone}>{STATUS_LABELS[order.status as Status] ?? order.status.toLowerCase()}</Chip>
          <select
            value={order.status}
            onChange={(event) => onStatus(order.id, event.target.value as Status)}
            aria-label="Change status"
            title="Change status"
            className="h-[26px] rounded-md border border-border bg-surface px-1.5 text-[11px] text-muted outline-none transition hover:border-border-strong"
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </span>
      </div>

      {order.counterpartyName && (
        <p className="mt-1.5 text-[11px] text-muted">with {order.counterpartyName}</p>
      )}
      {order.notes && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{order.notes}</p>
      )}
    </li>
  );
}

function LedgerMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M5 4h11l3 3v13H5V4Zm3 5h7M8 13h7M8 17h4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
