# SolCRM

Version **0.2.0** — see [CHANGELOG.md](CHANGELOG.md).

Multi-account dashboard: Solana wallet → Binance → P2P. You sign in with a Solana wallet, link more wallets to the same account, and exchange through **your own** Binance account via your own API key.

**Phases 1 and 2 are complete** (read-only dashboard; transfer and convert). **Phase 3 is partly built:** ad discovery and the local order archive work; order-status polling is deliberately not implemented — see below.

---

## Setup

```bash
npm install
cp .env.example .env.local   # then set APP_ENCRYPTION_KEY, see below
npm run db:setup             # generate client + apply migrations
npm run dev                  # http://localhost:3000
```

Needs Node ≥ 20.9 (Next 16). `better-sqlite3` is a native module built for whichever Node ran `npm install`; switching Node versions afterwards needs `npm rebuild better-sqlite3`.

### After pulling changes

Run `npm run db:setup` whenever `prisma/schema.prisma` or `prisma/migrations/` changed.

Skipping it produces `Cannot read properties of undefined (reading 'findMany')` —
`prisma.<model>` is `undefined` because the generated client predates the model.
The two halves fail independently, so check both with `npm run db:status`:

- **Client stale** (missing models) — `npm install` overwrites
  `node_modules/@prisma/client`, reverting it to whatever was generated last.
  A `postinstall` hook now regenerates it automatically.
- **Database behind** (missing tables) — migrations on disk were never applied.

The dev server reads the client once at startup, so **restart it** after regenerating.

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

### 6. BestChange (optional — Exchanger and Compare tabs)

The dashboard has three tabs:

| Tab | What it does |
|---|---|
| **P2P** | wallet → Binance: everything above (sell/buy SOL, P2P ads, order archive) and **Autotrade** |
| **Exchanger** | exchangers on [BestChange](https://www.bestchange.com) that **buy or sell** SOL, USDT (Solana) or USDC (Solana) through e-money, bank accounts and cards, picked the way BestChange lists them — payment system, then currency (*Bank card* → USD, RUB, UAH …; *WebMoney* → WMZ, WME; PayPal, YooMoney, Volet, Alipay …). Each offer is set against Binance P2P |
| **Compare** | exchanger offers and Binance P2P for one crypto, side and fiat, on one scale (fiat per 1 unit), sortable by price; filters for Binance merchants only, payment method, and whether an amount fits |

BestChange serves rates to partners only. Get a free key at [bestchange.com/partner](https://www.bestchange.com/partner/) (Profile → *API to get exchange rates*) and add it to `.env.local`:

```
BESTCHANGE_API_KEY=your_32_character_key
```

Without it the Exchanger tab says how to connect and Compare shows Binance only. One key serves the whole server, so both tabs require sign-in, like P2P search.

- **Rails** are BestChange's groups *Digital currencies*, *Bank accounts and cards* and *Online banking* — taken from the data, not a hand-kept list. *Money transfers* (WU, MoneyGram, Ria) and cash are left out: both are collected as cash.
- **Payment systems** come from BestChange's `ps` number: rails sharing one are a system, and their common leading words are its name.
- **Fiat of a rail** is read off the end of its code (`SBERRUB` → RUB). WebMoney's `WMZ` / `WME` are pegged to USD / EUR; anything else without an ISO suffix is left out of Compare.
- **Measured on 2026-09-28 with a live key:** `rate`, `rankrate` and a presence's `best` are always units of the FROM currency per 1 unit of the TO currency. Buying (fiat → SOL) that is fiat per SOL already (Sberbank RUB → SOL: `10585`); selling it is the inverse (SOL → Sberbank RUB: `0.0000916`). `inmin` / `inmax` are in the FROM currency, `reserve` in the TO currency; `inmax` is often far above the reserve, which is the real cap. Rows arrive unsorted.
- **Binance side:** P2P ads for the crypto itself (selling lists buyers, buying lists sellers), and for SOL also the route via USDT at the spot price. `publisherType` is ignored by the ad list, so *merchants only* filters on the ads' own `userType`. Neither route includes network fees or the Convert spread.
- The exchange itself happens on the exchanger's site, and P2P orders on Binance. Nothing in these two tabs sends money.

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
│     │  └─ offers/               exchanger offers + Binance reference
│     ├─ compare/                 exchangers vs Binance P2P, one scale
│     ├─ autotrade/               settings, runs, check now, run actions
│     ├─ p2p/
│     │  ├─ ads/                  public ad search
│     │  └─ orders/               local order archive (GET/POST/PATCH)
│     └─ solana/rpc/              RPC proxy (see above)
├─ components/
│  ├─ AuthProvider.tsx            session state, sign-in / link via signMessage
│  ├─ Dashboard.tsx               sign-in screen or the three tabs
│  ├─ ExchangePanel.tsx           Exchanger tab (BestChange)
│  ├─ ComparePanel.tsx            Compare tab
│  ├─ market-ui.tsx               shared bits of those two tabs
│  ├─ AutoTradePanel.tsx          autotrade settings and runs
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
   │  └─ scheduler.ts             60 s background timer
   ├─ compare.ts                  crypto <-> fiat across exchangers and Binance
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
