'use client';

import { useCallback, useEffect, useState } from 'react';
import { Panel, SectionLabel, ErrorNote, Spinner, Chip, EmptyRow, ExtLink, RefreshButton } from './ui';
import { fetchJson, Field, inputClass, onMount } from './market-ui';

interface Config {
  enabled: boolean;
  fiat: string;
  minPrice: string;
  amountSol: string;
  buyerMethod: string | null;
  payIds: number[];
  minOrderFiat: string;
  payTimeLimit: number;
  lastCheck: string | null;
  lastCheckAt: string | null;
}

interface Run {
  id: string;
  state: string;
  label: string;
  fiat: string;
  amountSol: string;
  triggerPrice: string;
  triggerAdvertiser: string | null;
  convertOrderId: string | null;
  usdtReceived: string | null;
  advNo: string | null;
  lastError: string | null;
  createdAt: string;
}

interface PayMethod {
  payId: number;
  identifier: string;
  tradeMethodName: string;
}

interface Snapshot {
  config: Config | null;
  runs: Run[];
  intervalMs: number;
  payMethods?: PayMethod[];
  payMethodsError?: string | null;
  preview?: string;
}

const EMPTY_FORM = {
  fiat: 'UAH',
  minPrice: '',
  amountSol: '',
  buyerMethod: '',
  minOrderFiat: '500',
  payTimeLimit: 15,
  payIds: [] as number[],
};

const STATE_TONE: Record<string, 'good' | 'warn' | 'bad' | 'neutral'> = {
  AD_POSTED: 'good',
  CONVERT_FAILED: 'bad',
  AD_FAILED: 'bad',
  AD_REQUESTED: 'warn',
  CONVERT_QUOTED: 'warn',
  CONVERTED: 'warn',
};

/**
 * Autotrade: when a Binance P2P buyer pays at least the set USDT price, the
 * server converts SOL to USDT and publishes a SELL ad at that price, then
 * switches itself off.
 */
export function AutoTradePanel() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [methods, setMethods] = useState<PayMethod[] | null>(null);
  const [methodsError, setMethodsError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const apply = useCallback((next: Snapshot, syncForm: boolean) => {
    setSnapshot(next);
    if (syncForm && next.config) {
      setForm({
        fiat: next.config.fiat,
        minPrice: next.config.minPrice,
        amountSol: next.config.amountSol,
        buyerMethod: next.config.buyerMethod ?? '',
        minOrderFiat: next.config.minOrderFiat,
        payTimeLimit: next.config.payTimeLimit,
        payIds: next.config.payIds,
      });
    }
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await fetchJson<Snapshot>('/api/autotrade'), true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load autotrade.');
    }
  }, [apply]);

  useEffect(() => onMount(load), [load]);

  // While armed, follow what the server's checks find.
  const armed = snapshot?.config?.enabled ?? false;
  useEffect(() => {
    if (!armed) return;
    const timer = setInterval(() => {
      void fetchJson<Snapshot>('/api/autotrade').then((next) => apply(next, false), () => undefined);
    }, 15_000);
    return () => clearInterval(timer);
  }, [armed, apply]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action + (extra.id ?? ''));
    setError(null);
    setNotice(null);
    try {
      const next = await fetchJson<Snapshot & { result?: { kind: string; message?: string } }>(
        '/api/autotrade',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...extra }),
        },
      );
      apply(next, action === 'save');
      if (next.preview) setNotice(next.preview);
      else if (next.result?.message) setNotice(next.result.message);
      if (action === 'arm' || action === 'save') setConfirmed(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed.');
    } finally {
      setBusy(null);
    }
  }

  async function loadMethods() {
    setBusy('methods');
    setMethodsError(null);
    try {
      const data = await fetchJson<Snapshot>('/api/autotrade?payMethods=1');
      setMethods(data.payMethods ?? []);
      setMethodsError(data.payMethodsError ?? null);
    } catch (cause) {
      setMethodsError(cause instanceof Error ? cause.message : 'Could not load payment methods.');
    } finally {
      setBusy(null);
    }
  }

  const config = snapshot?.config ?? null;
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <Panel
      title="Autotrade"
      subtitle="Sell SOL via USDT when a Binance buyer pays your price"
      icon={<BoltMark />}
      action={
        <div className="flex items-center gap-2">
          {config && (
            <Chip tone={config.enabled ? 'good' : 'neutral'}>{config.enabled ? 'armed' : 'off'}</Chip>
          )}
          <RefreshButton onClick={() => void load()} loading={false} />
        </div>
      }
    >
      <div className="space-y-5">
        {error && <ErrorNote title="Autotrade">{error}</ErrorNote>}

        {config?.lastCheck && (
          <div className="rounded-lg border border-border bg-surface-subtle px-3.5 py-2.5 text-xs">
            <span className="text-faint">
              Last check{config.lastCheckAt && ` · ${new Date(config.lastCheckAt).toLocaleTimeString()}`}:{' '}
            </span>
            {config.lastCheck}
          </div>
        )}
        {notice && (
          <div className="rounded-lg border border-accent/30 bg-accent/5 px-3.5 py-2.5 text-xs">{notice}</div>
        )}

        <div>
          <SectionLabel>Trigger</SectionLabel>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label="Fiat">
              <input
                value={form.fiat}
                onChange={(e) => set('fiat', e.target.value.toUpperCase())}
                maxLength={3}
                className={inputClass}
              />
            </Field>
            <Field label={`Buyer pays ≥, ${form.fiat}/USDT`}>
              <input
                value={form.minPrice}
                onChange={(e) => set('minPrice', e.target.value)}
                inputMode="decimal"
                placeholder="e.g. 42"
                className={inputClass}
              />
            </Field>
            <Field label="SOL per run">
              <input
                value={form.amountSol}
                onChange={(e) => set('amountSol', e.target.value)}
                inputMode="decimal"
                placeholder="e.g. 1"
                className={inputClass}
              />
            </Field>
            <Field label="Buyer accepts (optional)">
              <input
                value={form.buyerMethod}
                onChange={(e) => set('buyerMethod', e.target.value)}
                placeholder="Monobank"
                className={inputClass}
              />
            </Field>
          </div>
        </div>

        <div>
          <SectionLabel
            trailing={
              <button
                type="button"
                onClick={() => void loadMethods()}
                disabled={busy === 'methods'}
                className="text-[11px] font-medium text-muted hover:text-foreground"
              >
                {busy === 'methods' ? 'Loading…' : methods ? 'Reload' : 'Load my payment methods'}
              </button>
            }
          >
            Your ad
          </SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <Field label={`Min order, ${form.fiat}`}>
              <input
                value={form.minOrderFiat}
                onChange={(e) => set('minOrderFiat', e.target.value)}
                inputMode="decimal"
                className={inputClass}
              />
            </Field>
            <Field label="Time to pay">
              <select
                value={form.payTimeLimit}
                onChange={(e) => set('payTimeLimit', Number(e.target.value))}
                className={inputClass}
              >
                {[15, 30, 45, 60].map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {methodsError && (
            <p className="mt-2 text-[11px] leading-relaxed text-bad">
              {methodsError} — publishing ads through the API needs P2P merchant status.
            </p>
          )}
          {methods && methods.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {methods.map((m) => (
                <label key={m.payId} className="flex cursor-pointer items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={form.payIds.includes(m.payId)}
                    onChange={(e) =>
                      set(
                        'payIds',
                        e.target.checked
                          ? [...form.payIds, m.payId]
                          : form.payIds.filter((id) => id !== m.payId),
                      )
                    }
                  />
                  {m.tradeMethodName}
                </label>
              ))}
            </div>
          )}
          {methods && methods.length === 0 && !methodsError && (
            <p className="mt-2 text-[11px] text-warn">No payment methods on your Binance P2P profile.</p>
          )}
          {!methods && form.payIds.length > 0 && (
            <p className="mt-2 text-[11px] text-faint">{form.payIds.length} payment method(s) chosen.</p>
          )}
          <p className="mt-2 text-[11px] text-faint">
            The ad sells all the USDT from the run at the buyer&apos;s price; the largest order is the
            whole amount.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void act('save', { ...form })}
            disabled={busy !== null}
            className="inline-flex h-[34px] items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium transition hover:border-border-strong disabled:opacity-50"
          >
            {busy === 'save' && <Spinner />}
            Save {config?.enabled ? '(disarms)' : ''}
          </button>
          <button
            type="button"
            onClick={() => void act('check')}
            disabled={busy !== null || !config}
            className="inline-flex h-[34px] items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium transition hover:border-border-strong disabled:opacity-50"
          >
            {busy === 'check' && <Spinner />}
            {config?.enabled ? 'Check now' : 'Preview'}
          </button>
          {config?.enabled && (
            <button
              type="button"
              onClick={() => void act('disarm')}
              disabled={busy !== null}
              className="inline-flex h-[34px] items-center rounded-lg border border-bad/40 px-3 text-sm font-medium text-bad transition hover:bg-bad-bg disabled:opacity-50"
            >
              Switch off
            </button>
          )}
        </div>

        {config && !config.enabled && (
          <div className="rounded-lg border border-warn/30 bg-warn-bg px-3.5 py-3 text-xs leading-relaxed text-warn">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                When a buyer pays ≥ {config.minPrice} {config.fiat}/USDT for the amount, the server will
                convert <b>{config.amountSol} SOL</b> to USDT on my Binance <b>without asking</b> and
                publish a SELL ad at that buyer&apos;s price. It then switches itself off. Orders on the
                ad, and releasing the USDT, stay manual in Binance.
              </span>
            </label>
            <button
              type="button"
              onClick={() => void act('arm', { confirm: true })}
              disabled={!confirmed || busy !== null}
              className="mt-2.5 inline-flex h-[32px] items-center gap-2 rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
            >
              {busy === 'arm' && <Spinner className="border-t-accent-fg" />}
              Arm autotrade
            </button>
          </div>
        )}

        <div>
          <SectionLabel>Runs</SectionLabel>
          {!snapshot || snapshot.runs.length === 0 ? (
            <EmptyRow>No runs yet.</EmptyRow>
          ) : (
            <ul className="space-y-2">
              {snapshot.runs.map((run) => (
                <RunCard key={run.id} run={run} busy={busy} onAct={act} />
              ))}
            </ul>
          )}
        </div>

        <p className="border-t border-border pt-3 text-[11px] leading-relaxed text-faint">
          Checks run on the server every {Math.round((snapshot?.intervalMs ?? 60000) / 1000)}s while it
          is running. Binance has no API for ordering on someone else&apos;s ad, so the trade
          happens through your own ad at the price found. Publishing ads through the API needs P2P
          merchant status; without it autotrade stops before converting anything.
        </p>
      </div>
    </Panel>
  );
}

function RunCard({
  run,
  busy,
  onAct,
}: {
  run: Run;
  busy: string | null;
  onAct: (action: string, extra: Record<string, unknown>) => Promise<void>;
}) {
  const button = (action: string, label: string) => (
    <button
      type="button"
      onClick={() => void onAct(action, { id: run.id })}
      disabled={busy !== null}
      className="inline-flex h-[28px] items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-xs font-medium transition hover:border-border-strong disabled:opacity-50"
    >
      {busy === action + run.id && <Spinner />}
      {label}
    </button>
  );

  return (
    <li className="rounded-lg border border-border bg-surface-subtle px-3.5 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <Chip tone={STATE_TONE[run.state] ?? 'neutral'}>{run.label}</Chip>
          <span className="text-[11px] text-faint">{new Date(run.createdAt).toLocaleString()}</span>
        </span>
        {run.advNo && (
          <ExtLink href={`https://c2c.binance.com/en/adv?code=${encodeURIComponent(run.advNo)}`}>
            <span className="font-mono text-[11px]">ad {run.advNo}</span>
          </ExtLink>
        )}
      </div>
      <p className="tabular mt-1 text-xs text-muted">
        {run.amountSol} SOL
        {run.usdtReceived && ` → ${run.usdtReceived} USDT`} · buyer{' '}
        {run.triggerAdvertiser ?? ''} at {run.triggerPrice} {run.fiat}/USDT
      </p>
      {run.lastError && <p className="mt-1 text-[11px] leading-relaxed text-bad">{run.lastError}</p>}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {run.state === 'CONVERT_QUOTED' && run.convertOrderId && button('settle', 'Check order')}
        {run.state === 'AD_FAILED' && button('retry-ad', 'Retry ad')}
        {run.state === 'AD_REQUESTED' && run.lastError && button('ad-missing', 'Ad is not on Binance')}
      </div>
    </li>
  );
}

function BoltMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
