import { NextResponse } from 'next/server';
import { userRoute } from '@/lib/auth/route';
import { SafeError } from '@/lib/binance/redact';
import { withBinanceCredentials } from '@/lib/binance/client';
import { getKeyRestrictions } from '@/lib/binance/account';
import { loadBinanceCredentials } from '@/lib/binance/credentials';
import { accountSummary } from '@/lib/account/store';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Account settings. Currently one: autoWithdraw.
 *
 * Switching it OFF is refused while the stored key can still withdraw: the
 * setting exists to decide whether such a key may be held at all, so turning
 * it off must not leave one behind. The key is checked live, not from the
 * snapshot taken when it was saved -- its permissions may have changed.
 */
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { autoWithdraw?: unknown };
  if (typeof body.autoWithdraw !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'autoWithdraw must be true or false.' }, { status: 400 });
  }
  const autoWithdraw = body.autoWithdraw;

  return userRoute(request, 'PATCH /api/account/settings', async (user) => {
    if (!autoWithdraw) {
      const creds = await loadBinanceCredentials(user.id);
      if (creds) {
        const permissions = await withBinanceCredentials(creds, () => getKeyRestrictions());
        await prisma.binanceCredential.update({
          where: { userId: user.id },
          data: {
            canTrade: permissions.canTrade,
            canWithdraw: permissions.canWithdraw,
            ipRestricted: permissions.ipRestricted,
          },
        });
        if (permissions.canWithdraw) {
          throw new SafeError(
            'The stored Binance key can still withdraw. Turn withdrawals off on that key in Binance (or replace or remove it here), then switch auto-withdraw off.',
            { status: 409 },
          );
        }
      }
    }

    await prisma.user.update({ where: { id: user.id }, data: { autoWithdraw } });
    return accountSummary(user.id);
  });
}
