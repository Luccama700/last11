# PLAN — Architecture, contract & multiplayer-readiness

Owner: worker-7 (integrator). Phase R (research + plan only). Companion file:
`CONTRACT.md` (the shared types). Status: **v0.2 (2026-07-11)** — PLAN-draft and
PLAN-qa reconciled (see the Reconciliation log); still awaiting PLAN-database,
PLAN-engine, PLAN-sim.

---

## Findings

- The engine is **already pure and deterministic** (`mulberry32` seeded RNG in
  `src/engine/rng.ts`, consumed only in event handlers; reducer is pure; 54
  tests including an e2e tournament and a determinism test). This is the single
  most important fact for multiplayer: option (b) below is not aspirational, it
  is a small refactor of what already exists.
- Today's coupling to the old shapes is shallow and localized:
  - `Position` = 4 coarse values, referenced in `types.ts`, `rating.ts`
    (`FORMATION`, `effectiveRating`, `OFF_POSITION_MULT`), `draft.ts`,
    `data.ts`, and the screens.
  - Strength is a flat sum (`teamStrength`) → a single number → Poisson xG on
    the strength diff (`simulateMatch`). Tactics/formation do not enter it at
    all today.
  - State machine has 5 screens; draft walks `FORMATION` slot-by-slot via one
    advancing `draftSlotIndex`; `spunNation` is a bare string.
- Nothing in the UI currently makes a gameplay decision that isn't already
  routed through the seeded RNG, EXCEPT that matches resolve instantly (no
  timeline, no playback clock). So the two real new seams are: **(1)** the
  strength/timeline producer in the engine, and **(2)** a fixed-duration
  playback consumer in the sim — both of which the multiplayer story needs.
- The four content streams all converge on the same handful of shared types
  (Position, PlayerV2, Squad, Formation, Tactics, MatchTimeline). If each invents
  its own, integration is a rewrite. `CONTRACT.md` freezes them now.

---

## Job 2 — Multiplayer-readiness memo

> Lucca asked: should match playback "all be server-side — correct me if I'm
> wrong." Short answer: **no, and you're right to doubt it.** Because our engine
> is already deterministic, the correct model is a *thin* server that exchanges
> seeds + tactics; clients replay the identical timeline locally, synced by one
> shared start timestamp. Server-authoritative streaming is the wrong default
> here — it throws away the exact property that makes this engine special.

### The three options

**(a) Fully server-authoritative — server runs the sim, streams state frames.**
The server is the only place the match exists; every client renders frames it
receives.
- Pros: canonical result by construction; trivially cheat-proof (client never
  computes anything); clients can be dumb.
- Cons: bandwidth + server CPU scale with viewers × 30fps; needs a real-time
  infra investment now; latency/jitter shows directly in the pitch meter;
  **discards our determinism** — we'd be paying to stream what every client
  could compute for free. Wrong tool for a turn-based BR whose matches are short
  and whose engine is pure.

**(b) Deterministic replay — server exchanges `(seed, both tactics, both XIs)`;
each client runs the SAME engine locally and plays the SAME timeline, aligned by
a shared `startAt` wall-clock timestamp.** ✅ **RECOMMENDED.**
- Pros: server is tiny (relays a few hundred bytes per match, no game logic on
  the hot path); zero per-frame bandwidth; perfectly in sync because playback is
  `pure(timeline, elapsed)` and `elapsed = now − startAt`; the engine we already
  have IS the netcode; scales to many spectators for free (they run it too).
- Cons / honest trade-offs:
  - **Anti-cheat:** a client can compute the result early (it has the seed) or
    lie about its own tactics submission. Mitigation: **commit–reveal** on
    tactics (both submit a hash before either reveals), and the server (or any
    peer) can re-run the same pure engine to verify a claimed result in
    microseconds — cheating is *detectable* even though the sim is client-run.
    Seeing the result a few seconds early has no value in a fixed-duration
    watch-only match where inputs are already locked.
  - Requires **every client on the same engine version** — a version byte in the
    match handshake; mismatched versions refuse rather than desync.
  - Floating-point determinism across engines is the classic trap; ours is
    integer-ish (`Math.imul` mulberry32 + Poisson via multiply-compare). Lock it
    with a cross-environment golden-timeline test (QA plan).

**(c) Hybrid — clients replay locally (b), server independently re-runs the same
engine to *certify* the official result.** The honest upgrade path for a ranked/
competitive mode.
- Pros: all of (b)'s cheapness for rendering + an authoritative result the
  server signs; cheating a reported result becomes impossible, not just
  detectable.
- Cons: server needs the engine bundled (fine — it's pure TS, runs in Node
  unchanged) and a tiny bit of orchestration. Strictly additive on top of (b).

### Recommendation

Ship **(b)** as the multiplayer model; treat **(c)** as the drop-in hardening for
a future ranked mode (same engine, now also run server-side to certify). Never
build (a). The whole point of a deterministic engine is that the timeline is the
wire format — a few hundred bytes, not a video stream.

### What we must do NOW (in the solo game) so multiplayer is a refactor

None of this builds a server this weekend — it just avoids decisions that would
force a rewrite later:

1. **Playback is `pure(timeline, elapsedMs)`** (see `CONTRACT.md §5`). No
   per-frame RNG, no engine calls inside React. The component only maps a clock
   to a frame. This single rule is 80% of multiplayer-readiness.
2. **The timeline is the unit of exchange.** The engine emits a complete
   `MatchTimeline` up front; nothing about the match is decided during playback.
   (Headless BR uses the score-only path; watched matches get the full timeline.)
3. **All randomness through the seeded `Rng`.** Already true — keep it true. No
   `Math.random`/`Date.now` in engine or reducer (QA guards this). The match seed
   must be **derived deterministically** from `(tournamentSeed, round, matchId)`
   so a server can name a match by its coordinates, not ship a fresh seed.
4. **No gameplay decision in a component.** Tactics submitted → locked into
   state → passed to the engine. Draft picks go through the reducer. Components
   render; they never resolve outcomes.
5. **Round/match clock semantics are explicit and shared.** Fixed wall-clock
   duration per match; `startAt` timestamp drives `elapsed`. Draft timers, if
   added, are the one place real wall-clock enters gameplay — keep them out of
   the deterministic core (a draft timeout produces an *action*, e.g. auto-pick,
   which then flows through the seeded reducer like any other).

### Eventual transport/host (one page, not this weekend)

- **Recommendation: Supabase Realtime broadcast channels** for lobby + match
  handshake (seed, both tactics, `startAt`), with a **tiny serverless function
  (Vercel/Supabase Edge) that owns match scheduling + result certification**
  (option c) if/when ranked lands. Rationale: Lucca already runs Supabase across
  his stack; Realtime gives presence + broadcast with no server to babysit; the
  pure engine drops into an Edge function unchanged for certification.
- Alternative if we want zero external deps: a **~100-line Node + `ws` relay**
  (rooms, broadcast, presence). More control, one more thing to host. Prefer
  Supabase unless we outgrow it.
- Either way the payload is the same handshake; the transport is swappable
  precisely because the timeline is deterministic. **This is a post-hackathon
  build (Tier B / Tier 3).**

---

## Job 3 — Integration sequencing

Goal: `main` stays green and *playable* at every merge. Order chosen so each step
is independently shippable behind a flag and the demo never breaks.

```
0. CONTRACT.md merged (types only, no behavior)         ← no risk, unblocks all
1. Contract types added to src/ (Position12, PlayerV2,  ← compile-only; old code
   Formation, Tactics, MatchTimeline) alongside old        untouched, adapters map
   types + the migration adapter (§7 of CONTRACT)          old↔new
2. Data v2 behind `dataV2` flag: new squads-by-year     ← flag OFF = old 12×12
   JSON + loader; adapter feeds old game when OFF          JSON, game identical
3. Engine v2 behind `engineV2` flag: affinity matrix +  ← flag OFF = current
   zonal strength + tactics modifiers + timeline           Poisson; ON = new model
   producer; score-only path preserved for headless BR      validated vs balance harness
4. Draft UI v2: formation picker + tactics board + free ← consumes engine+data v2;
   placement + year roll; bots get slot-choice strategy     gated by same flags
5. Sim UI v2: fixed-duration playback of the human's    ← consumes timeline;
   match; others summarized on a rail                       animate={false} instant path kept
6. Flags default ON; delete adapters + old shapes once  ← cleanup, last
   every stream is green
```

**Why this order:** types → data → engine → draft → sim mirrors the dependency
DAG (draft needs positions+squads+affinity; sim needs the timeline the engine
produces). Each of steps 2–5 is behind a flag, so a half-finished stream can sit
on `main` without breaking the Saturday demo. If time runs out, we ship whatever
prefix is green with flags OFF — i.e. **the current game still runs**.

### Keeping the 4-position data alive until v2

The migration adapter (`CONTRACT §7`) maps the current coarse squads into
12-position formations (`DF→CB`, `MF→CM`, `FW→ST`) and a diagonal-`1.0`/off-
`0.75` affinity matrix that reproduces today's exact numbers. So with all flags
OFF the engine v2 code path is behaviorally identical to v1 — the balance harness
can prove that (a regression gate) before any real values turn the flag ON.

### The 54 tests: preserve vs update

| Test area | Fate |
|---|---|
| `rng.test.ts` | **Preserve** verbatim — RNG contract is unchanged and load-bearing for multiplayer. |
| `data.test.ts` | **Update** — add v2 schema validation (ids unique across nation-year, 12-position enum, rating bounds); keep old-JSON test until data v2 default-on. |
| `rating.test.ts` | **Update** — `effectiveRating` now takes the affinity matrix; keep the "stronger XI out-rates weaker" invariant. |
| `match.test.ts` | **Update/expand** — Poisson tests stay for the v1 path; add timeline invariants (goals sum, tick bounds, determinism) for v2. |
| `draft.test.ts` | **Update** — bot slot-choice strategy + free placement; keep "no dup within a team". |
| `tournament.test.ts` | **Preserve shape** — e2e "32→1 deterministically, monotonic shrink, correct cut counts" is the crown-jewel invariant; update only the steal-pool assertion for pool v2. |
| `state.test.ts` | **Update** — new phases (`setup`, `playback`), `SPIN {roll}`, `PICK {slotIndex}`. |
| `app.test.tsx` | **Update** — walkthrough gains formation pick + a playback step; the `animate={false}` instant path must still resolve synchronously. |

New invariants to lock (coordinate with QA plan): same seed ⇒ identical
timeline; `Σ goal events == finalScore`; every formation drafts to a legal XI for
bots; affinity matrix in-bounds + diagonal 1; `resolveMatch` score ==
`simulateMatchTimeline` score for the same seed.

---

## Risk list

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Engine v2 scope (zonal + tactics + timeline) blows the 24h clock | High | High | Flag-gated; v1 stays the demo default. Tier A = affinity + style only; Markov/timeline is Tier B. |
| R2 | Four streams invent conflicting shapes | Med | High | This is why CONTRACT.md ships first and I reconcile every plan. |
| R3 | Data v2 (historical squads) is a huge manual effort | High | Med | db plan targets ~12 nations × few years; ONE verified sample squad for the demo, rest incremental. Adapter keeps old data working. |
| R4 | Fixed-duration playback breaks the synchronous test path | Med | Med | `pure(timeline, elapsed=∞)` returns the final frame; `animate={false}` preserved as a hard requirement in CONTRACT §5. |
| R5 | Cross-environment float determinism (future MP) | Low (now) | High (later) | Golden-timeline test across Node+browser; version byte in the handshake. Not a hackathon blocker. |
| R6 | Free-placement draft creates "no compatible slot" dead-ends | Med | Med | Draft plan must define the fallback (off-position with penalty / re-spin / skip). I flag it; engine affinity threshold gates the UI. |
| R7 | Bots must draft under the new free-placement + tactics rules or the BR breaks | Med | High | Bot slot-choice strategy is a draft-plan deliverable; tournament e2e test is the gate. |

---

## Tier A vs Tier B (my workstream)

**Tier A — shippable by Saturday night (integrator scope):**
- `CONTRACT.md` frozen + the shared types added to `src/` alongside old ones.
- Migration adapter so the current game keeps running with flags OFF.
- Flag scaffolding (`dataV2`, `engineV2`, `draftV2`, `simV2`) wired into
  `src/game/flags.ts` (today it's only the flag-emoji map — I'll add a feature-
  flag object next to it, or a sibling `features.ts`).
- This multiplayer memo delivered as the answer to Lucca's question (decision,
  not code).
- Reconciliation pass over whatever peer plans land.

**Tier B — post-hackathon:**
- Multiplayer transport (Supabase Realtime handshake + optional Edge
  certification, option c).
- Deleting adapters + old shapes once every stream is default-on.
- Cross-environment determinism golden test for netcode.
- Commit–reveal tactics submission for anti-cheat.

---

## Open decisions for Lucca (integrator)

1. **Accept engine-v2 behind a flag for the demo?** Recommended: demo runs
   **v1 (current Poisson) by default**, with v2 tactics/affinity as a toggle we
   flip live if it's stable by Saturday. Keeps the demo safe. Yes/no?
2. **Multiplayer model confirmed as (b) deterministic-replay**, with (c) as the
   ranked-mode upgrade? (This memo recommends it; I need your sign-off to design
   the solo game around the `pure(timeline, elapsed)` constraint.)
3. **Supabase Realtime** as the eventual transport (vs a self-hosted Node+WS
   relay)? Leaning Supabase since it's already in your stack.
4. **Flag or fork?** I recommend feature flags on `main` (one branch, always
   green) over long-lived feature branches. Confirm you're happy merging
   half-built streams behind OFF flags rather than holding them on branches.
5. **How hard is "always playable"?** If a stream isn't green by Saturday
   afternoon, do we cut it from the demo (flag OFF) with no hesitation? I'll
   enforce that if you say so.

---

## Reconciliation log

- **v0.1 (2026-07-11):** authored before any `PLAN-*.md` peer landed. CONTRACT.md
  drafted from the six briefs + engine source.
- **v0.2 (2026-07-11):** reconciled PLAN-draft + PLAN-qa into CONTRACT v0.2 (see
  below). Still awaiting PLAN-database, PLAN-engine, PLAN-sim (their `samples/`
  landed but not the plans).

### Peer-plan review

**PLAN-draft.md (bug-hunt) — strong, reconciled.** Free-pick-onto-pitch board,
8-formation catalog, (nation, year) roll, re-spin tokens, Classic/Memory mode,
bot slot-choice strategy. Alignment + the fixes I made:
- ✅ 12-position `Position`, `PlayingStyle`, formation catalog — match CONTRACT.
- ⚠️ **Affinity arg order conflict** — draft wrote `affinity(slot, natural)`;
  CONTRACT indexes `matrix[natural][slot]`. **Resolved:** canonical is
  `affinity(natural, slot)`; draft adopts it. This is exactly the silent-shape
  bug the contract exists to catch — caught pre-code.
- ✅ Folded `year`-on-player, `mode`, `respinTokens`, and the **sparse-XI**
  model into CONTRACT §2/§6. Draft flagged sparse-XI as its highest-risk
  cross-cutting assumption; I froze it as "sparse during draft, dense at
  kickoff" so every engine consumer still sees a dense 11.
- ✅ Draft's off-position recommendation (affinity, never dead-ends) maps onto
  CONTRACT's `compatibleThreshold` — the shape serves both models; Lucca's Q1
  answer just sets the value. No contract change needed either way.
- 🔎 Scope note: draft's Tier A offers all 8 formations; if the engine's Tier A
  only differentiates 3, the picker shows formations that play identically. QA
  raised the same "do the Tier-A cuts compose" risk. Tracked as R-compose below.

**PLAN-qa.md (test-hardening) — strong, reconciled.** Balance harness
(`balance.report.ts` + `skipIf(!BALANCE)`), real-football target bands (2.6–2.9
goals, 22–29% draws, sourced), test migration map, determinism traps.
- ✅ Its Job-2 invariants (same-seed⇒identical timeline; goal-sum==score; legal
  XI per formation; affinity bounds+diagonal) are exactly CONTRACT §4's locked
  invariants — independently converged, good signal.
- ✅ **Affinity symmetry** — QA correctly refused to assume it and asked CONTRACT
  to decide. **Decided: asymmetric-allowed** (CONTRACT §1). QA writes bounds +
  diagonal tests only, no symmetry assertion.
- ✅ **Steal-pool mechanics** — QA flags "replace starter vs expand bench" as a
  `Manager`-shape decision unresolved across 3 briefs. Surfaced as CONTRACT open
  Q7 with a default (replace-a-starter, keeps `xi` dense).
- ✅ QA's "publish a CONTRACT draft as soon as 2–3 plans land, not after all 4"
  recommendation — already doing exactly that (this is v0.2 off two plans).
- 🔎 QA's cross-cutting worry ("do all 5 Tier-A cuts compose into one playable
  demo") is really MY job (sequencing). Elevated to R-compose below.

**New risk R-compose (from both plans):** the five independent Tier-A cuts may
not compose — e.g. an 8-formation picker over an engine that only distinguishes
3, or a box-score panel with no zonal numbers behind it. **Mitigation (mine):**
once PLAN-engine + PLAN-sim land, I publish a one-page "Tier-A demo contract" —
the exact feature set every stream's Tier A must hit so the Saturday demo is
internally consistent (draft's proxy box-score in §2b already anticipates this).
This is the single highest-value integration check; it goes in CONTRACT v0.3.

**Still awaiting:** PLAN-database (squad size, id scheme, secondaries, rating
rubric bounds → CONTRACT §2), PLAN-engine (affinity VALUES, `Tactics` levers,
timeline producer → §1/§3/§4), PLAN-sim (match duration + wall-clock → §4/§5).
`samples/brazil-2002.json` and `samples/match-playback.html` landed ahead of
their plans; treated as provisional until the plans confirm shapes.
