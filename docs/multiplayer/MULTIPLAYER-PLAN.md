# Last11 Multiplayer — The Plan (Phase R2 synthesis)

Status: **v1.0** (Main, 2026-07-12) — synthesized from the six RESEARCH-*.md docs.
(RESEARCH-testing.md landing last; its harness plan slots into §6 unchanged.)

## 0. The verdict

**Feasible, and cheaper than expected.** The two classically hard problems are
already solved by the codebase's own discipline: the engine is pure+seeded, and
playback is `pure(timeline, elapsedMs)` — the sync doc PROVES playback.ts needs
ZERO changes (late-join seek is free). The one genuine hazard found is
`Math.exp` in the Poisson sampler (implementation-defined precision across JS
engines), which kills naive cross-browser client replay — and the architecture
routes around it entirely:

- **MVP (2–8 friends, casual): HOST-AUTHORITATIVE.** The host's browser is the
  room authority — it owns the seed, phase deadlines and action ordering, runs
  the ONE engine instance, and broadcasts computed `MatchTimeline`s (KB-scale)
  plus `startAt` through **Supabase Realtime** (Broadcast + Presence + a
  Postgres input-log for reconnect). One JS engine computes ⇒ bit-identical for
  everyone by construction; clients are pure playback. $0 at MVP scale, and
  Supabase is already in Lucca's stack.
- **v2 (32 seats, ranked): SERVER-CERTIFIED.** The same pure engine moves into a
  serverless function as the authority (host-migration + anti-cheat solved in
  one move), commit–reveal on simultaneous decisions, engine-version handshake.
  Strictly additive on the same message schema.

**The single hard code change** (protocol doc §3): today `playRound()` resolves a
whole round synchronously inside a click handler. Multiplayer needs resolution
split at the input-collection deadline — actions in, authority resolves,
timelines out — behind a **Driver interface** (`LocalDriver` = today's handlers
verbatim; `OnlineDriver` = the room channel feeding the SAME reducer actions).
Engine, reducer, screens: unchanged.

**Effort:** MVP ≈ a focused weekend (driver seam + room channel + lobby UI +
deadline timers); v2 ≈ a second comparable chunk. No rewrite anywhere.

## 1. Product design (Main's lane — this section is the design)

### Mode select
The home screen becomes a fork: **SOLO RUN** (today's game, unchanged, instant)
and **BATTLE ROYALE ONLINE** → create room / join by code. One game, two entry
doors; everything after the lobby looks identical in both modes.

### Lobby
- Room code (5 letters, shareable link `11a0.com/r/GOLDN`). Host creates, picks
  lobby size cap and phase-timer profile (Casual / Fast).
- Seats fill with humans as they join; at kickoff every empty seat gets a bot
  (the funny names stay). 2 humans minimum, 32 seats always.
- Lobby shows crests + names joining live; host presses START — from that moment
  every phase runs on the shared room clock, nobody waits on stragglers.

### The shared-clock principle (the core UX decision)
Solo Last11 is turn-paced; online Last11 is PHASE-paced. Every phase has a fixed
window and a deterministic fallback, so one AFK player can never stall 31 others:
- **Setup** (formation/style): 45s → fallback: 4-3-3 balanced.
- **Draft**: everyone drafts SIMULTANEOUSLY on their own board — 11 picks inside
  one shared window (~3 min Casual) with per-pick soft deadlines; timeout =
  deterministic auto-pick (the bot policy, seeded, so it's fair and replayable).
  A live rail shows opponents' fill-progress (7/11...) for pressure.
- **Rounds**: results resolve at the deadline; everyone watches their own featured
  match simultaneously (same wall-clock duration — this is why we built fixed
  45s playback), rails tick the other matches live.
- **Steal window**: 30s, simultaneous, hidden picks (revealed together).
- **Between matches**: re-slot window 20s, or skip.

### Elimination → spectatorship
Getting cut must stay fun: eliminated humans become SPECTATORS — they see the
standings popup pinned, can watch any surviving match as their featured view
(the marquee mechanic), and get a "rooting for" pick that shows on the end
screen. They never get kicked to a lobby; they see the crowning.

### The end
Shared end screen: champion banner (human or bot), Golden Boot/Playmaker,
per-human placements, and the persistent HALL OF CHAMPIONS (already landing in
solo tonight) which in MP records the room's winner by name.

### What solo keeps
Solo remains exactly today's game (its own pace, skip buttons, speed controls —
those are removed only in MP). Same screens, same engine; the mode only changes
who supplies inputs and who owns the clock.

## 2. Architecture decision — PENDING RESEARCH
Two candidate shapes (the determinism audit decides):
- **A. Deterministic client replay**: server relays (seed + everyone's inputs +
  startAt); clients recompute matches locally. Cheapest bandwidth; requires
  bit-identical math across browsers (Math.exp risk — see RESEARCH-determinism).
- **B. Server-computed timelines**: one Node/Edge runtime runs the SAME pure
  engine, broadcasts full MatchTimelines (~KBs); clients only play back
  (pure(timeline, elapsed) — zero cross-browser risk). Slightly more bandwidth,
  radically fewer determinism footguns, and anti-cheat comes free.
Main's prior: **B for MVP** unless the determinism audit proves A trivially safe
— B also keeps the client dumb enough that phones/weak devices never desync.

## 3. Major changes inventory — PENDING RESEARCH-protocol
Known already: seed comes from the server not Math.random; rngRef/engineCtxRef
move behind a Driver interface (LocalDriver = today's handlers; OnlineDriver =
room channel); state machine gains WAITING/DEADLINE states + phase clock; App
timers respect server startAt; auth = anonymous session per room.

## 4. Feasibility & roadmap — PENDING (effort tiers land with research)
Expected shape: **MVP** = private rooms 2–8, casual trust, server timelines,
Supabase or PartyKit transport; **v2** = 32 seats, reconnect hardening,
certification/ranked; **v3** = matchmaking, persistent accounts.

## 5. Decisions for Lucca — ALL RESOLVED (see FORMAT-REPORT-v1.1.md §6b)
1. ~~MVP seat count~~ → **20-manager rooms**, fill-with-bots start.
2. ~~Trust vs commit-reveal~~ → **trust for MVP; commit–reveal is a planned
   later feature** (ranked/public rooms).
3. ~~Phase timers~~ → **30s picks · 30s match slots (lockstep) · combined 45s
   pit stop** (loot + re-slot + tactics; wave-2 retune from 10s/20s). When
   every human has locked in, the countdown snaps to a **5s fuse** instead of
   running out the window (§6b ruling 9). Cut ladder 20→16→8→4→2→1.
4. ~~Rooting-for~~ → **IN** — eliminated managers pick a survivor to back.

The format is fully locked as of 2026-07-11; FORMAT-REPORT-v1.1.md §6b is the
authoritative ruling list.

## 6. IMPLEMENTED (MVP shipped 2026-07-11, Main)

- `src/engine/mp.ts` — the pure layer: stride-rotation squad assignment,
  global-uniqueness pools, deterministic bots + auto-picks, `resolveMpRound`
  (playRound with an injected DETAILED `sideOf` + fixed pairing rng), lockstep
  slot timing (1.5× scale), matchday rebuild from stamped seeds.
- `src/game/net/` — typed protocol + Supabase Realtime channel (broadcast +
  presence only, NO tables; project `last11`, keys in `.env.local`/Vercel env).
- `src/game/online/controller.ts` — host-authoritative room brain with ONE
  apply path (host self-receives its own canonical stream); host-only code is
  the deadline timer. Wire carries seeds/picks/deadlines only — pairings, bots,
  morale, pools and timelines are derived locally and deterministically.
  Wave-2 hardening: every host message stamps `hostNow` (clients keep a median
  clock offset — real phones sit seconds off NTP) and a mirror checksum
  (`sync`) that surfaces divergence as a loud SYNC LOST banner, never silently.
  When every human has locked in, the host snaps the deadline to 5s and
  broadcasts `hurry` so all countdowns jump together (all-locked-in rule).
- `src/screens/online/OnlineApp.tsx` — entry → lobby (setup while waiting,
  fill-with-bots) → simultaneous draft (SpinReveal + 30s countdown + board
  moves) → lockstep viewing (MatchPlaybackScreen wall-clock mode, no skips) →
  45s combined pit stop (loot rail + re-slot + tactics on the pit board) →
  spectator view with rooting-for → EndScreen + Hall of Champions.
- Tests: `mp.test.ts` (15) + `controller.test.ts` loopback end-to-end (a full
  host+guest tournament over an in-memory bus, mirrors asserted identical —
  this caught a real gameStart/spinStart ordering race) + entry DOM tests.
  Real-network smoke verified broadcast+presence on the live project.
- Deliberate MVP wire-format deviation: REPLAY coordinates (seeds+inputs)
  instead of shipped timelines — all clients run the same build (version
  handshake enforces it); `timelines` remains the ranked upgrade path.
- Out of MVP scope (documented): reconnect/rejoin (drop = AFK fallbacks),
  host migration (host leaves ⇒ room over), commit–reveal (later feature).
