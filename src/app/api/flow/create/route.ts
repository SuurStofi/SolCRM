import { NextResponse } from 'next/server';
import { getDepositAddress } from '@/lib/binance/account';
import { handleRoute } from '@/lib/binance/route-helpers';
import { createFlow } from '@/lib/flow/store';

export const dynamic = 'force-dynamic';

/**
 * Start a transfer: fetch the Binance SOL deposit address and record the
 * intent. Nothing is signed or broadcast here -- the client builds and signs
 * the transaction, because this app never holds the private key.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { amountSol?: unknown };
  const amountSol = String(body.amountSol ?? '').trim();

  // Validated as a decimal string: parsing to float here would lose precision
  // on the value that determines how much money moves.
  if (!/^\d+(\.\d+)?$/.test(amountSol) || Number(amountSol) <= 0) {
    return NextResponse.json(
      { ok: false, error: 'Enter a positive SOL amount.' },
      { status: 400 },
    );
  }

  return handleRoute('POST /api/flow/create', async () => {
    const deposit = await getDepositAddress('SOL', 'SOL');
    const flow = await createFlow({
      amountSol,
      depositAddress: deposit.address,
      destinationTag: deposit.tag ?? null,
    });
    return { flow, deposit };
  });
}
