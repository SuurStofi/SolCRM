import 'server-only';

import { prisma } from '../db';

/**
 * One timeline across everything that moved.
 *
 * Each source stores its own shape, so this flattens them into a single list
 * rather than making the UI understand five schemas. Only records that
 * actually represent movement are included: a draft transfer nobody signed is
 * not activity.
 */

export type ActivitySource = 'wallet' | 'binance' | 'bank' | 'paypal' | 'p2p';

export interface ActivityItem {
  id: string;
  source: ActivitySource;
  /** Short description, already in plain language. */
  title: string;
  /** Extra context: a counterparty, a card, a state. */
  detail?: string;
  /** Signed where direction is known; negative is money leaving. */
  amount?: string;
  unit?: string;
  at: string;
  /** Solana signature, for the explorer link. */
  signature?: string;
  /** Failed or cancelled, so the UI can mark it. */
  failed?: boolean;
}

export async function buildActivity(userId: string, limit = 40): Promise<ActivityItem[]> {
  const [transfers, buys, bankTx, orders] = await Promise.all([
    prisma.transferFlow.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.buyFlow.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.bankTransaction.findMany({
      where: { bankAccount: { connection: { userId } } },
      orderBy: { time: 'desc' },
      take: limit,
      include: {
        bankAccount: {
          select: { maskedPan: true, connection: { select: { label: true, provider: true } } },
        },
      },
    }),
    prisma.p2POrder.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
  ]);

  const items: ActivityItem[] = [];

  for (const flow of transfers) {
    // A draft that was never signed did not move anything.
    if (flow.state === 'DRAFT' || flow.state === 'AWAITING_SIGNATURE') continue;
    const failed = flow.state === 'CHAIN_FAILED' || flow.state === 'CONVERT_FAILED';
    items.push({
      id: `transfer-${flow.id}`,
      source: 'wallet',
      title: flow.usdtReceived ? 'Sold SOL for USDT' : 'Sent SOL to Binance',
      detail: flow.usdtReceived ? `Received ${flow.usdtReceived} USDT` : STATE_WORDS[flow.state],
      amount: `-${flow.amountSol}`,
      unit: 'SOL',
      at: (flow.convertedAt ?? flow.createdAt).toISOString(),
      signature: flow.txSignature ?? undefined,
      failed,
    });
  }

  for (const buy of buys) {
    if (!buy.solReceived && buy.state === 'CONVERT_QUOTED') continue;
    items.push({
      id: `buy-${buy.id}`,
      source: 'binance',
      title: 'Bought SOL with USDT',
      detail: buy.solReceived ? `Received ${buy.solReceived} SOL` : buy.state,
      amount: `-${buy.usdtAmount}`,
      unit: 'USDT',
      at: (buy.convertedAt ?? buy.createdAt).toISOString(),
      failed: buy.state.endsWith('FAILED'),
    });
  }

  for (const tx of bankTx) {
    const label = tx.bankAccount.connection.label ?? tx.bankAccount.connection.provider;
    const card = tx.bankAccount.maskedPan ? ` •• ${tx.bankAccount.maskedPan.slice(-4)}` : '';
    items.push({
      id: `bank-${tx.id}`,
      source: 'bank',
      title: tx.description || 'Card payment',
      detail: `${label}${card}${tx.counterName ? ` · ${tx.counterName}` : ''}`,
      // Minor units in the database; shown as a normal amount here.
      amount: formatMinor(tx.amount),
      unit: CURRENCY_NAMES[tx.currencyCode] ?? String(tx.currencyCode),
      at: tx.time.toISOString(),
    });
  }

  for (const order of orders) {
    items.push({
      id: `p2p-${order.id}`,
      source: 'p2p',
      title: `${order.tradeType === 'SELL' ? 'Sold' : 'Bought'} ${order.asset} with someone`,
      detail: [order.counterpartyName, order.status].filter(Boolean).join(' · '),
      amount: order.amount ? (order.tradeType === 'SELL' ? `-${order.amount}` : order.amount) : undefined,
      unit: order.asset,
      at: order.createdAt.toISOString(),
      failed: order.status === 'CANCELLED' || order.status === 'DISPUTED',
    });
  }

  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

const STATE_WORDS: Record<string, string> = {
  SUBMITTED: 'Sent, waiting for the network',
  CHAIN_CONFIRMED: 'On-chain, waiting for Binance',
  BINANCE_CREDITED: 'On Binance, ready to exchange',
  CREDIT_TIMEOUT: 'Still waiting for Binance',
  CONVERT_QUOTED: 'Price quoted',
  CONVERTED: 'Done',
  CHAIN_FAILED: 'Transfer failed',
  CONVERT_FAILED: 'Exchange failed',
};

const CURRENCY_NAMES: Record<number, string> = {
  980: 'UAH',
  840: 'USD',
  978: 'EUR',
  826: 'GBP',
  985: 'PLN',
};

/** Signed minor units to a decimal string, without touching a float. */
function formatMinor(minor: bigint): string {
  const negative = minor < BigInt(0);
  const digits = (negative ? -minor : minor).toString().padStart(3, '0');
  const whole = digits.slice(0, -2);
  const cents = digits.slice(-2);
  return `${negative ? '-' : ''}${whole}.${cents}`;
}
