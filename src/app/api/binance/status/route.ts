import { NextResponse } from 'next/server';
import { rateLimitStatus } from '@/lib/binance/client';

export const dynamic = 'force-dynamic';

/**
 * In-process rate-limit state, for the dashboard's backoff indicator.
 *
 * Deliberately makes no call to Binance: this endpoint is polled, and a status
 * check that itself spent rate limit would be self-defeating.
 */
export function GET() {
  return NextResponse.json({ ok: true, data: rateLimitStatus() });
}
