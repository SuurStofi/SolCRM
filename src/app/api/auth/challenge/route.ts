import { NextResponse } from 'next/server';
import { handleRoute } from '@/lib/binance/route-helpers';
import { SafeError } from '@/lib/binance/redact';
import { issueChallenge, normalizeAddress } from '@/lib/auth/siws';
import { currentUser } from '@/lib/auth/session';
import { isSameOrigin } from '@/lib/auth/route';

export const dynamic = 'force-dynamic';

/**
 * Issue a one-time message for a wallet to sign.
 *
 *   purpose: 'LOGIN' -- sign in (creates the account on first use)
 *   purpose: 'LINK'  -- add a wallet to the signed-in account
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ ok: false, error: 'Cross-origin request refused.' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    address?: unknown;
    purpose?: unknown;
  };
  const purpose = body.purpose === 'LINK' ? 'LINK' : body.purpose === 'LOGIN' ? 'LOGIN' : null;
  if (!purpose) {
    return NextResponse.json({ ok: false, error: 'Invalid purpose.' }, { status: 400 });
  }

  return handleRoute('POST /api/auth/challenge', async () => {
    const address = normalizeAddress(body.address);

    let userId: string | undefined;
    if (purpose === 'LINK') {
      const user = await currentUser();
      if (!user) throw new SafeError('Sign in first.', { status: 401 });
      userId = user.id;
    }

    return issueChallenge({
      address,
      purpose,
      userId,
      domain: request.headers.get('host') ?? 'localhost',
    });
  });
}
