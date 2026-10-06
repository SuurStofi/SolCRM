import { NextResponse } from 'next/server';
import { userRoute } from '@/lib/auth/route';
import { withBinanceCredentials } from '@/lib/binance/client';
import { getKeyRestrictions } from '@/lib/binance/account';
import {
  saveBinanceCredentials,
  deleteBinanceCredentials,
  assertKeyAllowed,
} from '@/lib/binance/credentials';
import { prisma } from '@/lib/db';
import { accountSummary } from '@/lib/account/store';

export const dynamic = 'force-dynamic';

const KEY_SHAPE = /^[A-Za-z0-9]{16,128}$/;

/**
 * Store the user's own Binance API key.
 *
 * The key is tried against Binance before it is saved, so a typo fails here
 * rather than on the first transfer. Whether a withdrawal-enabled key is
 * accepted depends on the account's auto-withdraw setting -- see
 * assertKeyAllowed.
 */
export async function PUT(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    apiKey?: unknown;
    apiSecret?: unknown;
  };
  const apiKey = String(body.apiKey ?? '').trim();
  const apiSecret = String(body.apiSecret ?? '').trim();
  if (!KEY_SHAPE.test(apiKey) || !KEY_SHAPE.test(apiSecret)) {
    return NextResponse.json(
      { ok: false, error: 'Paste the API key and secret exactly as Binance shows them.' },
      { status: 400 },
    );
  }

  return userRoute(request, 'PUT /api/account/binance', async (user) => {
    const permissions = await withBinanceCredentials({ apiKey, apiSecret }, () =>
      getKeyRestrictions(),
    );

    const account = await prisma.user.findUnique({ where: { id: user.id } });
    assertKeyAllowed(permissions, account?.autoWithdraw ?? false);

    await saveBinanceCredentials(user.id, { apiKey, apiSecret }, permissions);
    return { account: await accountSummary(user.id), permissions };
  });
}

export async function DELETE(request: Request) {
  return userRoute(request, 'DELETE /api/account/binance', async (user) => {
    await deleteBinanceCredentials(user.id);
    return { account: await accountSummary(user.id) };
  });
}
