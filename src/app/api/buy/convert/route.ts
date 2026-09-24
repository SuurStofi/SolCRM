import { NextResponse } from 'next/server';
import { userRoute } from '@/lib/auth/route';
import { SafeError, safeLog, redact } from '@/lib/binance/redact';
import {
  getConvertQuote,
  acceptConvertQuote,
  getConvertOrderStatus,
  getConvertPairLimits,
  isConvertFailed,
} from '@/lib/binance/convert';
import { normalizeAddress } from '@/lib/auth/siws';
import { isWalletOfUser } from '@/lib/account/store';
import { compareDecimal, isPositiveDecimal } from '@/lib/decimal';
import { prisma } from '@/lib/db';
import { createBuy, requireBuy, transitionBuy, patchBuy } from '@/lib/buy/store';
import { runWithdraw } from '@/lib/buy/withdraw';
import { provablyNotExecuted } from '@/lib/binance/withdraw';

export const dynamic = 'force-dynamic';

/**
 * Buy SOL with USDT, in two explicit calls like the sell side:
 *
 *   action: 'quote'  -- { usdtAmount, destination? } starts a purchase,
 *                       { id } re-quotes an existing one. Executes nothing.
 *   action: 'accept' -- { id, quoteId } executes the trade, IRREVERSIBLE.
 *   action: 'status' -- { id } settles an accepted order whose outcome was
 *                       not confirmed (the status call failed).
 *
 * With auto-withdraw on, a successful accept goes straight on to withdraw
 * the SOL to the chosen linked wallet -- server-side, so it does not depend
 * on the browser staying open. A failed withdrawal never undoes the buy.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action;

  if (action === 'quote') {
    return userRoute(
      request,
      'POST /api/buy/convert (quote)',
      async (user) => {
        // Re-quote an existing purchase.
        if (typeof body.id === 'string') {
          const flow = await requireBuy(user.id, body.id);
          // An accepted order whose result is unconfirmed may already have
          // spent the USDT; quoting again could buy twice.
          if (flow.convertOrderId && flow.state === 'CONVERT_QUOTED') {
            throw new SafeError('Binance already accepted an order for this purchase. Check its status first.', { status: 409 });
          }
          const quote = await getConvertQuote('USDT', 'SOL', flow.usdtAmount);
          const updated = await transitionBuy(
            user.id,
            flow.id,
            'CONVERT_QUOTED',
            { convertQuoteId: quote.quoteId, convertOrderId: null, lastError: null },
            `Quoted ${flow.usdtAmount} USDT -> ${quote.toAmount} SOL at ${quote.ratio}`,
          );
          return { quote, flow: updated };
        }

        const usdtAmount = String(body.usdtAmount ?? '').trim();
        if (!isPositiveDecimal(usdtAmount)) {
          throw new SafeError('Enter a positive USDT amount.', { status: 400 });
        }

        const account = await prisma.user.findUnique({ where: { id: user.id } });
        let destination: string | null = null;
        if (account?.autoWithdraw) {
          destination = normalizeAddress(body.destination);
          if (!(await isWalletOfUser(user.id, destination))) {
            throw new SafeError('Pick one of your linked wallets to receive the SOL.', {
              status: 403,
            });
          }
        }

        const limits = await getConvertPairLimits('USDT', 'SOL');
        if (compareDecimal(usdtAmount, limits.fromAssetMinAmount) < 0) {
          throw new SafeError(
            `Binance's minimum USDT to SOL conversion is ${limits.fromAssetMinAmount} USDT.`,
            { status: 400 },
          );
        }

        const quote = await getConvertQuote('USDT', 'SOL', usdtAmount);
        const flow = await createBuy({
          userId: user.id,
          usdtAmount,
          convertQuoteId: quote.quoteId,
          destination,
          note: `Quoted ${usdtAmount} USDT -> ${quote.toAmount} SOL at ${quote.ratio}`,
        });
        return { quote, flow };
      },
      { binance: true },
    );
  }

  if (action === 'status') {
    const statusId = String(body.id ?? '');
    return userRoute(
      request,
      'POST /api/buy/convert (status)',
      async (user) => {
        const flow = await requireBuy(user.id, statusId);
        if (flow.state !== 'CONVERT_QUOTED' || !flow.convertOrderId) return { flow };
        return settleOrder(user.id, flow.id, flow.convertOrderId);
      },
      { binance: true },
    );
  }

  if (action !== 'accept') {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const id = String(body.id ?? '');
  const quoteId = String(body.quoteId ?? '');
  if (!id || !quoteId) {
    return NextResponse.json({ ok: false, error: 'Missing purchase or quote id.' }, { status: 400 });
  }

  return userRoute(
    request,
    'POST /api/buy/convert (accept)',
    async (user) => {
      const owned = await requireBuy(user.id, id);
      if (owned.state !== 'CONVERT_QUOTED' || owned.convertQuoteId !== quoteId) {
        throw new SafeError('That quote is no longer current for this purchase. Request a new quote.', {
          status: 409,
        });
      }

      let orderId: string;
      try {
        orderId = (await acceptConvertQuote(quoteId)).orderId;
      } catch (error) {
        if (provablyNotExecuted(error)) {
          // Binance refused: no USDT moved, so quoting again is safe.
          await transitionBuy(user.id, id, 'CONVERT_FAILED', { lastError: errorText(error) }, 'Binance rejected the convert').catch(() => undefined);
        } else {
          // No answer: the trade may have executed. Stay put and say so,
          // rather than inviting a second purchase.
          await patchBuy(user.id, id, {
            lastError: `No answer from Binance -- this buy may have gone through. Check Convert history in Binance before buying again. (${errorText(error)})`,
          }).catch(() => undefined);
        }
        throw error;
      }

      // The order exists from here on; record it before anything else can fail.
      await patchBuy(user.id, id, { convertOrderId: orderId });
      return settleOrder(user.id, id, orderId);
    },
    { binance: true },
  );
}

/**
 * Confirm an accepted convert order and move the purchase on. acceptQuote
 * often answers PROCESS, so the result is read back rather than assumed. If
 * that read fails, the purchase stays CONVERT_QUOTED with the order id kept,
 * and the 'status' action finishes the job.
 */
async function settleOrder(userId: string, id: string, orderId: string) {
  let status;
  try {
    status = await getConvertOrderStatus(orderId);
    if (status.orderStatus === 'PROCESS') {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      status = await getConvertOrderStatus(orderId);
    }
  } catch (error) {
    const flow = await patchBuy(userId, id, {
      lastError: `Binance accepted order ${orderId} but its result could not be read yet. Use "Check order". (${errorText(error)})`,
    });
    return { flow, status: null };
  }

  if (status.orderStatus === 'PROCESS') {
    const flow = await patchBuy(userId, id, {
      lastError: `Order ${orderId} is still processing on Binance. Use "Check order" in a moment.`,
    });
    return { flow, status };
  }

  if (isConvertFailed(status.orderStatus)) {
    const failed = await transitionBuy(
      userId,
      id,
      'CONVERT_FAILED',
      { lastError: `Convert ${status.orderStatus}` },
      `Convert order ${status.orderStatus}`,
    );
    return { flow: failed, status };
  }

  let flow = await transitionBuy(
    userId,
    id,
    'CONVERTED',
    { convertedAt: new Date(), solReceived: status.toAmount, lastError: null },
    `Bought ${status.toAmount} SOL`,
  );

  const account = await prisma.user.findUnique({ where: { id: userId } });
  if (account?.autoWithdraw && flow.destination) {
    try {
      flow = await runWithdraw(userId, id);
    } catch (error) {
      // The buy stands; record why the withdrawal did not start.
      safeLog.error(`[buy] auto-withdraw for ${id} failed: ${redact(error)}`);
      flow = await patchBuy(userId, id, {
        lastError: `Bought, but the withdrawal did not start: ${errorText(error)}`,
      });
    }
  }
  return { flow, status };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
