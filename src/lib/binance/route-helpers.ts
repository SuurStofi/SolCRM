import 'server-only';

import { NextResponse } from 'next/server';
import { SafeError, redact, safeLog } from './redact';

/**
 * Shared error handling for Binance API routes.
 *
 * Every route funnels failures through here so that no raw error -- which can
 * embed the signed URL, the API key header, or a stack trace containing
 * either -- ever reaches the browser or the server log unscrubbed.
 */
export async function handleRoute<T>(
  label: string,
  work: () => Promise<T>,
): Promise<NextResponse> {
  try {
    return NextResponse.json({ ok: true, data: await work() });
  } catch (error) {
    // redact() on a raw Error includes its stack, which is useful in the log
    // but noise in the UI. Prefer the message alone for ordinary Errors;
    // it is still scrubbed.
    const message =
      error instanceof SafeError
        ? error.message
        : error instanceof Error
          ? redact(error.message)
          : redact(error);

    // The log keeps the full scrubbed error (including the stack) for
    // debugging; only the UI gets the trimmed message. Never the raw object.
    safeLog.error(`[api] ${label} failed: ${redact(error)}`);

    // 502 is the right default -- most failures here are Binance's. But a
    // SafeError that carries a 4xx describes something the caller did (a
    // duplicate record, a rejected argument), and reporting that as a bad
    // gateway points debugging at the wrong system entirely.
    const carried = error instanceof SafeError ? error.status : undefined;
    const status =
      carried === 418 ? 503 : carried !== undefined && carried <= 500 ? carried : 502;

    return NextResponse.json(
      {
        ok: false,
        error: message,
        code: error instanceof SafeError ? error.binanceCode : undefined,
      },
      { status },
    );
  }
}

/**
 * These routes hit Binance with live credentials, so responses must never be
 * cached or statically prerendered at build time.
 */
export const dynamic = 'force-dynamic';
