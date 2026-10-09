import { NextResponse } from 'next/server';
import { userRoute } from '@/lib/auth/route';
import { SafeError } from '@/lib/binance/redact';
import { prisma } from '@/lib/db';
import { MAX_ACTIVE_ALERTS } from '@/lib/alerts/engine';
import { ensureScheduler } from '@/lib/autotrade/scheduler';

export const dynamic = 'force-dynamic';

const ASSETS = ['SOL', 'USDT', 'USDC'];
const SIDES = ['sell', 'buy'];
const SOURCES = ['binance', 'exchanger', 'both'];

function serialize(row: {
  id: string;
  asset: string;
  side: string;
  fiat: string;
  source: string;
  target: string;
  payMethod: string | null;
  merchantOnly: boolean;
  status: string;
  repeat: boolean;
  cooldownUntil: Date | null;
  lastPrice: string | null;
  lastCheckedAt: Date | null;
  triggeredAt: Date | null;
}) {
  return {
    ...row,
    cooldownUntil: row.cooldownUntil?.toISOString() ?? null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    triggeredAt: row.triggeredAt?.toISOString() ?? null,
  };
}

export async function GET(request: Request) {
  // An alert is useless if nothing is checking it, so reaching this route is
  // enough to start the timer -- it does not depend on Auto-sell being used.
  ensureScheduler();
  return userRoute(request, 'GET /api/alerts', async (user) => {
    const alerts = await prisma.priceAlert.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    return { alerts: alerts.map(serialize), max: MAX_ACTIVE_ALERTS };
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  ensureScheduler();
  return userRoute(request, 'POST /api/alerts', async (user) => {
    const asset = String(body.asset ?? '').toUpperCase();
    const side = String(body.side ?? '');
    const fiat = String(body.fiat ?? '').toUpperCase();
    const source = String(body.source ?? 'both');
    const target = String(body.target ?? '').trim();

    if (!ASSETS.includes(asset)) throw new SafeError('Pick a coin.', { status: 400 });
    if (!SIDES.includes(side)) throw new SafeError('Pick buy or sell.', { status: 400 });
    if (!/^[A-Z]{3}$/.test(fiat)) throw new SafeError('Pick a currency.', { status: 400 });
    if (!SOURCES.includes(source)) throw new SafeError('Pick where to watch.', { status: 400 });
    // Decimal string, never parsed to a float: this is the number the alert
    // compares against.
    if (!/^\d+(\.\d+)?$/.test(target) || Number(target) <= 0) {
      throw new SafeError('Enter the price you are waiting for.', { status: 400 });
    }

    const active = await prisma.priceAlert.count({
      where: { userId: user.id, status: 'active' },
    });
    if (active >= MAX_ACTIVE_ALERTS) {
      throw new SafeError(
        `You can have ${MAX_ACTIVE_ALERTS} alerts running at once. Turn one off first.`,
        { status: 422 },
      );
    }

    await prisma.priceAlert.create({
      data: {
        userId: user.id,
        asset,
        side,
        fiat,
        source,
        target,
        payMethod: String(body.payMethod ?? '').trim() || null,
        merchantOnly: body.merchantOnly === true,
        repeat: body.repeat === true,
      },
    });

    const alerts = await prisma.priceAlert.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    return { alerts: alerts.map(serialize), max: MAX_ACTIVE_ALERTS };
  });
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id ?? '');
  if (!id) return NextResponse.json({ ok: false, error: 'Missing id.' }, { status: 400 });

  return userRoute(request, 'PATCH /api/alerts', async (user) => {
    const status = String(body.status ?? '');
    if (!['active', 'off'].includes(status)) {
      throw new SafeError('Alerts can only be turned on or off.', { status: 400 });
    }

    // updateMany scoped by userId: an id belonging to someone else matches
    // nothing rather than updating their row.
    const { count } = await prisma.priceAlert.updateMany({
      where: { id, userId: user.id },
      data: {
        status,
        // Re-arming clears the trigger so it can fire again.
        ...(status === 'active' ? { triggeredAt: null, cooldownUntil: null } : {}),
      },
    });
    if (count === 0) throw new SafeError('Alert not found.', { status: 404 });

    const alerts = await prisma.priceAlert.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    return { alerts: alerts.map(serialize), max: MAX_ACTIVE_ALERTS };
  });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!id) return NextResponse.json({ ok: false, error: 'Missing id.' }, { status: 400 });

  return userRoute(request, 'DELETE /api/alerts', async (user) => {
    await prisma.priceAlert.deleteMany({ where: { id, userId: user.id } });
    const alerts = await prisma.priceAlert.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    return { alerts: alerts.map(serialize), max: MAX_ACTIVE_ALERTS };
  });
}
