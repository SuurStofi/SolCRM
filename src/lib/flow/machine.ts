/**
 * State machine for a SOL -> Binance -> USDT run.
 *
 * Why a machine and not a few booleans: the legs fail independently. The case
 * that matters is a transfer that lands on-chain, gets credited by Binance,
 * and then fails at convert -- the SOL is sitting on Binance and the run must
 * be resumable from exactly that point, not restarted or reported as "failed".
 *
 * Two distinct notions of "confirmed" are tracked separately on purpose:
 *   CHAIN_CONFIRMED  -- the Solana network finalized the transfer
 *   BINANCE_CREDITED -- Binance credited the deposit to the spot wallet
 * Binance credit lags chain confirmation, typically by minutes. Collapsing
 * them would either claim success while the funds are untradeable, or look
 * stuck when it is merely waiting.
 */

export const FLOW_STATES = [
  'DRAFT',
  'AWAITING_SIGNATURE',
  'SUBMITTED',
  'CHAIN_CONFIRMED',
  'BINANCE_CREDITED',
  'CONVERT_QUOTED',
  'CONVERTED',
  'CHAIN_FAILED',
  'CREDIT_TIMEOUT',
  'CONVERT_FAILED',
] as const;

export type FlowState = (typeof FLOW_STATES)[number];

/** Allowed transitions. Anything not listed here is a bug. */
const TRANSITIONS: Record<FlowState, readonly FlowState[]> = {
  // Built the intent (amount + deposit address), nothing signed yet.
  DRAFT: ['AWAITING_SIGNATURE', 'CHAIN_FAILED'],
  // Handed to the wallet; user may still reject in Phantom.
  AWAITING_SIGNATURE: ['SUBMITTED', 'CHAIN_FAILED', 'DRAFT'],
  // Broadcast; waiting on the network.
  SUBMITTED: ['CHAIN_CONFIRMED', 'CHAIN_FAILED'],
  // On-chain done. Funds are NOT yet usable on Binance.
  CHAIN_CONFIRMED: ['BINANCE_CREDITED', 'CREDIT_TIMEOUT'],
  // Binance credited the deposit; SOL is now tradeable.
  BINANCE_CREDITED: ['CONVERT_QUOTED', 'CONVERT_FAILED'],
  // Quote obtained; it expires quickly (30s), hence its own state. Reachable
  // from itself because an expired quote is replaced in place rather than
  // unwinding the flow to BINANCE_CREDITED first.
  CONVERT_QUOTED: ['CONVERTED', 'CONVERT_FAILED', 'BINANCE_CREDITED', 'CONVERT_QUOTED'],

  // Terminal success.
  CONVERTED: [],

  // --- failure states ---
  // Nothing moved; safe to start over.
  CHAIN_FAILED: ['DRAFT'],
  // Chain confirmed but no credit seen yet. NOT terminal: credit may still
  // arrive, so this is re-checkable rather than a dead end.
  CREDIT_TIMEOUT: ['BINANCE_CREDITED'],
  // The money is on Binance as SOL. Retry the convert leg only -- never
  // re-send the transfer from here.
  CONVERT_FAILED: ['CONVERT_QUOTED', 'BINANCE_CREDITED'],
};

export function canTransition(from: FlowState, to: FlowState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: FlowState, to: FlowState): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `Invalid flow transition ${from} -> ${to}. Allowed from ${from}: ${TRANSITIONS[from]?.join(', ') || '(none, terminal)'}`,
    );
  }
}

export function isTerminal(state: FlowState): boolean {
  return TRANSITIONS[state].length === 0;
}

/** A failure the user can act on, as opposed to a state still in motion. */
export function isFailure(state: FlowState): boolean {
  return state === 'CHAIN_FAILED' || state === 'CREDIT_TIMEOUT' || state === 'CONVERT_FAILED';
}

/**
 * Whether the run can be picked up again, and what that would do. Drives the
 * "Resume" affordance in the UI.
 */
export function resumeAction(state: FlowState): string | null {
  switch (state) {
    case 'CHAIN_CONFIRMED':
      return 'Check whether Binance has credited the deposit';
    case 'CREDIT_TIMEOUT':
      return 'Re-check Binance for the deposit credit';
    case 'CONVERT_FAILED':
      return 'Retry the SOL -> USDT convert (funds are already on Binance)';
    case 'BINANCE_CREDITED':
      return 'Convert SOL -> USDT';
    case 'CHAIN_FAILED':
      return 'Start a new transfer (nothing was moved)';
    default:
      return null;
  }
}

export const STATE_LABELS: Record<FlowState, string> = {
  DRAFT: 'Draft',
  AWAITING_SIGNATURE: 'Awaiting your signature',
  SUBMITTED: 'Submitted to network',
  CHAIN_CONFIRMED: 'Confirmed on-chain',
  BINANCE_CREDITED: 'Credited on Binance',
  CONVERT_QUOTED: 'Quote received',
  CONVERTED: 'Converted to USDT',
  CHAIN_FAILED: 'Transfer failed',
  CREDIT_TIMEOUT: 'Awaiting Binance credit',
  CONVERT_FAILED: 'Convert failed',
};
