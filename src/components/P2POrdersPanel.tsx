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
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not archive the order.');
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
      title="P2P orders"
      subtitle="Your own record · not synced from Binance"
      icon={<LedgerMark />}
      action={<RefreshButton onClick={refresh} loading={loading} />}
    >
      <div className="space-y-5">
        {error && <ErrorNote title="Something went wrong">{error}</ErrorNote>}

        <div>
          <SectionLabel>Archive an order</SectionLabel>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Field label="Order number" className="col-span-2 sm:col-span-1">
              <input {...field('orderNumber')} placeholder="from Binance" className={inputClass} />
            </Field>
            <Field label="Fiat">
              <input
                value={draft.fiat}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, fiat: event.target.value.toUpperCase() }))
                }
                className={inputClass}
              />
            </Field>
            <Field label="Side">
              <select {...field('tradeType')} className={inputClass}>
                <option value="SELL">Sell</option>
                <option value="BUY">Buy</option>
              </select>
            </Field>
            <Field label="Amount">
              <input {...field('amount')} inputMode="decimal" className={inputClass} />
            </Field>
            <Field label="Price">
              <input {...field('price')} inputMode="decimal" className={inputClass} />
            </Field>
            <Field label="Counterparty">
              <input {...field('counterpartyName')} className={inputClass} />
            </Field>
            <Field label="Ad number" className="col-span-2 sm:col-span-3">
              <input {...field('adNo')} placeholder="optional" className={inputClass} />
            </Field>
            <Field label="Notes" className="col-span-2 sm:col-span-3">
              <textarea
                {...field('notes')}
                rows={2}
                placeholder="Payment quirks, delays, anything worth remembering"
                className={`${inputClass} h-auto py-2`}
              />
            </Field>
          </div>

          <button
            type="button"
            onClick={save}
            disabled={saving || draft.orderNumber.trim() === '' || draft.fiat.trim() === ''}
            className="mt-2 inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
          >
            {saving && <Spinner className="border-t-accent-fg" />}
            Archive order
          </button>
        </div>

        <div>
          <SectionLabel>Archived</SectionLabel>
          {orders.length === 0 ? (
            <EmptyRow>
              {loading ? 'Loading…' : 'No orders archived yet.'}
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
          <span className="font-mono text-xs font-semibold">{order.orderNumber}</span>
          <p className="tabular mt-0.5 text-[11px] text-faint">
            {order.tradeType === 'SELL' ? 'Sold' : 'Bought'}
            {order.amount ? ` ${order.amount} ${order.asset}` : ` ${order.asset}`}
            {order.price ? ` @ ${order.price} ${order.fiat}` : ''}
            {' · '}
            {new Date(order.createdAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <Chip tone={tone}>{order.status.toLowerCase()}</Chip>
          <select
            value={order.status}
            onChange={(event) => onStatus(order.id, event.target.value as Status)}
            aria-label="Change status"
            className="h-[26px] rounded-md border border-border bg-surface px-1.5 text-[11px] text-muted outline-none transition hover:border-border-strong"
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.toLowerCase()}
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
