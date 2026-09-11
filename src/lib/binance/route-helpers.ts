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
    const message =
      error instanceof SafeError ? error.message : redact(error);

    // Logged scrubbed; never the raw error object.
    safeLog.error(`[api] ${label} failed: ${message}`);

    const status = error instanceof SafeError && error.status === 418 ? 503 : 502;

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
