import { NextResponse } from 'next/server';
import { handleRoute } from '@/lib/binance/route-helpers';
import { getFlow, transition, noteError } from '@/lib/flow/store';
import type { FlowState } from '@/lib/flow/machine';

export const dynamic = 'force-dynamic';

/** Client-supplied text is stored and rendered, so its length is capped. */
const MAX_REASON_LENGTH = 300;

/**
 * The signing leg of a transfer, in the three steps the client drives:
 *
 *   { signing: true }  the transaction is sitting in the wallet, unanswered
 *   { signature }      the wallet signed and the network confirmed
 *   { failed: true }   something went wrong -- see recordFailure
 *
 * The signature comes from the client because signing happens in the wallet,
 * not here.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    id?: unknown;
    signature?: unknown;
    signing?: unknown;
    failed?: unknown;
    error?: unknown;
  };
  const id = String(body.id ?? '');
  if (!id) {
    return NextResponse.json({ ok: false, error: 'Missing flow id.' }, { status: 400 });
  }

  const reason =
    body.error === undefined ? null : String(body.error).slice(0, MAX_REASON_LENGTH);

  // Recorded before the wallet prompt opens: the user can leave it unanswered
  // for minutes, and the run should not read as an untouched draft while they
  // do. This is also what makes the later move to SUBMITTED a legal one.
  if (body.signing) {
    return handleRoute('POST /api/flow/submitted (signing)', () =>
      transition(id, 'AWAITING_SIGNATURE', { lastError: null }, 'Sent to wallet for signature'),
    );
  }

  if (body.failed) {
    return handleRoute('POST /api/flow/submitted (failed)', () =>
      recordFailure(id, String(body.signature ?? ''), reason),
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
    transition(
      id,
      'SUBMITTED',
      { txSignature: signature, lastError: null },
      'Broadcast to network',
    ),
  );
}

/**
 * Land a failed run in the state that matches what actually happened to the
 * SOL.
 *
 * The distinction that matters: CHAIN_FAILED means nothing moved and the run
 * is safe to start over. Reporting it for a transfer that was already
 * broadcast would invite a second send of money that is already on its way --
 * so a run that has a signature is never marked failed, it is advanced to
 * where the deposit can be chased instead.
 */
async function recordFailure(id: string, reportedSignature: string, reason: string | null) {
  const flow = await getFlow(id);
  if (!flow) throw new Error('Flow not found');

  const state = flow.state as FlowState;
  // The client only holds a signature once sendSolTransfer has returned, and
  // that call does not return until the network has confirmed the transfer.
  const signature = reportedSignature || flow.txSignature;

  if (!signature) {
    if (state === 'DRAFT' || state === 'AWAITING_SIGNATURE') {
      return transition(id, 'CHAIN_FAILED', { lastError: reason }, 'Transaction was not submitted');
    }
    // Past the broadcast point with no signature on record: no state change
    // here can be justified, so only the reason is kept.
    return noteError(id, reason ?? 'Transfer failed');
  }

  if (state === 'AWAITING_SIGNATURE') {
    await transition(id, 'SUBMITTED', { txSignature: signature }, 'Broadcast to network');
  }

  if (state === 'AWAITING_SIGNATURE' || state === 'SUBMITTED') {
    return transition(
      id,
      'CHAIN_CONFIRMED',
      { chainConfirmedAt: new Date(), lastError: reason },
      'Confirmed on-chain; Binance credit not yet checked',
    );
  }

  return noteError(id, reason ?? 'Transfer failed');
}
