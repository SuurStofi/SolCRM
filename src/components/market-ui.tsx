'use client';

import type { ReactNode } from 'react';

/** Shared bits of the Dealer and Compare tabs. */

export type Side = 'sell' | 'buy';
export type CryptoId = 'SOL' | 'USDT' | 'USDC';

export const CRYPTO_OPTIONS: Array<{ id: CryptoId; label: string }> = [
  { id: 'SOL', label: 'SOL' },
  { id: 'USDT', label: 'USDT (Solana)' },
  { id: 'USDC', label: 'USDC (Solana)' },
];

export function cryptoLabel(id: CryptoId): string {
  return CRYPTO_OPTIONS.find((c) => c.id === id)?.label ?? id;
}

/** Short unit for amounts: "SOL", "USDT", "USDC". */
export function unitOf(id: CryptoId): string {
  return id;
}

/**
 * Run `load` once the effect has committed. Deferred to a microtask so its
 * setLoading(true) does not land synchronously inside the effect, as in the
 * other panels; the returned cleanup drops a load for an unmounted view.
 */
export function onMount(load: () => Promise<void>): () => void {
  let active = true;
  void Promise.resolve().then(() => {
    if (active) return load();
  });
  return () => {
    active = false;
  };
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json()) as { ok: boolean; data?: T; error?: string };
  if (!body.ok || body.data === undefined) throw new Error(body.error ?? 'Request failed');
  return body.data;
}

export function money(value: number): string {
  const digits = value >= 1000 ? 0 : value >= 1 ? 2 : 6;
  return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** Signed % of `price` against `reference`, where "better" depends on side. */
export function advantage(price: number, reference: number, side: Side): number {
  const raw = (price / reference - 1) * 100;
  return side === 'sell' ? raw : -raw;
}

export const inputClass =
  'h-[34px] w-full rounded-lg border border-border bg-surface-subtle px-2.5 text-sm outline-none transition focus:border-accent placeholder:text-faint';

export function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
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

/** Two-to-four way toggle, e.g. Sell / Buy. */
/**
 * A titled group of related controls.
 *
 * The Dealer filters were five equal-weight fields in two unlabelled rows,
 * which gave no hint that "I want to" and "Crypto" decide WHAT is traded while
 * the rest only narrow the results. Grouping them says that without a tooltip.
 */
export function FilterGroup({
  title,
  hint,
  children,
  className = '',
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset
      className={`rounded-xl border border-border bg-surface-subtle px-3.5 pb-3 pt-2.5 ${className}`}
    >
      <legend className="flex items-baseline gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {title}
        {hint && <span className="font-normal normal-case tracking-normal text-faint">{hint}</span>}
      </legend>
      {children}
    </fieldset>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (id: T) => void;
}) {
  return (
    <div className="inline-flex h-[34px] rounded-lg border border-border bg-surface-subtle p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`rounded-md px-3 text-sm font-medium transition ${
            value === option.id ? 'bg-accent text-accent-fg' : 'text-muted hover:text-foreground'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SideAndCrypto({
  side,
  crypto,
  onSide,
  onCrypto,
}: {
  side: Side;
  crypto: CryptoId;
  onSide: (side: Side) => void;
  onCrypto: (crypto: CryptoId) => void;
}) {
  return (
    <>
      <Field label="I want to">
        <Segmented
          value={side}
          onChange={onSide}
          options={[
            { id: 'sell', label: 'Sell' },
            { id: 'buy', label: 'Buy' },
          ]}
        />
      </Field>
      <Field label="Crypto">
        <Segmented
          value={crypto}
          onChange={onCrypto}
          options={CRYPTO_OPTIONS.map((c) => ({ id: c.id, label: c.label }))}
        />
      </Field>
    </>
  );
}
