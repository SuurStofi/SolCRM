import 'server-only';

import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { prisma } from '../db';

/**
 * Cookie sessions backed by the Session table.
 *
 * The cookie is httpOnly (no script can read it) and SameSite=Lax (a
 * cross-site form cannot POST with it). Only the token's SHA-256 is stored.
 */

export const SESSION_COOKIE = 'solcrm_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function startSession(userId: string): Promise<void> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt } });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Plain http on localhost would never receive a Secure cookie.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  store.delete(SESSION_COOKIE);
}

export interface SessionUser {
  id: string;
}

/** The signed-in user, or null. Expired sessions are deleted on sight. */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  return { id: session.userId };
}
