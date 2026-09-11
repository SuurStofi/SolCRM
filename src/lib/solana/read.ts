import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  type ConfirmedSignatureInfo,
} from '@solana/web3.js';
// Imported rather than hardcoded: a mistyped program id is silently wrong --
// the RPC just answers INVALID_PARAMS and the panel shows no tokens.
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

/**
 * Read-only Solana queries.
 *
 * Everything here is public chain data fetched with a public key. No signing,
 * no private key -- this module could not move funds if it wanted to.
 */

/** Newer mints live under Token-2022, so both programs must be queried. */

export interface TokenHolding {
  mint: string;
  amount: number;
  decimals: number;
  /** Raw base-unit amount as a string; exact, unlike the float `amount`. */
  rawAmount: string;
  programId: string;
}

export interface WalletSnapshot {
  address: string;
  solBalance: number;
  lamports: number;
  tokens: TokenHolding[];
}

export async function getWalletSnapshot(
  connection: Connection,
  owner: PublicKey,
): Promise<WalletSnapshot> {
  // Both token programs are queried in parallel with the SOL balance.
  const [lamports, legacy, token2022] = await Promise.all([
    connection.getBalance(owner),
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
    connection
      .getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID })
      // A Token-2022 failure should not blank the whole panel, but it must not
      // pass silently either -- swallowing it is what hid a bad program id.
      .catch((cause: unknown) => {
        console.warn('[solana] Token-2022 accounts unavailable:', cause);
        return { value: [] as never[] };
      }),
  ]);

  const tokens: TokenHolding[] = [...legacy.value, ...token2022.value]
    .map((account) => {
      const info = account.account.data.parsed.info;
      const amount = info.tokenAmount;
      return {
        mint: info.mint as string,
        amount: Number(amount.uiAmountString ?? amount.uiAmount ?? 0),
        decimals: amount.decimals as number,
        rawAmount: amount.amount as string,
        programId: account.account.owner.toBase58(),
      };
    })
    // Empty token accounts are left behind by past activity; hide them.
    .filter((token) => token.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  return {
    address: owner.toBase58(),
    lamports,
    solBalance: lamports / LAMPORTS_PER_SOL,
    tokens,
  };
}

export interface TxSummary {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: boolean;
  memo: string | null;
}

/**
 * Recent transaction signatures.
 *
 * Deliberately does NOT fetch full transaction bodies: that is one RPC call
 * per signature and would exhaust a public endpoint immediately. The signature
 * list carries enough for the dashboard; the explorer link covers the rest.
 */
export async function getRecentTransactions(
  connection: Connection,
  owner: PublicKey,
  limit = 15,
): Promise<TxSummary[]> {
  const signatures: ConfirmedSignatureInfo[] = await connection.getSignaturesForAddress(
    owner,
    { limit },
  );

  return signatures.map((sig) => ({
    signature: sig.signature,
    slot: sig.slot,
    blockTime: sig.blockTime ?? null,
    err: sig.err !== null,
    memo: sig.memo,
  }));
}

export function explorerTxUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

export function explorerAddressUrl(address: string): string {
  return `https://solscan.io/account/${address}`;
}

/** Shorten a base58 address for display without losing recognisability. */
export function shortenAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}
