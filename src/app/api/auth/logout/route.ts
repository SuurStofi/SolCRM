import { NextResponse } from 'next/server';
import { endSession } from '@/lib/auth/session';
import { isSameOrigin } from '@/lib/auth/route';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ ok: false, error: 'Cross-origin request refused.' }, { status: 403 });
  }
  await endSession();
  return NextResponse.json({ ok: true, data: null });
}
