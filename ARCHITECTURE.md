# Architecture

SolCRM takes one person from a Solana wallet to cash in a bank account. It is a
personal-use tool, not a service: one deployment serves its owner, and there is
no multi-tenant plane, no admin, no support console.

This document covers the boundaries and the data flow. The file tree lives in
[README.md](README.md#layout) and the release history in
[CHANGELOG.md](CHANGELOG.md).

**At a glance**

| | |
|---|---|
| Stack | Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind v4 |
| Database | SQLite via Prisma 7 with the better-sqlite3 driver adapter |
| Models | 19 |
| API routes | 38, all server-only |
| Server-only modules | 36 under `src/lib` |
| Client components | 28 under `src/components` |
| Tests | 44 unit (Node's runner) + 17 end-to-end (Playwright; 2 skip off-target viewports) |
| Deployment | pm2 behind nginx on a single host, `127.0.0.1:8137` |
| Android | Capacitor shell around the deployed site |

## The three boundaries

Almost every design decision in this codebase follows from one of these. A
change that crosses one is a change worth arguing about.

### 1. The private key never reaches this code

The app never holds, asks for, or transmits a Solana private key. Transactions
are built server-side or client-side, then signed by the user's own wallet —
Phantom in a browser, Seed Vault in hardware on a Solana Seeker. Nothing in
`src/` can move funds on its own.

Practically: `src/lib/solana/transfer.ts` builds and submits, it never signs.
Signing lives behind the wallet adapter. One consequence worth knowing is that
we submit transactions ourselves rather than letting the adapter do it: the
adapter would make Phantom broadcast through our own RPC proxy, which the
extension cannot reach.

### 2. Secrets stay on the server, encrypted, per user

Binance API keys and bank tokens are encrypted with AES-256-GCM
(`src/lib/auth/encryption.ts`) using `APP_ENCRYPTION_KEY`, with the owning
user's id as additional authenticated data — so a row lifted into another
account fails to decrypt rather than silently working.

Credentials never travel to the browser, not even masked beyond a short hint.
Errors are scrubbed before logging (`src/lib/binance/redact.ts`), because a
Binance error body can echo the query string that contained the key.

This boundary is why the Android app is a wrapper rather than a bundle: a
self-contained APK would have to carry the key that decrypts every stored
credential onto a device that can be lost. See
[deploy/android/README.md](deploy/android/README.md).

### 3. Official APIs only, and money is never a float

No scraping, no headless browsers, no undocumented endpoints presented as
documented. Where a needed capability does not exist, the UI says so instead of
faking it — Binance P2P cannot release coins or send chat messages through the
API, and PayPal publishes nothing for reading a consumer balance, so neither is
offered.

All money is handled as `BigInt` minor units and converted to decimal strings
at the API boundary. `JSON.stringify` throws on `BigInt`, which is a useful
forcing function: a DTO that forgot to convert fails loudly in development.

## Request flow

```
Browser / Android WebView
        │
        │  session cookie (httpOnly, SameSite=Lax); only the SHA-256 is stored
        ▼
src/app/api/**/route.ts ──> userRoute()  src/lib/auth/route.ts
        │                     ├─ refuses cross-origin writes
        │                     ├─ resolves the session (401 without one)
        │                     └─ with { binance: true }, runs the handler
        │                        inside that user's own credentials
        ▼
src/lib/**  (server-only)
        ├─ binance/     HMAC-SHA256 signing, 429 backoff, 418 hard stop
        ├─ solana/      balances, SPL tokens, fees, transfer building
        ├─ banks/       Monobank + Privat adapters behind one interface
        ├─ bestchange/  dealer rates (read-only market data)
        ├─ alerts/      grouped price checks and notifications
        └─ autotrade/   the one background timer
        ▼
Prisma 7 ──> SQLite (prisma/prod.db)
```

Every route answers `{ ok: true, data }` or `{ ok: false, error }` through
`handleRoute`, so a client never has to guess whether a 200 body is an error.
Errors pass through the scrubber on the way out.

### Why there is exactly one background timer

`src/lib/autotrade/scheduler.ts` runs a single 60-second interval shared by
Auto-sell and price alerts. Both hit the same rate-limited APIs, so a second
schedule would double the spend for no benefit. Each is awaited separately, so
one failing does not skip the other.

Price alerts are grouped by `(asset, side, fiat, source)` *before* anything is
fetched: ten alerts on SOL/UAH cost one round of requests, not ten.

The timer lives on `globalThis` because Next.js reloads modules on every edit in
development, and it is started by `src/instrumentation.ts` at boot as well as by
the alerts and autotrade routes — so it runs whichever feature the user reaches
first.

## Data model

19 models, grouped by what they are for:

| Group | Models | Notes |
|---|---|---|
| Identity | `User`, `Wallet`, `Session`, `AuthChallenge` | Sign-In With Solana; only a token's hash is stored |
| Credentials | `BinanceCredential` | Encrypted, per user, AAD-bound |
| Sell flow | `TransferFlow`, `FlowEvent` | State machine, append-only events |
| Buy flow | `BuyFlow`, `BuyEvent` | Mirrors the sell flow |
| P2P | `P2POrder` | Manual archive; exists nowhere else |
| Auto-sell | `AutoTradeConfig`, `AutoTradeRun`, `AutoTradeEvent` | Needs merchant status |
| Banks | `BankConnection`, `BankAccount`, `BankTransaction` | Read-only; purged after `BANKS_RETENTION_DAYS` |
| PayPal | `PayoutAddress` | Deliberately not a `Wallet` — nobody proved control of it, so it can never sign in |
| Alerts | `PriceAlert`, `Notification` | Max 10 active alerts per account |

State machines are append-only: `*Flow` holds current state,
`*Event` holds the history. Transitions use compare-and-set, so two concurrent
requests cannot both advance the same run.

## External services

| Service | Used for | Constraints discovered and verified |
|---|---|---|
| Binance REST | balances, Convert, withdrawals | HMAC-SHA256; percent-encode **before** signing since 2026-01-15 |
| Binance P2P / C2C | ad discovery, ad publishing | No chat, no coin release via API. Publishing needs merchant status |
| Solana RPC | balances, SPL tokens, submitting | Public endpoints 403 any request with an `Origin`, hence the server proxy |
| BestChange | dealer rates | Partner key; rates are FROM-per-TO and arrive unsorted |
| Monobank | card balances, statements | `X-Token`; **1 request per 60s**; max 31 days + 1 hour per statement |
| PrivatBank AutoClient | business account statements | `id`/`token` headers, `DD-MM-YYYY`, cp1251. Business accounts only — no personal-card API exists |

Full measurements are in [README.md](README.md#verified-api-constraints).
These were checked against first-party documentation and live responses, not
assumed; where a vendor's own docs were wrong or silent, the README says which.

## Security posture

- Sessions: httpOnly, `SameSite=Lax`, SHA-256 of the token stored, 30-day TTL,
  expired rows deleted on sight.
- CSRF: cross-origin writes refused on every non-GET, on top of `SameSite`.
- Ownership: mutations use `updateMany`/`deleteMany` scoped by `userId`, so a
  guessed id matches nothing instead of touching another account's row.
- Transport: HSTS, `X-Frame-Options: DENY`, `nosniff`; the app binds to
  loopback only and is reachable solely through nginx.
- Secrets: never in git. `.env.local`, `prisma/*.db`, `private/`, the Android
  keystore and `key.properties` are all gitignored, and the history has been
  scanned to confirm none was ever committed.
- Uncertainty is never permission: a merchant-status check that fails returns
  `unknown`, which blocks Auto-sell exactly like `not-merchant`. The preflight
  refuses before anything is converted, so a failed check cannot leave the user
  holding USDT they did not ask for.

## Testing

`npm test` — 44 unit tests on Node's built-in runner, no extra framework. They
cover the places where a quiet mistake produces a wrong number rather than a
crash: money conversion in all three shapes the providers send, total-balance
rules, bank response parsing against mocked payloads, merchant-status
classification, and price-alert conditions and grouping.

`npm run test:e2e` — 17 Playwright checks across 360/390/768/1024/1440px plus
an emulated iPhone 13 (2 skip on viewports they do not apply to), measuring
`scrollWidth` rather than eyeballing screenshots. Headless screenshots proved actively misleading here: two runs
either side of a real layout fix produced byte-identical images.

No test calls a real bank, a real exchange, or a real market, and no real token
appears in the suite.

## Deployment

One host. `next start` bound to `127.0.0.1:8137` under pm2, fronted by nginx
with a Let's Encrypt certificate. The app holds the key that decrypts stored
credentials, so it is never reachable except through the proxy — verify with
`ss -tlnH | grep 8137` after any restart.

Releases are built from `git archive` of the committed tree, so no local
`.env.local`, `node_modules` or `.next` cache can travel with them. Details in
[deploy/prod/README.md](deploy/prod/README.md).

## Roadmap

Honest status, including what is deliberately not being built.

### Done

Solana wallet reading and Sign-In With Solana · SOL → Binance → USDT with a
resumable state machine · USDT → SOL with optional withdrawal · dealer
comparison via BestChange · Binance P2P ad discovery · Auto-sell with merchant
preflight · read-only bank cards (Monobank, Privat for business) · PayPal
bridge via PYUSD · unified total balance with staleness and in-transit rules ·
activity feed · responsive phone layout · price alerts and a notification
centre · Android APK with Seed Vault signing.

### Next

1. **Verify the Android app on real hardware.** Installing, launching, and an
   actual Seed Vault signature are untested — no physical Seeker was involved
   in building the APK. This is the highest-value next step because it
   validates work already shipped.
2. **Finish the notification channels.** The sender interface exists and the
   in-app bell works; web push is a deliberate no-op until per-device
   subscriptions are stored. Telegram would be a new sender, not an edit to
   every caller.
3. **Verify Privat24 response parsing against a live business account.** The
   adapter follows the published shape but has never seen a real response.
4. **Exercise the C2C ad endpoints with a real merchant account.**
   `getAvailableAdsCategory`, `getPayMethodByUserId` and `ads/post` are
   implemented from Binance's reference and unverified against a live merchant.

### Considered and rejected

- **A hosted multi-user service.** The threat model is a personal tool. Holding
  other people's exchange keys is a different product with different
  obligations.
- **Custodial signing, server-side keys, or a "convenience" key escrow.** This
  would dissolve boundary 1, which is the reason the tool is safe to use.
- **Scraping Binance's web UI** for chat, coin release, or merchant status. The
  API does not offer them; pretending otherwise with browser automation would
  be fragile and against their terms.
- **A fully offline APK.** Would require shipping `APP_ENCRYPTION_KEY` to the
  handset. See boundary 2.
- **Minification in the Android build.** The APK is a WebView shell with no
  logic to shrink, and minification has broken Capacitor's bridge reflection
  before.

### Known unverified

Listed so nobody mistakes "implemented" for "proven":

- Android: install, launch, Seed Vault signature, offline fallback screen,
  Android 6–9 behaviour.
- Privat24 response parsing against a live account.
- PayPal/PYUSD end-to-end send with real funds.
- Binance merchant status against a real merchant account.
- Wallet connect inside Phantom's in-app browser.
