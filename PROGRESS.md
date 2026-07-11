# Last11 — Build Progress

_Running log for the build agent. Update before context runs low._

## Current state

- **Tier:** 1 COMPLETE ✅ → moving to Tier 2 (juice) + README
- **Phase:** 4 done (full BR loop playable end-to-end)

## Done

- ✅ Brief loaded from Mindboard. Last11 / 11a0.com, Sport track, deadline Sun 9am PST.
- ✅ PLAN.md committed (a194866).
- ✅ Phase 0 (cd0bbf4): Vite 8 + React 19 + TS 7 + Tailwind 4 + Vitest 4 scaffold. Verified.
- ✅ Phase 1 (c81b664): engine foundations — mulberry32 RNG, 12 nations × 12 players
  JSON, 4-3-3 FORMATION, teamStrength (base + chem pairs ×1.5 + star ≥88 +3,
  off-pos ×0.75). Review subagent: clean.
- ✅ Phase 2 (cf558b0): draft logic (spin→nation→pick, value-max bots), Poisson match
  sim (xG 1.35 ± 0.012·diff, clamp [0.15,4.5]), tournament (32→24→16→8→4→2→1,
  3 pairings/round, pts/GD/GF/strength/id table, steal-from-fallen). Review: clean.
- ✅ Phase 3 (498a670): reducer state machine (src/game/state.ts), Home + Draft
  screens. RNG in ref, consumed only in handlers (StrictMode-safe).
- ✅ Phase 4: Battle (intro/results + cut-line table), Steal (loot grid + slot gains),
  End screens. Full-loop DOM tests. 53 tests green, build green.
  - NOTE: Chrome extension not connected → verification is via jsdom+RTL
    integration tests (walks the whole game through real components) + HTTP 200.

## Next

1. Phase 3+4 review subagent results → fix real bugs (in flight).
2. Remaining Tier 2 candidates (only if time): mobile layout pass, player card
   polish. Don't gold-plate.
3. Final sweep: kill dev-server background task, final PROGRESS/README touch-up.

## Balance findings (sanity-checked headlessly, 2026-07-10)

- Bot lobby strength: 940–1027, median ~990. Naive human (best on-position
  rating, no chem): median 966 → survives early rounds, dies mid-game.
  Chemistry-aware drafting closes the gap → competitive to win. Good curve, no
  tuning needed.
- Scorelines realistic: 2.69 goals/match avg, max 7, ~6% scoreless.
- 19/20 winners from strength top-8 (skill dominates; upsets exist).
- Demo talking points: all-GK troll draft = 719 strength, finishes #32.

## Key decisions

- Draft mechanic: spin lands a nation (uniform), pick any un-owned player from that
  nation into the current FORMATION slot; off-position allowed at 0.75×.
  Duplicates ACROSS teams allowed (genre norm); never within a team.
- Steal window after every cut (except when game over): human chooses via UI,
  bots auto-take best strictly-improving swap; pool = union of just-eliminated XIs.
- Human elimination → "SEE HOW IT ENDS" fast-forwards rest headlessly (same rng).
- Placement = table rank in the round you fell; champion = 1.
- Test-only-first-option drafting yields an all-GK 719-strength team that finishes
  #32 — engine correctly punishes bad drafting (good demo talking point).
- Dev server on :5173 (background task bnhxyhzci may still be running — stop before
  starting a new one).
