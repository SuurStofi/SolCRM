import 'server-only';

import { SafeError } from '../binance/redact';
import { monobankAdapter } from './monobank';
import { privatBusinessAdapter } from './privat';
import { BANK_PROVIDERS, type BankProvider, type BankProviderAdapter } from './types';

export * from './types';

/**
 * Which bank integrations this deployment offers.
 *
 * Monobank is OFF by default. Its personal API is intended for a person's own
 * account, and this app is reachable publicly, so enabling it is a deliberate
 * choice by whoever runs the server rather than something that ships on.
 * Multi-user operation needs Monobank's Corporate API.
 */
export function isProviderEnabled(provider: BankProvider): boolean {
  switch (provider) {
    case 'monobank':
      return process.env.BANKS_MONOBANK_ENABLED === 'true';
    case 'privat_business':
    case 'privat_import':
      return process.env.BANKS_PRIVAT_ENABLED === 'true';
    default:
      return false;
  }
}

const ADAPTERS: Partial<Record<BankProvider, BankProviderAdapter>> = {
  monobank: monobankAdapter,
  privat_business: privatBusinessAdapter,
  // privat_import has no adapter: its rows come from an uploaded statement,
  // not from an API, so it is handled by the import route instead.
};

export function getAdapter(provider: BankProvider): BankProviderAdapter {
  if (!isProviderEnabled(provider)) {
    throw new SafeError(`${provider} is not enabled on this server.`, { status: 403 });
  }
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    throw new SafeError(`${provider} is not implemented yet.`, { status: 501 });
  }
  return adapter;
}

export function parseProvider(value: unknown): BankProvider {
  const provider = String(value ?? '');
  if (!(BANK_PROVIDERS as readonly string[]).includes(provider)) {
    throw new SafeError('Unknown bank.', { status: 400 });
  }
  return provider as BankProvider;
}

/** What the connect screen offers, so the UI never hardcodes the list. */
export function enabledProviders(): Array<{ provider: BankProvider; displayName: string }> {
  return BANK_PROVIDERS.filter(isProviderEnabled)
    .map((provider) => ADAPTERS[provider])
    .filter((adapter): adapter is BankProviderAdapter => adapter !== undefined)
    .map((adapter) => ({ provider: adapter.provider, displayName: adapter.displayName }));
}
