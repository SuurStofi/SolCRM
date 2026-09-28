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
