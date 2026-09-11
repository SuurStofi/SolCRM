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
 * Reserve left behind so the account stays rent-exempt and can still pay fees.
 * Sending the entire balance leaves an account that cannot transact.
 */
const RESERVE_LAMPORTS = 5_000_000; // 0.005 SOL

export function maxSendableLamports(balanceLamports: number): number {
  return Math.max(0, balanceLamports - RESERVE_LAMPORTS);
}

export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

/**
 * Convert a decimal SOL string to lamports without floating point drift.
 * `0.1 * LAMPORTS_PER_SOL` is not exactly 100000000 in IEEE-754, and this
 * value decides how much money moves.
 */
export function solStringToLamports(amount: string): number {
  const [whole, fraction = ''] = amount.trim().split('.');
  const padded = (fraction + '000000000').slice(0, 9);
  return Number(BigInt(whole || '0') * BigInt(LAMPORTS_PER_SOL) + BigInt(padded));
}

export interface SendResult {
  signature: string;
}

export async function sendSolTransfer(
  connection: Connection,
  from: PublicKey,
  toAddress: string,
  amountSol: string,
  sendTransaction: WalletAdapterProps['sendTransaction'],
): Promise<SendResult> {
  const to = new PublicKey(toAddress);
  const lamports = solStringToLamports(amountSol);

  if (lamports <= 0) throw new Error('Amount must be greater than zero.');

  const balance = await connection.getBalance(from);
  if (lamports > maxSendableLamports(balance)) {
    throw new Error(
      `Amount exceeds the spendable balance. Keep at least ${lamportsToSol(
        RESERVE_LAMPORTS,
      )} SOL for fees and rent.`,
    );
  }

  const transaction = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }),
  );

  // A recent blockhash is required and expires quickly; fetch it immediately
  // before signing rather than reusing an older one.
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = from;

  const signature = await sendTransaction(transaction, connection);

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
