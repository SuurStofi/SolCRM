/**
 * Mobile Wallet Adapter: how a Solana phone signs.
 *
 * On a Seeker the key lives in Seed Vault, in hardware, and never reaches the
 * browser -- the same non-custodial contract this app keeps everywhere else,
 * enforced by the device rather than by a browser extension.
 *
 * registerMwa adds MWA to the Wallet Standard registry, which is the same
 * mechanism Phantom uses to announce itself. That is why SolanaProviders can
 * keep `wallets={[]}`: the picker discovers whatever is registered, so nothing
 * about the desktop path changes and no adapter is listed twice.
 *
 * VERIFIED 2026-10-12 against docs.solanamobile.com and the installed
 * package's own types (@solana-mobile/wallet-standard-mobile 0.7.0):
 *
 *  - This package, not @solana-mobile/wallet-adapter-mobile. Solana Mobile's
 *    migration guide puts the older one into maintenance mode, and
 *    @solana/wallet-adapter-react >= 1.0.0 drops its bundled MWA entirely.
 *  - @solana/wallet-adapter-react must be >= 0.15.36 for MWA to connect after
 *    being picked. This project is on 0.15.40.
 *  - `appIdentity` and `chains` are the required fields. Without an explicit
 *    appIdentity the wallet shows "Unknown app" and no icon, which is exactly
 *    the moment a user decides whether to trust a signing request.
 *  - MWA is Android-only: Chrome on Android works, Firefox/Opera/Brave are
 *    documented as not working, and iOS cannot support it at all (an OS
 *    limitation, not a missing feature).
 */

import {
  registerMwa,
  createDefaultAuthorizationCache,
  createDefaultChainSelector,
  createDefaultWalletNotFoundHandler,
} from '@solana-mobile/wallet-standard-mobile';

/** Mainnet only: this app moves real money and has no testnet mode. */
const CHAINS = ['solana:mainnet'] as const;

let registered = false;

/**
 * Whether this build should offer MWA at all.
 *
 * Android only, and never while prerendering. Registering it on a desktop
 * browser would add a wallet to the picker that cannot be used, so the check
 * is on the platform rather than on being inside the APK -- Chrome on an
 * Android phone gets Seed Vault signing from the website too.
 */
export function supportsMwa(): boolean {
  if (typeof window === 'undefined') return false;
  return /Android/i.test(window.navigator.userAgent);
}

/**
 * Register MWA once.
 *
 * Idempotent because React may run effects twice in development, and
 * registering the same wallet twice would duplicate it in the picker.
 *
 * Never throws: a phone that cannot register MWA must still be able to use
 * the rest of the app, so a failure here leaves the user with the normal
 * browser wallet flow instead of an unusable screen.
 */
export function ensureMwaRegistered(): void {
  if (registered || !supportsMwa()) return;
  registered = true;

  try {
    registerMwa({
      appIdentity: {
        name: 'SolCRM',
        uri: 'https://solcrm.tech',
        // Resolved against `uri` by the wallet, so this is
        // https://solcrm.tech/icon.png -- a route this app already serves.
        icon: 'icon.png',
      },
      chains: [...CHAINS],
      authorizationCache: createDefaultAuthorizationCache(),
      chainSelector: createDefaultChainSelector(),
      onWalletNotFound: createDefaultWalletNotFoundHandler(),
    });
  } catch (error) {
    // Left unregistered on purpose: the picker then shows only wallets that
    // actually work here.
    registered = false;
    console.warn('[mwa] registration failed; falling back to browser wallets', error);
  }
}
