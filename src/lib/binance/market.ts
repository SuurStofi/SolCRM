import 'server-only';

import { binanceRequest } from './client';
import { SafeError } from './redact';

/**
 * Last traded price for a spot symbol. Public and unsigned, but it still
 * spends this server's shared IP weight like every other Binance call.
 *
 * This is the market price, not what Convert would pay: a Convert quote
 * carries a small spread on top, so treat it as the upper bound of the
 * SOL -> USDT leg.
 */
export async function spotPrice(symbol: string): Promise<number> {
  const body = await binanceRequest<{ symbol?: string; price?: string }>('/api/v3/ticker/price', {
    params: { symbol },
  });
  const price = Number(body.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new SafeError(`Binance returned no usable price for ${symbol}.`);
  }
  return price;
}
