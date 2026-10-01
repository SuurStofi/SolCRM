/**
 * Runs once when the server starts.
 *
 * Autotrade's timer lives in the route-handler world (it needs Prisma and the
 * Binance client, which are server-only modules), so rather than import them
 * here, this asks the server for /api/autotrade once it is listening. The
 * route starts the timer before it checks the session, so the unauthenticated
 * request is enough -- it gets a 401 and the timer is running.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  warnOnMisconfiguredEncryptionKey();

  const port = process.env.PORT ?? '3000';
  const url = `http://127.0.0.1:${port}/api/autotrade`;

  // The server is not listening yet while register() runs; try a few times.
  void (async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      try {
        await fetch(url, { cache: 'no-store' });
        return;
      } catch {
        /* not up yet */
      }
    }
    console.warn('[autotrade] could not start background checks; they start on first page load');
  })();
}

/**
 * Check APP_ENCRYPTION_KEY at startup.
 *
 * Without it, everything works until the moment the user saves their Binance
 * key, which then fails with a 500 from deep inside a form submit. Reporting it
 * at boot points at the cause instead.
 *
 * Deliberately a warning, not a throw: the dashboard, wallet and P2P search do
 * not need the key, so an unconfigured install should still start.
 */
function warnOnMisconfiguredEncryptionKey(): void {
  const raw = process.env.APP_ENCRYPTION_KEY;

  if (!raw) {
    console.warn(
      '[config] APP_ENCRYPTION_KEY is not set, so Binance credentials cannot be saved.\n' +
        '         Generate one and put it in .env.local, then restart:\n' +
        '           node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
    return;
  }

  // Must be exactly 32 bytes for AES-256-GCM; a truncated or mistyped value
  // otherwise fails only on first use.
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length !== 32) {
    console.warn(
      `[config] APP_ENCRYPTION_KEY decodes to ${bytes.length} bytes; AES-256-GCM needs exactly 32. ` +
        'Binance credentials cannot be saved until this is a valid 32-byte base64 key.',
    );
  }
}
