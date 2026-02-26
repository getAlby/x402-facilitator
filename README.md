# x402 Lightning Facilitator

A multi-tenant [x402](https://x402.org) facilitator for Lightning Network payments, built on [Nostr Wallet Connect (NWC)](https://nwc.dev).

### Components

```
┌─────────────────────────────────────────────────────────┐
│  facilitator/   — neutral infrastructure (no wallet)    │
│    POST /invoice   generate BOLT11 for a merchant wallet │
│    POST /verify    check preimage cryptographically      │
│    POST /settle    confirm payment via merchant NWC      │
│    GET  /supported capability discovery                  │
└─────────────────────────────────────────────────────────┘
                          ▲
                          │ HTTP
┌─────────────────────────────────────────────────────────┐
│  app/           — merchant resource server              │
│    GET /resource   protected route (requires 1 sat)     │
│    GET /health     health check                         │
└─────────────────────────────────────────────────────────┘
```

### Multi-tenant design

The facilitator holds **no wallet credentials**. Each merchant passes their own [NWC](https://nwc.dev) connection string (`nostr+walletconnect://...`) in the payment requirements `extra.nwcUrl` field. The facilitator uses it to:

1. Create a BOLT11 invoice against the merchant's wallet (`POST /invoice`)
2. Confirm settlement against the merchant's wallet (`POST /settle`)

Multiple merchants can share the same facilitator instance — each with their own independent wallet.

## Setup

### Prerequisites

- Node.js 18+
- Two NWC-compatible wallets (e.g. [Alby](https://getalby.com)):
  - **Merchant wallet** — receives payments (goes in `app/.env`)
  - **Sender wallet** — sends payments during e2e test (goes in `.env.sender`)

### Install dependencies

```bash
# Facilitator
cd facilitator && npm install

# App
cd app && npm install

# Root (e2e test runner)
npm install
```

### Configure

**`facilitator/.env`** — no wallet config needed (multi-tenant):
```env
PORT=3000
```

**`app/.env`** — merchant's NWC URL:
```env
FACILITATOR_URL=http://localhost:3000
MERCHANT_NWC_URL=nostr+walletconnect://<pubkey>?relay=<relay>&secret=<secret>
PORT=4000
```

**`.env.sender`** — sender wallet for e2e test:
```env
SENDER_NWC_URL=nostr+walletconnect://<pubkey>?relay=<relay>&secret=<secret>
```
---

## Running

Start the facilitator (terminal 1):
```bash
cd facilitator && npm run dev
```

Start the app (terminal 2):
```bash
cd app && npm run dev
```

Run the e2e test (terminal 3):
```bash
npm run e2e
```

---

## Open questions / TODOs

### 1. `verify` vs `settle` — the hold invoice problem

**Current behaviour:** `verify` checks the preimage cryptographically (no network call — just `sha256(preimage) == paymentHash`). `settle` then calls the merchant's NWC wallet to confirm the invoice is actually paid.

**The problem:** This is different from how ERC-20 x402 flows work. In ERC-20, `verify` checks the on-chain transaction and `settle` is a no-op (the money is already moved). In Lightning, the payment is atomic — once the preimage is revealed, the payment is already settled. There is no separate "settle" step at the protocol level.

**Hold invoices as a solution:** [HODL invoices](https://bitcoinops.org/en/topics/hold-invoices/) allow a receiver to accept a payment but delay releasing the preimage (and thus settling) until they choose to. This would let the facilitator:
1. `verify` — check the HTLC is locked (payment is in-flight, funds committed)
2. `settle` — release the preimage to actually pull the funds

This maps cleanly onto the x402 verify/settle split and prevents the race condition where a client reveals a preimage before the resource server has confirmed delivery. Requires NWC wallet support for HODL invoices (not universally available yet).

### 2. Invoice store persistence

The current invoice store is in-memory (`Map`). A server restart loses all pending invoices. For production use, this should be backed by Redis or a database.

### 3. NWC client connection lifecycle

NWC clients are cached indefinitely by URL. There is no reconnection logic or health-check. Long-lived connections may silently drop. Consider adding a ping/reconnect strategy.

### 4. `nwcUrl` exposure in 402 response

The merchant's NWC URL is currently passed through `requirements.extra.nwcUrl` and ends up in the `402 Payment Required` response visible to the client. This leaks the merchant's wallet connection string. In production, the facilitator should assign a merchant ID and look up the NWC URL server-side, never exposing it to clients.

### 5. Amount validation

The app currently accepts `AssetAmount` with `asset: "sat"` only. USD price conversion uses a hardcoded rate (`$1 ≈ 100,000 sats`). A production system should use a real price oracle.
