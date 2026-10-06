import 'server-only';

import crypto from 'node:crypto';
import { SafeError } from '../binance/redact';

/**
 * At-rest encryption for users' Binance API credentials.
 *
 * AES-256-GCM with a server key from APP_ENCRYPTION_KEY. The owning user's id
 * is passed as additional authenticated data, so a ciphertext copied onto
 * another user's row fails to decrypt instead of quietly handing that user
 * someone else's exchange account.
 *
 * Stored format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 */

const VERSION = 'v1';

function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new SafeError(
      'APP_ENCRYPTION_KEY is not configured. Generate one with `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"` and put it in .env.local.',
      { status: 500 },
    );
  }
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length !== 32) {
    throw new SafeError('APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded.', {
      status: 500,
    });
  }
  return bytes;
}

export function encryptForUser(userId: string, plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(userId, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptForUser(userId: string, stored: string): string {
  const [version, iv, tag, ciphertext] = stored.split('.');
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new SafeError('Stored Binance credentials are in an unknown format. Save the key again.', {
      status: 500,
    });
  }
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(userId, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Wrong APP_ENCRYPTION_KEY (rotated or lost) is by far the likeliest cause.
    throw new SafeError(
      'Stored Binance credentials could not be decrypted -- APP_ENCRYPTION_KEY may have changed. Save the key again.',
      { status: 500 },
    );
  }
}
