import 'server-only';

import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

/**
 * Prisma singleton.
 *
 * Prisma 7 requires an explicit driver adapter -- a bare `new PrismaClient()`
 * throws, since the datasource URL no longer lives in schema.prisma.
 *
 * The singleton matters in dev: Next.js reloads modules on every edit, which
 * would otherwise open a new connection per reload until SQLite complains.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? 'file:./prisma/dev.db';
  // The adapter wants a filesystem path, not a `file:` URL.
  const adapter = new PrismaBetterSqlite3({ url });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
