# Plan: QA, balance harness & test strategy (owner: test-hardening)

## Findings

**Current engine (`src/engine/`)**: 4 coarse positions (GK/DF/MF/FW), fixed
4-3-3 `FORMATION`, flat `OFF_POSITION_MULT = 0.75`, `CHEM_PAIR_BONUS = 1.5`
same-nation pairs, `STAR_BONUS = 3` at rating ≥ 88, Poisson match sim on a
linear strength-diff → xG map (`BASE_XG 1.35`, `STRENGTH_TO_XG 0.012`, clamped
0.15–4.5). 32-manager single-elimination-by-cut BR: 32→24→16→8→4→2→1, 3 matches
per manager per round, bottom cut, post-round steal from just-eliminated XIs
only. Everything is a pure function of a mulberry32 `Rng` seeded once per
tournament/draft — this discipline is the single biggest asset the redesign
must not break.

**Current tests**: 54 across `rng.test.ts` (50 lines, generic RNG contract),
`data.test.ts` (37, hard-codes 12 nations × 12 players × 4-position quota),
`rating.test.ts` (100, off-position multiplier + chemistry + star math),
`draft.test.ts` (66, slot-by-slot spin+autopick), `match.test.ts` (51, Poisson
mean/determinism/strength-bias/no-side-bias), `tournament.test.ts` (182, the
big one — lobby shape, round mechanics, steal correctness, full-tournament
determinism/shape/"strength wins more than it loses"), plus
`src/game/state.test.ts` (120) and `src/app.test.tsx` (131, jsdom+RTL,
`animate={false}` keeps it synchronous). This is a strong pattern library to
extend, not replace.

**Existing balance baseline** (PROGRESS.md, headless sanity 2026-07-10): bot
strength 940–1027 (median 990), naive human ~966 (competitive-but-losing),
2.69 goals/match, ~6% scoreless, 19/20 tournament winners from the top-8 by
strength, troll all-GK draft (719) finishes dead last. This is the regression
baseline every v2 balance change must be diffed against.

**Real-football reference** (web research, 2026-07-11):
- Top-5 European leagues 2024–25: goals/match 2.56 (Serie A) – 3.14
  (Bundesliga), league-wide ~2.8–2.9; draws 22% (Ligue 1) – 29% (Serie A).
  [FIFA: Europe's big five leagues in stats](https://www.fifa.com/en/articles/europe-big-five-leagues-2024-2025-stats),
  [Sportytrader stats roundup](https://www.sportytrader.com/us/news/stats-across-top-european-leagues-and-mls-2024-2025/)
- World Cup 2002–2018: 2.48 goals/match average, range 2.27–2.67 by
  tournament. Group-stage matches run hotter than knockout (2.69 vs 2.31
  across the last 5 tournaments); 2026 group stage hit 2.99, highest since
  1958. Group draw rate ~22%, knockout (to 90') ~27%, 2026 group stage spiked
  to 37.5% (unusually high — treat as an outlier, not a target).
  [footballhistory.org World Cup statistics](https://www.footballhistory.org/world-cup/statistics.html),
  [Northeastern: World Cup 2026 group stage scoring](https://news.northeastern.edu/2026/06/28/world-cup-group-stage-standings/)
- Upsets: no single clean "underdog win %" stat, but 2026's group stage
  produced several strength-mismatch draws/wins (Cape Verde 0-0 Spain, DR
  Congo draw Portugal, Curaçao score on Germany) — corroborates using a
  strength-gap-bucketed upset rate rather than chasing one external number.

This lines up with the qa-balance.md brief's own cited range (2.6–2.9 goals,
~24% draws) — I'm treating **2.6–2.9 goals/match, 22–29% draw rate** as the
target band, sourced above, not just asserted.

## Job 1 — Balance harness design

**Metrics** (computed per batch of N headless tournaments/matches, using
`runTournament(seed)` for seeds `0..N-1` — deterministic and reproducible):

1. **Goals/match distribution** — mean, median, p95, max, % scoreless (both
   sides 0), % 5+ combined goals. Source: every `MatchResult` across every
   round of every tournament.
2. **Draw rate** — % of matches with `homeGoals === awayGoals`.
3. **Clean-sheet rate** — % of team-match instances where that team conceded
   0 (report separately from scoreless, since a 3-0 has one clean sheet, not
   zero goals).
4. **Upset rate** — bucket matches by `|strengthA - strengthB|` (e.g. 0-10,
   10-25, 25+) and report win rate for the lower-strength side per bucket.
   Flat/monotonic-decreasing-with-gap is healthy; a bucket where the weaker
   side wins ≥45% signals strength isn't mattering enough, and <5% at a small
   gap signals it's mattering too much (no room for tactics to swing it —
   directly tests the "tactics must matter" directive).
5. **Tactic-vs-tactic win matrix** (Tier B, needs match-engine's tactic
   levers) — an N×N grid (N = formation count × style count) of head-to-head
   win rate when strength is held equal (synthetic equal-strength XIs, only
   tactics differ), to catch a dominant strategy. Flag any cell >65% or <35%
   against the row-normalized average.
6. **Style matrix** (Tier B) — same idea, 3×3 (defensive/balanced/attacking),
   both win-rate and goals-for/against (attacking should raise variance both
   ways, not just win more).
7. **Human-strategy curves** — run N tournaments with one seat forced to a
   fixed drafting policy (naive-highest-rating, chem-aware, troll/all-one-
   position) against 31 bots, report finishing-position distribution
   (median, top-8 rate, last-place rate) per policy. Extends the existing
   single-run PROGRESS.md finding into a distribution.

**Reference targets & bands**:

| Metric | Real-football reference | Target band | Tier-1 baseline |
|---|---|---|---|
| Goals/match | 2.5–3.1 (leagues), 2.3–3.0 (WC) | 2.6–2.9 | 2.69 ✓ |
| Draw rate | 22–29% | 20–28% | not yet measured — **gap, see below** |
| Scoreless rate | not directly cited; leagues run ~8-10% for 0-0 specifically | 5–10% | ~6% ✓ |
| Upset rate (small gap, <10 strength) | — (no clean external stat) | 30–45% (tactics should be able to flip a close game) | not yet measured |
| Upset rate (large gap, 25+) | — | <15% | not yet measured (19/20 winners from top-8 is the current proxy) |
| Strength → win-rate slope | monotonic, football is upset-prone not chaotic | no single strength axis should make win rate >90% at any realistic gap | not yet measured |

Draw rate and upset-by-bucket are **not in the current PROGRESS.md notes** —
that's a real gap Tier A should close even before the engine rewrite lands,
so we have a pre-redesign baseline to diff v2 against, not just goals/match
and scoreless%.

**How it runs**: reuse Vitest, add zero new dependencies (matches the
project's "no new deps without a strong case" discipline — a full
report-and-print tool doesn't need a bespoke script runner). Concretely:

- `src/engine/balance.report.ts` — pure aggregation functions (one per
  metric above), unit-testable themselves, no I/O.
- `src/engine/balance.report.test.ts` — a `describe.skipIf(!process.env.BALANCE)`
  block that runs N=200 tournaments (fast: the existing suite already runs
  10-seed tournaments without complaint) and `console.table`s each metric
  against its band, plus a final PASS/FAIL summary line per band. Skipped by
  default so `npm test` stays fast and green; invoked via
  `BALANCE=1 npm run test -- balance.report`.
- Add `"balance": "cross-env BALANCE=1 vitest run balance.report"` to
  `package.json` scripts — actually, avoid the `cross-env` new-dep by using
  `BALANCE=1 vitest run balance.report` directly (works on the project's
  actual dev machine; if Windows support ever matters, revisit). **Open
  decision for Lucca below.**
- Bands live as named constants next to the metric functions so `git blame`
  shows every tuning decision against the number it changed.
- Output format: a markdown table dumped to stdout (human-readable in a
  terminal, pasteable into a PR description or a message to Lucca) — no new
  reporting dependency.

This is deliberately NOT a hard CI gate. Balance is a judgment call for
Lucca, and RNG-sampled bands are inherently noisy at small N — hard-failing
`npm test` on e.g. draw-rate drift would produce flaky red builds the night
before a deadline. Determinism and shape invariants (Job 2) stay hard
`expect()` assertions in the normal suite; statistical bands stay a
soft, human-read report.

## Job 2 — Test strategy for the redesign

**Survives largely as-is**: `rng.test.ts` (RNG contract is orthogonal to
everything else). `match.test.ts`'s determinism/no-side-bias/strength-bias
*shape* of tests survives even if the xG formula changes (Tier B zonal model)
— same assertions, new function signature.

**Needs rewriting, not just extending**:
- `data.test.ts`: hard-coded `12 nations × 12 players`, 4-position quota
  (`GK:2, DF:4, MF:3, FW:3`) all break under player-database v2 (more
  nation-years, 12 detailed positions, variable squad sizes 14-18). Rewrite
  as: every squad has ≥1 GK, ratings in rubric-defined bounds, position enum
  is exactly the 12-value set, ids unique **across (nation, year)** not just
  globally-incidentally-unique as today.
- `rating.test.ts`: the flat `OFF_POSITION_MULT = 0.75` tests are specific to
  a mechanic the redesign is explicitly replacing with a position-affinity
  matrix. Every test built on `effectiveRating`/`OFF_POSITION_MULT` needs a
  same-shape replacement against the affinity matrix (see invariants below).
  Chemistry/star tests survive if those mechanics are kept (brief says
  "unless you argue for replacing them" — assume kept until CONTRACT.md says
  otherwise).
- `draft.test.ts`: built entirely around slot-by-slot forced spin→autopick.
  The whole file is redesign-shaped by the "free pick after a spin" UX
  change; expect a near-total rewrite once PLAN-draft.md's flow lands, not
  an incremental patch.
- `tournament.test.ts`: `stealPool` currently dedupes fielded-XI players only
  (`m.xi`); v2 steals from full rolled squads (per player-database brief),
  so `stealPool`'s input type changes and its test needs a squad fixture, not
  an XI fixture. `Manager` gains a `tactics` field — every fixture builder in
  this file (`makeXi`, `makePlayer`) needs updating, and `runTournament`'s
  "steals preserve shape" test needs a version for every new formation length
  (currently assumes 11, formations like 4-4-2/3-5-2 also have 11 total but a
  different position multiset — assert the *multiset* not a fixed array).
- `src/app.test.tsx` / `state.test.ts`: new reducer phases (tactics board,
  match playback) mean new state-machine tests; the `animate={false}`
  synchronous-path contract must be preserved and re-verified for whatever
  new animated screens land (wheel-chase-style tests already exist as the
  pattern to copy).

**New invariants worth locking** (in priority order — these are the ones
that would let a redesign regression ship silently):

1. **Same seed ⇒ identical timeline.** Direct extension of the existing
   `runTournament` determinism test (`JSON.stringify` equality) to
   `MatchTimeline`. This is the single highest-value new test: it's the
   entire multiplayer-readiness bet (architecture brief Job 2) — if replay
   isn't bit-identical, the "thin server, clients replay locally" design
   doesn't work.
2. **Timeline goals sum == final score.** Cheap, catches the most likely
   integration bug between "engine emits discrete goal events" and "engine
   also returns an aggregate score" if those ever get computed by two
   different code paths instead of one deriving from the other.
3. **Every formation drafts to a legal XI for bots.** Parametrize the
   existing `draftBotXi` shape test over all 8 formations (currently only
   4-3-3 exists). "Legal" = position multiset matches the formation's
   ordered list, no duplicate players — same assertion shape as today's
   `draft.test.ts`, looped.
4. **Affinity matrix symmetry/bounds.** Bounds: every cell in [0, 1], diagonal
   (position → itself) == 1.0. Symmetry is an **open question, not an
   assumption** — a CM's affinity for CDM need not equal CDM's affinity for
   CM in real tactical terms (a CM pushed back to CDM loses less than a CDM
   pushed forward to CM). Test bounds unconditionally; only test symmetry if
   CONTRACT.md declares the matrix symmetric.
5. **Data validation over the JSON itself**, as a test (not just at build
   time): ids unique within (nation, year), position values are a strict
   subset of the 12-position enum, ratings within rubric bounds, every squad
   has enough players per position to fill at least the most common
   formations (e.g. ≥1 GK is necessary but not sufficient — flag as an open
   decision whether "every squad must field every formation" is a hard
   requirement or a draft-time UX concern instead).

**Determinism traps to guard** (grep-able, worth a lint/review checklist
line, not necessarily individual tests):
- `Date.now()` / `new Date()` anywhere in engine or reducer code — the
  match-sim brief's "fixed real-time duration, pure function of (timeline,
  elapsedTime)" requirement means wall-clock reads belong ONLY in the
  playback component's `elapsedTime` prop plumbing, never inside anything
  that computes game state.
- `Math.random()` anywhere outside `rng.ts` — today's codebase has zero
  instances outside the RNG module itself; that invariant is worth a
  standing grep-based check (`rg "Math\.random" src/` should only match
  `rng.ts`) as new workstreams land code.
- **Map/Set iteration order**: today's code leans on JS's guaranteed
  insertion-order iteration for `Map` (`nationCounts`, `strengths`, `stats`
  in `tournament.ts`) — safe today, but the zonal/possession engine (Tier B)
  will likely aggregate over more complex intermediate structures; any new
  `Map`/`Set`/object built from a non-deterministically-ordered source (e.g.
  iterating a JSON array is fine; iterating results of an unstable `.sort()`
  comparator is not) needs the same explicit tie-break pattern
  `compareRows` already uses (points → gd → gf → strength → id).
- **Floating-point summation order** in the possession/zonal model if Tier B
  goes that route (match-engine option b): summing per-minute zone
  probabilities in a different order can produce different floats on
  different runs only if summation order itself is non-deterministic (it
  isn't, in a single-threaded `for` loop) — low risk, but worth one explicit
  determinism test on the zonal model specifically once it exists, since
  it's new and unproven, unlike the well-tested Poisson path.
- **`requestAnimationFrame`-driven playback** (match-sim) — must preserve the
  existing `animate={false}` escape hatch pattern so tests and any future
  server-driven headless path stay synchronous.

## Review of the other five plans

**Update (2026-07-11, second pass): all five plans + CONTRACT.md have now
landed.** PLAN-draft.md's review stands from the first pass (below). This
pass adds PLAN-engine.md, PLAN-database.md, PLAN-sim.md,
PLAN-architecture.md, and CONTRACT.md. Leading with the single most
time-sensitive finding, then per-plan reviews, then a synthesis.

### 🔴 CONTRACT.md is stale relative to what's actually landed — top priority

`CONTRACT.md`'s own header still reads **"v0.2 ... awaiting PLAN-database,
PLAN-engine, PLAN-sim"** — but all three exist in `docs/redesign/` now (I
just read them for this review). Nothing in the repo is lying, exactly —
worker-7 just hasn't had a pass since they landed — but it means every
consumer reading `CONTRACT.md` today is reading a **known-incomplete**
snapshot, and at least two concrete conflicts below (formation catalog,
`boxScore` shape) exist *because* that reconciliation pass hasn't happened
yet. With ~24h to deadline, this is the highest-leverage single action
left in Phase R: **worker-7 publishing CONTRACT v0.3 unblocks every other
stream's implementation start.** Flagging this first because it's blocking,
not just imprecise.

### Review: PLAN-engine.md (hackathon-builder)

Excellent research (Dixon-Coles for the low-score draw problem is a genuinely
good find, not just a citation), and the "(a) now, (b) later, same
zonal-strength front-end" architecture decision is the right call — it means
Tier A isn't throwaway. Two concrete, verifiable issues and one reconciliation
gap:

1. **CONFIRMED: the 8-formation set disagrees with CONTRACT's frozen catalog.**
   `CONTRACT.md §3` (`FORMATIONS`, reconciled from PLAN-draft) lists **4-2-4**
   as the eighth formation. `PLAN-engine.md §3.3`'s tactics-lever table
   independently lists the eighth formation as **4-2-2-2**. These are
   different formations (4-2-4 has two out-and-out strikers and no second
   midfield pivot; 4-2-2-2 has two banks of two). This is exactly the kind of
   silent cross-plan disagreement CONTRACT.md exists to prevent, caught before
   either stream writes code against it. Someone (worker-7, reconciling v0.3)
   needs to pick one; I'd default to CONTRACT's 4-2-4 since it's already
   frozen and draft's UI plan is built against it, but flagging for Lucca/
   worker-7 to actually decide, not silently resolving it myself.
2. **`boxScore` is embedded in PLAN-engine's `MatchTimeline` but not in
   CONTRACT's.** `PLAN-engine.md §4` emits `boxScore: { home: ZoneBox; away:
   ZoneBox; xg: {...} }` as a field of `MatchTimeline`; `CONTRACT.md §4`'s
   `MatchTimeline` has no such field. Draft's tactics-board box-score panel
   (`PLAN-draft.md §2b`) needs this data from *somewhere* — CONTRACT v0.3
   needs to decide whether it's a `MatchTimeline` field (engine's proposal) or
   a separately-computed value derived from `ZoneStrength` at draft/pre-match
   time (cleaner separation — box score is really a property of the two XIs +
   tactics, not of a specific simulated match, so it shouldn't need a full
   timeline to exist). I'd lean toward the latter since it'd let the
   tactics-board panel render *before* a match is simulated at all, which is
   what draft's UI actually needs (pre-match, not post-match).
3. **Draw-rate research disagrees with my own PLAN-qa findings from the same
   underlying source.** `PLAN-engine.md §1a`'s table cites WC group-stage draw
   rate as **"~16–20% (2018 = 16%)"** from footballhistory.org. My own Job-1
   research (this document, above) cites the same footballhistory.org
   coverage as **"~22%"** for group matches. Same source, two different reads
   — worth a citation double-check before either number becomes a hard
   tuning target, though in practice it's low-stakes: engine's own §1a
   "read-through" recommends a **~22–25% draw-rate target** anyway, which
   sits inside my proposed 20–28% band regardless of which raw citation is
   more precise. Not blocking; flagging so nobody cites the 16-20% figure
   as authoritative later.
4. **My own upset-rate band doesn't yet reconcile with engine's Q1 default,
   and that's partly my error, not just theirs.** I proposed (Job 1, above)
   30–45% weaker-side win rate for strength gaps <10. Engine's Decision Q1
   recommends a 10-point zonal-strength gap ⇒ ~60/22/18 (win/draw/loss for
   the *stronger* side) — i.e. the weaker side winning **~18%**, not 30–45%.
   Before treating this as a contradiction to resolve, I need to flag the
   more basic problem: **my band was written against the current v1
   `teamStrength` scale (totals ~850–1030), and engine's Q1 is written
   against the not-yet-implemented v2 zonal-edge scale — "10 points" may not
   mean the same magnitude on both.** I'm marking my own upset-band numbers
   as **v1-scale placeholders that need to be redefined once engine v2's
   zonal scale is real**, not asserting engine's Q1 is wrong. Once Lucca
   answers Q1/Q2, my Job 1 upset-bucket boundaries should be rewritten in the
   same units, and I'll reconcile then rather than guess now.

### Review: PLAN-database.md (worker-6)

The ratings rubric is the strongest piece of research across all five plans —
the anchor ladder with 15 named cross-era players and the explicit "absolute
scale, quality not athleticism" reasoning directly answers Lucca's original
complaint with a real methodology, not just a vibe. One real product-quality
risk for the demo specifically:

1. **The year-roll mechanic will feel broken for 11 of 12 nations in Tier A.**
   §8's Tier A ships the current 12 nations at 2026 **plus 3 historical hero
   squads, all under Brazil (1970, 2002) and Argentina (1986)**. That means a
   spin landing on Brazil or Argentina can roll a real year choice, but a spin
   landing on France, England, Spain, Germany, Portugal, Netherlands, Belgium,
   Croatia, Morocco, or Japan (10 of 12 nations) only ever has **one** year
   available — 2026. The "year roll" is the headline new mechanic in the
   draft brief (§1.1's "e.g. Brazil 2002"), and as currently scoped it's a
   near-guaranteed single outcome for 83% of nations. This isn't wrong
   exactly — database's plan is honest that its Tier A target is deliberately
   thin (§4: "far below 7a0's scale, deliberate") — but I don't think the
   demo-visibility implication has been named out loud anywhere: **a judge
   who spins France twice sees no year variety at all.** Worth surfacing to
   Lucca directly: either broaden Tier A's historical coverage beyond
   Brazil/Argentina (even 1 extra hero squad on a 3rd nation meaningfully
   changes the "does this feel alive" perception), or explicitly frame the
   demo narration around spinning toward Brazil/Argentina so the year-roll
   payoff actually gets shown.
2. **Steal-pool size/perf mitigation (§6) is proposed but not owned by a
   test.** Database's own plan flags the risk (late-round pool could be
   thousands of entries) and proposes 3 mitigations (round-scoped not
   cumulative, deduped, ranked) but doesn't claim a test for it, and neither
   does architecture's plan. I'm noting this as a gap in my own Job 2 test
   list rather than just a complaint: once steal-pool v2 lands, I'll add a
   test asserting pool size stays bounded by (this round's eliminated
   managers × their rolled-squad count), not by total tournament history.
3. Rating-rescale calibration dependency is already correctly flagged by
   engine's own plan (§7: "if the rating scale changes, re-run the balance
   sweep") and by database's own dependencies section — no gap there, just
   confirming the two plans agree on sequencing (data v2 ratings must land
   before engine v2's constants are tuned against real numbers, which
   matches architecture's step 2-before-3 integration order).

### Review: PLAN-sim.md (codex-ui)

The best-reconciled of the five — it explicitly diffed its own schema against
CONTRACT.md and adopted CONTRACT's naming (`ticks`/`TimelineTick`/
`ballPosition` over its own `frames`/`MomentumTick`/`ballX`), which is exactly
the discipline the other plans should follow once CONTRACT v0.3 lands. Two
small, concrete notes:

1. **The reconciliation silently drops a `TimelineEventType` value.** Sim's
   original (§2, pre-reconciliation) event-type union included `'counter'`
   (for counter-attack captions — its own screen-flow wireframe in §4
   references counter-attack moments). CONTRACT's canonical union (`§4`,
   which sim says it's adopting) does **not** have `'counter'`, and neither
   does PLAN-engine's independently-written union. Mechanically this is
   fine — a counter-attack is presumably just a `'chance'` or `'shot'` event
   with `text: "Counter-attack — saved!"` — but the drop is implicit, not
   stated. One line confirming "counter-attacks are a caption style, not a
   distinct event type" would remove the ambiguity for whoever implements
   the ticker.
2. **Possible duplicate fallback-adapter work.** Both engine (§4.3, "Tier A
   timeline synthesis... deterministically distribute Poisson goals across
   minutes") and sim (§8 Q8, "OK for me to ship against a UI-side adapter
   that fabricates a timeline from MatchScore if engine v2 slips?") propose
   building essentially the same fallback: a synthetic `MatchTimeline` from a
   final score. If both streams build this independently, that's real hours
   spent twice on the same hackathon night for a fallback that, by design,
   only one of them should ever need to ship. Recommend architecture's v0.3
   pass names ONE owner for "synthesize timeline from score" (I'd say
   engine, since `MatchTimeline` production is engine's contract
   responsibility regardless of tier) so sim's Q8 becomes "consume whatever
   engine ships, always," with no separate UI-side implementation.
3. Confirms rather than conflicts with my own Job 2 determinism-trap note:
   sim's memo (§6) independently names `performance.now()`-at-mount as "the
   only local, stateful, non-deterministic input," matching exactly the
   `Date.now()`-boundary rule I wrote in Job 2 before reading this plan —
   good independent convergence, no action needed.

### Review: PLAN-architecture.md + CONTRACT.md (worker-7)

Beyond the staleness flagged above, the plan does real integration work, not
just paperwork — the peer-plan review section inside PLAN-architecture.md
already caught the affinity arg-order flip between draft and CONTRACT (a real
bug caught pre-code, correctly resolved) and already named the exact
composition risk I raised in my own first-pass review ("R-compose": do the
five Tier-A cuts actually add up to one working demo), committing to publish
a "Tier-A demo contract" in v0.3. That commitment is good; it just hasn't
landed yet (see the top-priority item above) — the demo-composition risk
that both my first pass and architecture's own plan flagged is **still
open**, not resolved by having been named.

One thing worth restating precisely against CONTRACT specifically, not just
against draft: **CONTRACT's own `Affinity` type (`§1`) permits exactly 0**
(`type Affinity = number; // 0..1 inclusive`), and nothing in CONTRACT states
a cell may never be exactly 0. PLAN-draft's entire "never dead-ends" product
guarantee (flagged in my first-pass review) depends on that never happening.
Since CONTRACT is the frozen shape everyone builds against, this is the
right place to fix it: either CONTRACT v0.3 adds "no cell is exactly 0" as a
named invariant (my preference — cheap, and turns "never dead-ends" from an
assumption into a checkable contract), or draft's flow needs an explicit
fallback for the case CONTRACT currently allows.

### Synthesis: do the five Tier-A cuts actually compose?

This was the single question I said (first pass) mattered more than any
individual plan's quality, and re-reading all five together, the honest
answer right now is **probably, but with real seams still open**:

- Formation catalog mismatch (engine vs CONTRACT) means the draft's
  formation picker and the engine's tactics table are not yet guaranteed to
  agree on what "the 8 formations" even are.
- Box-score panel (draft's UI) has no confirmed data source yet (engine
  embeds it in `MatchTimeline`; CONTRACT doesn't have the field).
- Year-roll (draft's headline new mechanic) will visibly under-deliver for
  10 of 12 nations under database's current Tier A scope — not a shape bug,
  a felt-experience gap a judge will notice.
- Two streams (engine, sim) may independently build the same score→timeline
  fallback adapter — wasted hours, not a correctness bug, but a real cost
  with ~24h left.

None of these are fatal, and every one of them is fixable in under an hour
of coordination — but they're exactly the kind of thing that's invisible
reading any single plan in isolation and only shows up cross-referencing
all five, which is what Job 3 is for. Recommend Lucca or worker-7 treat
CONTRACT v0.3 (already promised) as the forcing function that resolves all
four before implementation starts, not as a nice-to-have.

### Review: PLAN-draft.md (bug-hunt)

Strong plan — the 7a0 research is specific and sourced, the pick-then-place
flow handles all three placement cases cleanly, and it already
self-identifies its highest-risk assumption (sparse XI) rather than burying
it. Three real issues, not just polish notes:

1. **The "never dead-ends" guarantee is unverified, not just untested.**
   §2c states off-position affinity placement means "the draft can never
   dead-end" — but that's only true if `affinity(slot, natural) > 0` for
   *every* (slot, position) pair. §6's own type signature
   (`Affinity: (slot, natural) => number` in `[0,1]`) allows 0 as a valid
   value, and nothing in this plan or the engine brief commits to a strict
   lower bound. If the engine plan ships any affinity value of exactly 0
   (plausible — "GK's affinity for ST" is a natural candidate for 0, not
   ε), the product guarantee this plan is built on breaks silently on
   whatever squad roll produces that exact mismatch with no other options.
   **This needs to become an explicit CONTRACT.md invariant** ("all
   affinity values are in (0, 1], never exactly 0") or the draft flow needs
   a real fallback for the dead-end case it currently assumes away. I'm
   adding "affinity values are strictly positive" as a candidate hard test
   once the matrix lands (tightening my own bounds-only invariant above),
   but the *product* decision belongs to Lucca/engine, not QA.
2. **`RESPIN_FLOOR` is named but not owned.** §2d "handed to the
   balance/QA workstream" is the only place it's mentioned — no proposed
   default, no calibration method. It directly determines how often bots
   burn their 3 tokens, which changes bot XI quality distribution, which is
   exactly what my Job 1 human-strategy-curve metric measures — but that
   metric can't be built against a constant that doesn't have a value yet.
   Recommend PLAN-draft.md or PLAN-engine.md propose a starting number (even
   a guess) so it's a tuning target, not a blank.
3. **Q7 (do bots get a formation/style) changes the shape of the balance
   problem, not just difficulty.** If bots stay fixed 4-3-3/Balanced, my Job
   1 tactic-vs-tactic matrix only needs to cover the *human's* choice against
   one fixed opponent profile — cheap. If bots vary, it's a real 8×3 vs 8×3
   matchup space — expensive, and Tier-B-only by my Job 1 split regardless.
   This makes Q7 higher-priority to resolve early than its position in a
   10-question list suggests — it gates whether the balance harness's Tier A
   scope is even achievable this weekend. Recommend Lucca answer Q7 before
   match-engine finalizes its Tier A cut.

Minor: the bot re-spin loop (§2d pseudocode) is bounded and terminates
(finite `respins` countdown, falls through to "place best" at 0) — no
infinite-loop risk, confirmed by inspection, worth one explicit test
("bot draft always resolves within 11 × 4 spins") once implemented, cheap
insurance for a mechanic this brief got right on paper.

No contradictions with my own Job 2 test-migration notes — PLAN-draft.md
independently flagged the same dense→sparse XI break I did, which is a good
sign the two plans agree on where the real risk is.

**Cross-brief risks visible from the briefs alone** (the other four —
will re-verify once those plans land):

- **Sequencing risk between draft, database, and engine.** Draft-redesign
  depends on player-database's (nation, year) squads; match-engine depends on
  architecture's CONTRACT.md for shared `Position`/`Tactics`/`MatchTimeline`
  shapes; match-sim depends on match-engine's timeline schema; architecture's
  CONTRACT.md is explicitly told to land "LAST-ish" after watching the
  others. That's a real dependency chain for a ~24h clock — if CONTRACT.md
  lands late and disagrees with an assumption two other workers already
  wrote code against (in Phase R terms, planned against), the integration
  Tier A becomes a scramble. Recommend architecture worker publish an early
  DRAFT of CONTRACT.md's type shapes (even before its own findings/memo
  sections are done) as soon as 2-3 sibling plans land, not after all 4.
- **Affinity matrix ownership split (draft-redesign vs architecture vs
  match-engine) is a three-way seam.** Architecture owns the *shape*, engine
  owns the *values*, draft owns *consuming it for pick-value UI*. Three
  briefs touching one matrix invites exactly the kind of silent shape
  disagreement CONTRACT.md exists to prevent — worth a named open question
  in PLAN-architecture.md: "is affinity symmetric?" (I flag this above too,
  since it directly affects whether I write one test or two).
- **Steal-pool v2 data-shape change (fielded XI → full rolled squad) touches
  tournament.ts, player-database's schema, AND UI** (steal screen currently
  shows fielded XIs). None of the three briefs that touch it
  (player-database, architecture Job 1, and implicitly match-engine/sim for
  UI) explicitly say who resolves "does a stolen player replace a fielded
  starter or expand a bench" — flag as a genuine open decision for Lucca,
  not just an implementation detail, since it changes `Manager`'s shape.
- **Tier A vs Tier B discipline across 5 independently-planning workers is a
  scope risk in itself.** Every brief was told to split Tier A/B, but
  nothing forces the Tier A cuts to be *mutually consistent* — e.g. if
  match-engine's Tier A ships 3 formations but draft-redesign's Tier A ships
  the full 8-formation picker, the demo shows a picker that mostly doesn't
  work. This is architecture's Job 3 (sequencing) to catch, but I'll treat
  "do all 5 Tier-A cuts actually compose into one playable demo" as the
  single most important thing to adversarially check once the plans land —
  more important than any individual plan's internal quality.
- **Match-engine's Tier B option (c), full event/agent sim, is a genuine
  scope-blower if under-scoped.** The brief itself flags "likely overkill,
  say why or why not" — I'd push back hard on any plan that leaves the door
  open to attempting it for Tier A.

I'll append per-plan findings here once PLAN-draft/database/engine/sim/
architecture.md actually land, per the brief.

## Tier A vs Tier B split

**Tier A (shippable by Saturday night)**:
- `balance.report.ts` + the `describe.skipIf(!BALANCE)` report test,
  covering goals/match, draw rate, scoreless rate, clean-sheet rate, and
  strength-bucketed upset rate against the **current Tier-1 engine** — gives
  every other workstream a pre-redesign baseline to diff against tonight,
  independent of whether engine v2 lands in time.
- Rewrite `data.test.ts`'s quota/uniqueness assertions to be schema-driven
  (read expected position enum + bounds from a constants module) rather than
  hard-coded, so player-database v2's JSON drops in without a manual test
  rewrite.
- The 3 hard invariant tests (timeline determinism, timeline-sum-equals-
  score, legal-XI-per-formation) as soon as match-engine v2's Tier A lands —
  these are cheap and catch the highest-value regressions.
- Keep `rng.test.ts` untouched; it's foundational and correct as-is.

**Tier B (post-hackathon)**:
- Full tactic-vs-tactic and style win-matrices (needs many equal-strength
  synthetic tournaments — the expensive, statistically-heavy part).
- Human-strategy-curve harness (naive/chem-aware/troll policies run to
  distribution, not single-sample).
- Affinity-matrix symmetry test (pending the open question above) and any
  Tier-B zonal-model-specific determinism test.
- CI wiring (no GitHub Actions exist today) — decide whether the balance
  report becomes a scheduled/nightly non-blocking job.

## Open decisions for Lucca

1. **Hard-fail vs soft-report for balance bands.** I'm proposing soft
   (printed report, human judgment call) because RNG-sampled bands are noisy
   at small N and a red build the night before deadline is worse than a
   missed regression. Agree, or do you want at least determinism +
   shape invariants gating `npm test` (they already do) plus a *coarse* hard
   band (e.g. "goals/match must be 1.5–4.5, not exactly 2.6–2.9") as a real
   assertion?
2. **Sample size for the Tier A balance script.** Proposing N=200 headless
   tournaments (fast — the existing suite already runs 10-tournament loops
   without complaint). Fine for a pre-demo sanity check, or do you want it
   bigger/smaller?
3. **Upset definition.** Proposing strength-gap buckets (0-10 / 10-25 / 25+)
   over the natural distribution of matchups each round produces, rather
   than a scripted fixed-mismatch scenario. Buckets are noisier (fewer
   samples per bucket) but reflect what actually happens in play; a scripted
   scenario is cleaner signal but further from reality. Preference?
4. **Steal-pool v2 mechanics** (see review above): stolen player replaces a
   fielded starter directly, or expands a bench that the UI must then let
   you manage? This changes `Manager`'s shape and is currently unresolved
   across 3 briefs.
5. **Affinity matrix symmetry**: yes (simpler, half the values to tune and
   test) or no (more realistic, matches how a "CM pushed to CDM" vs "CDM
   pushed to CM" should plausibly differ)?
6. **CI**: is wiring up GitHub Actions in scope this weekend, or explicitly
   Tier B? No workflow exists today; if Tier A needs `npm test`/`npm run
   build`/lint to run somewhere other than a local machine before the demo,
   say so now.

## Dependencies on other workstreams

- **match-engine**: owns the timeline schema (Job 2 invariants #1-2 are
  written against it existing), the tactic/style levers (Job 1 metrics #5-6
  need them), and the affinity matrix *values* (bounds tests are written
  against whatever CONTRACT.md/match-engine settle on).
- **player-database**: owns the schema Job 2's rewritten `data.test.ts`
  validates, the ratings rubric bounds, and the (nation, year) id scheme.
- **draft-redesign**: owns the 8-formation set Job 2 invariant #3 loops
  over, and the free-pick UX that forces `draft.test.ts`'s rewrite.
- **architecture/CONTRACT.md**: owns the affinity-matrix *shape*, `Manager`
  tactics field, and steal-pool v2 shape — several Job 2 tests are blocked
  on this landing before they can be written for real (not just planned).
- **match-sim**: owns the `animate={false}`-equivalent synchronous contract
  for whatever new playback component exists; Job 2's UI-layer test notes
  assume that pattern is preserved.
