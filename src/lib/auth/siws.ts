import 'server-only';

import crypto from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { prisma } from '../db';
import { SafeError } from '../binance/redact';

/**
 * Sign-In With Solana.
 *
 * The server issues a one-time message naming the wallet, the site and a
 * nonce; the wallet signs it (signMessage -- not a transaction, so nothing is
 * broadcast and no fee is paid); the server checks the ed25519 signature
 * against the wallet's public key. The same mechanism proves control of a
 * wallet being linked to an already signed-in account.
 *
 * Replay protection comes from the challenge row: it is deleted by the first
 * verification attempt, whatever the outcome, and expires after CHALLENGE_TTL.
 */

export type ChallengePurpose = 'LOGIN' | 'LINK';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export function normalizeAddress(value: unknown): string {
  try {
    const key = new PublicKey(String(value ?? ''));
    return key.toBase58();
  } catch {
    throw new SafeError('Not a valid Solana address.', { status: 400 });
  }
}

export async function issueChallenge(input: {
  address: string;
  purpose: ChallengePurpose;
  domain: string;
  userId?: string;
}) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);

  // The text says what signing does, because this is all the user sees in the
  // wallet prompt. The domain is included so a signature collected by another
  // site cannot be replayed here (and the wallet can show the mismatch).
  const statement =
    input.purpose === 'LOGIN'
      ? 'Sign in to SolCRM. This does not send a transaction or cost a fee.'
      : 'Link this wallet to your SolCRM account. This does not send a transaction or cost a fee.';

  const message = [
    `${input.domain} wants you to sign in with your Solana account:`,
    input.address,
    '',
    statement,
    '',
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');

  // Opportunistic cleanup keeps the table from growing with abandoned prompts.
  await prisma.authChallenge.deleteMany({ where: { expiresAt: { lt: issuedAt } } });
  await prisma.authChallenge.create({
    data: {
      id: nonce,
      address: input.address,
      purpose: input.purpose,
      userId: input.userId ?? null,
      message,
      expiresAt,
    },
  });

  return { nonce, message };
}

/**
 * Consume a challenge and verify its signature. Returns the challenge on
 * success; throws a 401 SafeError otherwise.
 */
export async function consumeChallenge(input: {
  nonce: string;
  purpose: ChallengePurpose;
  signature: string;
}) {
  const challenge = await prisma.authChallenge.findUnique({ where: { id: input.nonce } });

  // deleteMany rather than delete: with two concurrent verifications of the
  // same nonce, exactly one sees count === 1, so a signature is honoured once.
  const { count } = await prisma.authChallenge.deleteMany({ where: { id: input.nonce } });

  if (!challenge || count !== 1 || challenge.purpose !== input.purpose) {
    throw new SafeError('Sign-in request not found or already used. Try again.', { status: 401 });
  }
  if (challenge.expiresAt.getTime() < Date.now()) {
    throw new SafeError('Sign-in request expired. Try again.', { status: 401 });
  }

  let signature: Buffer;
  try {
    signature = Buffer.from(input.signature, 'base64');
  } catch {
    throw new SafeError('Malformed signature.', { status: 400 });
  }

  if (!verifyEd25519(challenge.address, challenge.message, signature)) {
    throw new SafeError('Signature does not match this wallet.', { status: 401 });
  }
  return challenge;
}

function verifyEd25519(address: string, message: string, signature: Buffer): boolean {
  if (signature.length !== 64) return false;
  const publicKey = crypto.createPublicKey({
    key: {
      kty: 'OKP',
      crv: 'Ed25519',
      x: Buffer.from(new PublicKey(address).toBytes()).toString('base64url'),
    },
    format: 'jwk',
  });
  return crypto.verify(null, Buffer.from(message, 'utf8'), publicKey, signature);
}
