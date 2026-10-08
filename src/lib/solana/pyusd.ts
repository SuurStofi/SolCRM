import {
  Connection,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
  getMint,
  getTransferFeeConfig,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
} from '@solana/spl-token';

/**
 * PayPal USD (PYUSD) on Solana.
 *
 * Mint and properties verified on-chain on 2026-10-08 via getAccountInfo
 * against mainnet, not taken from a token list:
 *
 *   mint      2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo
 *   decimals  6
 *   program   TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb  (Token-2022)
 *   metadata  name "PayPal USD", symbol "PYUSD",
 *             uri https://token-metadata.paxos.com/pyusd_metadata/prod/solana/pyusd_metadata.json
 *
 * Issuer documentation: https://solana.com/news/pyusd-paypal-solana-developer
 * and the PYUSD on Solana white paper at
 * https://www.paypalobjects.com/devdoc/community/PYUSD-Solana-White-Paper.pdf
 *
 * PYUSD is a Token-2022 mint, NOT a legacy SPL token. Building a transfer with
 * the legacy program id fails outright, which is the single easiest way to get
 * this wrong.
 */

export const PYUSD_MINT = new PublicKey('2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo');

/** Devnet mint, for anyone testing without real money. */
export const PYUSD_MINT_DEVNET = new PublicKey(
  'CXk2AMBfi3TwaEL2468s6zP8xq9NxTXjp9gjMgzeUynM',
);

export const PYUSD_DECIMALS = 6;
export const PYUSD_PROGRAM_ID = TOKEN_2022_PROGRAM_ID;

/** Decimal string to base units, without going through a float. */
export function pyusdToBaseUnits(amount: string): bigint {
  const [whole, fraction = ''] = amount.trim().split('.');
  const padded = (fraction + '000000').slice(0, PYUSD_DECIMALS);
  return BigInt(whole || '0') * BigInt(10 ** PYUSD_DECIMALS) + BigInt(padded || '0');
}

export function formatPyusd(baseUnits: bigint): string {
  const negative = baseUnits < BigInt(0);
  const digits = (negative ? -baseUnits : baseUnits).toString().padStart(PYUSD_DECIMALS + 1, '0');
  const whole = digits.slice(0, -PYUSD_DECIMALS);
  const fraction = digits.slice(-PYUSD_DECIMALS).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export interface PyusdBalance {
  /** Base units (6 decimals). */
  amount: bigint;
  /** Whether the holder has a PYUSD token account at all. */
  hasAccount: boolean;
  tokenAccount: string;
}

/** PYUSD balance for a wallet. Zero when no token account exists yet. */
export async function getPyusdBalance(
  connection: Connection,
  owner: PublicKey,
): Promise<PyusdBalance> {
  const tokenAccount = await getAssociatedTokenAddress(
    PYUSD_MINT,
    owner,
    false,
    PYUSD_PROGRAM_ID,
  );
  try {
    const account = await getAccount(connection, tokenAccount, 'confirmed', PYUSD_PROGRAM_ID);
    return { amount: account.amount, hasAccount: true, tokenAccount: tokenAccount.toBase58() };
  } catch (error) {
    // No account yet is the normal state before the first deposit, not a fault.
    if (
      error instanceof TokenAccountNotFoundError ||
      error instanceof TokenInvalidAccountOwnerError
    ) {
      return { amount: BigInt(0), hasAccount: false, tokenAccount: tokenAccount.toBase58() };
    }
    throw error;
  }
}

export interface TransferFee {
  /** Hundredths of a percent. 0 today, but Paxos can change it. */
  basisPoints: number;
  /** Cap in base units. */
  maximumFee: bigint;
  /** What this transfer would actually cost, in base units. */
  feeForAmount: bigint;
}

/**
 * The transfer fee PYUSD would charge for an amount.
 *
 * Read rather than assumed: the mint carries a transferFeeConfig extension.
 * It is 0 basis points today, but the config exists and the authority can turn
 * it on, at which point a hardcoded zero would quietly short the recipient.
 */
export async function getPyusdTransferFee(
  connection: Connection,
  baseUnits: bigint,
): Promise<TransferFee> {
  const mint = await getMint(connection, PYUSD_MINT, 'confirmed', PYUSD_PROGRAM_ID);
  const config = getTransferFeeConfig(mint);
  if (!config) {
    return { basisPoints: 0, maximumFee: BigInt(0), feeForAmount: BigInt(0) };
  }
  const current = config.newerTransferFee;
  const basisPoints = current.transferFeeBasisPoints;
  const maximumFee = current.maximumFee;
  const raw = (baseUnits * BigInt(basisPoints)) / BigInt(10_000);
  return {
    basisPoints,
    maximumFee,
    feeForAmount: raw > maximumFee ? maximumFee : raw,
  };
}

/** A Solana address the user typed, checked before anything is signed. */
export function parseSolanaAddress(value: string): PublicKey {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Enter the PayPal PYUSD address.');
  let key: PublicKey;
  try {
    key = new PublicKey(trimmed);
  } catch {
    throw new Error('That is not a valid Solana address.');
  }
  // A base58 string of the right length can still not be a valid point; the
  // on-curve check catches typos that decode but address nothing.
  if (!PublicKey.isOnCurve(key.toBytes())) {
    throw new Error('That address is not a normal Solana wallet address.');
  }
  return key;
}

export interface BuiltTransfer {
  transaction: Transaction;
  /** True when the recipient has no PYUSD account and this creates one. */
  createsRecipientAccount: boolean;
  fee: TransferFee;
}

/**
 * Build an unsigned PYUSD transfer.
 *
 * `transferChecked` rather than `transfer`: it carries the mint and decimals,
 * so the network rejects a transaction that got either wrong instead of moving
 * the wrong amount.
 *
 * The transaction is returned unsigned. The user signs it in their own wallet;
 * this app never holds a key.
 */
export async function buildPyusdTransfer(
  connection: Connection,
  from: PublicKey,
  to: PublicKey,
  amount: string,
): Promise<BuiltTransfer> {
  const baseUnits = pyusdToBaseUnits(amount);
  if (baseUnits <= BigInt(0)) throw new Error('Enter an amount greater than zero.');

  const source = await getAssociatedTokenAddress(PYUSD_MINT, from, false, PYUSD_PROGRAM_ID);
  const destination = await getAssociatedTokenAddress(PYUSD_MINT, to, false, PYUSD_PROGRAM_ID);

  const sender = await getAccount(connection, source, 'confirmed', PYUSD_PROGRAM_ID).catch(() => {
    throw new Error('This wallet holds no PYUSD yet.');
  });
  if (sender.amount < baseUnits) {
    throw new Error(
      `Not enough PYUSD. This wallet holds ${formatPyusd(sender.amount)}.`,
    );
  }

  const instructions: TransactionInstruction[] = [];

  // A recipient with no PYUSD account needs one created, paid for by the
  // sender. PayPal's own receive address will already have one, but a wallet
  // the user types might not.
  let createsRecipientAccount = false;
  try {
    await getAccount(connection, destination, 'confirmed', PYUSD_PROGRAM_ID);
  } catch {
    createsRecipientAccount = true;
    instructions.push(
      createAssociatedTokenAccountInstruction(
        from,
        destination,
        to,
        PYUSD_MINT,
        PYUSD_PROGRAM_ID,
      ),
    );
  }

  instructions.push(
    createTransferCheckedInstruction(
      source,
      PYUSD_MINT,
      destination,
      from,
      baseUnits,
      PYUSD_DECIMALS,
      [],
      PYUSD_PROGRAM_ID,
    ),
  );

  const fee = await getPyusdTransferFee(connection, baseUnits);

  const transaction = new Transaction().add(...instructions);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = from;

  return { transaction, createsRecipientAccount, fee };
}
