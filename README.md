# SolCRM

Personal single-user dashboard: Solana wallet → Binance → P2P.

**Phases 1 and 2 are complete** (read-only dashboard; transfer and convert). **Phase 3 is partly built:** ad discovery and the local order archive work; order-status polling is deliberately not implemented — see below.

---

## Setup

```bash
npm install
cp .env.example .env.local   # then fill it in, see below
npx prisma migrate dev       # creates prisma/dev.db
npm run dev                  # http://localhost:3000
```

### 1. Binance API key

Create one at **Binance → Account → API Management**.

Permissions — enable **only** these:

| Permission | Phase 1 | Phase 2 | Notes |
|---|---|---|---|
| Enable Reading | ✅ required | ✅ required | balances, deposits, deposit address |
| Enable Spot & Margin Trading | ❌ leave off | ✅ required | needed for Convert only |
| **Enable Withdrawals** | 🚫 **OFF** | 🚫 **OFF** | this app never withdraws — leaving it on is pure downside |

Also set **"Restrict access to trusted IPs only"** to your own IP if you run from a fixed location. Binance also expires unrestricted keys after 90 days, so an IP allowlist saves you re-issuing.

Paste the key and secret into `.env.local`. That file is gitignored and was never committed.

> Heads-up on Convert: several developers report `-1002 not authorized` on `getQuote` even with Spot & Margin enabled, sometimes needing a fresh key. Phase 2 surfaces that error verbatim rather than hiding it.

### 2. Solana RPC (optional — works out of the box)

**No configuration needed.** Wallet RPC calls route through `/api/solana/rpc`, a server-side proxy.

That proxy is not an optimization, it's a requirement: public endpoints like `api.mainnet-beta.solana.com` return `403 Access forbidden` to any request carrying an `Origin` header, so the browser cannot call them directly. The proxy re-issues the call server-side, where no `Origin` is sent, and allowlists only the JSON-RPC methods this app uses.

To use a dedicated endpoint (e.g. [Helius](https://helius.dev)) for better reliability, prefer the **server-side** variable so the key is never shipped to the browser:

```
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
```

`NEXT_PUBLIC_SOLANA_RPC_URL` also works and bypasses the proxy entirely — only use it for an endpoint that permits browser origins, and **never** put a key you care about behind a `NEXT_PUBLIC_` name, since those are embedded in the client bundle.

---

## Security model

- **Non-custodial wallet.** The app never sees your Solana private key. It reads public chain data and (in Phase 2) builds unsigned transactions you approve in Phantom.
- **Binance secret is server-side only.** `src/lib/binance/client.ts` imports `server-only`, so importing it from a client component is a build error, not a runtime leak. The secret never reaches the browser.
- **Secrets scrubbed from all output.** Every log line and error passes through `redact.ts`, which strips API keys, secrets, and `signature=` values — including from stack traces and network error objects. Verified against signed URLs, header echoes, JSON bodies, stack traces, and env dumps.
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
- No adNo deep link exists. `/en/adDetail?adNo=…` answers 404, and the advertiser page keys off an `advertiserNo` the ad list never returns, so the UI links to the filtered board (`/en/trade/{side}/{asset}?fiat=…`, verified 200) and shows the ad number to match by hand.
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
│  ├─ page.tsx                    dashboard: Wallet | Binance | Transfer | P2P
│  └─ api/                        server-only routes
│     ├─ binance/
│     │  ├─ account/              balances + key permissions
│     │  ├─ deposits/             recent deposit records
│     │  ├─ deposit-address/      SOL deposit address
│     │  └─ earn/redeem/          Simple Earn Flexible -> Spot
│     ├─ flow/                    transfer/convert run lifecycle
│     │  ├─ create/               deposit address + intent record
│     │  ├─ submitted/            signing leg: awaiting / broadcast / failed
│     │  ├─ check-credit/         chain confirmation + Binance credit
│     │  ├─ convert/              quote, then accept (irreversible)
│     │  └─ list/                 recent runs
│     ├─ p2p/
│     │  ├─ ads/                  public ad search
│     │  └─ orders/               local order archive (GET/POST/PATCH)
│     └─ solana/rpc/              RPC proxy (see above)
├─ components/
│  ├─ WalletProvider.tsx          wallet adapter, client-side only
│  ├─ WalletPanel.tsx             SOL balance, SPL tokens, tx history
│  ├─ BinancePanel.tsx            balances, permissions, deposits, Earn redeem
│  ├─ TransferPanel.tsx           send SOL, track the run, convert to USDT
│  ├─ P2PAdsPanel.tsx             ad discovery
│  ├─ P2POrdersPanel.tsx          manual order archive
│  └─ ui.tsx                      shared primitives
└─ lib/
   ├─ binance/
   │  ├─ sign.ts                  HMAC + percent-encoding + clock skew
   │  ├─ client.ts                429 backoff, 418 hard stop, error mapping
   │  ├─ account.ts               read-only queries
   │  ├─ convert.ts               quote / accept / order status
   │  ├─ earn.ts                  Flexible positions + redemption
   │  ├─ p2p.ts                   public ad search (see limits above)
   │  ├─ redact.ts                secret scrubbing
   │  └─ route-helpers.ts         uniform scrubbed error responses
   ├─ solana/
   │  ├─ read.ts                  balance, SPL tokens, tx history
   │  └─ transfer.ts              fees, max sendable, send + confirm
   ├─ flow/
   │  ├─ machine.ts               transfer state machine
   │  └─ store.ts                 persistence + audited transitions
   └─ p2p/store.ts                order archive persistence
```

The `TransferFlow` state machine (`src/lib/flow/machine.ts`) already models the Phase 2 legs, including the case that matters: convert failing *after* a successful transfer leaves funds on Binance and is resumable from `CONVERT_FAILED` without re-sending SOL. On-chain confirmation and Binance credit are tracked as separate states because Binance credit lags the chain.

---

## Notes

- **Back up `prisma/dev.db`.** It is a single SQLite file with no redundancy, and it is the only record of transfer flows — and, once Phase 3 lands, of P2P orders, which exist nowhere else at all. Binance and the chain can tell you a deposit happened; neither can rebuild which run it belonged to or what you noted about it. Copy it somewhere outside the repo, along with `.env.local`, before the history is worth keeping.
- `AGENTS.md` / `CLAUDE.md` are generated by Next.js 16; set `agentRules: false` in `next.config.ts` to disable.
- The Prisma datasource URL lives in `prisma.config.ts` (Prisma 7 moved it out of `schema.prisma`).
