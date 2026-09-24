import 'server-only';

import { NextResponse } from 'next/server';
import { handleRoute } from '../binance/route-helpers';
import { SafeError } from '../binance/redact';
import { withBinanceCredentials } from '../binance/client';
import { loadBinanceCredentials } from '../binance/credentials';
import { currentUser, type SessionUser } from './session';

/**
 * Wrapper for every route that acts on behalf of a signed-in user.
 *
 *  - rejects cross-origin writes (defence in depth on top of SameSite=Lax);
 *  - resolves the session, answering 401 without one;
 *  - with `binance: true`, runs the handler with that user's own Binance key,
 *    so signed calls can only ever reach the caller's exchange account.
 *
 * Errors still flow through handleRoute, so they are scrubbed the same way.
 */
export async function userRoute<T>(
  request: Request,
  label: string,
  work: (user: SessionUser) => Promise<T>,
  options: { binance?: boolean } = {},
): Promise<NextResponse> {
  if (request.method !== 'GET' && !isSameOrigin(request)) {
    return NextResponse.json({ ok: false, error: 'Cross-origin request refused.' }, { status: 403 });
  }

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  }

  return handleRoute(label, async () => {
    if (!options.binance) return work(user);

    const creds = await loadBinanceCredentials(user.id);
    if (!creds) {
      throw new SafeError(
        'No Binance API key is linked to this account. Add one under Account → Binance API key.',
        { status: 409 },
      );
    }
    return withBinanceCredentials(creds, () => work(user));
  });
}

/**
 * Browsers always send Origin on POST/PATCH/DELETE. A missing header means a
 * non-browser client, which cannot be riding a victim's cookie, so it passes.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
