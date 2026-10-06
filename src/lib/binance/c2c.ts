import 'server-only';

import { binanceRequest, ensureTimeSynced } from './client';
import { SafeError } from './redact';

/**
 * P2P ad management through Binance's C2C "agent" SAPI endpoints.
 *
 * Source: binance/binance-skills-hub, skills/binance/p2p/references/
 * agent-sapi-api.md (read 2026-09-28). NOT yet verified against a live key.
 * What that reference says, and this module relies on:
 *
 *   - publishing needs MERCHANT permission; getAvailableAdsCategory tells
 *     which ad categories the account may publish, so it is the pre-check
 *   - SELL ads name payment methods by the user's own `payId`s, from
 *     getPayMethodByUserId
 *   - bodies are JSON; the signature covers the query string only, and the
 *     parameters must NOT be sorted (insertion order is what gets signed)
 *   - answers are wrapped: { code: "000000", message, data, success }
 *   - the agent endpoints expect User-Agent "binance-wallet/1.0.0 (Skill)"
 *
 * Creating orders on other people's ads and releasing coins are still not
 * possible through any API; only ads can be managed.
 */

const AGENT_HEADERS = { 'User-Agent': 'binance-wallet/1.0.0 (Skill)' };
const RECV_WINDOW = 60_000;

interface Wrapped<T> {
  code?: string;
  message?: string | null;
  data?: T;
  success?: boolean;
}

async function agentCall<T>(
  path: string,
  options: { method?: 'GET' | 'POST'; json?: unknown; noServerRetry?: boolean } = {},
): Promise<T> {
  await ensureTimeSynced();
  const body = await binanceRequest<Wrapped<T>>(path, {
    method: options.method ?? 'GET',
    signed: true,
    params: { recvWindow: RECV_WINDOW },
    json: options.json,
    headers: AGENT_HEADERS,
    noServerRetry: options.noServerRetry,
  });

  // Like the public ad list, these answer 200 even when they refuse.
  if (body.success === false || (body.code !== undefined && body.code !== '000000')) {
    throw new SafeError(
      `Binance P2P refused ${path}: ${body.message ?? body.code ?? 'no reason given'}`,
      // 4xx: the request was answered and refused, so nothing was created.
      { status: 422 },
    );
  }
  return body.data as T;
}

/** Ad categories this account may publish ("mass" is the ordinary one). */
export async function getPublishableCategories(): Promise<string[]> {
  const data = await agentCall<{ advClassifies?: string[] }>(
    '/sapi/v1/c2c/agent/ads/getAvailableAdsCategory',
  );
  return data?.advClassifies ?? [];
}

export interface PayMethod {
  payId: number;
  identifier: string;
  tradeMethodName: string;
}

/** The user's own payment methods, without account details. */
export async function getMyPayMethods(): Promise<PayMethod[]> {
  const data = await agentCall<PayMethod[]>('/sapi/v1/c2c/agent/ads/getPayMethodByUserId');
  return (data ?? []).filter((m) => typeof m.payId === 'number');
}

export interface SellAdInput {
  asset: string;
  fiat: string;
  /** Fixed price, fiat per unit, as a decimal string. */
  price: string;
  /** Total crypto on offer, as a decimal string. */
  amount: string;
  minOrderFiat: string;
  maxOrderFiat: string;
  payIds: number[];
  payTimeLimitMinutes: number;
  remarks?: string;
}

/**
 * Publish a fixed-price SELL ad and put it online. Returns the ad number.
 *
 * Not retried on a 5xx: an ad whose creation answer was lost may exist, and
 * a second one would offer the same USDT twice.
 */
export async function postSellAd(input: SellAdInput): Promise<string> {
  const advNo = await agentCall<string>('/sapi/v1/c2c/agent/ads/post', {
    method: 'POST',
    noServerRetry: true,
    json: {
      classify: 'mass',
      tradeType: 1, // 0 = BUY, 1 = SELL
      asset: input.asset,
      fiatUnit: input.fiat,
      priceType: 1, // fixed
      price: input.price,
      initAmount: input.amount,
      minSingleTransAmount: input.minOrderFiat,
      maxSingleTransAmount: input.maxOrderFiat,
      buyerKycLimit: 1,
      payTimeLimit: input.payTimeLimitMinutes,
      onlineNow: true,
      remarks: input.remarks,
      tradeMethods: input.payIds.map((payId) => ({ payId })),
    },
  });
  if (typeof advNo !== 'string' || !advNo) {
    throw new SafeError('Binance accepted the ad but returned no ad number. Check your ads on Binance.');
  }
  return advNo;
}
