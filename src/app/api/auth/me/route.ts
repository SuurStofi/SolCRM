import { NextResponse } from 'next/server';
import { handleRoute } from '@/lib/binance/route-helpers';
import { currentUser } from '@/lib/auth/session';
import { accountSummary } from '@/lib/account/store';

export const dynamic = 'force-dynamic';

/** The signed-in account, or `null` -- signed out is not an error here. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: true, data: null });
  return handleRoute('GET /api/auth/me', () => accountSummary(user.id));
}
