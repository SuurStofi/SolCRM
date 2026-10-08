import { userRoute } from '@/lib/auth/route';
import { buildTotals } from '@/lib/totals/aggregate';
import { buildActivity } from '@/lib/totals/activity';
import { DISPLAY_CURRENCIES, isDisplayCurrency, USD, getRate } from '@/lib/totals/rates';
import { spotPrice } from '@/lib/binance/market';
import { getFreeBalances } from '@/lib/binance/account';
import { loadBinanceCredentials } from '@/lib/binance/credentials';
import { withBinanceCredentials } from '@/lib/binance/client';

export const dynamic = 'force-dynamic';

/**
 * Everything the user has, in one currency.
 *
 * The wallet half is posted by the browser: the connection lives there, not on
 * the server, and this app never holds a key. Everything else is read here.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    currency?: unknown;
    wallet?: { address?: string; sol?: number; tokens?: Array<{ mint: string; amount: number }> };
  };

  const requested = Number(body.currency);
  const displayCurrency = isDisplayCurrency(requested) ? requested : USD;

  return userRoute(request, 'POST /api/totals', async (user) => {
    // SOL has no fixed value, so its price is fetched rather than assumed. A
    // failure leaves SOL out of the total and named, instead of guessed at.
    const solUsd = await spotPrice('SOLUSDT').catch(() => null);

    const result = await buildTotals(user.id, displayCurrency, {
      wallet: body.wallet?.address
        ? {
            address: body.wallet.address,
            sol: Number(body.wallet.sol ?? 0),
            tokens: body.wallet.tokens ?? [],
          }
        : undefined,
      solUsd,
    });

    // Binance balances are read here rather than in the aggregator so the
    // aggregator stays free of provider-specific plumbing.
    // Binance reports in USD terms, but the page may be showing UAH or EUR.
    // Assigning the USD figure straight to `converted` would understate every
    // Binance line by the exchange rate.
    const usdRate = await getRate(USD, displayCurrency);

    const credentials = await loadBinanceCredentials(user.id);
    if (credentials) {
      try {
        const balances = await withBinanceCredentials(credentials, () => getFreeBalances());
        for (const [asset, free] of Object.entries(balances)) {
          const amount = Number(free);
          if (!Number.isFinite(amount) || amount <= 0) continue;
          // "LD" assets are Simple Earn positions: real money, but not spot.
          const symbol = asset.startsWith('LD') ? asset.slice(2) : asset;
          const isStable = ['USDT', 'USDC', 'FDUSD', 'USD1', 'PYUSD'].includes(symbol);
          const isSol = symbol === 'SOL';
          if (!isStable && !isSol) continue;

          const usd = isSol ? (solUsd ? amount * solUsd : null) : amount;
          const converted = usd === null || !usdRate ? null : usd * usdRate.rate;
          result.sources.push({
            id: `binance-${asset}`,
            kind: 'binance',
            label: `${symbol} on Binance${asset.startsWith('LD') ? ' (Earn)' : ''}`,
            amount,
            currencyCode: USD,
            converted,
            asOf: new Date(),
            stale: false,
            liveness: 'live',
          });
          if (converted === null) result.unconvertible.push(symbol);
        }
      } catch {
        // Binance unreachable: the other sources still make a page.
        result.unconvertible.push('Binance');
      }
    }

    // Recomputed after Binance was folded in.
    result.total = result.sources
      .filter((line) => !line.excludedFromTotal && line.converted !== null)
      .reduce((sum, line) => sum + (line.converted ?? 0), 0);
    result.unconvertible = [...new Set(result.unconvertible)];

    const activity = await buildActivity(user.id);

    return { ...result, activity, currencies: DISPLAY_CURRENCIES };
  });
}
