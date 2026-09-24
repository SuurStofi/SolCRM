import 'server-only';

import { prisma } from '../db';
import { SafeError, redact } from '../binance/redact';
import { getFreeBalances } from '../binance/account';
import {
  applySolWithdraw,
  findSolWithdraw,
  getSolWithdrawConfig,
  isWithdrawCompleted,
  isWithdrawFailed,
  provablyNotExecuted,
} from '../binance/withdraw';
import { compareDecimal, floorToStep, minDecimal } from '../decimal';
import { isWalletOfUser } from '../account/store';
import { withdrawOrderId, type BuyState } from './machine';
import { requireBuy, transitionBuy, patchBuy } from './store';

/**
 * The withdrawal leg of a purchase. Must run inside withBinanceCredentials.
 * See machine.ts for why the order of writes here matters.
 */

/** A withdrawal still missing from Binance's history after this is treated as never sent. */
const NOT_FOUND_GRACE_MS = 2 * 60 * 1000;

export async function runWithdraw(userId: string, id: string, requestedDestination?: string) {
  const flow = await requireBuy(userId, id);
  const state = flow.state as BuyState;
  if (state !== 'CONVERTED' && state !== 'WITHDRAW_FAILED') {
    throw new SafeError(`Nothing to withdraw in state ${state}.`, { status: 409 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.autoWithdraw) {
    throw new SafeError(
      'Withdrawals are switched off for this account. Turn on auto-withdraw under Account, or withdraw in Binance yourself.',
      { status: 409 },
    );
  }

  const destination = requestedDestination ?? flow.destination;
  if (!destination || !(await isWalletOfUser(userId, destination))) {
    throw new SafeError('Withdrawals only go to a wallet linked to this account.', {
      status: 403,
    });
  }

  // A retry first settles what happened to the previous attempt: if Binance
  // has it and it did not fail, it is adopted rather than sent again.
  let attempt = flow.withdrawAttempt;
  if (attempt > 0) {
    const previous = await findSolWithdraw(withdrawOrderId(flow.id, attempt));
    if (previous && !isWithdrawFailed(previous.status)) {
      return transitionBuy(
        userId,
        id,
        'WITHDRAW_REQUESTED',
        { withdrawId: previous.id, withdrawTxId: previous.txId ?? null, lastError: null },
        'Found the previous withdrawal on Binance; not sending another',
      );
    }
    // Proven failed: a fresh attempt gets a fresh id. Not found at all: it
    // never registered, so the same id is safe to reuse.
    if (previous) attempt += 1;
  } else {
    attempt = 1;
  }

  const config = await getSolWithdrawConfig();
  if (!config.withdrawEnable) {
    return failBeforeSend(userId, id, state, 'Binance has SOL withdrawals suspended right now. The SOL stays on Binance; retry later.');
  }

  const bought = flow.solReceived ?? '0';
  const free = (await getFreeBalances()).SOL ?? '0';
  const amount = floorToStep(minDecimal(bought, free), config.withdrawIntegerMultiple);
  if (compareDecimal(amount, config.withdrawMin) < 0) {
    return failBeforeSend(
      userId,
      id,
      state,
      `${amount} SOL is below Binance's withdrawal minimum of ${config.withdrawMin} SOL. The SOL stays on Binance.`,
    );
  }

  // Recorded BEFORE sending: if the response is lost, the order id stored
  // here is how the withdrawal is found again.
  await transitionBuy(
    userId,
    id,
    'WITHDRAW_REQUESTED',
    {
      destination,
      withdrawAttempt: attempt,
      withdrawAmount: amount,
      withdrawFee: config.withdrawFee,
      withdrawId: null,
      withdrawTxId: null,
      lastError: null,
    },
    `Withdrawing ${amount} SOL to ${destination} (fee ${config.withdrawFee} SOL)`,
  );

  try {
    const result = await applySolWithdraw({
      address: destination,
      amount,
      withdrawOrderId: withdrawOrderId(flow.id, attempt),
    });
    return patchBuy(userId, id, { withdrawId: String(result.id) });
  } catch (error) {
    if (provablyNotExecuted(error)) {
      return transitionBuy(userId, id, 'WITHDRAW_FAILED', { lastError: redact(errorText(error)) }, 'Binance rejected the withdrawal');
    }
    // Outcome unknown: stay in WITHDRAW_REQUESTED. A status check resolves it.
    return patchBuy(userId, id, {
      lastError: `No answer from Binance -- the withdrawal may or may not have been accepted. Use "Check withdrawal" before retrying. (${errorText(error)})`,
    });
  }
}

/** Ask Binance where a requested withdrawal stands. */
export async function refreshWithdraw(userId: string, id: string) {
  const flow = await requireBuy(userId, id);
  if (flow.state !== 'WITHDRAW_REQUESTED') return flow;

  const record = await findSolWithdraw(withdrawOrderId(flow.id, flow.withdrawAttempt));

  if (!record) {
    // Binance lists a withdrawal almost immediately; one still absent after
    // the grace period was never accepted, and retrying will reuse its id.
    if (Date.now() - flow.updatedAt.getTime() > NOT_FOUND_GRACE_MS) {
      return transitionBuy(userId, id, 'WITHDRAW_FAILED', { lastError: 'Binance has no record of this withdrawal; nothing was sent.' }, 'Withdrawal not found on Binance');
    }
    return flow;
  }

  if (isWithdrawCompleted(record.status)) {
    return transitionBuy(
      userId,
      id,
      'WITHDRAWN',
      { withdrawId: record.id, withdrawTxId: record.txId ?? null, withdrawnAt: new Date(), lastError: null },
      'Withdrawal completed',
    );
  }
  if (isWithdrawFailed(record.status)) {
    return transitionBuy(
      userId,
      id,
      'WITHDRAW_FAILED',
      { withdrawId: record.id, lastError: `Binance reports the withdrawal ${record.status === 1 ? 'cancelled' : 'failed'}${record.info ? `: ${record.info}` : ''}.` },
      'Withdrawal failed on Binance',
    );
  }
  return patchBuy(userId, id, { withdrawId: record.id, withdrawTxId: record.txId ?? null, lastError: null });
}

/** A check that failed before anything was sent -- safe to call failed. */
async function failBeforeSend(userId: string, id: string, state: BuyState, message: string) {
  if (state === 'WITHDRAW_FAILED') return patchBuy(userId, id, { lastError: message });
  return transitionBuy(userId, id, 'WITHDRAW_FAILED', { lastError: message }, 'Withdrawal not sent');
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
