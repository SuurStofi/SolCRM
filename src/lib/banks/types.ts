/**
 * The shape every bank provider returns, so the UI and the storage layer never
 * depend on which bank (or which tier of a bank's API) produced the data.
 *
 * This is the seam that lets Monobank move from a personal token to Corporate
 * access later: only the provider changes, not the models, the routes or the
 * screens.
 *
 * Money is in MINOR UNITS as an integer (kopiyky, cents) everywhere in this
 * module. Monobank reports it that way, and keeping it there means no float
 * ever touches a balance.
 */

export const BANK_PROVIDERS = ['monobank', 'privat_business', 'privat_import'] as const;
export type BankProvider = (typeof BANK_PROVIDERS)[number];

export interface ProviderAccount {
  /** The bank's own id for the account. */
  externalId: string;
  /** Masked card number, never a full PAN. */
  maskedPan?: string;
  iban?: string;
  /** ISO-4217 numeric (980 UAH, 840 USD, 978 EUR). */
  currencyCode: number;
  /** Minor units. For Monobank this already includes creditLimit. */
  balance: bigint;
  creditLimit: bigint;
  accountType?: string;
}

export interface ProviderTransaction {
  externalId: string;
  time: Date;
  /** Minor units, signed: negative is money out. */
  amount: bigint;
  operationAmount?: bigint;
  currencyCode: number;
  description: string;
  mcc?: number;
  /** True while the bank still holds it; the final amount can change. */
  hold: boolean;
  /** Balance after this transaction, minor units. */
  balance?: bigint;
  counterName?: string;
  counterIban?: string;
  comment?: string;
}

export interface ProviderClientInfo {
  accounts: ProviderAccount[];
  /** Shown as the connection label when the user does not set one. */
  name?: string;
}

/**
 * A bank integration.
 *
 * Every method is read-only by contract. No provider may expose payment
 * initiation, transfers or card-to-card: this app reads balances and
 * transactions and nothing else.
 */
export interface BankProviderAdapter {
  readonly provider: BankProvider;

  /** Human name for the connect screen. */
  readonly displayName: string;

  /**
   * Check a credential and return what it can see. Used before saving, so a
   * bad token fails on the connect screen rather than on first sync.
   */
  verify(credential: string): Promise<ProviderClientInfo>;

  /** Accounts and balances. */
  fetchAccounts(credential: string): Promise<ProviderClientInfo>;

  /**
   * Transactions for one account within a window.
   *
   * Providers enforce their own maximum window; callers should respect
   * `maxWindowMs` rather than discovering the limit through an error.
   */
  fetchTransactions(
    credential: string,
    accountExternalId: string,
    from: Date,
    to: Date,
  ): Promise<ProviderTransaction[]>;

  /** Shortest gap the provider allows between calls, per credential. */
  readonly minRequestIntervalMs: number;

  /** Longest window a single transaction request may cover. */
  readonly maxWindowMs: number;
}
