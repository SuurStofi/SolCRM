# SolCRM

Version **0.2.0** — see [CHANGELOG.md](CHANGELOG.md).

Takes you from a Solana wallet to cash. You sign in with a Solana wallet, link
more wallets to the same account, and exchange through **your own** Binance
account via your own API key — the app never holds your private key, and your
Binance credentials stay encrypted on your own server.

Runs in a browser and as an [Android app](#android-app); on a Solana Seeker,
Seed Vault signs transactions in hardware.

📐 **[ARCHITECTURE.md](ARCHITECTURE.md)** — boundaries, data flow, roadmap, and
an explicit list of what is implemented but not yet verified. Start there to
understand *why* the code is shaped this way.

What works today: wallet reading, SOL ⇄ USDT through Binance, dealer price
comparison, P2P ad discovery, Auto-sell, read-only bank cards, a PayPal bridge
via PYUSD, unified total balance, price alerts, and the Android build. Order
status polling and P2P chat are deliberately absent — Binance's API does not
offer them, and this app does not fake capabilities it lacks.

---

## Website and workspace

The public landing page lives at `/`; the wallet-authenticated workspace lives at `/app`. Existing `/#home`, `/#market`, `/#p2p`, `/#exchange`, and `/#compare` bookmarks redirect to their matching workspace views. The workspace keeps panels mounted when switching tools so in-progress quotes and transfers retain their state.

The interface uses a dark purple theme with reduced-motion support. The original brand asset is `public/solcrm-logo.jpg`; regenerate browser and Apple icons with `node scripts/make-icons.mjs`.

## Setup

```bash
npm install
cp .env.example .env.local   # then set APP_ENCRYPTION_KEY, see below
npx prisma migrate dev       # creates / upgrades prisma/dev.db
npm run dev                  # http://localhost:3000
```

Needs Node ≥ 20.9 (Next 16). `better-sqlite3` is a native module built for whichever Node ran `npm install`; switching Node versions afterwards needs `npm rebuild better-sqlite3`.

### 1. Encryption key (required)

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Put the output in `.env.local` as `APP_ENCRYPTION_KEY`. It encrypts every user's stored Binance key. **Back it up with `prisma/dev.db`** — if it is lost or changed, stored keys become unreadable and everyone has to paste theirs again.

`BINANCE_API_KEY` / `BINANCE_API_SECRET` in `.env.local` are **no longer read**. Each account adds its own key in the app.

### 2. Accounts

Open the app, connect Phantom, press **Sign in**. The wallet signs a one-time text message (not a transaction — nothing is broadcast, no fee). A wallet signing in for the first time gets a new account.

- **Link more wallets:** switch to the other wallet in the extension, then press *Link this wallet* under Account. That wallet signs too, proving it is yours. Any linked wallet can sign in.
- **Unlink:** allowed while at least one other wallet remains — the last wallet is the only way back in, since there is no password.
- A wallet belongs to one account. Linking a wallet already on another account is refused rather than moved.

### 3. Your Binance API key

Create one at **Binance → Account → API Management** and paste it under **Account → Binance API key**.

| Permission | Needed for | Notes |
|---|---|---|
| Enable Reading | ✅ everything | balances, deposits, deposit address |
| Enable Spot & Margin Trading | ✅ Convert (sell and buy) | leave off if you only want to look |
| **Enable Withdrawals** | only with **auto-withdraw on** | refused while auto-withdraw is off; when on, the key **must** also be IP-restricted |

The key is checked against Binance before it is saved, stored encrypted (AES-256-GCM, bound to your account id), and never sent back to the browser — the UI only ever sees its last 4 characters.

If you restrict the key to trusted IPs, allowlist **the IP of the machine running this server**, not your own browser's.

> Heads-up on Convert: several developers report `-1002 not authorized` on `getQuote` even with Spot & Margin enabled, sometimes needing a fresh key. The error is surfaced verbatim rather than hidden.

### 4. Buying SOL

**Buy SOL** spends USDT on your Binance with Convert (quote → confirm, like selling). Where the SOL goes is a per-account setting under **Account → Bought SOL**:

| Auto-withdraw | What happens | Key requirement |
|---|---|---|
| **Off** (default) | SOL stays on your Binance balance; withdraw it yourself in Binance | withdrawals must be **off** |
| **On** | after the buy, the server withdraws the SOL to the linked wallet you picked | withdrawals **on** + **IP-restricted** to this server |

- Withdrawals only ever go to a wallet linked to the account.
- Turning auto-withdraw **off** is refused while the stored key can still withdraw (checked live against Binance), so the setting never leaves a withdrawal-capable key behind.
- A failed withdrawal never undoes the buy: the SOL stays on Binance and the purchase offers *Retry withdrawal*.
- **No double sends.** The withdrawal is recorded (with its own `withdrawOrderId`) *before* it is sent; 5xx answers are not retried; a retry first looks the previous attempt up on Binance and adopts it if it did not fail; a double click loses a compare-and-set on the state. Likewise a buy whose accept got no answer is never re-quoted until its order is checked.
- **Not verified against a live key yet:** `/sapi/v1/capital/withdraw/apply`, `/withdraw/history` filtered by `withdrawOrderId`, and `/capital/config/getall`. In particular, whether Binance deducts the network fee from `amount` or charges it on top is unconfirmed — the app withdraws `min(bought, free SOL)`, so if the fee is charged on top, the first withdrawal may be refused for balance and needs a retry. Try it with a small amount first.

### 5. Solana RPC (optional — works out of the box)

**No configuration needed.** Wallet RPC calls route through `/api/solana/rpc`, a server-side proxy.

That proxy is not an optimization, it's a requirement: public endpoints like `api.mainnet-beta.solana.com` return `403 Access forbidden` to any request carrying an `Origin` header, so the browser cannot call them directly. The proxy re-issues the call server-side, where no `Origin` is sent, and allowlists only the JSON-RPC methods this app uses.

To use a dedicated endpoint (e.g. [Helius](https://helius.dev)) for better reliability, prefer the **server-side** variable so the key is never shipped to the browser:

```
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
```

`NEXT_PUBLIC_SOLANA_RPC_URL` also works and bypasses the proxy entirely — only use it for an endpoint that permits browser origins, and **never** put a key you care about behind a `NEXT_PUBLIC_` name, since those are embedded in the client bundle.

### 6. BestChange (optional — Dealer and Compare tabs)

The dashboard has three tabs:

| Tab | What it does |
|---|---|
| **P2P** | wallet → Binance: everything above (sell/buy SOL, P2P ads, order archive) and **Autotrade** |
| **Dealer** | dealers on [BestChange](https://www.bestchange.com) that **buy or sell** SOL, USDT (Solana) or USDC (Solana) through e-money, bank accounts and cards, picked the way BestChange lists them — payment system, then currency (*Bank card* → USD, RUB, UAH …; *WebMoney* → WMZ, WME; PayPal, YooMoney, Volet, Alipay …). Each offer is set against Binance P2P |
| **Compare** | dealer offers and Binance P2P for one crypto, side and fiat, on one scale (fiat per 1 unit), sortable by price; filters for Binance merchants only, payment method, and whether an amount fits |

BestChange serves rates to partners only. Get a free key at [bestchange.com/partner](https://www.bestchange.com/partner/) (Profile → *API to get exchange rates*) and add it to `.env.local`:

```
BESTCHANGE_API_KEY=your_32_character_key
```

Without it the Dealer tab says how to connect and Compare shows Binance only. One key serves the whole server, so both tabs require sign-in, like P2P search.

- **Rails** are BestChange's groups *Digital currencies*, *Bank accounts and cards* and *Online banking* — taken from the data, not a hand-kept list. *Money transfers* (WU, MoneyGram, Ria) and cash are left out: both are collected as cash.
- **Payment systems** come from BestChange's `ps` number: rails sharing one are a system, and their common leading words are its name.
- **Fiat of a rail** is read off the end of its code (`SBERRUB` → RUB). WebMoney's `WMZ` / `WME` are pegged to USD / EUR; anything else without an ISO suffix is left out of Compare.
- **Measured on 2026-09-28 with a live key:** `rate`, `rankrate` and a presence's `best` are always units of the FROM currency per 1 unit of the TO currency. Buying (fiat → SOL) that is fiat per SOL already (Sberbank RUB → SOL: `10585`); selling it is the inverse (SOL → Sberbank RUB: `0.0000916`). `inmin` / `inmax` are in the FROM currency, `reserve` in the TO currency; `inmax` is often far above the reserve, which is the real cap. Rows arrive unsorted.
- **Binance side:** P2P ads for the crypto itself (selling lists buyers, buying lists sellers), and for SOL also the route via USDT at the spot price. `publisherType` is ignored by the ad list, so *merchants only* filters on the ads' own `userType`. Neither route includes network fees or the Convert spread.
- The exchange itself happens on the dealer's site, and P2P orders on Binance. Nothing in these two tabs sends money.

### 7. Autotrade (P2P tab)

When armed, the server checks Binance P2P every 60 s for a **USDT buyer** in your fiat who pays at least your price and whose limits take the whole amount. On a match it:

1. checks everything it can first — the account may publish ads (`getAvailableAdsCategory` includes `mass`), the chosen payment methods are still on it, the SOL is on Binance, the amount clears Convert's minimum — and if anything is missing, **switches off without converting** and says why;
2. **switches itself off** (a compare-and-set, so the timer and *Check now* cannot both trade), then converts the SOL to USDT with Convert;
3. publishes a fixed-price **SELL ad** for that USDT at the buyer's price.

Why an ad: Binance has no API for ordering on someone else's ad, so selling to that buyer directly is impossible. Orders on your ad, and releasing the USDT, stay manual in Binance.

- **Needs P2P merchant status.** Binance's ad endpoints (`/sapi/v1/c2c/agent/ads/*`) are merchant-only. The key also needs *Enable Spot & Margin Trading* for Convert.
- **Not verified against a live key:** the C2C agent ad endpoints (`getAvailableAdsCategory`, `getPayMethodByUserId`, `ads/post`), taken from Binance's [P2P skill reference](https://github.com/binance/binance-skills-hub/blob/main/skills/binance/p2p/references/agent-sapi-api.md). Try it with a small amount first.
- Each leg is recorded before it is sent. A convert with no answer stays put for *Check order*; an ad with no answer stays put until you check Binance (*Ad is not on Binance* allows a retry). A refused ad keeps the USDT on Binance and offers *Retry ad*.
- **Preview** (while off) shows what a check would find, trading nothing, and works before a key is linked.
- The checks run in the server process: they stop when the server stops. `src/instrumentation.ts` starts them at boot.

---

## Security model

- **Wallet sign-in (SIWS).** The server issues a message naming the site, the wallet and a random nonce; the wallet signs it; the server verifies the ed25519 signature. Each challenge is deleted by the first verification attempt and expires after 5 minutes, so a captured signature cannot be replayed.
- **Sessions.** Random 256-bit token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production); only its SHA-256 is stored. Writes from another origin are refused as well.
- **Per-user isolation.** Every transfer run and P2P record belongs to an account; another user's id answers as not found. A transfer can only be started from a wallet linked to the account.
- **Per-user Binance keys.** Signed Binance calls only run inside `withBinanceCredentials` with the caller's own decrypted key (`AsyncLocalStorage`); a signed call outside it fails instead of falling back to any other key.
- **Non-custodial wallet.** The app never sees your Solana private key. It reads public chain data and (in Phase 2) builds unsigned transactions you approve in Phantom.
- **Binance secrets are server-side only.** `src/lib/binance/client.ts` imports `server-only`, so importing it from a client component is a build error, not a runtime leak. The secret never reaches the browser.
- **Secrets scrubbed from all output.** Every log line and error passes through `redact.ts`, which strips API keys, secrets, and `signature=` values — including from stack traces and network error objects. Verified against signed URLs, header echoes, JSON bodies, stack traces, and env dumps.
- **Shared IP budget.** Most Binance limits are per IP, and all accounts share this server's IP — one busy account can slow the others, and an HTTP 418 ban stops everyone. P2P ad search therefore requires sign-in too.
- **Rate limits respected, and visible.** HTTP 429 backs off honoring `Retry-After`; HTTP 418 (IP ban) is a hard stop that refuses all further calls, since retrying while banned extends the ban. The dashboard polls `/api/binance/status` and shows a banner while either is in effect — without it a backoff is indistinguishable from a hung spinner.
- **Failed connections are retried, completed ones are not.** A request that never reached Binance (`UND_ERR_CONNECT_TIMEOUT`, `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`) is safe to re-send and is retried. Anything that failed mid-flight is not: `acceptQuote` and the Earn redemption execute on receipt, so re-sending one that may have landed is worse than reporting a failure.
- **Clock skew handled.** Server time is sampled once per process and the offset applied to every signed request.

---

## Verified API constraints

Checked against Binance's own first-party [P2P skill doc](https://github.com/binance/binance-skills-hub/blob/main/skills/binance/p2p/SKILL.md), not blog posts.

**Not possible via API — these stay manual in Binance's UI:**
- Creating an order on someone else's ad
- Sending/receiving P2P chat messages
- Releasing coins

Phase 3 is therefore scoped to **discovery + local record-keeping**, not full lifecycle management. This is a platform boundary, not a gap to engineer around — no scraping, no browser automation.

**Available without merchant status:**
- `GET /bapi/c2c/v1/public/c2c/agent/ad-list` — public ad search, no auth. Host is `www.binance.com`, **not** `api.binance.com`. Measured against the live endpoint on 2026-09-21:
  - Payload is `{ data: { items: [...] } }`, not a bare array.
  - **No pagination.** At most 10 ads come back, and `page` and `rows` are both ignored — `page=2` returns the same first ad as `page=1`. The 11th-best ad is unreachable; narrowing the query is the only way to see different ads.
  - `tradeMethodIdentifiers` does filter server-side, and must be a single plain string (`"PrivatBank"`), not a JSON array. An unknown identifier returns zero ads.
  - An unsupported market returns **success with zero items**, not an error, so a typo in `fiat` looks exactly like a thin market. RUB currently returns nothing at all, for any asset or direction.
  - Prices and amounts arrive as JSON **numbers**, not the decimal strings used everywhere money is arithmetic in this app. They are display-only.
  - *(2026-09-28)* `minTransAmount` / `maxTransAmount` are in the **asset** (SOL, USDT), not the fiat: a SOL/EUR ad's `9.5396` at `104.826` EUR is exactly a 1,000 EUR minimum. The ad list used to label them as fiat; fixed.
  - *(2026-09-28)* `transAmount` is **ignored** — 2, 500, 2000 and 100000 all return the same ten ads as no amount. The Amount field in *P2P ads* therefore does not narrow anything; Compare checks amounts against the limits itself.
- **Merchant links.** The ad list never returns the advertiser's number, so it is looked up in the search p2p.binance.com itself runs (`POST /bapi/c2c/v2/friendly/c2c/adv/search`, **undocumented**), which answers `advertiser.userNo` per `adv.advNo`; on 2026-09-28 its first 20 rows held all of the ad list's ads for every market tried. Each ad then links to `p2p.binance.com/en/advertiserDetail?advertiserNo=…`. The lookup is best effort: if it fails, ads link to themselves (`c2c.binance.com/en/adv?code={adNo}`, from Binance's P2P skill reference). `/en/adDetail?adNo=…` answers 404.
- `POST /sapi/v1/c2c/agent/orderMatch/getUserOrderDetail` — order status. Listed under standard-key endpoints, but **still unverified against a live key, and therefore still not built.** Status in the archive is manual until someone confirms this endpoint answers for a non-merchant key; `statusFromBinance` on `P2POrder` exists to mark the difference once it does.

**Simple Earn Flexible** — verified against a live key on 2026-09-21:
- `GET /sapi/v1/simple-earn/flexible/position` returns `{ total, rows }`. Each row carries `asset`, `productId` (`SOL001`, `USDT001`, …), `totalAmount` as a decimal **string**, and `canRedeem`.
- `POST /sapi/v1/simple-earn/flexible/redeem` with `productId` + `redeemAll=true` + `destAccount=SPOT` + `type=FAST` answers `{ redeemId, success }` and settles within seconds — the balance moves from `LD<ASSET>` to `<ASSET>` in spot. `redeemAll` and `amount` are mutually exclusive.
- The `LD<ASSET>` spot row and the position's `totalAmount` are **not the same number**. Redeeming moves the position total, so never present the spot figure as the amount that will be redeemed.

**Convert limits:** `/sapi/v1/convert/exchangeInfo` returns an **array**, not an object. SOL→USDT minimum is `0.000085` SOL. The maximum comes back in scientific notation (`9E+24`), which will not survive naive decimal-string handling if a max check is ever added.

**Signing change (effective 2026-01-15):** payloads must be percent-encoded *before* computing the HMAC. Older tutorials sign the raw string; that failure surfaces as a signature error easily mistaken for clock skew. Handled centrally in `sign.ts` — don't re-encode a payload after signing.

---

## Layout

```
src/
├─ app/
│  ├─ page.tsx                    shell; Dashboard picks sign-in or panels
│  └─ api/                        server-only routes
│     ├─ auth/
│     │  ├─ challenge/            one-time message to sign (LOGIN / LINK)
│     │  ├─ verify/               check signature; start session or link wallet
│     │  ├─ logout/
│     │  └─ me/                   account summary (no secrets)
│     ├─ account/
│     │  ├─ wallets/              unlink a wallet
│     │  ├─ binance/              verify + store / remove own API key
│     │  └─ settings/             auto-withdraw on/off
│     ├─ binance/
│     │  ├─ account/              balances + key permissions
│     │  ├─ deposits/             recent deposit records
│     │  ├─ deposit-address/      SOL deposit address
│     │  └─ earn/redeem/          Simple Earn Flexible -> Spot
│     ├─ buy/
│     │  ├─ info/                 spendable USDT, convert minimum, withdrawal fee
│     │  ├─ convert/              quote / accept (irreversible) / status
│     │  ├─ withdraw/             send (or retry) / check a withdrawal
│     │  └─ list/                 recent purchases
│     ├─ flow/                    transfer/convert run lifecycle
│     │  ├─ create/               deposit address + intent record
│     │  ├─ submitted/            signing leg: awaiting / broadcast / failed
│     │  ├─ check-credit/         chain confirmation + Binance credit
│     │  ├─ convert/              quote, then accept (irreversible)
│     │  └─ list/                 recent runs
│     ├─ exchange/
│     │  ├─ rails/                e-money / bank / card rails per crypto and side
│     │  └─ offers/               dealer offers + Binance reference
│     ├─ compare/                 dealers vs Binance P2P, one scale
│     ├─ autotrade/               settings, runs, check now, run actions
│     ├─ alerts/                 price alerts (GET/POST/PATCH/DELETE)
│     ├─ notifications/          notification feed + mark all read
│     ├─ p2p/
│     │  ├─ ads/                  public ad search
│     │  └─ orders/               local order archive (GET/POST/PATCH)
│     └─ solana/rpc/              RPC proxy (see above)
├─ components/
│  ├─ AuthProvider.tsx            session state, sign-in / link via signMessage
│  ├─ Dashboard.tsx               sign-in screen or the three tabs
│  ├─ ExchangePanel.tsx           Dealer tab (BestChange)
│  ├─ ComparePanel.tsx            Compare tab
│  ├─ market-ui.tsx               shared bits of those two tabs
│  ├─ AutoTradePanel.tsx          autotrade settings and runs
│  ├─ PriceAlertsPanel.tsx       price alerts (Pro tab)
│  ├─ NotificationBell.tsx       header bell + unread count
│  ├─ AccountPanel.tsx            linked wallets, Binance key
│  ├─ WalletProvider.tsx          wallet adapter, client-side only
│  ├─ WalletPanel.tsx             SOL balance, SPL tokens, tx history
│  ├─ BinancePanel.tsx            balances, permissions, deposits, Earn redeem
│  ├─ TransferPanel.tsx           sell: send SOL, track the run, convert to USDT
│  ├─ BuyPanel.tsx                buy: USDT -> SOL, optional withdrawal
│  ├─ P2PAdsPanel.tsx             ad discovery
│  ├─ P2POrdersPanel.tsx          manual order archive
│  └─ ui.tsx                      shared primitives
└─ lib/
   ├─ auth/
   │  ├─ siws.ts                  challenges + ed25519 verification
   │  ├─ session.ts               cookie sessions
   │  ├─ encryption.ts            AES-256-GCM for stored keys
   │  └─ route.ts                 userRoute(): session, origin, user's Binance key
   ├─ account/store.ts            users and linked wallets
   ├─ binance/
   │  ├─ sign.ts                  HMAC + percent-encoding + clock skew
   │  ├─ client.ts                429 backoff, 418 hard stop, request-scoped credentials
   │  ├─ credentials.ts           per-user key storage (encrypted) + key policy
   │  ├─ withdraw.ts              SOL withdrawal: config, apply, history
   │  ├─ account.ts               read-only queries
   │  ├─ convert.ts               quote / accept / order status
   │  ├─ earn.ts                  Flexible positions + redemption
   │  ├─ p2p.ts                   public ad search (see limits above)
   │  ├─ market.ts                public spot price
   │  ├─ c2c.ts                   P2P ad publishing (merchant, unverified)
   │  ├─ redact.ts                secret scrubbing
   │  └─ route-helpers.ts         uniform scrubbed error responses
   ├─ bestchange/
   │  ├─ client.ts                API v2 client, mirrors, caching
   │  └─ market.ts                rails, payment systems, offers (buy and sell)
   ├─ autotrade/
   │  ├─ machine.ts               run state machine
   │  ├─ store.ts                 persistence, compare-and-set, claim
   │  ├─ engine.ts                trigger, preflight, convert, publish
   │  ├─ merchant.ts              merchant status, cached, never assumed
   │  └─ scheduler.ts             60 s background timer (autotrade + alerts)
   ├─ alerts/
   │  ├─ engine.ts                grouped price checks, cooldowns, firing
   │  └─ notify.ts                notification record + sender list
   ├─ compare.ts                  crypto <-> fiat across dealers and Binance
   ├─ solana/
   │  ├─ read.ts                  balance, SPL tokens, tx history
   │  └─ transfer.ts              fees, max sendable, send + confirm
   ├─ buy/
   │  ├─ machine.ts               purchase state machine
   │  ├─ store.ts                 persistence, compare-and-set transitions
   │  └─ withdraw.ts              withdrawal leg (no double sends)
   ├─ decimal.ts                  exact decimal-string math
   ├─ flow/
   │  ├─ machine.ts               transfer state machine
   │  └─ store.ts                 persistence + audited transitions
   └─ p2p/store.ts                order archive persistence
```

The `TransferFlow` state machine (`src/lib/flow/machine.ts`) already models the Phase 2 legs, including the case that matters: convert failing *after* a successful transfer leaves funds on Binance and is resumable from `CONVERT_FAILED` without re-sending SOL. On-chain confirmation and Binance credit are tracked as separate states because Binance credit lags the chain.

---

## Notes

- **Legacy records.** Runs and P2P records made before accounts existed have no owner and are hidden from everyone. To adopt them into your account, sign in once, then:

  ```bash
  npx prisma db execute --stdin <<'SQL'
  UPDATE TransferFlow SET userId = (SELECT userId FROM Wallet WHERE address = 'YOUR_WALLET_ADDRESS') WHERE userId IS NULL;
  UPDATE P2POrder     SET userId = (SELECT userId FROM Wallet WHERE address = 'YOUR_WALLET_ADDRESS') WHERE userId IS NULL;
  SQL
  ```
- **Back up `prisma/dev.db` together with `APP_ENCRYPTION_KEY`.** It is a single SQLite file with no redundancy, and it is the only record of accounts, transfer flows — and, once Phase 3 lands, of P2P orders, which exist nowhere else at all. Binance and the chain can tell you a deposit happened; neither can rebuild which run it belonged to or what you noted about it. Copy it somewhere outside the repo, along with `.env.local`, before the history is worth keeping.
- `AGENTS.md` / `CLAUDE.md` are generated by Next.js 16; set `agentRules: false` in `next.config.ts` to disable.
- The Prisma datasource URL lives in `prisma.config.ts` (Prisma 7 moved it out of `schema.prisma`).

## Bank cards (Monobank)

Off by default. Switch it on with `BANKS_MONOBANK_ENABLED=true` and restart.

### Legal note — read before enabling publicly

Monobank's **personal** API is intended for your own account. A service other
people use needs Monobank's **Corporate API**, which you request from Monobank
directly. This app is built behind a provider interface
(`src/lib/banks/types.ts`) so the token source can change from personal to
corporate without touching the models, routes or screens — but the flag ships
off, and the connect screen says so in plain language.

### What it does, and does not

- **Reads** card balances and recent transactions. Nothing else.
- **Never** initiates payments or transfers. The provider interface exposes no
  write operation, so this is a property of the code, not a policy.
- **Never** asks for a bank login, password, PIN, OTP, CVV or full card number.
  Card numbers are stored and displayed masked (`•• 4417`).
- **Encrypts** the token with the same AES-256-GCM helper as the Binance key.
  It is never returned to the browser and is scrubbed from logs and errors.
- **Disconnect deletes.** Removing a connection drops the token, the accounts
  and every stored transaction.
- **Purges** transactions older than `BANKS_RETENTION_DAYS` (default 90).

### Connecting

1. Open <https://api.monobank.ua> and sign in with the Monobank app.
2. Copy the personal token it issues.
3. Paste it in **Home → My cards**, tick the consent box, press *Check and
   connect*. The token is checked against Monobank before it is stored.

### Limits the app works within

Verified against the published spec on 2026-10-08:

| Limit | Value |
|---|---|
| Requests per token | **1 per 60 seconds** (both client-info and statement) |
| Statement window | **31 days + 1 hour** (2,682,000 s) per request |

Refreshes are queued per token and the UI shows the remaining wait instead of
retrying into a 429. Balances and transactions are fetched in separate calls so
one refresh stays inside the limit.

## Privat24 for Business (AutoClient)

Off by default. Switch it on with `BANKS_PRIVAT_ENABLED=true`.

**Business accounts only.** AutoClient exists for Privat24 **for Business**
(FOP or company). PrivatBank publishes no API for a personal card, so personal
cards are not supported here and the app does not pretend otherwise — the
planned path for those is statement import (CSV/XLSX export from Privat24),
which is not built yet.

### Connecting

1. In Privat24 for Business, open AutoClient and create an application.
2. Copy the **client id** and the **token**.
3. Paste both in **Home → My cards**, tick consent, press *Check and connect*.

### Verified against the live API (2026-10-08)

| | |
|---|---|
| Base | `https://acp.privatbank.ua/api` |
| Balances | `GET /statements/balance?startDate=DD-MM-YYYY` |
| Transactions | `GET /statements/transactions?startDate=DD-MM-YYYY` |
| Auth headers | `id` and `token` |
| Date format | **DD-MM-YYYY** — an ISO date is rejected |

The header names were confirmed by sending dummy values and getting
`VE014 Bad token format`: the server reached token validation, so it had
accepted the headers. Balance responses come back as `charset=cp1251`, so the
client decodes by the declared charset rather than assuming UTF-8.

AutoClient reports money as decimal strings in major units where Monobank uses
integer minor units; the adapter converts via string handling so no value
passes through a float.

## Total balance

**Home → Total balance** adds up every connected source in one currency
(USD, UAH or EUR; the list is easy to extend).

Fiat rates come from Monobank's public `/bank/currency`, which needs no token
and carries its own timestamp, so the page can say where a rate came from and
how old it is. The midpoint of buy and sell is used: a total is neither a
purchase nor a sale, so quoting one side would bias every figure.

The rules that make the number trustworthy:

- **Only connected sources count**, and the page lists which.
- **A failed refresh keeps its last value, marked stale.** A total that
  silently drops because one source timed out is worse than one that admits it
  is out of date.
- **Money in transit is shown separately.** SOL that has left the wallet but
  is not yet credited on Binance exists in neither balance, so it is listed on
  its own and never added twice.
- **Unpriceable assets are named, not dropped.** If SOL's price cannot be
  fetched, the page says SOL is missing from the total.
- **A credit limit is not your money.** Monobank's balance includes it, so the
  total uses `balance - creditLimit`.

### PayPal is never presented as live

There is no API for reading a consumer's PayPal balance, so this app cannot
know it and does not pretend to. PayPal appears under **Not counted**, labelled
"Not connected — transfers only". Only PYUSD moved through SolCRM is visible.

A PayPal receive address is treated as a destination, never as the user's
holding: its on-chain balance belongs to PayPal, so it is never read and never
added to the total.

## Android app

A Capacitor shell wraps the deployed site, so the phone talks to the same
server the browser does. On a Solana Seeker, Seed Vault signs transactions
natively through Mobile Wallet Adapter.

```bash
npm run android:release   # signed APK, verified before it is handed over
```

Because the APK carries no logic, deploying the server updates the app. See
[deploy/android/README.md](deploy/android/README.md) for the toolchain (it needs
JDK 21, not 17), the signing setup, and what has not been tested on real
hardware.

## Price alerts

Alerts watch Binance P2P and the dealers for a price and tell you when someone
meets it. You make the trade yourself, which is the point: because the app
publishes nothing on your behalf, alerts need no P2P merchant status and work
on every account — unlike Auto-sell.

Set one in **Pro → Price alerts**: buy or sell, which coin, the price, and the
fiat. Optionally narrow it to one payment method, to Binance merchants only, or
to one venue type. One-shot alerts switch themselves off once they fire;
repeating ones go quiet for an hour instead, so a price sitting at your target
cannot notify you every minute. Ten alerts may run at once.

Notifications appear under the bell in the workspace header, with an unread
count; opening it marks them read. The in-app record is always written first
and other channels are senders layered on top (`src/lib/alerts/notify.ts`), so
a delivery failure never loses the message. Browser push is stubbed behind
`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` and does nothing until per-device
subscriptions are stored — setting the keys alone does not start sending.

Two details that are easy to get wrong:

- **Rate limits.** Alerts are grouped by (coin, side, fiat, source) *before*
  anything is fetched, so ten alerts on SOL/UAH cost one round of requests
  rather than ten. Alerts also share Auto-sell's existing 60-second server
  timer instead of adding a second schedule against the same rate-limited APIs.
- **Which price counts.** Where a venue publishes a fee, the fee-adjusted price
  is both what the target is compared against and what the rows are ranked by.
  These have to be the same number: ranking on the headline price while judging
  the net one lets a dealer that advertises more but pays less win the ranking
  and then fail the target, hiding a qualifying offer behind it.

## Tests

```bash
npm test
```

Node's built-in runner, no extra framework. The suite covers the parts where a
quiet mistake would mean a wrong number rather than a crash:

- **Money conversion** in all three shapes the providers send — Monobank's
  integer minor units, Privat's major-unit decimal strings, PYUSD's six
  decimals — checked against exact integers, including values a float gets
  wrong.
- **Total-balance rules**: stale sources keeping their value, in-transit money
  not double-counted, PayPal excluded even when a figure is typed by hand,
  unpriceable assets named rather than dropped, and a credit limit not counted
  as the holder's money.
- **Bank response parsing** against hand-written payloads in the documented
  shape.
- **Merchant status**: that an uncertain answer is never read as permission,
  and that the preflight refuses before anything is converted.
- **Price alerts**: the buy/sell comparison at and either side of the target,
  the fee-adjusted price deciding rather than the headline one, cooldowns, and
  that alerts on one market are grouped into a single fetch.

No test calls a real bank or a real market, and no real token appears in the
suite.
