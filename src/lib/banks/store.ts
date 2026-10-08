import 'server-only';

import { prisma } from '../db';
import { encryptForUser, decryptForUser } from '../auth/encryption';
import { SafeError, redact } from '../binance/redact';
import type { BankProvider, ProviderAccount, ProviderTransaction } from './types';

/**
 * Storage for bank connections.
 *
 * Every function takes the owning user's id and treats a connection belonging
 * to anyone else exactly like one that does not exist, so a guessed id cannot
 * read another account's bank data -- the same rule as transfers and P2P.
 *
 * The credential is encrypted with the per-user AES-256-GCM helper and is
 * never returned to the browser. Callers get `tokenHint` and nothing more.
 */

/** Default retention. Older transactions are purged on each sync. */
export const DEFAULT_RETENTION_DAYS = 90;

export function retentionDays(): number {
  const raw = Number(process.env.BANKS_RETENTION_DAYS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_RETENTION_DAYS;
}

export async function listConnections(userId: string) {
  return prisma.bankConnection.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    include: {
      accounts: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });
}

export async function getConnection(userId: string, id: string) {
  return prisma.bankConnection.findFirst({
    where: { id, userId },
    include: { accounts: true },
  });
}

export async function createConnection(input: {
  userId: string;
  provider: BankProvider;
  credential?: string;
  label?: string;
}) {
  return prisma.bankConnection.create({
    data: {
      userId: input.userId,
      provider: input.provider,
      credentialEnc: input.credential
        ? encryptForUser(input.userId, input.credential)
        : null,
      tokenHint: input.credential ? input.credential.slice(-4) : null,
      label: input.label ?? null,
      // Set here rather than defaulted in the schema: a row without an explicit
      // consent moment should not exist.
      consentAt: new Date(),
      status: 'active',
    },
  });
}

/**
 * The decrypted credential, for use inside one request only. Never return this
 * from a route.
 */
export async function loadCredential(userId: string, connectionId: string): Promise<string> {
  const row = await prisma.bankConnection.findFirst({
    where: { id: connectionId, userId },
    select: { credentialEnc: true },
  });
  if (!row?.credentialEnc) {
    throw new SafeError('That bank connection has no stored credential.', { status: 404 });
  }
  return decryptForUser(userId, row.credentialEnc);
}

/**
 * Disconnect means delete: the token, the accounts and every stored
 * transaction go. Cascades handle the children.
 */
export async function deleteConnection(userId: string, id: string) {
  const { count } = await prisma.bankConnection.deleteMany({ where: { id, userId } });
  if (count === 0) throw new SafeError('Bank connection not found.', { status: 404 });
}

export async function upsertAccounts(connectionId: string, accounts: ProviderAccount[]) {
  const now = new Date();
  for (const account of accounts) {
    const data = {
      maskedPan: account.maskedPan ?? null,
      iban: account.iban ?? null,
      currencyCode: account.currencyCode,
      balance: account.balance,
      creditLimit: account.creditLimit,
      accountType: account.accountType ?? null,
      balanceUpdatedAt: now,
    };
    await prisma.bankAccount.upsert({
      where: { connectionId_externalId: { connectionId, externalId: account.externalId } },
      create: { connectionId, externalId: account.externalId, ...data },
      update: data,
    });
  }
}

/**
 * Store transactions, ignoring ones already seen.
 *
 * Deduplication is by (account, externalId), which is what makes a webhook
 * delivery and a polling sync safe to run over the same period.
 */
export async function saveTransactions(
  bankAccountId: string,
  transactions: ProviderTransaction[],
): Promise<number> {
  let added = 0;
  for (const tx of transactions) {
    try {
      await prisma.bankTransaction.create({
        data: {
          bankAccountId,
          externalId: tx.externalId,
          time: tx.time,
          amount: tx.amount,
          operationAmount: tx.operationAmount ?? null,
          currencyCode: tx.currencyCode,
          description: tx.description,
          mcc: tx.mcc ?? null,
          hold: tx.hold,
          balance: tx.balance ?? null,
          counterName: tx.counterName ?? null,
          counterIban: tx.counterIban ?? null,
          comment: tx.comment ?? null,
        },
      });
      added += 1;
    } catch {
      // Unique violation: already stored. Any other failure would also be
      // swallowed here, which is acceptable for one row of a statement.
    }
  }
  return added;
}

/** Drop transactions older than the retention window. */
export async function purgeOldTransactions(bankAccountId: string): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays() * 24 * 60 * 60 * 1000);
  const { count } = await prisma.bankTransaction.deleteMany({
    where: { bankAccountId, time: { lt: cutoff } },
  });
  return count;
}

export async function listTransactions(
  userId: string,
  options: { connectionId?: string; limit?: number } = {},
) {
  return prisma.bankTransaction.findMany({
    where: {
      bankAccount: {
        connection: {
          userId,
          ...(options.connectionId ? { id: options.connectionId } : {}),
        },
      },
    },
    orderBy: { time: 'desc' },
    take: options.limit ?? 100,
    include: {
      bankAccount: {
        select: { maskedPan: true, currencyCode: true, connectionId: true },
      },
    },
  });
}

export async function markSynced(connectionId: string) {
  await prisma.bankConnection.update({
    where: { id: connectionId },
    data: { lastSyncedAt: new Date(), lastError: null, status: 'active' },
  });
}

export async function markError(connectionId: string, error: unknown) {
  await prisma.bankConnection.update({
    where: { id: connectionId },
    // Scrubbed before storage: a provider failure can carry the token, and
    // this row is rendered in the UI.
    data: { lastError: redact(error instanceof Error ? error.message : error), status: 'error' },
  });
}
