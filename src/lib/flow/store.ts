import 'server-only';

import { prisma } from '../db';
import { assertTransition, type FlowState } from './machine';
import { redact, SafeError } from '../binance/redact';

/**
 * Persistence for transfer flows.
 *
 * Every state change goes through `transition`, which validates the move
 * against the state machine and appends an audit event in the same
 * transaction. Writing `state` directly anywhere else would let the record
 * drift into a combination the machine says is impossible.
 */

export interface TransitionPatch {
  txSignature?: string;
  chainConfirmedAt?: Date;
  binanceCreditedAt?: Date;
  creditedAmount?: string;
  convertQuoteId?: string;
  convertOrderId?: string;
  convertedAt?: Date;
  usdtReceived?: string;
  depositAddress?: string;
  destinationTag?: string | null;
  lastError?: string | null;
}

/**
 * Every function here takes the owning user's id and treats a flow belonging
 * to anyone else exactly like one that does not exist, so a guessed id cannot
 * be read or advanced across accounts.
 */

export async function createFlow(input: {
  userId: string;
  fromAddress: string;
  amountSol: string;
  depositAddress: string;
  destinationTag?: string | null;
}) {
  return prisma.transferFlow.create({
    data: {
      state: 'DRAFT',
      userId: input.userId,
      fromAddress: input.fromAddress,
      amountSol: input.amountSol,
      depositAddress: input.depositAddress,
      destinationTag: input.destinationTag ?? null,
      events: { create: { toState: 'DRAFT', note: 'Flow created' } },
    },
  });
}

export async function getFlow(userId: string, id: string) {
  return prisma.transferFlow.findFirst({
    where: { id, userId },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  });
}

export async function listFlows(userId: string, limit = 20) {
  return prisma.transferFlow.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { events: { orderBy: { createdAt: 'asc' } } },
  });
}

/**
 * Move a flow to a new state, validating the transition and recording it.
 *
 * Errors are scrubbed before storage: a Binance failure can carry a signed URL
 * or key material, and this row is rendered in the UI.
 */
export async function transition(
  userId: string,
  id: string,
  to: FlowState,
  patch: TransitionPatch = {},
  note?: string,
) {
  const current = await prisma.transferFlow.findFirst({ where: { id, userId } });
  if (!current) throw new SafeError('Flow not found', { status: 404 });

  assertTransition(current.state as FlowState, to);

  const { lastError, ...rest } = patch;

  return prisma.transferFlow.update({
    where: { id },
    data: {
      ...rest,
      state: to,
      lastError: lastError === undefined ? undefined : lastError === null ? null : redact(lastError),
      events: {
        create: {
          fromState: current.state,
          toState: to,
          note: note ? redact(note) : null,
        },
      },
    },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  });
}

/**
 * Record a failure without changing state -- used when a retry fails but the
 * flow should stay where it is (e.g. a credit check that found nothing yet).
 */
export async function noteError(userId: string, id: string, error: unknown) {
  await prisma.transferFlow.updateMany({
    where: { id, userId },
    data: { lastError: redact(error) },
  });
  return getFlow(userId, id);
}
