import 'server-only';

import { prisma } from '../db';
import { redact, SafeError } from '../binance/redact';
import { assertBuyTransition, type BuyState } from './machine';

/**
 * Persistence for purchases. As with transfer flows, every state change goes
 * through `transitionBuy`, which validates it and appends an audit event, and
 * a purchase belonging to another user answers as not found.
 */

export interface BuyPatch {
  convertQuoteId?: string;
  convertOrderId?: string | null;
  convertedAt?: Date;
  solReceived?: string;
  destination?: string | null;
  withdrawAttempt?: number;
  withdrawId?: string | null;
  withdrawAmount?: string;
  withdrawFee?: string;
  withdrawTxId?: string | null;
  withdrawnAt?: Date;
  lastError?: string | null;
}

const withEvents = { events: { orderBy: { createdAt: 'asc' as const } } };

export async function createBuy(input: {
  userId: string;
  usdtAmount: string;
  convertQuoteId: string;
  destination: string | null;
  note: string;
}) {
  return prisma.buyFlow.create({
    data: {
      userId: input.userId,
      state: 'CONVERT_QUOTED',
      usdtAmount: input.usdtAmount,
      convertQuoteId: input.convertQuoteId,
      destination: input.destination,
      events: { create: { toState: 'CONVERT_QUOTED', note: redact(input.note) } },
    },
    include: withEvents,
  });
}

export async function getBuy(userId: string, id: string) {
  return prisma.buyFlow.findFirst({ where: { id, userId }, include: withEvents });
}

export async function requireBuy(userId: string, id: string) {
  const flow = await getBuy(userId, id);
  if (!flow) throw new SafeError('Purchase not found', { status: 404 });
  return flow;
}

export async function listBuys(userId: string, limit = 20) {
  return prisma.buyFlow.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: withEvents,
  });
}

export async function transitionBuy(
  userId: string,
  id: string,
  to: BuyState,
  patch: BuyPatch = {},
  note?: string,
) {
  const current = await prisma.buyFlow.findFirst({ where: { id, userId } });
  if (!current) throw new SafeError('Purchase not found', { status: 404 });

  assertBuyTransition(current.state as BuyState, to);

  const { lastError, ...rest } = patch;
  // Compare-and-set on the state read above: of two concurrent requests
  // (a double click on "Withdraw"), exactly one moves the purchase on and the
  // other fails here -- before it can send a second withdrawal.
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.buyFlow.updateMany({
      where: { id, userId, state: current.state },
      data: {
        ...rest,
        state: to,
        lastError:
          lastError === undefined ? undefined : lastError === null ? null : redact(lastError),
      },
    });
    if (count !== 1) {
      throw new SafeError('This purchase was changed by another request. Refresh and try again.', {
        status: 409,
      });
    }
    await tx.buyEvent.create({
      data: { flowId: id, fromState: current.state, toState: to, note: note ? redact(note) : null },
    });
  });
  return requireBuy(userId, id);
}

/** Update fields without a state change (status refresh, a recorded error). */
export async function patchBuy(userId: string, id: string, patch: BuyPatch) {
  const { lastError, ...rest } = patch;
  await prisma.buyFlow.updateMany({
    where: { id, userId },
    data: {
      ...rest,
      lastError: lastError === undefined ? undefined : lastError === null ? null : redact(lastError),
    },
  });
  return requireBuy(userId, id);
}
