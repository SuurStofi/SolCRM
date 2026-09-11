import 'server-only';

import { prisma } from '../db';
import { assertTransition, type FlowState } from './machine';
import { redact } from '../binance/redact';

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

export async function createFlow(input: {
  amountSol: string;
  depositAddress: string;
  destinationTag?: string | null;
}) {
  return prisma.transferFlow.create({
    data: {
      state: 'DRAFT',
      amountSol: input.amountSol,
      depositAddress: input.depositAddress,
      destinationTag: input.destinationTag ?? null,
      events: { create: { toState: 'DRAFT', note: 'Flow created' } },
    },
  });
}

export async function getFlow(id: string) {
  return prisma.transferFlow.findUnique({
    where: { id },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  });
}

export async function listFlows(limit = 20) {
  return prisma.transferFlow.findMany({
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
  id: string,
  to: FlowState,
  patch: TransitionPatch = {},
  note?: string,
) {
  const current = await prisma.transferFlow.findUnique({ where: { id } });
  if (!current) throw new Error(`Flow ${id} not found`);

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
export async function noteError(id: string, error: unknown) {
  return prisma.transferFlow.update({
    where: { id },
    data: { lastError: redact(error) },
  });
}
