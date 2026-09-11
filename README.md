# SolCRM

Personal single-user dashboard: Solana wallet → Binance → P2P.

**Phase 1 (read-only dashboard) is complete.** Phases 2 and 3 are scoped but not built.

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

### 2. Solana RPC (recommended)

Defaults to the public mainnet endpoint, which is heavily rate-limited and will intermittently fail to load token accounts. A free [Helius](https://helius.dev) key fixes it:

```
NEXT_PUBLIC_SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
```

`NEXT_PUBLIC_` values are visible in the browser. That's fine for an RPC URL — **never** use that prefix for a Binance secret.

---

## Security model

- **Non-custodial wallet.** The app never sees your Solana private key. It reads public chain data and (in Phase 2) builds unsigned transactions you approve in Phantom.
- **Binance secret is server-side only.** `src/lib/binance/client.ts` imports `server-only`, so importing it from a client component is a build error, not a runtime leak. The secret never reaches the browser.
- **Secrets scrubbed from all output.** Every log line and error passes through `redact.ts`, which strips API keys, secrets, and `signature=` values — including from stack traces and network error objects. Verified against signed URLs, header echoes, JSON bodies, stack traces, and env dumps.
- **Rate limits respected.** HTTP 429 backs off honoring `Retry-After`; HTTP 418 (IP ban) is a hard stop that refuses all further calls, since retrying while banned extends the ban.
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
- `GET /bapi/c2c/v1/public/c2c/agent/ad-list` — public ad search, no auth. Note: host is `www.binance.com`, **not** `api.binance.com`, and `tradeMethodIdentifiers` must be a plain string (`"BANK"`), not a JSON array.
- `POST /sapi/v1/c2c/agent/orderMatch/getUserOrderDetail` — order status. Listed under standard-key endpoints; **to be verified against a live key** before Phase 3 builds polling on it.

**Signing change (effective 2026-01-15):** payloads must be percent-encoded *before* computing the HMAC. Older tutorials sign the raw string; that failure surfaces as a signature error easily mistaken for clock skew. Handled centrally in `sign.ts` — don't re-encode a payload after signing.

---

## Layout

```
src/
├─ app/
│  ├─ page.tsx                    dashboard: Wallet | Binance
│  └─ api/binance/                server-only routes
│     ├─ account/                 balances + key permissions
│     ├─ deposits/                recent deposit records
│     └─ deposit-address/         SOL deposit address (Phase 2)
├─ components/
│  ├─ WalletProvider.tsx          wallet adapter, client-side only
│  ├─ WalletPanel.tsx             SOL balance, SPL tokens, tx history
│  ├─ BinancePanel.tsx            balances, permissions, deposits
│  └─ ui.tsx                      shared primitives
└─ lib/
   ├─ binance/
   │  ├─ sign.ts                  HMAC + percent-encoding + clock skew
   │  ├─ client.ts                429 backoff, 418 hard stop, error mapping
   │  ├─ account.ts               read-only queries
   │  ├─ redact.ts                secret scrubbing
   │  └─ route-helpers.ts         uniform scrubbed error responses
   ├─ solana/read.ts              balance, SPL tokens, tx history
   └─ flow/machine.ts             Phase 2 state machine
```

The `TransferFlow` state machine (`src/lib/flow/machine.ts`) already models the Phase 2 legs, including the case that matters: convert failing *after* a successful transfer leaves funds on Binance and is resumable from `CONVERT_FAILED` without re-sending SOL. On-chain confirmation and Binance credit are tracked as separate states because Binance credit lags the chain.

---

## Notes

- `AGENTS.md` / `CLAUDE.md` are generated by Next.js 16; set `agentRules: false` in `next.config.ts` to disable.
- The Prisma datasource URL lives in `prisma.config.ts` (Prisma 7 moved it out of `schema.prisma`).
