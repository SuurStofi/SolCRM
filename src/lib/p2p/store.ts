import 'server-only';

import { prisma } from '../db';
import { SafeError } from '../binance/redact';

/**
 * Local archive of P2P trades.
 *
 * These rows are the user's own record, typed in by hand. Binance's API cannot
 * create an order on someone else's ad and exposes no chat history, so nothing
 * here is reconstructible from the exchange -- this file is the only copy.
 */

export const P2P_STATUSES = [
  'PENDING',
  'PAID',
  'COMPLETED',
  'CANCELLED',
  'DISPUTED',
] as const;

export type P2PStatus = (typeof P2P_STATUSES)[number];

export function isP2PStatus(value: string): value is P2PStatus {
  return (P2P_STATUSES as readonly string[]).includes(value);
}

export interface OrderInput {
  orderNumber: string;
  fiat: string;
  adNo?: string | null;
  asset?: string;
  tradeType?: string;
  amount?: string | null;
  price?: string | null;
  totalFiat?: string | null;
  payMethod?: string | null;
  counterpartyName?: string | null;
  notes?: string | null;
}

export async function listOrders(userId: string, limit = 50) {
  return prisma.p2POrder.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function createOrder(userId: string, input: OrderInput) {
  return prisma.p2POrder.create({
    data: {
      userId,
      orderNumber: input.orderNumber,
      fiat: input.fiat,
      adNo: input.adNo ?? null,
      asset: input.asset ?? 'USDT',
      tradeType: input.tradeType ?? 'SELL',
      amount: input.amount ?? null,
      price: input.price ?? null,
      totalFiat: input.totalFiat ?? null,
      payMethod: input.payMethod ?? null,
      counterpartyName: input.counterpartyName ?? null,
      notes: input.notes ?? null,
    },
  });
}

/**
 * Update a record by hand. `statusFromBinance` is cleared only when the status
 * itself changes, so editing a note does not relabel a status that genuinely
 * did come from Binance.
 */
export async function updateOrder(
  userId: string,
  id: string,
  patch: { status?: P2PStatus; notes?: string | null },
) {
  // Ownership is checked first: another user's order answers as not found.
  const existing = await prisma.p2POrder.findFirst({ where: { id, userId } });
  if (!existing) throw new SafeError('Order not found.', { status: 404 });

  return prisma.p2POrder.update({
    where: { id },
    data: {
      ...(patch.status === undefined
        ? {}
        : { status: patch.status, statusFromBinance: false }),
      ...(patch.notes === undefined ? {} : { notes: patch.notes }),
    },
  });
}
