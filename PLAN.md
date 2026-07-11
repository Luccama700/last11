# Last11 — Build Plan

**Last11** (domain **11a0.com**) — a football **draft battle royale**. Built at
**United Hacks V7** (Hack United, virtual, Jul 10–12 2026), **Sport theme track**.

> One big lobby. Everyone drafts an XI under pressure. The weakest teams get
> eliminated round after round. Last manager standing wins. Nobody has built the
> battle-royale version of the spin-to-draft football sim genre (38-0, 7a0) — we did.

## Confirmed scope & constraints

- **Name:** Last11 (11a0.com) — used in README, page `<title>`, pitch copy.
- **Track:** Theme (Sport). Judging: Creativity · Practicality · Presentation
  (rewards a working demo) · Design · Technical Complexity.
- **Deadline:** Sun Jul 12, **9:00am PST** (hard). Public repo + 2–5 min demo
  video + Devpost write-up. Video/write-up locked Saturday night.
- **Engine:** pure, deterministic TypeScript in `src/engine/`, unit-tested with
  Vitest. This is the technical-complexity core — kept honest with tests.
- **Stack:** Vite + React + TypeScript, Tailwind, Vitest. Plain reducer for game
  state (no Zustand unless a tier needs it). Local only, no deployment.
- **Data:** small bundled JSON of 2026 World Cup squads (names + simple ratings),
  assembled now.
- **Lobby cap ~32** (1 human + 31 bots), not 99.
- Minimal. No abstraction/config/flexibility the current tier doesn't need. Cut
  from the bottom of the scope ladder; ship Tier 1 fully before juice/multiplayer.

## Scope ladder

- **Tier 1 — solo BR vs bots (MUST SHIP FULLY):** the playable end-to-end loop.
- **Tier 2 — juice + mobile (stretch):** animations, sound, cards, phone layout,
  bot trash-talk.
- **Tier 3 — live multiplayer (out of scope for this build):** needs a server;
  conflicts with local-only. Noted, not built.
- **Tier 4 — submission polish:** README, screenshots (video/Devpost are Lucca's).

## Phased build (vertical slices — each ends runnable + testable)

### Phase 0 — Scaffold & smoke
Vite + React + TS + Tailwind + Vitest. `Last11` landing page renders.
- **DoD:** `npm run dev` serves the page; `npm test` passes (smoke test);
  `npm run build` succeeds. Committed.

### Phase 1 — Engine foundations
`src/engine/`: domain types (Player, Position, XI, Manager), seeded RNG
(deterministic), bundled World Cup squad JSON + draft-pool helpers, team rating
(chemistry + position fit + star power → strength).
- **DoD:** `npm test` green. Determinism test (same seed ⇒ same output). Rating
  tests (a stronger XI out-rates a weaker one; chemistry/fit move the number the
  expected way).

### Phase 2 — Engine match & tournament
Deterministic match sim (two XIs + seed ⇒ scoreline), round pairing + scoring,
bottom-~25% elimination, between-round steal mechanic, and `runTournament`
(32 → 1) driving the whole battle royale headlessly.
- **DoD:** `npm test` green incl. an **end-to-end tournament test**: a full BR
  from 32 managers resolves to exactly one winner, deterministically, with a
  monotonically shrinking lobby and correct per-round cut counts.

### Phase 3 — Draft UI
React app wired to the engine: 32-manager lobby (1 human + 31 named bots),
spin-to-draft roulette across positions, human builds an XI, bots auto-draft.
Game state via a plain reducer.
- **DoD:** dev server — complete a full draft and see your assembled XI + a
  preview of the lobby field.

### Phase 4 — Battle royale loop UI (Tier 1 complete)
Post-draft: simulate a round, elimination reveal table, shrinking lobby, the
between-round steal action, repeat to a winner. Win/lose screens + run summary;
play-again resets.
- **DoD:** dev server — a full solo-vs-bots BR is playable start to finish; both
  win and elimination endings are reachable. **Tier 1 done.**

### Phase 5+ — Tier 2 juice (only if Tier 1 is solid)
Wheel spin animation, elimination drama/countdown, sound, player cards, mobile
layout, bot trash-talk. Add from the top; stop when time runs out.

## Definition of done (every phase)
Runs **and** its tests pass — shown with the command + output, not asserted.
After each phase a subagent reviews the diff for real correctness bugs; fix, then
advance. `PROGRESS.md` updated before context runs low.

## Non-goals (this build)
Real multiplayer/networking. Deployment. Accounts/persistence. Real player
licensing (post-hackathon question). Anything beyond the current tier.
