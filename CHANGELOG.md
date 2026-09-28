# Changelog

## Unreleased

### Added
- **Three tabs**: P2P (everything that was on the dashboard, plus Autotrade), Exchanger and Compare. The tab is kept in the URL hash.
- **Exchanger tab**: exchangers on BestChange that buy or sell SOL, USDT (Solana) and USDC (Solana) through e-money, bank accounts and cards. Picked like on BestChange — payment system, then currency — with search, currency and type filters. Per rail, every offer with limits, reviews and warnings, and its difference from the best Binance P2P price in the same fiat.
- **Compare tab**: for one crypto, side (buy / sell) and fiat, exchanger offers and Binance P2P side by side per 1 unit, sortable by price; filters for sources, Binance merchants only, payment method, and an amount that fits. For SOL also the route via USDT.
- **Autotrade** (P2P tab): when a Binance P2P USDT buyer pays at least a set price, converts SOL to USDT and publishes a SELL ad at that price, then switches itself off. Checks every 60 s on the server; preflight stops it before converting when the account cannot publish ads. Needs P2P merchant status.
- `BESTCHANGE_API_KEY` (optional).
- Binance client: JSON request bodies and extra headers (for the C2C agent endpoints).

### Changed
- Binance P2P ads (P2P ads panel, Compare) link to the advertiser's merchant page instead of the filtered P2P board, or to the ad itself when the advertiser cannot be looked up.

### Fixed
- P2P ads showed order limits as fiat. Binance sends them in the asset (SOL, USDT); they are now labelled that way.

### Migrations
- `20260928195320_autotrade` (`AutoTradeConfig`, `AutoTradeRun`, `AutoTradeEvent`).

### Not yet verified against a live key
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
