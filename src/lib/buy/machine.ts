/**
 * State machine for a USDT -> SOL purchase on Binance.
 *
 * The convert leg mirrors the sell flow's. The withdrawal leg only exists
 * when the account has auto-withdraw on; with it off, CONVERTED is where a
 * purchase ends and the SOL stays on Binance.
 *
 * The withdrawal is the dangerous step: it moves money off the exchange, and
 * a request whose response is lost may still have executed. So:
 *   WITHDRAW_REQUESTED is entered BEFORE the request is sent, with the order
 *     id that will identify it, so an interrupted send is always findable;
 *   WITHDRAW_FAILED is only entered once Binance has proven nothing moved
 *     (rejected the request, or reports the withdrawal failed/cancelled);
 *   a retry first asks Binance about the previous attempt before sending.
 */

export const BUY_STATES = [
  'CONVERT_QUOTED',
  'CONVERTED',
  'WITHDRAW_REQUESTED',
  'WITHDRAWN',
  'CONVERT_FAILED',
  'WITHDRAW_FAILED',
] as const;

export type BuyState = (typeof BUY_STATES)[number];

const TRANSITIONS: Record<BuyState, readonly BuyState[]> = {
  // Re-quoting in place replaces an expired quote.
  CONVERT_QUOTED: ['CONVERTED', 'CONVERT_FAILED', 'CONVERT_QUOTED'],
  // Bought; SOL is on Binance. Terminal unless a withdrawal follows.
  CONVERTED: ['WITHDRAW_REQUESTED', 'WITHDRAW_FAILED'],
  // Sent (or being sent) to Binance; settles over minutes.
  WITHDRAW_REQUESTED: ['WITHDRAWN', 'WITHDRAW_FAILED'],
  WITHDRAWN: [],

  // USDT never left; quote again.
  CONVERT_FAILED: ['CONVERT_QUOTED'],
  // SOL is still on Binance; retry the withdrawal only.
  WITHDRAW_FAILED: ['WITHDRAW_REQUESTED'],
};

export function assertBuyTransition(from: BuyState, to: BuyState): void {
  if (!TRANSITIONS[from]?.includes(to)) {
    throw new Error(
      `Invalid buy transition ${from} -> ${to}. Allowed from ${from}: ${TRANSITIONS[from]?.join(', ') || '(none, terminal)'}`,
    );
  }
}

export function isBuyFailure(state: BuyState): boolean {
  return state === 'CONVERT_FAILED' || state === 'WITHDRAW_FAILED';
}

export const BUY_STATE_LABELS: Record<BuyState, string> = {
  CONVERT_QUOTED: 'Price received',
  CONVERTED: 'Bought · SOL is on Binance',
  WITHDRAW_REQUESTED: 'Withdrawing to wallet',
  WITHDRAWN: 'In your wallet',
  CONVERT_FAILED: 'Buy failed',
  WITHDRAW_FAILED: 'Withdrawal failed',
};

/** Our id for one withdrawal attempt of a purchase. */
export function withdrawOrderId(flowId: string, attempt: number): string {
  return `${flowId}-w${attempt}`;
}
