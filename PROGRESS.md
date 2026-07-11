# Last11 — Build Progress

_Running log for the build agent._

## Current state: V2 REDESIGN LIVE — ALL FLAGS ON ✅ (2026-07-11)

The six-worker redesign (docs/redesign/: DECISIONS.md + CONTRACT.md are the
authority) shipped and is switched on as the default game (4bf64d5):

- **Draft v2** (draft-page): free pick-then-place tactics board, 12 detailed
  positions, 8 formations + styles, re-spin tokens, (nation, year) roll.
- **Data v2** (players): 33+ squads across World Cups 1950–2026 on Lucca's
  anchor scale (Pelé-1970 97 ceiling), verified vs the web; RATINGS-LADDER.md
  pending Lucca's calibration pass.
- **Engine v2** (game-engine): zonal tactics-aware engine, affinity matrix,
  morale (chemistry removed), penalty shootouts (no draws; points 3/2/1/0),
  deterministic minute-timeline producer. Balance verified vs DECISIONS
  targets: 3.48 goals/match (3.4), 15.6% pre-shootout draws (15%), 0.0% final.
- **Sim v2** (match-sim): watched 2D-pitch playback (drifting dots, ticker,
  goal FX, shootout beat, rail) as pure(timeline, elapsed); real engine
  timelines wired (score/timeline agreement invariant held).
- **Integration** (architect + Main): tournament + App threading (per-match
  seeds, morale round-to-round, varied bot tactics), flags flipped ON;
  app.test.tsx pinned as the flags-OFF regression gate.

176+ tests green, `npm run build` green. In flight: between-match re-arrange
board (draft-page + match-sim), all-flags-ON walkthrough test (QA). Chrome
extension unavailable again → DOM walkthroughs + balance harness are the
browser evidence; Lucca playtests via `npm run dev`.

## Tier 1 history: TIER 1 + CORE TIER 2 SHIPPED ✅ (2026-07-10)

All phases of PLAN.md through Tier 2 core juice are done, reviewed, and green.
54 tests passing, production build verified serving.

## Done

- ✅ PLAN.md (a194866) — scope, phases, DoD.
- ✅ Phase 0 (cd0bbf4): Vite 8 + React 19 + TS 7 + Tailwind 4 + Vitest 4 scaffold.
- ✅ Phase 1 (c81b664): engine foundations — mulberry32 RNG, 12 nations × 12
  players, 4-3-3, teamStrength (fit ×0.75 off-pos + chem pairs ×1.5 + star ≥88 +3).
  Subagent review: clean.
- ✅ Phase 2 (cf558b0): spin-draft logic, Poisson match sim, BR tournament
  32→24→16→8→4→2→1 with steals. Subagent review: clean (all 6 risk areas traced).
- ✅ Phase 3 (498a670): reducer state machine + Home/Draft screens.
- ✅ Phase 4 (8125a07): Battle/Steal/End screens — Tier 1 complete. Subagent
  review: 1 real finding (roundsSurvived off-by-one) → fixed in 55621ef.
- ✅ README (8aa6795), Tier 2 juice (e6398d2): wheel chase animation, table
  cascade, trash talk. Home explainer + favicon (2af4903).
- ✅ Verification: 54 vitest tests (engine determinism, e2e tournament, full
  UI walkthrough via jsdom+RTL incl. animated path), `npm run build` green,
  dev server AND production preview both served HTTP 200 with content.
  NOTE: Chrome extension unavailable all session → DOM-level integration tests
  used as the browser evidence.
- ✅ Cleanup: scratch sanity test deleted, background servers stopped.

## Remaining (deliberately not done — cut from the bottom / not mine)

- Tier 2 extras: sound, deeper mobile pass (layout is responsive by
  construction but unverified on a real phone), player-card art.
- Tier 3 multiplayer: out of scope (local-only constraint).
- Lucca's side: play a run, record 2–5 min demo video, Devpost write-up,
  push repo public. Video/write-up should be locked SATURDAY NIGHT
  (deadline Sun Jul 12, 9:00am PST).

## Balance findings (headless sanity, 2026-07-10)

- Bots 940–1027 (med 990); naive human ~966 → dies mid-game; chem-aware human
  competitive. Good curve, untouched.
- 2.69 goals/match, max 7, ~6% scoreless. 19/20 winners from strength top-8.
- Troll draft (all GKs) = 719, finishes #32 — fun demo beat.

## Key decisions

- Spin lands a nation → pick any un-owned player into current slot; off-pos
  allowed at 0.75×; duplicates across teams OK (genre norm), never within.
- Steal window after each cut: human via UI, bots auto best-positive-swap,
  pool = just-eliminated XIs.
- Human dead → "SEE HOW IT ENDS" fast-forwards headlessly on the same rng.
- RNG in a ref, consumed only in event handlers (StrictMode-safe); reducer pure.
- `animate={false}` App prop keeps DOM tests synchronous.
