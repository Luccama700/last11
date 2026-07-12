# Multiplayer — Phase R2 (research & planning ONLY, no src/ changes)

> **STATUS (2026-07-12): SHIPPED.** This file is the historical research-phase
> brief. Multiplayer is live at last11.app (engine `last11-mp-6`) — the current
> state is `MULTIPLAYER-PLAN.md` §6–7 (implementation) and
> `FORMAT-REPORT-v1.1.md` §6b (the authoritative ruling list).

Directed by Lucca (2026-07-12): "by the end of this I want to have both a single
player or multiplayer mode" — this phase produces the research + the plan
(implementation approach, feasibility, major changes), NOT code. Main owns the
product/UX design and the final synthesis; workers research and write findings.

Start work on your section ONLY AFTER your night-batch-2 job is done and merged.
Output: `docs/multiplayer/RESEARCH-<area>.md`, committed to your own file, findings
→ options compared → recommendation → open questions. Cite sources for web claims.

## Fixed context (do not re-litigate)

- Architect's existing memo (PLAN-architecture.md Job 2 + CONTRACT §5): the engine
  is pure/deterministic; playback is `pure(timeline, elapsedMs)`; per-match seeds
  are canonical `matchSeed(tournamentSeed, round, matchIndex)`. Recommended model
  was (b) deterministic client replay with a thin relay; (c) server-certification
  as ranked upgrade. This phase STRESS-TESTS that recommendation, it doesn't
  assume it.
- Product intent: 2–32 humans per room, bots fill empty seats; fixed wall-clock
  match playback (already true); eliminated humans become SPECTATORS who can
  watch the rest; private rooms with codes first, matchmaking later.
- Solo mode must remain first-class: one game, two drivers (local vs online),
  engine/reducer unchanged wherever possible.

## Sections & owners

### RESEARCH-determinism.md — game-engine
THE load-bearing question: is client-side replay bit-identical across browsers?
ECMA-262 leaves Math.exp/log/pow precision implementation-defined — our Poisson
sampler uses Math.exp, and the timeline cosmetics use math on floats. Audit every
transcendental/float-order dependence in the engine; test V8 vs JSC vs Gecko if
feasible (write tiny probes, run in node + report what browsers would need);
evaluate mitigations: (a) deterministic exp polyfill / fixed-point, (b) integer-
only engine core, (c) SERVER-COMPUTED TIMELINES as the wire format (clients never
recompute — measure timeline JSON size for a full round, 48 matches, gzip).
Recommend: client-replay vs server-computed-timelines vs hybrid, with numbers.

### RESEARCH-protocol.md — architect
The room/phase state machine end-to-end: create/join (room codes), seat claim,
bot fill, DRAFT phase (simultaneous spins on a shared phase clock, per-pick
deadlines, deterministic auto-pick for AFK), tactics lock (commit-reveal or
trust-for-casual?), round resolution (input collection deadline → seed+inputs or
timelines broadcast → synchronized startAt playback), steal windows, elimination
→ spectator, reconnect/rejoin (state rebuild from input log), version handshake,
room lifecycle/timeouts. Define the message schema (typed events) and the seam in
OUR code: the "driver" abstraction (LocalDriver = today's App handlers;
OnlineDriver = same actions fed by the room channel) — inventory exactly which
App/state pieces change (seed source, rngRef, phase waits, timers) and which
stay. Effort-tier the migration: MVP (2–8 friends, casual trust) / v2 (32,
certification, ranked).

### RESEARCH-transport.md — players
Compare hosting/transport options with quotas + pricing at our scale (rooms of
2–32, ~KB-scale messages, phase cadence not frame cadence): Supabase Realtime +
Edge Functions (already in Lucca's stack), PartyKit/Cloudflare Durable Objects,
Colyseus, plain Node+ws on Fly/Railway/Render, Firebase RTDB. Table: cost at 0 /
100 / 10k MAU, latency model, room-state persistence, auth story (anonymous),
free-tier ceilings, lock-in. Recommend one for MVP + one for scale. Web research
inline, no subagents.

### RESEARCH-sync-playback.md — match-sim
Synchronized viewing spec: server startAt → client clock skew handling (SNTP-ish
offset estimate vs trusting local clock), late-join/reconnect mid-match (seek =
pure(timeline, now-startAt) — verify our playback handles arbitrary seek),
spectator multi-match view (eliminated players watching OTHERS' featured
matches — what does the Matchday shape need), speed controls disabled in MP,
pens beat timing across clients. Pure timing/design doc against the existing
playback core; identify any playback.ts changes needed (should be near-zero —
prove it).

### RESEARCH-mp-ux-precedents.md — draft-page
How comparable games run multiplayer flows (web research): 38-0 1v1 ranked +
private leagues, roadto38 64-player weekly bracket + Champions rooms, 38nil.fun
online rooms, plus generic patterns (Kahoot/Jackbox room-code lobbies, chess.com
correspondence timers). For each: lobby flow, timer lengths, AFK handling,
disconnect policy, spectator features, seat limits. Raw findings only — product
design decisions are Main's.

### QA — RESEARCH-testing.md
How to test MP without pain: multi-client simulation harness (N fake drivers
against one room state machine, all in vitest), clock-skew fuzzing, protocol
property tests (every input-log replay reaches identical state), the cross-env
golden-timeline test (depends on determinism verdict), soak/chaos basics.

## Synthesis (Main)
Main writes docs/multiplayer/MULTIPLAYER-PLAN.md after all sections land:
product/UX design (lobby, mode select, spectator experience), final architecture
decision, feasibility verdict, tiered roadmap with effort estimates, and the
decision list for Lucca.
