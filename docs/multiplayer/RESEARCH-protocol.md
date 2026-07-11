# RESEARCH — Room / Phase Protocol & the Driver Seam (architect / ARCHITECT)

**Scope:** the end-to-end room + phase state machine, the typed message schema, and
the exact seam in *our* code that turns the solo game into a multiplayer one without
rewriting the engine or the reducer. Effort-tiered MVP → v2.

**Not in scope here (owned elsewhere, referenced, not duplicated):**
- Clock skew / `startAt` / late-join seek / spectator viewing mechanics →
  `RESEARCH-sync-playback.md` (match-sim). This doc treats "everyone watches the same
  match in sync" as a solved primitive and only says *when* a `startAt` is broadcast.
- Whether client replay is bit-identical across browsers → `RESEARCH-determinism.md`
  (game-engine). **This doc is written to survive either verdict** — see §2.
- Transport/host choice (Supabase Realtime vs PartyKit vs …) → `RESEARCH-transport.md`
  (players). This doc assumes only "an ordered broadcast channel per room with
  presence," which every candidate provides.
- Lobby/timer/AFK/disconnect *product* precedents → `RESEARCH-mp-ux-precedents.md`
  (draft-page). Numbers below (deadline lengths) are engineering defaults, not the
  final UX — Main owns that.

---

## 0. TL;DR

- **The reducer already IS the room state machine, and `Action` already IS the wire
  protocol.** Solo dispatches actions locally; online, the *same* actions arrive over
  a channel and run through the *same* reducer. This is the whole trick — see §3.
- **One authority per room** (the host client for MVP; a serverless function for
  ranked v2) owns three things the client cannot be trusted with: the **seed**, the
  **phase deadlines**, and the **action ordering**. Everything else is already pure.
- **The single hard change** is that today `playRound()` resolves a whole round
  *synchronously in one call* (App.tsx `handlePlayRound`). Multiplayer must split that
  into **collect-inputs-until-deadline → resolve → broadcast**. That is the load-
  bearing refactor; the rest is plumbing. See §4 + §5.
- **Reconnect is nearly free**: room state = `(seed, ordered action log)`. Replay the
  log through the reducer and you are back. Derived refs (`matchIndex`, morale) rebuild
  from the same replay. See §6.
- **MVP is small** (2–8 friends, host-authoritative, trust-based tactics): ~a driver
  interface + a room channel + deadline timers. **v2** (up to 32, commit–reveal,
  server certification, ranked) is strictly additive on the same schema. See §8.

---

## 1. Design tenets (carried from PLAN-architecture Job 2 §b, re-affirmed)

1. **The timeline is the wire format, not video.** Matches are decided up front and
   played back as `pure(timeline, elapsed)`. Nothing about a match is decided during
   playback, so "sync" is just a shared `startAt`.
2. **All gameplay randomness flows through the seeded `Rng`; per-match seeds are
   canonical coordinates** `matchSeed(tournamentSeed, round, matchIndex)`
   (`engine/tournament.ts:231`). A match is *named* by `(seed, round, matchIndex)`, so
   the authority never ships fresh per-match seeds — it ships one tournament seed.
3. **No gameplay decision in a component.** Picks, tactics, steals are all `Action`s
   through the reducer. This is why the network layer can be a thin action pipe.
4. **Wall-clock enters gameplay in exactly two places** — the match `startAt` and the
   phase deadlines (draft/tactics/steal). Both live *outside* the deterministic core:
   a deadline produces an `Action` (e.g. auto-pick), which then flows through the
   seeded reducer like any human action. The core never reads a clock.

---

## 2. The determinism fork — and why this protocol is agnostic to it

`RESEARCH-determinism.md` (game-engine) answers THE load-bearing question: is a client
replay of `simulateMatchTimeline(seed)` **byte-identical across V8/JSC/Gecko**? Our
in-process determinism is already pinned (`invariants.v2.test.ts:47` — same seed ⇒
`toEqual` on the whole `MatchTimeline`; `engine.v2.test.ts:88`). The open risk is
**cross-engine float divergence** (ECMA-262 leaves `Math.exp/log/pow` precision
implementation-defined; our Poisson sampler and cosmetic tick math touch floats).

**This protocol does not bet on the answer.** The round-resolution message carries a
`resolution` payload that is one of two shapes, chosen by the determinism verdict — and
*nothing else in the state machine changes*:

```ts
type RoundResolution =
  // (b) REPLAY — authority ships coordinates; every client recomputes locally.
  //     Payload is ~tens of bytes. Requires the cross-engine verdict to be GREEN.
  | { kind: 'replay'; tournamentSeed: number; round: number;
      inputs: RoundInputs /* each manager's tactics+XI, collected this phase */ }
  // (c/timelines) CERTIFIED — authority computes and ships the full timelines;
  //     clients never call the engine. Bigger payload, immune to float drift.
  | { kind: 'timelines'; round: number; matchday: MatchdayWire /* see §5 */;
      results: RoundResultWire };
```

Decision rule (to be finalised with game-engine's numbers):

| determinism verdict | ship | payload size (full round, ~48 matches) | who runs the engine |
|---|---|---|---|
| cross-engine **bit-identical** | `kind:'replay'` | ~hundreds of bytes (inputs only) | every client |
| **diverges**, but 1 host is canonical | `kind:'timelines'` from host | measure: watched-match timelines dominate — game-engine to gzip a round | host only |
| diverges + ranked (cheat-proof) | `kind:'timelines'` from **server** (option c certify) | same, server-signed | server |

**RESOLVED (game-engine `RESEARCH-determinism.md`, commit `34cf4a5`):** the engine is
bit-identical across engines *except* a single `Math.exp` in `poisson()` — a ~10⁻¹⁵
cross-engine asterisk that agrees in practice on V8/JSC/Gecko but isn't *guaranteed*.
A **watched** timeline is **3.6 KB gzipped**, and a client only ever needs the match it
is watching (not the whole 48-match round), so realistic cost is **~3.6 KB per watched
match**. Their recommendation, which I adopt for this protocol: **`kind:'timelines'` is
the online default for BOTH MVP and ranked** — paying ~KB/round removes the determinism
question outright, kills the cross-browser golden-test burden, and is the same path
ranked certification already needs. `kind:'replay'` stays a *valid* fallback in the
schema (near-zero bytes if we ever want it), but is not the default.

Net effect on THIS doc: **nothing structural.** The state machine, schema, driver seam,
and migration inventory are identical; the authority simply always broadcasts
`{kind:'timelines', matchday, results}` and clients never call the engine on the hot
path. This is exactly the switch the payload-agnostic design above was built to absorb.

> **Confirmed with game-engine:** `matchSeed` + `moraleByManager` + tactics/XI are the
> *entire* determinism input (`PlayRoundEngine`), so the authority can compute
> timelines from collected inputs with no hidden state.

---

## 3. The core reframe: actions are the protocol, the reducer is the state machine

We do **not** invent a parallel netcode state machine. The room's authoritative state
is exactly `GameState` (plus a thin room envelope), and every transition is an existing
`Action`. Networking = *ordering and gating* who may emit which action when.

```
        LocalDriver (solo, today)                 OnlineDriver (multiplayer)
   ┌─────────────────────────────┐          ┌───────────────────────────────────┐
   UI event → handler → dispatch(A)          UI event → driver.submit(intent)
   → reducer(state, A) → render                          │  (validate locally, optimistic)
                                                          ▼
                                              channel.send(intent) ──▶ AUTHORITY
                                                                        orders + gates
                                                                        + injects seed/deadline
                                              channel.recv(A) ◀── broadcast(A) ──┘
                                              → reducer(state, A) → render   (all clients)
```

Both drivers end in the identical `reducer(state, A)`. The reducer stays pure and
**unchanged**; solo tests keep passing untouched. The only new code is the driver
interface + the authority's ordering/deadline logic.

```ts
interface GameDriver {
  // UI calls these instead of dispatch() directly.
  start(): void;
  spinDraft(): void;  placePick(p: PlayerV2, slot: number): void;  respin(): void;
  setTactics(t: Tactics): void;                 // formation/style between rounds
  readyForRound(): void;                        // "I've locked in" (replaces PLAY ROUND)
  finishPlayback(): void;                       // local: PLAYBACK_DONE
  chooseSteal(c: StealChoice | null): void;
  reset(): void;
  // Driver → app: authoritative actions to run through the reducer, plus room meta.
  subscribe(onAction: (a: Action) => void, onRoom: (r: RoomState) => void): () => void;
}
```

`LocalDriver` is literally today's App handlers (each method dispatches immediately,
fills bots locally, uses `Math.random()` seed). `OnlineDriver` sends intents to the
authority and applies the broadcast action stream. **App becomes driver-agnostic**;
`state.screen`/`battleView` switch renders identically in both modes.

---

## 4. The room / phase state machine (end to end)

Room phases are a superset of the solo `Screen`/`BattleView`, with explicit
*barriers* (wait-for-all-or-deadline) that solo resolves instantly.

```
LOBBY ──seat claim / bot-fill──▶ SETUP(formation+mode, per player, deadline)
  ▲                                      │
  │ (host can kick/rebalance)            ▼
  └──────────────────────────────  DRAFT  (per-pick deadline, AFK auto-pick)
                                         │  barrier: all humans draft-complete OR deadline
                                         ▼
                              TACTICS_LOCK (deadline; commit–reveal in v2)
                                         │  barrier: all tactics in OR deadline→last tactics
                                         ▼
                              RESOLVE (authority computes/derives round) ──┐
                                         │ broadcast {startAt, resolution}  │
                                         ▼                                  │
                              PLAYBACK (synchronized; sync-playback.md)     │
                                         │ barrier: startAt+duration elapsed │ (spectators
                                         ▼                                  │  ride along)
                              RESULTS (table reveal; standings)             │
                                         │                                  │
                          ┌──────────────┴───────────────┐                 │
                     someone eliminated?              tournament over? ─────┘→ END (champion,
                          │ yes                          │ yes                    hall of champions)
                          ▼                              ▼
                    STEAL window (survivors,        (skip STEAL)
                    deadline; AFK = keep XI)
                          │ barrier: all steals in OR deadline
                          └────────────▶ back to TACTICS_LOCK for next round
```

### 4.1 Room lifecycle & seats
- **Create:** host opens a room → 6-char code (Kahoot/Jackbox pattern; precedents doc).
  Host mints the **tournament seed** here (crypto-random, authoritative) and the room
  `version` (engine build hash).
- **Join:** enter code → presence add → claim a seat. Seats are `0..N-1`; unclaimed
  seats become **bots** at draft start. Target 2–32 humans; bots fill to a fixed lobby
  size (today `LOBBY_SIZE`, currently 32) so bracket math is unchanged.
- **Bot fill is deterministic:** bot squads/tactics come from the seeded RNG exactly as
  `createV2Lobby` does today, so every client derives identical bots from `(seed, seat
  map)`. No bot state is broadcast — it's a pure function of the seed.
- **Host migration (v2):** if the host drops, the authority role transfers to the
  lowest-seat live human (state is fully reconstructible from the action log, §6). MVP
  can accept "host leaves → room ends" to save scope.

### 4.2 Phase clock model
Every gated phase has `deadlineAt` (server-epoch ms). The authority is the *only* timer
that matters; clients render a countdown from `deadlineAt` (skew-corrected, same offset
math as playback). On `deadlineAt`, the **authority** emits the fallback action for any
missing input (auto-pick / keep-XI / last-committed-tactics) and advances the barrier.
Clients never self-advance a barrier — they only *display* the countdown.

### 4.3 DRAFT (simultaneous, the interesting phase)
Solo drafts one human alone against pre-baked bots. MP drafts **all humans at once**:
- Each human has their own `humanSlate` and `respinTokens`; picks are independent, so
  there is **no cross-player draft contention** (unlike snake drafts — everyone rolls
  from the shared squad universe; duplicates across *different* managers are allowed,
  the person-uniqueness rule is per-XI). This makes concurrency trivial: N independent
  draft sub-machines, one shared deadline.
- **Roll determinism:** each seat's spins come from a **seat-scoped RNG stream**
  `seatRng(seed, seatIndex)` so player A's rolls never depend on player B's timing.
  (Today solo uses one `rngRef` stream because there's one human — MP must split
  per-seat to keep rolls independent of network ordering. This is the one RNG-plumbing
  change; see §5 inventory.)
- **Per-pick deadline + AFK:** a slow drafter gets a per-pick timer; on timeout the
  authority emits a **deterministic auto-pick** (highest-affinity available for the
  next open slot — reuse bot `autoArrange`/greedy logic). AFK never stalls the room.
- Barrier: all humans' slates complete **or** the phase deadline → auto-complete
  stragglers → SETUP for round 1.

### 4.4 TACTICS_LOCK
Between-round formation/style choice (already `SET_TACTICS`). Barrier: all live humans
submit **or** deadline → keep previous tactics.
- **MVP: trust.** Submit tactics in the clear; the authority collects them. Fine for
  friends — there's no ladder to protect.
- **v2: commit–reveal.** Each client sends `hash(tactics, nonce)` before the reveal
  deadline; after all commits (or deadline), everyone reveals `(tactics, nonce)`; the
  authority verifies hashes. Prevents "wait to see opponent's formation, then counter."
  Additive: a `commit` then `reveal` message pair around the same `SET_TACTICS`.

### 4.5 RESOLVE + PLAYBACK
On the tactics barrier the authority builds `RoundInputs` (every manager's XI+tactics+
morale) and produces `RoundResolution` (§2), then broadcasts `{ round, startAt,
resolution }`. Clients:
- `replay`: run `playRound`-equivalent locally from `(seed, round, inputs)` → identical
  `RoundResult` + `matchday`, then play featured matches at `startAt`.
- `timelines`: adopt the shipped `matchday`/`results` directly (skip the engine call),
  then play at `startAt`.
Either way the render path is unchanged. **Eliminated humans stay subscribed and watch**
(spectator) rather than the solo `handleFastForward` headless path — see §4.7.
Synchronized viewing, skew, late-join seek: all `RESEARCH-sync-playback.md`.

### 4.6 STEAL
Survivors get the steal window with a deadline; AFK = keep XI (null steal). Bots
evaluate deterministically (`evaluateSteal`) from the seed. Barrier → next
TACTICS_LOCK. Note the ordering subtlety already in solo (`handleStealDone` applies
human + bots together): the authority applies all steals atomically after the barrier
so every client sees one `STEALS_APPLIED` with the full XI map.

### 4.7 Elimination → spectator (a genuine divergence from solo)
Solo: when the human dies, `handleFastForward` silently simulates the rest and jumps to
END with a rebuilt final timeline. **MP must not fast-forward** — the tournament is
still live for others. An eliminated human transitions to **SPECTATOR**: still in the
room, still receiving every round's `{startAt, resolution}`, watching *others'* featured
matches. This needs the spectator Matchday shape (which featured matches a seatless
viewer sees) — flagged to match-sim's `RESEARCH-sync-playback.md §5`. The solo
`handleFastForward` becomes a **LocalDriver-only** path; OnlineDriver never calls it.

### 4.8 END
Champion crowned; each client records the hall-of-champions entry locally (the util I
just shipped, `game/champions.ts`) — it already keys off `state.champion`, so it works
unchanged in MP (every client records the same finished tournament; the entry is
per-device by design). Room closes or offers rematch (re-seat, new seed).

### 4.9 Reconnect / rejoin
Covered in §6 — free, because state = `(seed, ordered action log)`.

### 4.10 Version handshake
On join, client sends `version` (engine build hash baked at compile time). Mismatch →
**refuse join** with "update required" rather than silently desyncing a `replay`. For
`timelines` mode a minor mismatch is survivable (clients don't recompute), but we still
gate to keep the reducer shapes compatible.

---

## 5. Message schema (typed events)

Two directions. **Client→Authority = intents** (requests, may be rejected/reordered).
**Authority→Clients = actions/meta** (canonical, applied in order). Intents are
deliberately *not* the reducer `Action`s — they're requests; the authority converts an
accepted intent into the canonical `Action` it broadcasts.

```ts
// ---- envelope ----
interface Envelope<T> { roomId: string; seq: number; /* authority monotonic */ ts: number; body: T; }

// ---- Client → Authority (intents) ----
type Intent =
  | { t: 'join'; name: string; version: string }
  | { t: 'claimSeat'; seat: number }
  | { t: 'leave' }
  | { t: 'setup'; formation: FormationId; mode: DraftMode }
  | { t: 'spin' }                                   // authority returns the seat-rng roll
  | { t: 'respin' }
  | { t: 'place'; playerId: string; slot: number }  // ids, not full players (authority has the squad universe from seed)
  | { t: 'draftComplete' }
  | { t: 'commitTactics'; hash: string }            // v2 commit–reveal
  | { t: 'revealTactics'; tactics: Tactics; nonce: string }
  | { t: 'setTactics'; tactics: Tactics }           // MVP trust variant
  | { t: 'ready' }                                   // lock in for the round
  | { t: 'steal'; choice: { slot: number; playerId: string } | null }
  | { t: 'ping'; clientNow: number }                // skew estimation (sync-playback owns math)
  | { t: 'rejoin'; sinceSeq: number };              // reconnect: give me the log tail

// ---- Authority → Clients (canonical) ----
type Server =
  | { t: 'room'; state: RoomState }                 // full snapshot (join / rejoin)
  | { t: 'roomDelta'; presence: PresenceDelta }     // seat claims, joins, drops
  | { t: 'phase'; phase: Phase; deadlineAt: number | null }
  | { t: 'action'; action: Action }                 // ← run straight through the reducer
  | { t: 'roundStart'; round: number; startAt: number; resolution: RoundResolution }
  | { t: 'pong'; clientNow: number; serverNow: number } // skew
  | { t: 'error'; code: 'ROOM_FULL' | 'BAD_VERSION' | 'SEAT_TAKEN' | 'PHASE' | 'GONE' };

interface RoomState {
  roomId: string; code: string; version: string;
  seed: number;                                     // the tournament seed (authoritative)
  hostSeat: number;
  seats: { seat: number; name: string | null; isHuman: boolean; connected: boolean;
           alive: boolean }[];
  phase: Phase; deadlineAt: number | null;
  seq: number;                                      // last applied action seq (for rejoin)
  // the reducer GameState is DERIVED by replaying the action log; RoomState carries
  // only what isn't reconstructible: identity/presence/seed/phase/deadline.
}
type Phase = 'lobby'|'setup'|'draft'|'tactics'|'resolve'|'playback'|'results'|'steal'|'end';
```

Design notes:
- **Intents carry ids, not objects** (`playerId`, not a `PlayerV2`): the authority and
  every client already have the full squad universe as a pure function of `seed`, so we
  never ship player blobs. Anti-tamper for free (you can't inject a fake 99-rated
  player; the id must resolve in the seeded universe).
- **`action` is the existing reducer `Action`.** The authority is a thin translator:
  accepted `place` intent → broadcast `{t:'action', action:{type:'PLACE',…}}`. This is
  what keeps the client a pure function of the action stream.
- **`seq` is the ordering spine.** Reconnect asks `rejoin{sinceSeq}`; authority replays
  the tail. Gaps ⇒ request full `room` snapshot.

---

## 6. Migration inventory — what changes in App/state, what stays

The reducer (`game/state.ts`) is **untouched** (the actions already exist; solo tests
stay green). All change is in **App.tsx** (extracted into `LocalDriver`) plus a new
`OnlineDriver`. Concretely:

| Piece (today) | Solo behavior | MP change | Where |
|---|---|---|---|
| **seed** `Math.random()` | client picks | **authority mints**; clients receive it in `RoomState` | App.tsx:130 → driver |
| **`rngRef`** single stream | one human's rolls | **per-seat stream** `seatRng(seed, seat)` so rolls are ordering-independent | App.tsx:99,166,179 |
| **`engineCtxRef`** (`matchIndex`, `moraleByManager`) | refs threaded round→round | **derived, reconstructible** from replaying rounds; authority owns canonical copy for `resolve` | App.tsx:104,154,280 |
| **`handleStart`** builds lobby locally | `createV2Lobby(rng)` | bots still pure-from-seed; **seat map** decides which are human | App.tsx:130 |
| **`handlePlayRound`** resolves whole round **synchronously** | `playRound(...)` inline | **split**: `ready` intent → barrier → authority `resolve` → `roundStart` broadcast | App.tsx:~270 (the crux) |
| **`handleFinishRound`** → `PLAYBACK_DONE` | local, immediate | gated on `startAt+duration` (all clients converge); still just `PLAYBACK_DONE` | App.tsx (post night-batch-2) |
| **`handleStealDone`** applies human+bots | inline | authority collects all humans by deadline, applies atomically | App.tsx:~298 |
| **`handleFastForward`** | headless finish for eliminated human | **LocalDriver-only**; OnlineDriver → spectator subscription | App.tsx:~335 |
| **draft timers** | none (untimed) | **new** per-pick + phase deadlines (authority) | new |
| **`animate` flag** | true (browser), false (tests) | unchanged; MP just pins speed 1× (sync-playback §6) | App.tsx |
| **reducer & all `Action`s** | — | **NO CHANGE** | game/state.ts |
| **engine, playback, champions** | — | **NO CHANGE** (pure; already MP-safe) | engine/*, playback.ts, champions.ts |

**The crux, stated plainly:** solo's `handlePlayRound` is a synchronous
"compute-the-whole-round-now." MP replaces the *trigger* (one human clicking PLAY) with
a *barrier* (all live humans `ready`, or deadline), and moves the *computation* to the
authority, which then broadcasts either coordinates (`replay`) or timelines. The reducer
action that lands (`ENTER_PLAYBACK` with the round result, per my night-batch-2 change)
is **the same** — I made round-recording a state invariant carried on `ENTER_PLAYBACK`,
which is exactly what a network broadcast wants to hand the reducer. That refactor was
incidentally MP-friendly.

---

## 7. Anti-cheat posture (per tier, not one-size)

| Threat | MVP (friends) | v2 (ranked) |
|---|---|---|
| See match result early (has seed in `replay`) | ignore — watch-only, inputs locked, no value | use `timelines` from server; client never gets the seed early |
| Lie about own tactics after seeing opponent's | ignore (trust) | **commit–reveal** (§4.4) |
| Inject illegal player/XI | blocked by id-in-seeded-universe (§5) + reducer validation | same + server re-validates |
| Report a false result | N/A (host computes) | **server certification** (option c): server re-runs the pure engine, signs the result |
| Stall the room (AFK) | deadlines + deterministic auto-actions | same |

Commit–reveal and server-certify are *additive on the same schema* — MVP ships without
them and turns them on for ranked without touching the state machine.

---

## 8. Effort tiers

**MVP — "play with 2–8 friends this month," host-authoritative, trust-based**
- Extract `LocalDriver` from App handlers (pure refactor, no behavior change, solo
  tests stay green).
- `OnlineDriver` + a room channel (transport per `RESEARCH-transport.md`); **host
  client is the authority** (mints seed, runs deadlines, computes `resolve`).
- Room code create/join, seat claim, bot fill, presence.
- Phase deadlines + deterministic auto-actions (auto-pick, keep-XI).
- `resolution` = `replay` if determinism GREEN, else `timelines` from host.
- Spectator = keep eliminated clients subscribed (reuse existing Matchday render).
- Skip: commit–reveal, server certification, host migration, matchmaking.
- Risk: host's device is the authority (if they close the tab mid-game, room ends —
  acceptable for friends). Everything else is bounded plumbing.

**v2 — "up to 32, ranked, cheat-resistant"**
- Move authority off the host into a **serverless function** (Supabase Edge / the
  transport's server runtime) that bundles the pure engine unchanged.
- Commit–reveal tactics; server certification of results (option c); host migration.
- `timelines` mode default if cross-engine determinism is anything short of perfect.
- Matchmaking / public rooms; reconnect hardening; soak/chaos tests (QA doc).

---

## 9. Open questions / decisions for Lucca (and cross-worker coordination)

1. ~~**Determinism verdict**~~ **RESOLVED** (game-engine `34cf4a5`): one `Math.exp`
   asterisk + 3.6 KB/watched-match ⇒ **`timelines` is the online default for both
   tiers** (§2). No longer blocking; no state-machine impact.
2. **MVP authority: host-client or serverless from day one?** Host-client is far less
   work and fine for friends; serverless is required for ranked. Recommend host-client
   MVP → serverless v2. (Transport doc informs feasibility.)
3. **Tactics trust level for casual** — commit–reveal from the start, or trust for MVP?
   Recommend trust for MVP (it's friends), commit–reveal gated to ranked.
4. **Draft deadline lengths & AFK policy** — engineering default: 20–30s/pick soft, hard
   phase cap ~2–3 min; product call is draft-page's precedents doc + Main.
5. **Eliminated-human experience** — confirm spectators watch *featured* matches only
   (which ones?) — needs the spectator Matchday shape from match-sim.
6. **Host-migration in MVP?** Recommend no (room ends if host leaves) to save scope;
   revisit for v2.
7. **Rematch semantics** — new seed, same seats? (Trivial: `reset` + fresh seed.)

---

## 10. Sources

Internal (load-bearing):
- `docs/redesign/PLAN-architecture.md` §"Job 2 — Multiplayer-readiness memo" (options
  a/b/c; the (b) recommendation this doc stress-tests).
- `docs/redesign/CONTRACT.md` §5 (playback is `pure(timeline, elapsed)`; MP-critical
  constants) and §6 (state deltas / `Matchday`).
- `engine/tournament.ts:231` (`matchSeed` canonical coordinates), `PlayRoundEngine`
  (the *complete* determinism input: seed, round, matchIndex, morale, tactics).
- `engine/invariants.v2.test.ts:47`, `engine/engine.v2.test.ts:88` (in-process
  full-timeline determinism already pinned).
- Sibling briefs: `RESEARCH-sync-playback.md` (clock/skew/seek/spectator),
  `RESEARCH-transport.md` (channel choice), `RESEARCH-mp-ux-precedents.md` (lobby/timer
  precedents), `RESEARCH-determinism.md` (cross-engine verdict — **pending**).

External patterns (well-established, not novel claims):
- **Commit–reveal** for simultaneous hidden moves — standard cryptographic commitment
  scheme (hash a value+nonce, reveal later); widely used for on-chain and P2P games to
  prevent front-running of simultaneous choices.
- **Room-code lobbies** (6-char join codes, host screen) — Kahoot / Jackbox pattern;
  detailed in the precedents doc.
- **Cristian's algorithm / NTP-style offset estimation** for client clock skew — the
  math is owned by `RESEARCH-sync-playback.md`; cited here only as the mechanism behind
  skew-corrected phase countdowns.

---

*Status: research complete for R2. Determinism dependency now RESOLVED (game-engine
`34cf4a5`): server-computed `timelines` is the online default for both tiers; the
`replay` payload stays in the schema as an unused fallback. The state machine, schema,
driver seam, and migration inventory are final.*
