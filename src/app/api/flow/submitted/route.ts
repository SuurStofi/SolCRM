import { NextResponse } from 'next/server';
import { handleRoute } from '@/lib/binance/route-helpers';
import { transition } from '@/lib/flow/store';

export const dynamic = 'force-dynamic';

/**
 * Record that the user signed and broadcast the transfer. The signature comes
 * from the client because signing happens in the wallet, not here.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    id?: unknown;
    signature?: unknown;
    failed?: unknown;
  };
  const id = String(body.id ?? '');
  if (!id) {
    return NextResponse.json({ ok: false, error: 'Missing flow id.' }, { status: 400 });
  }

  // The user rejected the transaction in their wallet, or it never broadcast.
  if (body.failed) {
    return handleRoute('POST /api/flow/submitted (failed)', () =>
      transition(id, 'CHAIN_FAILED', {}, 'Transaction was not submitted'),
    );
  }

  const signature = String(body.signature ?? '');
  if (!signature) {
    return NextResponse.json(
      { ok: false, error: 'Missing transaction signature.' },
      { status: 400 },
    );
  }

  return handleRoute('POST /api/flow/submitted', () =>
    transition(id, 'SUBMITTED', { txSignature: signature }, 'Broadcast to network'),
  );
}
