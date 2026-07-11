# RESEARCH-transport.md — hosting/transport options for multiplayer

Owner: players. Phase R2, research only. Findings → options → recommendation →
open questions. All pricing figures are from vendor docs / 2026 pricing pages
(cited at the bottom); cost-at-scale numbers are **my estimates** built on the
explicit workload model below — check the model before trusting the dollars.

## TL;DR

- **MVP pick: Supabase Realtime (Broadcast + Presence) + a Postgres input-log +
  anonymous auth.** It is already in Lucca's stack, it is **$0** at 0 and 100
  MAU with 10×+ headroom, anonymous sign-in is first-class, and Postgres is a
  durable input-log for reconnect/rebuild for free. It is a *thin relay*, which
  is exactly what the architect's model (b) deterministic client replay + thin
  relay asks for. Casual-trust rooms of 2–8 (the README's MVP tier) run
  client-authoritative-host over Broadcast with zero new vendor and no new bill.
- **Scale / authoritative pick: Cloudflare Durable Objects (the PartyKit
  model) — one DO instance per room.** When we need a *trusted* server (32-seat
  rooms, deterministic AFK auto-pick you can't let a client fake, round
  certification for ranked, anti-cheat), one-DO-per-room maps 1:1 onto our room
  model, WebSocket **Hibernation** drives idle cost to ~zero for a
  phase-cadence game, DO storage is co-located per-room persistence, and it is
  the **cheapest** option at 10k MAU (~$5–15/mo est.). Cost of the move is a
  relay-layer rewrite, which the architect's `OnlineDriver` seam should contain.

The two are complementary, not either/or: Supabase relay first; graft an
authoritative DO room server under the same `OnlineDriver` when ranked/32-seat
lands. Firebase, Colyseus, and plain Node+ws are viable but each loses to one of
the two picks on our specific axes (see table + per-option notes).

---

## Workload model (grounds every cost number)

This is **not** a frame-cadence game. Playback is already `pure(timeline,
elapsedMs)` off a broadcast `startAt`; the wire carries **phase transitions and
small inputs**, not 60 Hz state.

- **Room size:** 2–32 humans; bots fill empty seats (bots are server/host-side,
  they consume no connections).
- **Message shape:** KB-scale JSON — seat claims, draft picks/spins, tactics
  lock, per-round input submit, one resolution broadcast (seed+inputs, or a
  server-computed timeline — sized by the determinism doc, not here), steal
  windows, presence/heartbeat.
- **Volume per player per full game (~15–30 min session):** order **~500 small
  messages**, ~1–2 KB each ⇒ **~1 MB/player/session** of transport. This is
  tiny; **concurrency (peak connections), not bandwidth, is the cost driver** on
  every platform here.

Scenario concurrency assumptions (stated so they're auditable):

| Scale | Monthly players | Peak concurrency (~5%) | Peak live rooms | Messages/mo (≈players×4 sessions×500) |
|------:|----------------:|-----------------------:|----------------:|--------------------------------------:|
| 0 MAU (dev) | 0 | a handful | 1–2 | negligible |
| 100 MAU | 100 | ~5–8 conns | 1–2 | ~200k |
| 10k MAU | 10,000 | ~500 conns | ~15–40 | ~20M |

Every free tier swallows the 100-MAU column whole. The 10k column is where the
platforms separate.

---

## Comparison table

Cost columns are **monthly, my estimate for the workload model above**. "Free
ceiling" = the usage cap where the free tier stops.

| Platform | 0 MAU | 100 MAU | 10k MAU (~500 conns, ~20M msg) | Latency model | Room persistence | Anonymous auth | Free-tier ceiling | Lock-in |
|---|---|---|---|---|---|---|---|---|
| **Supabase Realtime + Edge/Postgres** | $0 | $0 | **~$60–65** ($25 Pro + msg overage) | Regional (project region), Phoenix WS; 1 hop. Fine for phase cadence | **Postgres input-log** (durable, queryable, already there) | **First-class** (`signInAnonymously`) | 200 peak conns, **2M msg/mo**, 256 KB/msg | Moderate; Postgres portable, Realtime is OSS/self-hostable |
| **Cloudflare Durable Objects / PartyKit** | $0 | $0 | **~$5–15** (Workers Paid $5 + tiny req/duration w/ hibernation) | **Global edge**, DO pinned to first-access colo; low | **DO storage** per room (co-located, durable) | **Roll your own** (Worker mints token) | 100k req/day + 13k GB-s/day (free plan) | High; DO is a proprietary CF runtime |
| **Colyseus (Cloud or self-host)** | $0 self-host / $15 Cloud | $15 Cloud | **~$50–150 Cloud** (500 CCU tier) / ~$5–15 self-host on Fly | Single region (pick near players); always-on, no cold start | In-memory rooms; **add your own DB** for durability | Roll your own (`onAuth`) | OSS self-host unlimited; Cloud from $15/mo | **Low (framework, not vendor)** — OSS, self-hostable anywhere |
| **Plain Node + ws on Fly/Railway/Render** | $0 (Fly PAYG) | ~$2–9 | **~$5–20** (1–2 shared-cpu-1x + trivial bandwidth) | Single region; always-on (avoid Render free — spins down) | In-memory unless you add Redis/DB | Roll your own entirely | Fly ~$2/mo min machine; Railway $5 Hobby; Render $7 starter | **None** — plain standard, most portable |
| **Firebase Realtime Database** | $0 | $0 | **~$20–25** (Blaze: ~20 GB download × $1 + storage) | Regional Google DB; WS-ish long-poll | **RTDB tree IS the state** (durable) | **First-class** (anon auth) | Spark: **100 simultaneous conns**, 1 GB store, 10 GB/mo download | High; proprietary Google data model |

Notes on the estimates:
- **Supabase 10k:** Pro is $25/mo → 5M msgs + 500 conns included; ~20M msgs ⇒
  ~15M overage × $2.50/M ≈ **$37.50**; ~500 conns ≈ included ⇒ **~$60–65/mo**.
  [1][2]
- **DO 10k:** ~20M incoming WS msgs ÷ 20:1 ratio = ~1M billable requests (≈ the
  included million); the real variable is **duration**, and with the Hibernation
  API a phase-cadence room accrues near-zero GB-s while idle between phases ⇒
  dominated by the **$5/mo Workers Paid** floor + single-digit overage. [3][4]
- **Firebase 10k:** no per-connection charge on Blaze; ~20M msgs × ~1 KB ≈ 20 GB
  egress × **$1/GB** + trivial storage ⇒ **~$20–25/mo**. Spark's **100
  simultaneous-connection** cap is the hard wall that forces Blaze well before
  10k MAU. [5]
- **Colyseus Cloud** publishes "from **$15/mo**, no CCU/DAU/MAU limits" but does
  not break out how much CCU the entry tier includes; 500 CCU realistically sits
  a tier or two up ⇒ **~$50–150/mo** est. Self-hosting the OSS framework on Fly
  gets the same server for Fly's compute cost. [6][7]
- **Fly/Railway/Render:** smallest always-on box — Fly shared-cpu-1x/256 MB
  **~$2/mo**, Railway Hobby **$5/mo** (+metered), Render Starter **$7/mo**. 500
  concurrent tiny-message sockets fit on 1–2 small instances. [8]

---

## Per-option findings

### Supabase Realtime + Edge Functions — MVP winner
- **What it is:** Postgres + Realtime (Broadcast = pub/sub relay, Presence =
  who's-in-the-room, Postgres Changes = DB-driven). Edge Functions (Deno) for
  any server-side authoritative bit later.
- **Fit:** Broadcast is *the thin relay* the architect's model (b) wants;
  Presence is seat-claim/lobby for free; the room's authoritative logic runs
  client-host (casual trust) or in an Edge Function per phase; **Postgres is the
  input-log** the protocol doc needs for reconnect/rebuild — no extra store.
- **Auth:** anonymous sign-in is native and **already wired in Lucca's stack**.
- **Free ceiling:** 200 concurrent peak connections, **2M messages/mo**, 256 KB
  max message. Overage: **$10 / 1k peak conns**, **$2.50 / 1M msgs**. [1][2]
- **Weakness:** it is a *relay, not a stateful game server*. There is no
  server-authoritative room process — you either trust clients (fine for MVP
  2–8) or invoke Edge Functions per phase (stateless, clunky for a live phase
  clock). This is the reason a scale pick exists.

### Cloudflare Durable Objects / PartyKit — scale/authoritative winner
- **What it is:** a DO is a single-threaded, addressable, **stateful** object
  with its own storage — **one DO = one room** is the canonical multiplayer
  pattern, and it's exactly what PartyKit (Cloudflare-acquired, Apr 2024)
  packages. [3]
- **Fit:** the authoritative room server the 32-seat/ranked tier needs —
  phase clock, trusted deterministic AFK auto-pick, round certification,
  anti-cheat — all live *in the DO*, with per-room persistence in DO storage for
  reconnect. Global edge placement, WebSocket-native.
- **Cost engine:** requests ($0.15/M over 1M) + **duration** ($12.50/M GB-s over
  400k). Incoming WS messages billed **20:1** (favorable). **Hibernation API**
  lets the object sleep while sockets stay open ⇒ a phase-cadence room pays
  almost no duration between phases — cheapest at 10k MAU. [3][4]
- **Weakness:** no built-in auth (mint your own room token in a Worker);
  proprietary CF runtime = highest vendor lock-in; a room's DO lives in one colo
  (far players get one extra hop — irrelevant at phase cadence).

### Firebase Realtime Database — viable, no reason to pick over Supabase
- Native anonymous auth; the RTDB tree **is** durable room state; cheap egress
  billing. **But:** relay/state-store only (no authoritative server logic, same
  ceiling as Supabase), the **100 simultaneous-connection** Spark cap is low,
  and it's a **second vendor with GCP lock-in**. Given Supabase already owns our
  auth + DB, Firebase is strictly redundant here. [5]

### Colyseus — best "real game server" DX, but priced/shaped worse for us
- OSS authoritative game-server framework: room lifecycle, state sync,
  matchmaking, `onAuth` hook — genuinely batteries-included for exactly this
  problem, and **low lock-in** (self-hostable). **But:** Cloud managed hosting
  starts at $15/mo and 500 CCU lands well above the entry tier (est.
  $50–150/mo), rooms are in-memory (bring your own DB for durable input-logs),
  and it's an always-on server + a framework to learn. Self-hosting on Fly gets
  the framework at Fly's price but re-adds ops. Strong **alternative** to DO if
  we'd rather own a portable Node framework than bet on Cloudflare's runtime. [6][7]

### Plain Node + ws on Fly / Railway / Render — max control, least lock-in
- **Zero lock-in**, cheapest raw compute (Fly ~$2/mo), full control of the
  protocol. **But:** you hand-build everything Colyseus/DO give you — room
  lifecycle, reconnect, presence, and especially **horizontal scale with sticky
  rooms** (a room must live on one process; scaling past one box needs a
  router/affinity layer). Render's free tier **spins down on idle** (cold-start
  mid-lobby) — use paid. Good as a self-host target *for Colyseus*, weak as a
  from-scratch build. [8]

---

## Recommendation

1. **MVP (2–8 friends, casual trust): Supabase Realtime Broadcast + Presence,
   Postgres input-log, anonymous auth.** $0 at our launch scale, no new vendor,
   reuses auth, and is the thin relay the architecture already assumes. Room
   logic runs client-authoritative-host; Edge Functions available for the few
   bits that must not be client-trusted.
2. **Scale (32 seats, ranked, certification): Cloudflare Durable Objects,
   one DO per room**, fronted by the same `OnlineDriver` seam. Cheapest at 10k
   MAU, per-room stateful server is the natural home for authoritative
   resolution + anti-cheat, hibernation kills idle cost, DO storage is built-in
   reconnect persistence.
3. **If we'd rather not bet on a proprietary runtime for the scale tier:**
   self-hosted **Colyseus on Fly** is the low-lock-in alternative to DO — a
   portable authoritative Node framework at Fly's compute cost. Keep it as the
   fallback scale pick.

The migration between (1) and (2) is a relay-layer swap. Its cost is bounded
entirely by how cleanly the architect's `OnlineDriver` isolates transport from
room logic — flag this as the dependency that makes the two-phase plan cheap.

---

## Open questions (for Main's synthesis / other sections)

- **Authoritative-in-MVP?** If casual-trust is unacceptable even at MVP (e.g.
  money/ranked from day one), Supabase-relay's client-host model is out and we
  start on DO/Colyseus directly — pricier, slower to ship. Product call.
- **Wire format = seed+inputs vs server-computed timelines?** The determinism
  doc decides this. If clients can't replay bit-identically and we must ship
  server-computed timelines, payloads grow (48-match round, gzipped — sized
  there); all five platforms still clear it on bandwidth, but it nudges toward a
  **server that computes** (DO/Colyseus) over a **pure relay** (Supabase/Firebase).
- **`OnlineDriver` transport interface** (architect's protocol doc): if it's
  defined against a minimal `join/leave/send/onMessage/presence` surface, all
  five backends implement it and the MVP→scale swap is contained. Confirm the
  seam shape.
- **Latency budget:** playback tolerance is phase-cadence + clock-skew-corrected
  `startAt` (sync-playback doc) — confirm no interaction needs sub-100ms RTT, or
  region choice / edge placement gets weightier.
- **Supabase 10k cost sensitivity:** the ~$60/mo estimate is message-overage
  driven; if real message volume is 2–3× my 500/session assumption, Supabase's
  relative cost worsens vs DO/Firebase — worth re-measuring once the protocol
  message schema is fixed.

---

## Sources

1. [Realtime Pricing | Supabase Docs](https://supabase.com/docs/guides/realtime/pricing)
2. [Manage Realtime Peak Connections usage | Supabase Docs](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-peak-connections) · [Pricing & Fees | Supabase](https://supabase.com/pricing)
3. [Pricing · Cloudflare Durable Objects docs](https://developers.cloudflare.com/durable-objects/platform/pricing/) · [Cloudflare acquires PartyKit](https://blog.cloudflare.com/cloudflare-acquires-partykit/)
4. [Use WebSockets · Cloudflare Durable Objects docs (Hibernation)](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
5. [Firebase Pricing](https://firebase.google.com/pricing) · [Firebase pricing plans | Firebase Docs](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
6. [Pricing — Colyseus Cloud](https://colyseus.io/pricing/)
7. [Colyseus Cloud — Managed Multiplayer Server Hosting](https://colyseus.io/cloud-managed-hosting/) · [Pricing & Billing – Colyseus Docs](https://docs.colyseus.io/cloud/pricing-billing)
8. [Render vs Railway vs Fly.io: Pricing Compared (2026) — DEV](https://dev.to/pavel-hostim/render-vs-railway-vs-flyio-pricing-compared-2026-2e5p) · [Fly.io Pricing 2026](https://toolradar.com/tools/flyio/pricing)
