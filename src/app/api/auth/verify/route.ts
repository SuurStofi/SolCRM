import { NextResponse } from 'next/server';
import { handleRoute } from '@/lib/binance/route-helpers';
import { SafeError } from '@/lib/binance/redact';
import { consumeChallenge } from '@/lib/auth/siws';
import { currentUser, startSession } from '@/lib/auth/session';
import { isSameOrigin } from '@/lib/auth/route';
import { accountSummary, findOrCreateUserForWallet, linkWallet } from '@/lib/account/store';

export const dynamic = 'force-dynamic';

/**
 * Check a signed challenge.
 *
 * LOGIN starts a session for the wallet's account (creating it on first use).
 * LINK attaches the wallet to the account that requested the challenge -- and
 * only if that is still the account signed in now, so a challenge requested
 * in one session cannot be completed in another.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ ok: false, error: 'Cross-origin request refused.' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    nonce?: unknown;
    signature?: unknown;
    purpose?: unknown;
  };
  const nonce = String(body.nonce ?? '');
  const signature = String(body.signature ?? '');
  const purpose = body.purpose === 'LINK' ? 'LINK' : 'LOGIN';
  if (!/^[0-9a-f]{32}$/.test(nonce) || !signature) {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  return handleRoute(`POST /api/auth/verify (${purpose})`, async () => {
    const challenge = await consumeChallenge({ nonce, purpose, signature });

    if (purpose === 'LOGIN') {
      const userId = await findOrCreateUserForWallet(challenge.address);
      await startSession(userId);
      return accountSummary(userId);
    }

    const user = await currentUser();
    if (!user || user.id !== challenge.userId) {
      throw new SafeError('Session changed while linking. Try again.', { status: 401 });
    }
    await linkWallet(user.id, challenge.address);
    return accountSummary(user.id);
  });
}
