import type { BankProvider } from './types';

/**
 * Shapes sent to the browser.
 *
 * Balances are BigInt minor units in the database, and JSON.stringify throws on
 * a BigInt, so every amount crosses this boundary as a decimal string. Strings
 * also keep the exact value: a balance in kopiyky can exceed what a JS number
 * represents safely once it is large enough.
 *
 * Nothing here carries a credential. The UI sees `tokenHint` and never the
 * token itself.
 */

export interface AccountDto {
  id: string;
  /** The bank's own id. The sync route needs it to ask for this account. */
  externalId: string;
  maskedPan: string | null;
  iban: string | null;
  currencyCode: number;
  /** Minor units, as a decimal string. */
  balance: string;
  creditLimit: string;
  /** Balance minus the credit limit: what is actually the user's money. */
  ownFunds: string;
  accountType: string | null;
  balanceUpdatedAt: string | null;
}

export interface ConnectionDto {
  id: string;
  provider: BankProvider;
  label: string | null;
  tokenHint: string | null;
  consentAt: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  status: string;
  accounts: AccountDto[];
}

export interface TransactionDto {
  id: string;
  externalId: string;
  time: string;
  amount: string;
  currencyCode: number;
  description: string;
  mcc: number | null;
  hold: boolean;
  balance: string | null;
  counterName: string | null;
  comment: string | null;
  maskedPan: string | null;
}

interface AccountRow {
  id: string;
  externalId: string;
  maskedPan: string | null;
  iban: string | null;
  currencyCode: number;
  balance: bigint;
  creditLimit: bigint;
  accountType: string | null;
  balanceUpdatedAt: Date | null;
}

interface ConnectionRow {
  id: string;
  provider: string;
  label: string | null;
  tokenHint: string | null;
  consentAt: Date;
  lastSyncedAt: Date | null;
  lastError: string | null;
  status: string;
  accounts: AccountRow[];
}

export function toAccountDto(row: AccountRow): AccountDto {
  return {
    id: row.id,
    externalId: row.externalId,
    maskedPan: row.maskedPan,
    iban: row.iban,
    currencyCode: row.currencyCode,
    balance: row.balance.toString(),
    creditLimit: row.creditLimit.toString(),
    // Monobank's balance includes the credit limit, so the figure a person
    // thinks of as "my money" is the difference.
    ownFunds: (row.balance - row.creditLimit).toString(),
    accountType: row.accountType,
    balanceUpdatedAt: row.balanceUpdatedAt?.toISOString() ?? null,
  };
}

export function toConnectionDto(row: ConnectionRow): ConnectionDto {
  return {
    id: row.id,
    provider: row.provider as BankProvider,
    label: row.label,
    tokenHint: row.tokenHint,
    consentAt: row.consentAt.toISOString(),
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastError: row.lastError,
    status: row.status,
    accounts: row.accounts.map(toAccountDto),
  };
}

interface TransactionRow {
  id: string;
  externalId: string;
  time: Date;
  amount: bigint;
  currencyCode: number;
  description: string;
  mcc: number | null;
  hold: boolean;
  balance: bigint | null;
  counterName: string | null;
  comment: string | null;
  bankAccount: { maskedPan: string | null };
}

export function toTransactionDto(row: TransactionRow): TransactionDto {
  return {
    id: row.id,
    externalId: row.externalId,
    time: row.time.toISOString(),
    amount: row.amount.toString(),
    currencyCode: row.currencyCode,
    description: row.description,
    mcc: row.mcc,
    hold: row.hold,
    balance: row.balance?.toString() ?? null,
    counterName: row.counterName,
    comment: row.comment,
    maskedPan: row.bankAccount.maskedPan,
  };
}

/** ISO-4217 numeric to a symbol the UI can print. */
export const CURRENCY_NAMES: Record<number, string> = {
  980: 'UAH',
  840: 'USD',
  978: 'EUR',
  826: 'GBP',
  985: 'PLN',
};

export function currencyName(code: number): string {
  return CURRENCY_NAMES[code] ?? String(code);
}
