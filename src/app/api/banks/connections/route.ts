import { NextResponse } from 'next/server';
import { userRoute } from '@/lib/auth/route';
import { getAdapter, parseProvider, enabledProviders } from '@/lib/banks';
import { encodePrivatCredential } from '@/lib/banks/privat';
import { SafeError } from '@/lib/binance/redact';
import {
  listConnections,
  createConnection,
  deleteConnection,
  upsertAccounts,
  markSynced,
} from '@/lib/banks/store';
import { toConnectionDto } from '@/lib/banks/serialize';

export const dynamic = 'force-dynamic';

/** The user's bank connections, plus which banks this server offers. */
export async function GET(request: Request) {
  return userRoute(request, 'GET /api/banks/connections', async (user) => {
    const rows = await listConnections(user.id);
    return {
      connections: rows.map(toConnectionDto),
      available: enabledProviders(),
    };
  });
}

/**
 * Connect a bank.
 *
 * The credential is checked against the bank before it is stored, so a typo
 * fails here rather than on the first sync. Consent is required explicitly:
 * the request must carry it, and the moment is recorded on the row.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    provider?: unknown;
    token?: unknown;
    clientId?: unknown;
    label?: unknown;
    consent?: unknown;
  };

  if (body.consent !== true) {
    return NextResponse.json(
      { ok: false, error: 'Please agree to the read-only terms before connecting a bank.' },
      { status: 400 },
    );
  }

  return userRoute(request, 'POST /api/banks/connections', async (user) => {
    const provider = parseProvider(body.provider);
    const adapter = getAdapter(provider);

    // Monobank takes one token; Privat24 AutoClient takes an id and a token.
    // Both are stored as one opaque string so the models stay provider-neutral.
    const token =
      provider === 'privat_business'
        ? encodePrivatCredential({
            id: String(body.clientId ?? '').trim(),
            token: String(body.token ?? '').trim(),
          })
        : String(body.token ?? '').trim();

    if (provider === 'privat_business' && !String(body.clientId ?? '').trim()) {
      throw new SafeError('Enter the AutoClient id from Privat24 for Business.', {
        status: 400,
      });
    }
    if (!String(body.token ?? '').trim()) {
      throw new SafeError('Paste your token.', { status: 400 });
    }

    // Verify first: an unusable credential should never reach the database.
    const info = await adapter.verify(token);

    const label = String(body.label ?? '').trim() || info.name || adapter.displayName;
    const connection = await createConnection({
      userId: user.id,
      provider,
      credential: token,
      label,
    });

    // The verify call already returned the accounts, so storing them here
    // avoids spending a second request against a one-per-minute limit.
    await upsertAccounts(connection.id, info.accounts);
    await markSynced(connection.id);

    const rows = await listConnections(user.id);
    return { connections: rows.map(toConnectionDto) };
  });
}

/** Disconnect: deletes the token and every stored balance and transaction. */
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!id) {
    return NextResponse.json({ ok: false, error: 'Missing connection id.' }, { status: 400 });
  }

  return userRoute(request, 'DELETE /api/banks/connections', async (user) => {
    await deleteConnection(user.id, id);
    const rows = await listConnections(user.id);
    return { connections: rows.map(toConnectionDto) };
  });
}
