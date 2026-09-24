import 'server-only';

import { prisma } from '../db';
import { encryptForUser, decryptForUser } from '../auth/encryption';
import type { BinanceCredentials } from './client';
import type { KeyRestrictions } from './account';
import { SafeError } from './redact';

/**
 * Per-user Binance API credentials, encrypted at rest. The decrypted secret
 * exists only inside a request that runs withBinanceCredentials; it is never
 * returned to the browser -- the UI gets `apiKeyHint` and nothing else.
 */

/**
 * Which keys an account may store, given its auto-withdraw setting.
 *
 *  - auto-withdraw off: no withdrawal permission at all. The app never
 *    withdraws, so a key that could only adds risk.
 *  - auto-withdraw on: withdrawals allowed, but only on an IP-restricted key
 *    (Binance insists on that too), so a leaked key is useless elsewhere.
 */
export function assertKeyAllowed(permissions: KeyRestrictions, autoWithdraw: boolean): void {
  if (!permissions.canRead) {
    throw new SafeError('This key lacks "Enable Reading", which every feature here needs.', {
      status: 422,
    });
  }
  if (permissions.canWithdraw && !autoWithdraw) {
    throw new SafeError(
      'This key has "Enable Withdrawals" switched on, but auto-withdraw is off for this account. Either turn withdrawals off on the key, or switch on auto-withdraw under Account first.',
      { status: 422 },
    );
  }
  if (permissions.canWithdraw && !permissions.ipRestricted) {
    throw new SafeError(
      "A key that can withdraw must be restricted to trusted IPs. Add this server's IP under \"Restrict access to trusted IPs only\" in Binance.",
      { status: 422 },
    );
  }
}

export async function saveBinanceCredentials(
  userId: string,
  creds: BinanceCredentials,
  permissions: KeyRestrictions,
) {
  const data = {
    apiKeyEnc: encryptForUser(userId, creds.apiKey),
    apiSecretEnc: encryptForUser(userId, creds.apiSecret),
    apiKeyHint: creds.apiKey.slice(-4),
    canTrade: permissions.canTrade,
    canWithdraw: permissions.canWithdraw,
    ipRestricted: permissions.ipRestricted,
  };
  await prisma.binanceCredential.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

export async function deleteBinanceCredentials(userId: string) {
  await prisma.binanceCredential.deleteMany({ where: { userId } });
}

export async function loadBinanceCredentials(
  userId: string,
): Promise<BinanceCredentials | null> {
  const row = await prisma.binanceCredential.findUnique({ where: { userId } });
  if (!row) return null;
  return {
    apiKey: decryptForUser(userId, row.apiKeyEnc),
    apiSecret: decryptForUser(userId, row.apiSecretEnc),
  };
}
