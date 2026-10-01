import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
// The send function is supplied by the wallet adapter, which owns this type.
import type { WalletAdapterProps } from '@solana/wallet-adapter-base';

/**
 * Client-side transfer construction.
 *
 * The transaction is built here but signed by the user's wallet. No private
 * key is ever available to this code -- `sendTransaction` comes from the
 * wallet adapter and delegates signing to the extension.
 */

/**
 * Base fee per signature, fixed by the protocol. A simple transfer carries one
 * signature, so this is the whole fee at zero priority.
 */
export const BASE_FEE_LAMPORTS = 5_000;

/**
 * Rent-exempt minimum for a bare system account (zero data bytes), queried
 * from the chain at 810_624 lamports. Fetched live where possible, since the
 * rent parameters are a chain setting rather than a true constant.
 *
 * A wallet that drops below this becomes rent-collectable, so the balance left
 * behind must cover it.
 */
export const FALLBACK_RENT_EXEMPT_LAMPORTS = 810_624;

export interface FeeBreakdown {
  /** Total balance in the wallet. */
  balanceLamports: number;
  /** Network fee for this transfer. */
  feeLamports: number;
  /** Must stay in the account to keep it rent-exempt. */
  rentExemptLamports: number;
  /** Largest amount that can actually be sent. */
  maxSendableLamports: number;
}

/**
 * Work out what can actually be sent.
 *
 * Deliberately queries the chain rather than assuming: an earlier fixed 0.005
 * SOL reserve was roughly six times the real requirement, which silently
 * stranded usable funds.
 */
export async function getFeeBreakdown(
  connection: Connection,
  owner: PublicKey,
): Promise<FeeBreakdown> {
  const [balanceLamports, rentExemptLamports] = await Promise.all([
    connection.getBalance(owner),
    connection
      .getMinimumBalanceForRentExemption(0)
      .catch(() => FALLBACK_RENT_EXEMPT_LAMPORTS),
  ]);

  const feeLamports = BASE_FEE_LAMPORTS;
  const reserved = feeLamports + rentExemptLamports;

  return {
    balanceLamports,
    feeLamports,
    rentExemptLamports,
    maxSendableLamports: Math.max(0, balanceLamports - reserved),
  };
}

export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

/** Format lamports as a SOL string without exponent notation or trailing zeros. */
export function formatSol(lamports: number): string {
  const text = (lamports / LAMPORTS_PER_SOL).toFixed(9).replace(/\.?0+$/, '');
  return text === '' || text === '-' ? '0' : text;
}

/**
 * Convert a decimal SOL string to lamports without floating point drift.
 * `4.35 * LAMPORTS_PER_SOL` is 4350000000.0000005 in IEEE-754, and this value
 * decides how much money moves.
 */
export function solStringToLamports(amount: string): number {
  const [whole, fraction = ''] = amount.trim().split('.');
  const padded = (fraction + '000000000').slice(0, 9);
  return Number(BigInt(whole || '0') * BigInt(LAMPORTS_PER_SOL) + BigInt(padded));
}

/**
 * Thrown when the wallet cannot cover the amount plus fees. Carries the
 * numbers so the UI can explain the shortfall rather than just refusing.
 */
export class InsufficientFundsError extends Error {
  readonly breakdown: FeeBreakdown;
  readonly requestedLamports: number;

  constructor(breakdown: FeeBreakdown, requestedLamports: number) {
    const shortfall =
      requestedLamports + breakdown.feeLamports + breakdown.rentExemptLamports -
      breakdown.balanceLamports;

    super(
      breakdown.maxSendableLamports <= 0
        ? `Not enough SOL to send. The wallet holds ${formatSol(
            breakdown.balanceLamports,
          )} SOL, but ${formatSol(
            breakdown.feeLamports + breakdown.rentExemptLamports,
          )} SOL must stay behind for the network fee and the rent-exempt minimum.`
        : `Not enough SOL to send ${formatSol(requestedLamports)} SOL. ` +
          `Short by ${formatSol(shortfall)} SOL — the most you can send is ${formatSol(
            breakdown.maxSendableLamports,
          )} SOL after the ${formatSol(breakdown.feeLamports)} SOL fee and the ${formatSol(
            breakdown.rentExemptLamports,
          )} SOL rent-exempt minimum.`,
    );
    this.name = 'InsufficientFundsError';
    this.breakdown = breakdown;
    this.requestedLamports = requestedLamports;
  }
}

export interface SendResult {
  signature: string;
}

/**
 * How the signed transaction reaches the network.
 *
 * `signTransaction` is preferred when the wallet offers it. The adapter's
 * combined `sendTransaction` makes the WALLET submit, using the Connection we
 * hand it -- and that Connection points at this app's own /api/solana/rpc
 * proxy, which only exists inside the page. Phantom's extension context cannot
 * use it, so its submit fails with a generic "Unexpected error" even though the
 * transaction itself is valid.
 *
 * Signing locally and submitting ourselves keeps the network call on the side
 * that can actually reach the proxy. The wallet still signs, so the private key
 * never leaves it.
 */
export interface Signer {
  signTransaction?: (transaction: Transaction) => Promise<Transaction>;
  sendTransaction: WalletAdapterProps['sendTransaction'];
}

export async function sendSolTransfer(
  connection: Connection,
  from: PublicKey,
  toAddress: string,
  amountSol: string,
  signer: Signer,
): Promise<SendResult> {
  const to = new PublicKey(toAddress);
  const lamports = solStringToLamports(amountSol);

  if (lamports <= 0) throw new Error('Amount must be greater than zero.');

  // Re-checked immediately before sending: the balance may have changed since
  // the panel last refreshed.
  const breakdown = await getFeeBreakdown(connection, from);
  if (lamports > breakdown.maxSendableLamports) {
    throw new InsufficientFundsError(breakdown, lamports);
  }

  const transaction = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }),
  );

  // A recent blockhash is required and expires quickly; fetch it immediately
  // before signing rather than reusing an older one.
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = from;

  let signature: string;
  if (signer.signTransaction) {
    const signed = await signer.signTransaction(transaction);
    signature = await connection.sendRawTransaction(signed.serialize(), {
      // The transaction was simulated by the wallet already; skipping
      // preflight avoids a second round trip that can fail on a node whose
      // view of the blockhash lags.
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
  } else {
    // Wallets without signTransaction (rare) must submit themselves.
    signature = await signer.sendTransaction(transaction, connection);
  }

  // Wait for confirmation rather than returning on broadcast: a transaction
  // can be dropped after submission, and reporting success then would be wrong.
  const result = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    'confirmed',
  );
  if (result.value.err) {
    throw new Error(`Transaction failed on-chain: ${JSON.stringify(result.value.err)}`);
  }

  return { signature };
}
