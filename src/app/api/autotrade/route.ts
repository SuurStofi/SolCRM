
import { userRoute } from '@/lib/auth/route';
import { SafeError } from '@/lib/binance/redact';
import { getMyPayMethods } from '@/lib/binance/c2c';
import { isPositiveDecimal } from '@/lib/decimal';
import { prisma } from '@/lib/db';
import { getConfig, listRuns } from '@/lib/autotrade/store';
import { RUN_STATE_LABELS, type RunState } from '@/lib/autotrade/machine';
import {
  CHECK_INTERVAL_MS,
  checkUserOnce,
  findTrigger,
  parsePayIds,
  publishAd,
  reportAdMissing,
  settleConvert,
} from '@/lib/autotrade/engine';
import { ensureScheduler } from '@/lib/autotrade/scheduler';

export const dynamic = 'force-dynamic';

const FIAT = /^[A-Z]{3}$/;
const PAY_METHOD = /^[A-Za-z0-9_-]{1,40}$/;

async function snapshot(userId: string) {
  const [config, runs] = await Promise.all([getConfig(userId), listRuns(userId)]);
  return {
    config: config && { ...config, payIds: parsePayIds(config.payIds) },
    runs: runs.map((run) => ({ ...run, label: RUN_STATE_LABELS[run.state as RunState] ?? run.state })),
    intervalMs: CHECK_INTERVAL_MS,
  };
}

/**
 * Autotrade settings and recent runs. `?payMethods=1` also lists the user's
 * own Binance P2P payment methods (a signed call, so only on request).
 */
export async function GET(request: Request) {
  ensureScheduler();
  const withMethods = new URL(request.url).searchParams.get('payMethods') === '1';

  return userRoute(
    request,
    'GET /api/autotrade',
    async (user) => {
      const base = await snapshot(user.id);
      if (!withMethods) return base;
      try {
        return { ...base, payMethods: await getMyPayMethods(), payMethodsError: null };
      } catch (error) {
        return {
          ...base,
          payMethods: [],
          payMethodsError: error instanceof Error ? error.message : String(error),
        };
      }
    },
    { binance: withMethods },
  );
}

/**
 * Actions:
 *   save        store settings; always disarms, so a changed setting is
 *               never traded on without being armed again
 *   arm/disarm  switch the background checks on or off
 *   check       run one check now (armed: may trade; unarmed: preview only)
 *   settle      read back an unconfirmed convert order
 *   retry-ad    publish the ad again after Binance refused it
 *   ad-missing  the user checked Binance; an unconfirmed ad is not there
 */
export async function POST(request: Request) {
  ensureScheduler();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? '');

  return userRoute(
    request,
    `POST /api/autotrade (${action})`,
    async (user) => {
      switch (action) {
        case 'save': {
          const fiat = String(body.fiat ?? '').trim().toUpperCase();
          const minPrice = String(body.minPrice ?? '').trim();
          const amountSol = String(body.amountSol ?? '').trim();
          const minOrderFiat = String(body.minOrderFiat ?? '').trim();
          const buyerMethod = String(body.buyerMethod ?? '').trim() || null;
          const payTimeLimit = Number(body.payTimeLimit ?? 15);
          const payIds = Array.isArray(body.payIds)
            ? body.payIds.filter((v): v is number => Number.isInteger(v))
            : [];

          if (!FIAT.test(fiat)) throw new SafeError('Fiat must be a 3-letter code, e.g. UAH.', { status: 400 });
          if (!isPositiveDecimal(minPrice)) throw new SafeError('Enter the lowest USDT price, e.g. 41.5.', { status: 400 });
          if (!isPositiveDecimal(amountSol)) throw new SafeError('Enter how much SOL to sell per run.', { status: 400 });
          if (!isPositiveDecimal(minOrderFiat)) throw new SafeError("Enter the ad's minimum order in fiat.", { status: 400 });
          if (buyerMethod !== null && !PAY_METHOD.test(buyerMethod)) {
            throw new SafeError('Invalid payment method identifier.', { status: 400 });
          }
          if (!Number.isInteger(payTimeLimit) || payTimeLimit < 15 || payTimeLimit > 180) {
            throw new SafeError('Payment time limit must be 15–180 minutes.', { status: 400 });
          }

          const data = {
            fiat,
            minPrice,
            amountSol,
            minOrderFiat,
            buyerMethod,
            payTimeLimit,
            payIds: JSON.stringify(payIds),
            enabled: false,
          };
          await prisma.autoTradeConfig.upsert({
            where: { userId: user.id },
            create: { userId: user.id, ...data },
            update: data,
          });
          return snapshot(user.id);
        }

        case 'arm':
        case 'disarm': {
          const config = await getConfig(user.id);
          if (!config) throw new SafeError('Save the settings first.', { status: 409 });
          if (action === 'arm' && body.confirm !== true) {
            throw new SafeError('Arming needs explicit confirmation.', { status: 400 });
          }
          await prisma.autoTradeConfig.update({
            where: { userId: user.id },
            data: {
              enabled: action === 'arm',
              lastCheck: action === 'arm' ? 'Armed — first check within a minute.' : 'Switched off.',
              lastCheckAt: new Date(),
            },
          });
          return snapshot(user.id);
        }

        case 'check': {
          const config = await getConfig(user.id);
          if (!config) throw new SafeError('Save the settings first.', { status: 409 });
          if (!config.enabled) {
            // Preview only: what an armed check would find, with no trading.
            const { trigger, note } = await findTrigger({
              fiat: config.fiat,
              minPrice: config.minPrice,
              amountSol: config.amountSol,
              buyerMethod: config.buyerMethod,
              payIds: parsePayIds(config.payIds),
              minOrderFiat: config.minOrderFiat,
              payTimeLimit: config.payTimeLimit,
            });
            return { ...(await snapshot(user.id)), preview: trigger ? `Would trade now: ${note}` : note };
          }
          const result = await checkUserOnce(user.id);
          return { ...(await snapshot(user.id)), result };
        }

        case 'settle':
        case 'retry-ad':
        case 'ad-missing': {
          const id = String(body.id ?? '');
          if (action === 'settle') await settleConvert(user.id, id);
          else if (action === 'retry-ad') await publishAd(user.id, id);
          else await reportAdMissing(user.id, id);
          return snapshot(user.id);
        }

        default:
          throw new SafeError('Unknown action.', { status: 400 });
      }
    },
    // settle / retry-ad act on the user's Binance account. An armed 'check'
    // loads the key itself (checkUser), and only once a buyer qualifies, so a
    // preview works before any key is linked.
    { binance: action === 'settle' || action === 'retry-ad' },
  );
}

