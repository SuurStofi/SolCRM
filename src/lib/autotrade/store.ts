import 'server-only';

import { prisma } from '../db';
import { redact, SafeError } from '../binance/redact';
import { assertRunTransition, type RunState } from './machine';

/**
 * Persistence for autotrade. As with purchases, every state change goes
 * through `transitionRun`, which validates it, appends an audit event and
 * compare-and-sets on the state, and another user's run answers as not found.
 */

export interface RunPatch {
  convertQuoteId?: string;
  convertOrderId?: string | null;
  usdtReceived?: string;
  advNo?: string | null;
  lastError?: string | null;
}

const withEvents = { events: { orderBy: { createdAt: 'asc' as const } } };

function scrub(lastError: string | null | undefined) {
  return lastError === undefined ? undefined : lastError === null ? null : redact(lastError);
}

export async function getConfig(userId: string) {
  return prisma.autoTradeConfig.findUnique({ where: { userId } });
}

export async function listRuns(userId: string, limit = 10) {
  return prisma.autoTradeRun.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: withEvents,
  });
}

export async function requireRun(userId: string, id: string) {
  const run = await prisma.autoTradeRun.findFirst({ where: { id, userId }, include: withEvents });
  if (!run) throw new SafeError('Autotrade run not found', { status: 404 });
  return run;
}

/** The run that still needs attention, if any. */
export async function openRun(userId: string) {
  return prisma.autoTradeRun.findFirst({
    where: { userId, state: { notIn: ['AD_POSTED', 'CONVERT_FAILED'] } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function recordCheck(userId: string, text: string) {
  await prisma.autoTradeConfig.updateMany({
    where: { userId },
    data: { lastCheck: redact(text), lastCheckAt: new Date() },
  });
}

/**
 * Start a run and switch autotrade off in one transaction.
 *
 * The switch-off is a compare-and-set on `enabled`: of two checks that find
 * the same buyer at once (the timer and a "Check now"), exactly one gets to
 * start a run. And because it happens before any money moves, a crash
 * mid-run can never leave autotrade armed to trade again.
 */
export async function claimRun(input: {
  userId: string;
  fiat: string;
  amountSol: string;
  triggerAdNo: string;
  triggerPrice: string;
  triggerAdvertiser: string | null;
  note: string;
}) {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.autoTradeConfig.updateMany({
      where: { userId: input.userId, enabled: true },
      data: { enabled: false },
    });
    if (count !== 1) return null;

    const busy = await tx.autoTradeRun.findFirst({
      where: { userId: input.userId, state: { notIn: ['AD_POSTED', 'CONVERT_FAILED'] } },
    });
    if (busy) {
      throw new SafeError('An earlier autotrade run still needs attention.', { status: 409 });
    }

    return tx.autoTradeRun.create({
      data: {
        userId: input.userId,
        state: 'CONVERT_QUOTED',
        fiat: input.fiat,
        amountSol: input.amountSol,
        triggerAdNo: input.triggerAdNo,
        triggerPrice: input.triggerPrice,
        triggerAdvertiser: input.triggerAdvertiser,
        events: { create: { toState: 'CONVERT_QUOTED', note: redact(input.note) } },
      },
    });
  });
}

export async function transitionRun(
  userId: string,
  id: string,
  to: RunState,
  patch: RunPatch = {},
  note?: string,
) {
  const current = await prisma.autoTradeRun.findFirst({ where: { id, userId } });
  if (!current) throw new SafeError('Autotrade run not found', { status: 404 });

  assertRunTransition(current.state as RunState, to);

  const { lastError, ...rest } = patch;
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.autoTradeRun.updateMany({
      where: { id, userId, state: current.state },
      data: { ...rest, state: to, lastError: scrub(lastError) },
    });
    if (count !== 1) {
      throw new SafeError('This run was changed by another request. Refresh and try again.', {
        status: 409,
      });
    }
    await tx.autoTradeEvent.create({
      data: { runId: id, fromState: current.state, toState: to, note: note ? redact(note) : null },
    });
  });
  return requireRun(userId, id);
}

/** Update fields without a state change (an order id, a recorded error). */
export async function patchRun(userId: string, id: string, patch: RunPatch) {
  const { lastError, ...rest } = patch;
  await prisma.autoTradeRun.updateMany({
    where: { id, userId },
    data: { ...rest, lastError: scrub(lastError) },
  });
  return requireRun(userId, id);
}
