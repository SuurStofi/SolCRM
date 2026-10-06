/**
 * State machine for one autotrade run: SOL -> USDT on Binance Convert, then a
 * P2P SELL ad for that USDT at the price of the buyer that triggered it.
 *
 * Both legs are recorded BEFORE they are sent, like the buy flow's
 * withdrawal, so an answer lost in transit is never mistaken for a failure:
 *
 *   CONVERT_QUOTED  quote taken; once an order id is recorded the SOL may be
 *                   gone, and the run stays here until Binance says how the
 *                   order ended ("Check order")
 *   AD_REQUESTED    about to publish / published with no answer yet. A lost
 *                   answer stays here: the user checks Binance, then either
 *                   reports the ad missing (AD_FAILED) or it shows up
 *   AD_FAILED       Binance refused the ad; the USDT is on Binance and the ad
 *                   can be retried
 */

export const RUN_STATES = [
  'CONVERT_QUOTED',
  'CONVERTED',
  'AD_REQUESTED',
  'AD_POSTED',
  'CONVERT_FAILED',
  'AD_FAILED',
] as const;

export type RunState = (typeof RUN_STATES)[number];

const TRANSITIONS: Record<RunState, readonly RunState[]> = {
  CONVERT_QUOTED: ['CONVERTED', 'CONVERT_FAILED'],
  CONVERTED: ['AD_REQUESTED'],
  AD_REQUESTED: ['AD_POSTED', 'AD_FAILED'],
  AD_POSTED: [],
  // Nothing was sold; the SOL is still on Binance.
  CONVERT_FAILED: [],
  AD_FAILED: ['AD_REQUESTED'],
};

export function assertRunTransition(from: RunState, to: RunState): void {
  if (!TRANSITIONS[from]?.includes(to)) {
    throw new Error(
      `Invalid autotrade transition ${from} -> ${to}. Allowed from ${from}: ${TRANSITIONS[from]?.join(', ') || '(none, terminal)'}`,
    );
  }
}

/** A run in any other state still needs attention and blocks a new one. */
export function isRunSettled(state: string): boolean {
  return state === 'AD_POSTED' || state === 'CONVERT_FAILED';
}

export const RUN_STATE_LABELS: Record<RunState, string> = {
  CONVERT_QUOTED: 'Exchanging SOL to USDT',
  CONVERTED: 'Exchanged · posting sale ad',
  AD_REQUESTED: 'Posting sale ad',
  AD_POSTED: 'Sale ad is live',
  CONVERT_FAILED: 'Exchange failed',
  AD_FAILED: 'Sale ad not posted',
};
