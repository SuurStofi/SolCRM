import { NextResponse } from 'next/server';
import { getDepositAddress } from '@/lib/binance/account';
import { userRoute } from '@/lib/auth/route';
import { SafeError } from '@/lib/binance/redact';
import { normalizeAddress } from '@/lib/auth/siws';
import { isWalletOfUser } from '@/lib/account/store';
import { createFlow } from '@/lib/flow/store';

export const dynamic = 'force-dynamic';

/**
 * Start a transfer: fetch the Binance SOL deposit address and record the
 * intent. Nothing is signed or broadcast here -- the client builds and signs
 * the transaction, because this app never holds the private key.
 *
 * The sending wallet must be one linked to the account: the run is recorded
 * against this user, and a wallet nobody proved control of would make that
 * record meaningless.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    amountSol?: unknown;
    fromAddress?: unknown;
  };
  const amountSol = String(body.amountSol ?? '').trim();

  // Validated as a decimal string: parsing to float here would lose precision
  // on the value that determines how much money moves.
  if (!/^\d+(\.\d+)?$/.test(amountSol) || Number(amountSol) <= 0) {
    return NextResponse.json(
      { ok: false, error: 'Enter a positive SOL amount.' },
      { status: 400 },
    );
  }

  return userRoute(
    request,
    'POST /api/flow/create',
    async (user) => {
      const fromAddress = normalizeAddress(body.fromAddress);
      if (!(await isWalletOfUser(user.id, fromAddress))) {
        throw new SafeError(
          'The connected wallet is not linked to your account. Link it under Account first.',
          { status: 403 },
        );
      }

      const deposit = await getDepositAddress('SOL', 'SOL');
      const flow = await createFlow({
        userId: user.id,
        fromAddress,
        amountSol,
        depositAddress: deposit.address,
        destinationTag: deposit.tag ?? null,
      });
      return { flow, deposit };
    },
    { binance: true },
  );
}
