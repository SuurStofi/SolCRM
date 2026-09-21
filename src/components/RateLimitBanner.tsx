'use client';

import { useEffect, useState } from 'react';
import { useSecondsLeft } from './ui';

interface RateLimitStatus {
  banned: boolean;
  bannedUntil: number | null;
  backingOff: boolean;
  backoffUntil: number | null;
  reason: string | null;
}

/**
 * Binance backoff is invisible without this.
 *
 * A 429 makes the server sleep and retry, so the only symptom in the browser
 * is a request that takes several seconds longer than usual -- which looks
 * exactly like a hung spinner. An 418 IP ban is worse: every call fails fast
 * with an error that reads like a bug unless you know the app is refusing to
 * retry on purpose.
 */
const POLL_MS = 5000;

export function RateLimitBanner() {
  const [status, setStatus] = useState<RateLimitStatus | null>(null);

  useEffect(() => {
    let active = true;

    const check = async () => {
      try {
        const response = await fetch('/api/binance/status');
        const body = (await response.json()) as { ok?: boolean; data?: RateLimitStatus };
        if (active && body.ok && body.data) setStatus(body.data);
      } catch {
        // An indicator that announced its own failure would be noise.
      }
    };

    void check();
    const timer = setInterval(() => void check(), POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const deadline = status?.banned ? status.bannedUntil : (status?.backoffUntil ?? null);
  const secondsLeft = useSecondsLeft(deadline);

  if (!status || (!status.banned && !status.backingOff)) return null;

  return (
    <div
      role="status"
      className={`mb-5 rounded-lg border px-3.5 py-2.5 text-xs leading-relaxed ${
        status.banned
          ? 'border-bad/30 bg-bad-bg text-bad'
          : 'border-warn/30 bg-warn-bg text-warn'
      }`}
    >
      <span className="font-semibold">
        {status.banned ? 'Binance IP ban active' : 'Backing off, not stuck'}
      </span>{' '}
      {status.reason}
      {deadline !== null && (
        <span className="ml-1 tabular">
          {status.banned
            ? `Expected to clear around ${new Date(deadline).toLocaleTimeString()}.`
            : `Retrying in ${secondsLeft}s.`}
        </span>
      )}
    </div>
  );
}
