import { NextResponse } from 'next/server';
import {
  getConvertQuote,
  acceptConvertQuote,
  getConvertOrderStatus,
  getConvertPairLimits,
  isConvertFailed,
} from '@/lib/binance/convert';
import { handleRoute } from '@/lib/binance/route-helpers';
import { getFlow, transition, noteError } from '@/lib/flow/store';

export const dynamic = 'force-dynamic';

/**
 * Convert leg, split into two explicit calls:
 *
 *   action: 'quote'  -> fetch a rate, executes nothing
 *   action: 'accept' -> execute the trade, IRREVERSIBLE
 *
 * They are separate so the UI can show the rate and require a deliberate
 * confirmation before anything irreversible happens.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    id?: unknown;
    action?: unknown;
    quoteId?: unknown;
  };
  const id = String(body.id ?? '');
  const action = String(body.action ?? '');

  if (!id || (action !== 'quote' && action !== 'accept')) {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  if (action === 'quote') {
    return handleRoute('POST /api/flow/convert (quote)', async () => {
      const flow = await getFlow(id);
      if (!flow) throw new Error('Flow not found');

      // Convert whatever Binance actually credited, not what was sent: network
      // fees mean the credited amount is slightly lower, and quoting the
      // larger figure fails for insufficient balance.
      const amount = flow.creditedAmount ?? flow.amountSol;

      const limits = await getConvertPairLimits('SOL', 'USDT');
      if (Number(amount) < Number(limits.fromAssetMinAmount)) {
        throw new Error(
          `Binance's minimum SOL to USDT conversion is ${limits.fromAssetMinAmount} SOL; this flow has ${amount} SOL.`,
        );
      }

      const quote = await getConvertQuote('SOL', 'USDT', amount);
      const updated = await transition(
        id,
        'CONVERT_QUOTED',
        { convertQuoteId: quote.quoteId, lastError: null },
        `Quoted ${amount} SOL -> ${quote.toAmount} USDT at ${quote.ratio}`,
      );
      return { quote, flow: updated };
    });
  }

  // --- accept: executes the trade ---
  const quoteId = String(body.quoteId ?? '');
  if (!quoteId) {
    return NextResponse.json({ ok: false, error: 'Missing quote id.' }, { status: 400 });
  }

  return handleRoute('POST /api/flow/convert (accept)', async () => {
    try {
      const acceptance = await acceptConvertQuote(quoteId);

      // acceptQuote frequently returns PROCESS rather than a final state, so
      // confirm the outcome rather than assuming success.
      let status = await getConvertOrderStatus(acceptance.orderId);
      if (status.orderStatus === 'PROCESS') {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        status = await getConvertOrderStatus(acceptance.orderId);
      }

      if (isConvertFailed(status.orderStatus)) {
        const failed = await transition(
          id,
          'CONVERT_FAILED',
          { convertOrderId: acceptance.orderId, lastError: `Convert ${status.orderStatus}` },
          `Convert order ${status.orderStatus}`,
        );
        return { flow: failed, status };
      }

      const updated = await transition(
        id,
        'CONVERTED',
        {
          convertOrderId: acceptance.orderId,
          convertedAt: new Date(),
          usdtReceived: status.toAmount,
          lastError: null,
        },
        `Converted to ${status.toAmount} USDT`,
      );
      return { flow: updated, status };
    } catch (error) {
      // A failure here leaves SOL sitting on Binance. Record it so the flow is
      // resumable from CONVERT_FAILED rather than looking merely broken.
      await noteError(id, error).catch(() => undefined);
      const flow = await getFlow(id);
      if (flow && flow.state === 'CONVERT_QUOTED') {
        await transition(id, 'CONVERT_FAILED', {}, 'Convert failed').catch(
          () => undefined,
        );
      }
      throw error;
    }
  });
}
