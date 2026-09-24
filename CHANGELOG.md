# Changelog

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
