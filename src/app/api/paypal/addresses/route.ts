import { NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { userRoute } from '@/lib/auth/route';
import { SafeError } from '@/lib/binance/redact';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * The feature ships off. Gated on the server rather than only in the UI, so a
 * disabled deployment refuses the request rather than merely hiding a button.
 */
function assertEnabled(): void {
  if (process.env.PAYPAL_PYUSD_ENABLED !== 'true') {
    throw new SafeError('PayPal transfers are not enabled on this server.', { status: 403 });
  }
}


/**
 * Addresses the user sends PYUSD to, such as their PayPal receive address.
 *
 * These are destinations, not wallets: nobody proved control of them here, so
 * they can never sign in and their balance is never read as the user's.
 */

function assertValidAddress(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) throw new SafeError('Enter the address from your PayPal app.', { status: 400 });
  let key: PublicKey;
  try {
    key = new PublicKey(raw);
  } catch {
    throw new SafeError('That is not a valid Solana address.', { status: 400 });
  }
  // Catches typos that decode as base58 but address no real account.
  if (!PublicKey.isOnCurve(key.toBytes())) {
    throw new SafeError('That address is not a normal Solana wallet address.', { status: 400 });
  }
  return key.toBase58();
}

export async function GET(request: Request) {
  return userRoute(request, 'GET /api/paypal/addresses', async (user) => {
    assertEnabled();
    const addresses = await prisma.payoutAddress.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, address: true, label: true, kind: true },
    });
    return { addresses };
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    address?: unknown;
    label?: unknown;
  };

  return userRoute(request, 'POST /api/paypal/addresses', async (user) => {
    assertEnabled();
    const address = assertValidAddress(body.address);
    const label = String(body.label ?? '').trim() || 'My PayPal';

    // A wallet the user signs in with must never double as a payout target:
    // sending there would look like a PayPal transfer but go back to itself.
    const own = await prisma.wallet.findFirst({ where: { userId: user.id, address } });
    if (own) {
      throw new SafeError(
        'That is one of your own linked wallets, not a PayPal address.',
        { status: 400 },
      );
    }

    await prisma.payoutAddress.upsert({
      where: { userId_address: { userId: user.id, address } },
      create: { userId: user.id, address, label, kind: 'paypal' },
      update: { label },
    });

    const addresses = await prisma.payoutAddress.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, address: true, label: true, kind: true },
    });
    return { addresses };
  });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!id) {
    return NextResponse.json({ ok: false, error: 'Missing address id.' }, { status: 400 });
  }

  return userRoute(request, 'DELETE /api/paypal/addresses', async (user) => {
    assertEnabled();
    await prisma.payoutAddress.deleteMany({ where: { id, userId: user.id } });
    const addresses = await prisma.payoutAddress.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, address: true, label: true, kind: true },
    });
    return { addresses };
  });
}
