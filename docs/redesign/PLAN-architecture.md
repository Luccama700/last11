# PLAN — Architecture, contract & multiplayer-readiness

Owner: worker-7 (integrator). Phase R (research + plan only). Companion file:
`CONTRACT.md` (the shared types). Status: **v0.3 (2026-07-11)** — all six plans
landed and reconciled; the seven cross-plan conflicts are resolved in CONTRACT
v0.3 and reviewed below. Includes the **Tier-A Demo Contract** (promised in
R-compose).

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

## Tier-A Demo Contract (the R-compose deliverable)

The one thing that can sink a six-stream redesign: five internally-fine Tier-A cuts
that **don't compose** into one playable Saturday demo (an 8-formation picker over an
engine that distinguishes 3; a box-score panel with no numbers behind it; a playback
view with no timeline). This is the binding agreement on the EXACT Tier-A feature set,
so every stream cuts to the same line. **If a row below can't be green by Saturday
afternoon, its flag ships OFF and the demo falls back to the row's stated fallback —
`main` stays playable no matter what.**

| Capability | In Tier A | Owner(s) | Hard dependency | Fallback if it slips |
|---|---|---|---|---|
| 12 positions + affinity matrix (real values) | ✅ | engine (values), me (shape) | CONTRACT §1 | diagonal-1/off-0.75 placeholder = today's behavior |
| Formation picker | ✅ **all 8** (cheap data) | draft | FORMATIONS §3 | curate to 3–4 if pitch-layout time-boxed |
| Free-pick onto pitch board | ✅ | draft | affinity shape | — (headline change, must ship) |
| Playing style (def/bal/att) **that moves results** | ✅ | draft (UI), engine (effect) | Tactics §3 | style stored but ±0 effect (cosmetic) |
| One extra lever | ✅ **line height only** | engine | Tactics §3 | drop lever; style-only |
| Year roll (nation, year) | ✅ **if** DB v2 lands | draft, database | squads-by-year | nation-only roll vs current flat squads |
| Data v2 (12 nations 2026 + 3 hero squads) | ✅ | database | schema v2 | coarse→detailed adapter over today's JSON |
| Match engine v2 (closed-form + Dixon–Coles) | ✅ **behind flag** | engine | CONTRACT §4 | v1 Poisson (flag OFF) — demo-safe default |
| `MatchTimeline` emitted (synthesized frames) | ✅ | engine | CONTRACT §4 | sim's adapter fabricates from `MatchResult` |
| On-screen playback of YOUR matches (~45s) | ✅ | sim | timeline | static instant table (today) |
| Momentum meter + ball + ticker + goal flash | ✅ | sim | ticks/events | score-only scoreboard |
| Scoreboard rail (other matches) | ✅ **final scores** (live-tick = Tier B) | sim | `MatchResult.goals` | static final-score strip |
| Box score panel (GK/DEF/MID/ATT + xG) | ✅ | engine (numbers), draft (panel) | `boxScore` §4 | draft's fixed-weight proxy numbers |
| Balance harness + determinism/shape tests | ✅ | qa | engine v2 | run against v1 for a baseline |
| Classic vs Memory mode | ❌ Tier B | draft | — | — |
| Live-ticking rail / marquee / 2×–4× | ❌ Tier B | sim | — | — |
| Zonal Markov chain / pressing/tempo/man-mark | ❌ Tier B | engine | — | — |
| Multiplayer | ❌ Tier B/3 | me | — | — |

**The demo-safe spine (must be green even if everything else falls back):** the
current game runs with all v2 flags OFF. Every "fallback" column collapses to
today's shipped behavior, so the worst case is "Last11 as it is now, plus whatever
v2 rows went green." **Non-negotiables that MUST go green for the demo to be the
*new* game** (if these slip, we ship the current game and say so): 12-position
free-pick draft, style-that-matters, and on-screen playback of your match. Those
three are the story; everything else is upside.

**Enforcement:** I hold a flag matrix in `src/game/flags.ts` and flip each v2 flag ON
only when its row is green (tests + a manual pass). Saturday afternoon I do the compose
check — draft, play a full BR, watch a match — with the intended demo flag set, and cut
any row that isn't solid to its fallback. This table is the checklist.

---

## Reconciliation log

- **v0.1 (2026-07-11):** authored before any `PLAN-*.md` peer landed. CONTRACT.md
  drafted from the six briefs + engine source.
- **v0.2 (2026-07-11):** reconciled PLAN-draft + PLAN-qa into CONTRACT v0.2 (see
  below). Still awaiting PLAN-database, PLAN-engine, PLAN-sim (their `samples/`
  landed but not the plans).
- **v0.3 (2026-07-11):** all six plans in. Resolved the seven cross-plan conflicts
  in CONTRACT v0.3 (affinity transposition + family expansion + strictly-`>0`;
  canonical formation set; timeline field set/ranges + boxScore + nullable team +
  goal `scoreAfter` + `counter`; `MatchResult.goals`; chemistry design flag Q9) and
  published the Tier-A Demo Contract above (R-compose). No shape conflicts remain
  open — only Lucca's calibration answers.

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

**PLAN-engine.md (hackathon-builder) — strong, reconciled with two corrections.**
Zonal-strength front-end + affinity matrix + tactic modifiers (Tier A closed-form
Poisson + Dixon–Coles; Tier B zonal Markov chain), one-generator/two-emitter for
the fast headless path, 16-question decision questionnaire.
- ⚠️ **Affinity table authored TRANSPOSED** (`affinity[slot][natural]`) vs canonical
  `matrix[natural][slot]`; asymmetric ⇒ values change. Resolved in CONTRACT §1 with
  an explicit transcription rule (`matrix[natural][slot] = engineTable[slot][natural]`)
  and flipped worked examples. Engine also authored a 9×9 *family* table — CONTRACT §1
  documents the family→12×12 L/R expansion so the flip is applied once at build time.
- ⚠️ **Formation-set mismatch:** engine listed `4-2-2-2`, dropped `4-2-4`. Canonical is
  the draft/7a0 eight (keeps `4-2-4`). Engine authors its zone-weight map for those.
- ✅ **Chemistry** reframed to a MID/ATT cohesion multiplier — good, EXCEPT the new
  draft makes same-`(nation,year)` pairs near-impossible, so it silently dies. Elevated
  to CONTRACT open Q9 (design decision for Lucca; my rec = same-nation-any-year for
  Tier A). Engine's own Q13 asks "keep chemistry?" — Lucca should answer them together.
- ✅ Determinism guarantees (`resolveMatch` ≡ `simulateMatchTimeline().finalScore`,
  pure `simulateTimeline`) match the MP memo exactly. `boxScore` folded into CONTRACT §4.

**PLAN-database.md (worker-6) — strong, reconciled.** Absolute cross-era 1–99 rubric
(quality-not-athleticism, per-tournament snapshot), 15 named anchors, `(nation,year)`
squads 16–23, verified Brazil-2002 sample, steal-pool-from-full-rolled-squads.
- ✅ Id scheme `${nation}-${year}-${slug}` adopted verbatim into CONTRACT §2.
- 🔧 **Field-name reconciliation:** db's raw type uses `pos`/`altPos` and keeps
  `nation`/`year` on the squad only; engine/draft consume `position`/`secondary` and
  the engine's chemistry needs `nation` ON the player. CONTRACT §2 resolves it the way
  `data.ts` already works: raw JSON stays lean (`pos`/`altPos`, squad-level nation/year),
  the **loader denormalizes** nation/year down and renames fields to the in-memory
  `PlayerV2`. No churn to the sample file.
- ✅ `Squad`→`SquadEntry`, `Manager.rolledSquads`, `squadByRef(nation,year)`,
  `Zone`/`POSITION_ZONE` rollup all folded in. Steal-pool size blow-up flagged (Q7).

**PLAN-sim.md (codex-ui) — strong, already self-reconciled to CONTRACT.** rAF clock +
pure `projectMatch`, SofaScore-style momentum meter, watched-vs-rail split, runnable
HTML wireframe. It proactively adopted CONTRACT §4/§5 naming — thank you.
- ✅ **Timeline field set ratified (conflict 3):** sim wants `pressure`+`ballX`, engine
  emits `momentum`+`ballPos`; CONTRACT §4 `TimelineTick` now carries BOTH `ballPosition`
  (0..1, engine converts from its −1..+1) and `momentum` (−1..+1). Events get nullable
  `team`, required `text`, `scoreAfter` required-on-goal, `'counter'` type.
- ✅ **Rail goal stamps (conflict 4):** `MatchResult.goals:{minute,team}[]`, engine-
  produced in the shared score core (NOT sim's UI-fabrication fallback — that would
  desync from the real timeline and break MP). Sim's Q7/Q8 fallbacks are thereby closed.
- ✅ `MATCH_DURATION_MS`/`VIRTUAL_MINUTES`/`CELEBRATION_MS` promoted into CONTRACT §5 as
  shared MP constants. `animate===false` headless path preserved as a hard contract.

**All six plans now reconciled into CONTRACT v0.3.** No unresolved shape conflicts
remain; the open items are Lucca's calibration/questionnaire answers, not integration
disagreements.
