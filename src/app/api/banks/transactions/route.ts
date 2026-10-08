import { userRoute } from '@/lib/auth/route';
import { listTransactions } from '@/lib/banks/store';
import { toTransactionDto } from '@/lib/banks/serialize';

export const dynamic = 'force-dynamic';

/** Stored bank transactions for this account, newest first. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const connectionId = params.get('connectionId') ?? undefined;
  const limit = Math.min(Number(params.get('limit')) || 100, 500);

  return userRoute(request, 'GET /api/banks/transactions', async (user) => {
    const rows = await listTransactions(user.id, { connectionId, limit });
    return { transactions: rows.map(toTransactionDto) };
  });
}
