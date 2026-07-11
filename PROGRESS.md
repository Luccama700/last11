# Last11 — Build Progress

_Running log for the build agent. Update before context runs low._

## Current state

- **Tier:** 1 (solo BR vs bots)
- **Phase:** 0 done → starting Phase 1 (engine foundations)

## Done

- ✅ Brief loaded from Mindboard (plan, idea note, theme-reveal note). Naming
  note absent from vault but decision known: **Last11 / 11a0.com**, Sport track.
- ✅ PLAN.md committed (a194866).
- ✅ Phase 0 — scaffold: Vite 8 + React 19 + TS 7 + Tailwind 4 (vite plugin) +
  Vitest 4, hand-rolled (create-vite prompts in non-empty dir). Verified:
  `npm test` green (1 smoke test), `npm run build` green, dev server serves
  Last11 page (HTTP 200).

## Next

1. **Phase 1 — engine foundations:** `src/engine/` types, seeded RNG
   (mulberry32-style), World Cup squad JSON (bundled, ~8 nations to start),
   team rating (chemistry + position fit + star power). Determinism + rating
   tests.
2. **Phase 2 — engine match & tournament:** match sim, pairing, bottom-25% cut,
   steal, `runTournament` 32→1, e2e test.
3. **Phase 3 — draft UI.** 4. **Phase 4 — BR loop UI (Tier 1 done).**
   5. Juice (stretch).

## Key decisions

- Single tsconfig, `build: tsc --noEmit && vite build`, vitest config inside
  `vite.config.ts` via `vitest/config`. Node env for tests (engine is pure TS;
  no jsdom needed).
- Plain React reducer for game state — no state lib.
- Lobby = 32 (1 human + 31 bots). Tier 3 multiplayer is out of scope (local-only).
- After each phase: subagent diff review for real correctness bugs, fix, advance.
- Deadline anchor: video/Devpost locked Sat night; submission Sun 9am PST.
