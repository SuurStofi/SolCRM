import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android shell.
 *
 * This is a thin native wrapper, not a second copy of the app. The APK holds
 * no business logic and no secrets: it points a WebView at the real server and
 * lets Mobile Wallet Adapter handle signing, so Seed Vault on a Seeker signs
 * natively while the Binance key stays encrypted on the server where it
 * already lives.
 *
 * Why a wrapper rather than a bundled build: 36 modules are server-only and 16
 * API routes need a database and the encryption key. Shipping those in an APK
 * would mean putting the key that decrypts every user's Binance credentials on
 * the handset. Deploying the server therefore updates the app -- a UI change
 * needs no new APK.
 *
 * `androidScheme: 'https'` matters even though nothing local is served: it
 * keeps the WebView on a secure context, which the wallet and clipboard APIs
 * require.
 *
 * `webDir` is android-shell/, holding only an offline notice. It is what the
 * WebView falls back to when the server cannot be reached, so losing signal
 * shows an explanation instead of a blank screen. It is deliberately not
 * public/, which still carries unused create-next-app sample SVGs that would
 * otherwise be packaged into every APK.
 */
const SERVER_URL = process.env.CAPACITOR_SERVER_URL ?? 'https://solcrm.tech';

const config: CapacitorConfig = {
  appId: 'tech.solcrm.app',
  appName: 'SolCRM',
  webDir: 'android-shell',
  android: {
    // Release builds are never debuggable: it would let any app on the device
    // inspect the WebView holding a live session.
    webContentsDebuggingEnabled: false,
  },
  server: {
    // Overridable for a staging host or a LAN IP during testing:
    //   CAPACITOR_SERVER_URL=http://192.168.1.5:3000 npx cap sync android
    url: SERVER_URL,
    androidScheme: 'https',
    // Shown when the server cannot be reached (the page in webDir above).
    errorPath: 'index.html',
    // Plain http is refused. The session cookie in this WebView can move
    // money, so it is never sent over a network anyone can read -- which also
    // means a local http URL above needs cleartext explicitly allowed.
    cleartext: false,
  },
};

export default config;
