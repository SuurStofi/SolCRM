import { NextResponse } from 'next/server';
import { userRoute } from '@/lib/auth/route';
import { SafeError } from '@/lib/binance/redact';
import { getAdapter } from '@/lib/banks';
import { msUntilAllowed } from '@/lib/banks/monobank';
import {
  getConnection,
  loadCredential,
  upsertAccounts,
  saveTransactions,
  purgeOldTransactions,
  markSynced,
  markError,
  listConnections,
} from '@/lib/banks/store';
import { toConnectionDto } from '@/lib/banks/serialize';
import type { BankProvider } from '@/lib/banks/types';

export const dynamic = 'force-dynamic';

/**
 * Refresh one connection: balances, then recent transactions.
 *
 * Monobank allows one request per minute per token, so a full sync of several
 * accounts cannot happen in one go. This fetches balances every time (one
 * request) and transactions for a single account per call, which keeps each
 * sync inside the limit and lets the UI drive the rest.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    id?: unknown;
    accountId?: unknown;
    days?: unknown;
  };
  const id = String(body.id ?? '');
  if (!id) {
    return NextResponse.json({ ok: false, error: 'Missing connection id.' }, { status: 400 });
  }

  return userRoute(request, 'POST /api/banks/sync', async (user) => {
    const connection = await getConnection(user.id, id);
    if (!connection) throw new SafeError('Bank connection not found.', { status: 404 });

    const adapter = getAdapter(connection.provider as BankProvider);
    const credential = await loadCredential(user.id, id);

    // Report the wait instead of making the call and taking a 429: the user
    // gets a number to look at rather than an error.
    const wait = msUntilAllowed(credential);
    if (wait > 0) {
      throw new SafeError(
        `Monobank allows one refresh per minute. Try again in ${Math.ceil(wait / 1000)} seconds.`,
        { status: 429 },
      );
    }

    try {
      const accountExternalId = String(body.accountId ?? '');

      if (accountExternalId) {
        // Transactions for one account. The window is clamped to what the
        // provider accepts so an over-wide request fails here, not at the bank.
        const requestedDays = Number(body.days);
        const days = Number.isFinite(requestedDays) && requestedDays > 0 ? requestedDays : 30;
        const to = new Date();
        const from = new Date(
          Math.max(to.getTime() - days * 24 * 60 * 60 * 1000, to.getTime() - adapter.maxWindowMs),
        );

        const account = connection.accounts.find(
          (candidate: { id: string; externalId: string }) =>
            candidate.externalId === accountExternalId,
        );
        if (!account) throw new SafeError('Account not found on this connection.', { status: 404 });

        const transactions = await adapter.fetchTransactions(
          credential,
          accountExternalId,
          from,
          to,
        );
        const added = await saveTransactions(account.id, transactions);
        const purged = await purgeOldTransactions(account.id);
        await markSynced(id);

        const rows = await listConnections(user.id);
        return { added, purged, connections: rows.map(toConnectionDto) };
      }

      // No account named: refresh balances.
      const info = await adapter.fetchAccounts(credential);
      await upsertAccounts(id, info.accounts);
      await markSynced(id);

      const rows = await listConnections(user.id);
      return { connections: rows.map(toConnectionDto) };
    } catch (error) {
      // Recorded so the UI can explain a stale balance rather than silently
      // showing an old number.
      await markError(id, error).catch(() => undefined);
      throw error;
    }
  });
}
