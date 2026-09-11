import { NextResponse } from 'next/server';

/**
 * Solana RPC proxy.
 *
 * Why this exists: public Solana RPC endpoints reject browser traffic. They
 * answer normally to a server-side request but return
 *   403 {"error":{"code":403,"message":"Access forbidden"}}
 * as soon as an `Origin` header is present. Calling them directly from the
 * wallet panel therefore always fails, regardless of rate limits.
 *
 * Proxying through this route strips the browser Origin and makes the request
 * server-side. It also means a paid RPC key can live in SOLANA_RPC_URL
 * (server-only) rather than NEXT_PUBLIC_SOLANA_RPC_URL, which would ship the
 * key to every visitor.
 */

export const dynamic = 'force-dynamic';

/** Server-side endpoint. Falls back to the public one, which works from here. */
function endpoint(): string {
  return (
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    'https://api.mainnet-beta.solana.com'
  );
}

/** JSON-RPC methods this app actually uses. */
const ALLOWED_METHODS = new Set([
  'getBalance',
  'getSignaturesForAddress',
  'getTokenAccountsByOwner',
  'getParsedTokenAccountsByOwner',
  'getAccountInfo',
  'getLatestBlockhash',
  'getSignatureStatuses',
  'getTransaction',
  'getSlot',
  'getMinimumBalanceForRentExemption',
  'getFeeForMessage',
  'sendTransaction',
  'simulateTransaction',
  'getVersion',
  'getHealth',
  'getEpochInfo',
  'getMultipleAccounts',
  'getTokenAccountBalance',
  'getRecentPrioritizationFees',
  'isBlockhashValid',
]);

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
      { status: 400 },
    );
  }

  // web3.js batches calls, so the body may be a single object or an array.
  const calls = Array.isArray(body) ? body : [body];
  for (const call of calls) {
    const method = (call as { method?: unknown })?.method;
    if (typeof method !== 'string' || !ALLOWED_METHODS.has(method)) {
      return NextResponse.json(
        {
          jsonrpc: '2.0',
          id: (call as { id?: unknown })?.id ?? null,
          error: {
            code: -32601,
            message: `Method not allowed through this proxy: ${String(method)}`,
          },
        },
        { status: 400 },
      );
    }
  }

  try {
    const upstream = await fetch(endpoint(), {
      method: 'POST',
      // Deliberately no Origin/Referer: their presence is what triggers 403.
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (cause) {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32603,
          message: `RPC proxy could not reach the upstream endpoint: ${
            cause instanceof Error ? cause.message : 'unknown error'
          }`,
        },
      },
      { status: 502 },
    );
  }
}
