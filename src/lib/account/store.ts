import 'server-only';

import { prisma } from '../db';
import { SafeError } from '../binance/redact';

/**
 * Accounts and their linked wallets.
 */

/** The account a wallet signs in to, creating one on first sign-in. */
export async function findOrCreateUserForWallet(address: string): Promise<string> {
  const existing = await prisma.wallet.findUnique({ where: { address } });
  if (existing) return existing.userId;

  try {
    const user = await prisma.user.create({
      data: { wallets: { create: { address } } },
    });
    return user.id;
  } catch (error) {
    // Two first sign-ins for the same wallet racing: the loser hits the
    // unique index on address, and the winner's account is the right answer.
    if (isUniqueViolation(error)) {
      const winner = await prisma.wallet.findUnique({ where: { address } });
      if (winner) return winner.userId;
    }
    throw error;
  }
}

export async function linkWallet(userId: string, address: string) {
  const existing = await prisma.wallet.findUnique({ where: { address } });
  if (existing) {
    if (existing.userId === userId) return existing;
    // Moving a wallet between accounts silently would let whoever links it
    // second take over the first account's sign-in. Refuse instead.
    throw new SafeError(
      'This wallet is already linked to another account. Unlink it there first.',
      { status: 409 },
    );
  }
  try {
    return await prisma.wallet.create({ data: { userId, address } });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new SafeError('This wallet was just linked to another account.', { status: 409 });
    }
    throw error;
  }
}

export async function unlinkWallet(userId: string, address: string) {
  return prisma.$transaction(async (tx) => {
    const wallets = await tx.wallet.findMany({ where: { userId } });
    if (!wallets.some((w) => w.address === address)) {
      throw new SafeError('That wallet is not linked to this account.', { status: 404 });
    }
    // The last wallet is the only way back in: there is no password.
    if (wallets.length === 1) {
      throw new SafeError(
        'Cannot unlink the only wallet on the account -- you would be unable to sign in again.',
        { status: 409 },
      );
    }
    await tx.wallet.delete({ where: { address } });
  });
}

export async function isWalletOfUser(userId: string, address: string): Promise<boolean> {
  const wallet = await prisma.wallet.findUnique({ where: { address } });
  return wallet?.userId === userId;
}

/** Everything the browser may know about the account. No secrets. */
export async function accountSummary(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      wallets: { orderBy: { createdAt: 'asc' } },
      binance: {
        select: {
          apiKeyHint: true,
          updatedAt: true,
          canTrade: true,
          canWithdraw: true,
          ipRestricted: true,
        },
      },
    },
  });
  if (!user) return null;
  return {
    id: user.id,
    createdAt: user.createdAt,
    autoWithdraw: user.autoWithdraw,
    wallets: user.wallets.map((w) => ({
      address: w.address,
      label: w.label,
      createdAt: w.createdAt,
    })),
    binance: user.binance,
  };
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
