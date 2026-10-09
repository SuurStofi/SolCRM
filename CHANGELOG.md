# Changelog

## Unreleased

### Added
- **My cards** (Home tab): connect a bank and see card balances and recent payments. Read-only by contract — the integration has no way to move money, and never asks for a bank login, PIN, SMS code or card number. Card numbers are stored and shown masked. Disconnecting deletes the token and everything read with it. Transactions are purged after `BANKS_RETENTION_DAYS` (default 90).
- **Monobank** via the official personal API (`api.monobank.ua`), behind `BANKS_MONOBANK_ENABLED` (off by default). Bank credentials are encrypted at rest with the same AES-256-GCM helper as the Binance key and are never returned to the browser.
- Bank provider interface (`src/lib/banks/types.ts`) so a Monobank personal token can be swapped for Corporate access, or another bank added, without touching the models, routes or screens.
- **Privat24 for Business** via the official AutoClient API, behind `BANKS_PRIVAT_ENABLED` (off by default). Business (FOP/company) accounts only — PrivatBank publishes no personal-card API, and none is faked.
- **PayPal** (Market tab) via **PYUSD on Solana**, behind `PAYPAL_PYUSD_ENABLED` (off by default). Receive shows the wallet address with a QR and numbered steps; Send builds an SPL transfer the user signs in their own wallet. No PayPal API is used — PayPal publishes none for reading a consumer's balance — so the app never asks for a PayPal login and never claims to know the PayPal balance.
- `PayoutAddress` model for saved PayPal receive addresses. Deliberately not a `Wallet`: nobody proved control of it, so it can never sign in, and its on-chain balance is PayPal's rather than the user's.
- **Pro tab** (`#pro`) with **Auto-sell** moved out of P2P into `#pro/auto-sell`, and a placeholder for Price alerts. Everything in Pro is free to every signed-in user; `canUsePro` in `src/lib/pro.ts` is the single seam billing would hook into if it were ever added.
- **Merchant status card** above Auto-sell: Verified merchant / Not a merchant / Couldn't check / No Binance key, with a "Check again" button, a 10-minute cache, and a live re-check before every run rather than only on page load. "Couldn't check" locks Auto-sell exactly like "Not a merchant" — an uncertain answer is never read as permission.
- **Responsive layout**: viewport meta (this was missing, so phones laid the page out at ~980px and scaled down), a fixed bottom tab bar on phones with safe-area padding, nav collapsing at 860px before it clips, and 40px minimum touch targets.
- **Playwright** (`npm run test:e2e`): 15 checks across 360/390/768/1024/1440px plus an emulated iPhone 13.
- **Activity feed** on the Total balance page: one timeline across wallet transfers, Binance swaps, bank transactions and P2P deals, each marked with its source. Drafts nobody signed are left out — an unsigned transfer is not activity.
- **Tests** (`npm test`, Node's built-in runner, no new framework): money conversion in all three shapes the providers send, the total-balance rules, and bank response parsing against mocked payloads. No test calls a real bank, and no real token appears in the suite.
- **Total balance** (Home tab): wallet, Binance and connected cards added up in USD, UAH or EUR, with the rate source and its age shown. A source that failed to refresh keeps its last value and is marked stale rather than vanishing; money in transit between two places is listed separately so it is never counted twice; sources with no price are named rather than silently dropped.
- `BANKS_MONOBANK_ENABLED`, `BANKS_PRIVAT_ENABLED`, `BANKS_RETENTION_DAYS`, `PAYPAL_PYUSD_ENABLED`.

- **Three tabs**: P2P (everything that was on the dashboard, plus Autotrade), Exchanger and Compare. The tab is kept in the URL hash.
- **Exchanger tab**: exchangers on BestChange that buy or sell SOL, USDT (Solana) and USDC (Solana) through e-money, bank accounts and cards. Picked like on BestChange — payment system, then currency — with search, currency and type filters. Per rail, every offer with limits, reviews and warnings, and its difference from the best Binance P2P price in the same fiat.
- **Compare tab**: for one crypto, side (buy / sell) and fiat, exchanger offers and Binance P2P side by side per 1 unit, sortable by price; filters for sources, Binance merchants only, payment method, and an amount that fits. For SOL also the route via USDT.
- **Autotrade** (P2P tab): when a Binance P2P USDT buyer pays at least a set price, converts SOL to USDT and publishes a SELL ad at that price, then switches itself off. Checks every 60 s on the server; preflight stops it before converting when the account cannot publish ads. Needs P2P merchant status.
- `BESTCHANGE_API_KEY` (optional).
- Binance client: JSON request bodies and extra headers (for the C2C agent endpoints).

### Changed
- **P2P tab reorganised for non-experts.** Instead of eight panels on one page, it has sections — My balance, Sell SOL, Buy SOL, Trade with people, Auto-sell, My account — each with a short explanation and numbered "how it works" steps. A "Before you start" checklist (connect wallet, connect Binance) shows until both are done. The section is kept in the URL hash (`#p2p/sell`).
- Plain-language wording across the P2P tab: statuses ("On Binance · ready to exchange" instead of "Credited on Binance"), buttons ("See price", "Confirm and exchange", "Turn on auto-sell"), prices shown as "1 USDT = 41.5 UAH", P2P offers marked "best price" and "reliable" / "check reviews". The P2P order archive is now "My deals", with optional fields folded away.
- Binance P2P ads (P2P ads panel, Compare) link to the advertiser's merchant page instead of the filtered P2P board, or to the ad itself when the advertiser cannot be looked up.

### Migrations
- `20261008095300_payout_addresses` — adds `PayoutAddress`. Additive only.
- `20261008091407_banks` — adds `BankConnection`, `BankAccount` and `BankTransaction`. Additive only; no existing table is changed.

### Verified
- **How Merchant status is checked**: there is no Binance endpoint that reports it. Confirmed 2026-10-09 against Binance's own first-party P2P reference (`binance/binance-skills-hub`, `skills/binance/p2p/SKILL.md`), which states no dedicated status endpoint exists and recommends calling "get available ad categories" and catching the permission error. So the check is `getAvailableAdsCategory`, which is **read-only** — it creates, changes and deletes nothing. The other method that reference mentions, attempting a real ad post, is destructive and is never used.
- The merchant application URL (`c2c.binance.com/en/merchantApplication`) was confirmed reachable before being linked.
- Total-balance arithmetic was exercised against mocked sources: currency conversion, a stale source keeping its value, in-transit amounts excluded from the total, PayPal excluded whether or not a figure is entered by hand, unpriceable assets named rather than dropped, and a credit limit not counted as the user's money.
- The stablecoin mints the total recognises (USDC, USDT, PYUSD) were each read from mainnet; all are 6 decimals.
- PYUSD's mint, decimals and token program were read from mainnet, not from a token list: `2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo`, 6 decimals, **Token-2022**. The mint carries a `transferFeeConfig` (0 bps today) and a `transferHook` (unset today), so the fee is read per transfer rather than assumed zero.
- Privat24 AutoClient endpoints, the `id`/`token` headers and the DD-MM-YYYY date format were confirmed by probing the live API: dummy credentials return `VE014 Bad token format`, which only happens after the headers and date parse. No call has been made with real AutoClient credentials yet.
- No PYUSD transfer has been sent with real funds. The mint, decimals, program, fee config, amount conversion and address validation were verified; the end-to-end send was not.
- Monobank was connected with a real personal token on 2026-10-08: client info, balances and statements all read correctly, so the response field names are confirmed rather than inferred. Endpoints, the `X-Token` header, the one-request-per-minute limit and the 31-day statement window were verified first-hand beforehand. One correction found on the way: the statement balance field is `balance`, not `balanceAfter`.

### Fixed
- P2P ads showed order limits as fiat. Binance sends them in the asset (SOL, USDT); they are now labelled that way.

### Migrations
- `20260928195320_autotrade` (`AutoTradeConfig`, `AutoTradeRun`, `AutoTradeEvent`).

### Not yet verified against a live key
- Merchant status has **not** been checked against a real merchant account. The read-only call and the four states are implemented and unit-tested, but no live key has returned a category list.
- Binance C2C agent ad endpoints used by Autotrade (`getAvailableAdsCategory`, `getPayMethodByUserId`, `ads/post`).

## 0.2.0 — 2026-09-25

Accounts and buying SOL. SolCRM is no longer single-user.

### Added
- **Accounts with wallet sign-in** (Sign-In With Solana). The wallet signs a one-time message; no password, no transaction, no fee. A wallet signing in for the first time gets an account.
- **Linked wallets.** More wallets can be linked to an account (each proves control with a signature); any of them signs in. The last wallet cannot be unlinked.
- **Per-account Binance API keys**, entered in the app, checked against Binance, stored encrypted (AES-256-GCM, `APP_ENCRYPTION_KEY`), never returned to the browser.
- **Buy SOL**: USDT → SOL via Binance Convert, quote → confirm.
- **Auto-withdraw setting**: off keeps bought SOL on Binance; on withdraws it to a chosen linked wallet. Keys that can withdraw are only accepted with auto-withdraw on and an IP restriction.
- `CHANGELOG.md`.

### Changed
- Transfers, purchases and P2P records belong to an account; other accounts cannot see or change them. P2P order numbers are unique per account, not globally.
- A transfer can only be started from a wallet linked to the account.
- P2P ad search requires sign-in (it spends the server's shared Binance IP budget).
- `BINANCE_API_KEY` / `BINANCE_API_SECRET` in `.env.local` are no longer read. `APP_ENCRYPTION_KEY` is now required.
- The Binance client no longer retries a 5xx for calls that move money off the exchange (withdrawals).
- "Transfer & Convert" panel renamed to "Sell SOL".

### Fixed
- The page crashed (`insertBefore` NotFoundError) when a button showed its spinner while Chrome's page translation was on.

### Migrations
- `20260924185717_accounts`, `20260924210044_buy_flow`. Existing transfer runs and P2P records are kept without an owner; see README, "Legacy records", to adopt them.

### Not yet verified against a live key
- SOL withdrawal endpoints, including whether Binance charges the network fee from the amount or on top. Try a small amount first.
