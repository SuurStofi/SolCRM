'use client';

import { useCallback, useEffect, useState } from 'react';
import { Spinner, Chip } from './ui';

interface MerchantStatus {
  state: 'merchant' | 'not-merchant' | 'unknown' | 'no-key';
  categories: string[];
  reason?: string;
  checkedAt: string;
  applyUrl: string;
}

async function api<T>(url: string, method = 'GET'): Promise<T> {
  const response = await fetch(url, { method });
  const json = (await response.json()) as { ok: boolean; data?: T; error?: string };
  if (!json.ok || json.data === undefined) throw new Error(json.error ?? 'Request failed');
  return json.data;
}

/**
 * Whether this account may publish Binance P2P ads, which is what Auto-sell
 * needs and nothing else here does.
 *
 * "Couldn't check" is shown as a lock, not a maybe: an uncertain answer is
 * never treated as permission, because the alternative is converting SOL for
 * an ad that cannot be posted.
 */
export function MerchantStatusCard({
  onStatus,
}: {
  onStatus?: (canPublish: boolean) => void;
}) {
  const [status, setStatus] = useState<MerchantStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (force: boolean) => {
      setChecking(true);
      setError(null);
      try {
        const data = await api<MerchantStatus>(
          '/api/autotrade/merchant',
          force ? 'POST' : 'GET',
        );
        setStatus(data);
        onStatus?.(data.state === 'merchant');
      } catch (cause) {
        setStatus(null);
        onStatus?.(false);
        setError(cause instanceof Error ? cause.message : 'Could not check.');
      } finally {
        setChecking(false);
      }
    },
    [onStatus],
  );

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return load(false);
    });
    return () => {
      active = false;
    };
  }, [load]);

  if (checking && !status) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-subtle px-4 py-3 text-sm text-faint">
        <Spinner /> Checking whether you can publish ads…
      </div>
    );
  }

  // A failed request and an uncertain answer are the same thing to the user:
  // Auto-sell is locked either way.
  const state = error ? 'unknown' : (status?.state ?? 'unknown');
  const canPublish = state === 'merchant';

  const tone =
    state === 'merchant' ? 'good' : state === 'not-merchant' ? 'warn' : 'warn';

  return (
    <div
      className={`rounded-xl border px-4 py-3.5 ${
        canPublish ? 'border-good/30 bg-good-bg/40' : 'border-warn/30 bg-warn-bg/40'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <Chip tone={tone}>
            {state === 'merchant'
              ? 'Verified merchant'
              : state === 'not-merchant'
                ? 'Not a merchant'
                : state === 'no-key'
                  ? 'No Binance key'
                  : "Couldn't check"}
          </Chip>
          {status?.checkedAt && (
            <span className="text-[11px] text-faint">
              checked {new Date(status.checkedAt).toLocaleTimeString()}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={checking}
          className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted transition hover:text-foreground disabled:opacity-40"
        >
          {checking ? 'Checking…' : 'Check again'}
        </button>
      </div>

      {canPublish ? (
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Your Binance account can publish P2P ads, so Auto-sell can post one for you.
        </p>
      ) : state === 'no-key' ? (
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Connect your Binance key under <strong>Home → My account</strong> first. Until
          then, use Price alerts — they work for everyone.
        </p>
      ) : state === 'not-merchant' ? (
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Auto-sell publishes ads on Binance P2P, and only Binance P2P merchants can do
          that. Your account isn&apos;t a merchant yet. You can apply at{' '}
          <a
            href={status?.applyUrl ?? 'https://c2c.binance.com/en/merchantApplication'}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Binance P2P → Become a merchant
          </a>
          . Until then, use Price alerts — they work for everyone.
        </p>
      ) : (
        <p className="mt-2 text-xs leading-relaxed text-muted">
          We couldn&apos;t confirm whether your account can publish ads, so Auto-sell stays
          locked — it never runs on an uncertain answer. Press{' '}
          <strong>Check again</strong>, or use Price alerts, which work for everyone.
          {(error ?? status?.reason) && (
            <span className="mt-1 block text-[11px] text-faint">
              {error ?? status?.reason}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
