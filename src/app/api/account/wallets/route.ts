import { NextResponse } from 'next/server';
import { userRoute } from '@/lib/auth/route';
import { normalizeAddress } from '@/lib/auth/siws';
import { accountSummary, unlinkWallet } from '@/lib/account/store';

export const dynamic = 'force-dynamic';

/**
 * Unlink a wallet. Linking goes through /api/auth/challenge + /api/auth/verify
 * with purpose LINK, because it needs a signature from the wallet itself.
 */
export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { address?: unknown };
  if (typeof body.address !== 'string') {
    return NextResponse.json({ ok: false, error: 'Missing address.' }, { status: 400 });
  }

  return userRoute(request, 'DELETE /api/account/wallets', async (user) => {
    await unlinkWallet(user.id, normalizeAddress(body.address));
    return accountSummary(user.id);
  });
}
