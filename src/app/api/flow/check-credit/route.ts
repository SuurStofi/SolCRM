import { NextResponse } from 'next/server';
import { getRecentDeposits } from '@/lib/binance/account';
import { handleRoute } from '@/lib/binance/route-helpers';
import { getFlow, transition } from '@/lib/flow/store';
import type { FlowState } from '@/lib/flow/machine';

export const dynamic = 'force-dynamic';

/**
 * Check whether Binance has credited this transfer.
 *
 * Binance credit lags on-chain confirmation, often by minutes, which is why
 * this is a separate step from chain confirmation rather than the same state.
 *
 * Matching is by transaction signature, NOT by amount or recency: two
 * transfers of the same size, or an unrelated deposit arriving in between,
 * would otherwise credit the wrong flow. Binance sometimes suffixes txId, so
 * the comparison allows the signature to appear within the field.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  const id = String(body.id ?? '');
  if (!id) {
    return NextResponse.json({ ok: false, error: 'Missing flow id.' }, { status: 400 });
  }

  return handleRoute('POST /api/flow/check-credit', async () => {
    const flow = await getFlow(id);
    if (!flow) throw new Error('Flow not found');
    if (!flow.txSignature) throw new Error('Flow has no transaction signature yet');

    const deposits = await getRecentDeposits('SOL');
    const match = deposits.find(
      (deposit) =>
        typeof deposit.txId === 'string' &&
        deposit.txId.includes(flow.txSignature as string),
    );

    if (!match) {
      // Not an error: the deposit may simply not have landed yet.
      return { credited: false, flow };
    }

    // status 1 = success, 6 = credited but withdrawal-locked. Both mean the
    // balance is spendable for a Convert, which is all this flow needs.
    const credited = match.status === 1 || match.status === 6;
    if (!credited) {
      return { credited: false, flow, depositStatus: match.status };
    }

    // Already recorded -- avoid an invalid repeat transition on re-check.
    if (flow.state === 'BINANCE_CREDITED' || flow.binanceCreditedAt) {
      return { credited: true, flow };
    }

    const updated = await transition(
      id,
      'BINANCE_CREDITED',
      {
        binanceCreditedAt: new Date(),
        creditedAmount: match.amount,
        lastError: null,
      },
      `Binance credited ${match.amount} SOL`,
    );
    return { credited: true, flow: updated };
  });
}

/**
 * Mark a flow as confirmed on-chain. Separate from credit detection so the two
 * statuses are never conflated in the UI.
 */
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    id?: unknown;
    state?: unknown;
  };
  const id = String(body.id ?? '');
  const state = String(body.state ?? '') as FlowState;

  if (!id || (state !== 'CHAIN_CONFIRMED' && state !== 'CHAIN_FAILED' && state !== 'CREDIT_TIMEOUT')) {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  return handleRoute('PATCH /api/flow/check-credit', () =>
    transition(
      id,
      state,
      state === 'CHAIN_CONFIRMED' ? { chainConfirmedAt: new Date() } : {},
      state === 'CHAIN_CONFIRMED'
        ? 'Confirmed on-chain'
        : state === 'CREDIT_TIMEOUT'
          ? 'Still waiting for Binance to credit the deposit'
          : 'Transaction failed on-chain',
    ),
  );
}
