# DECISIONS.md — Lucca's rulings (2026-07-11, morning)

Binding for Phase I (implementation). Where a line says DEFAULT, it's the
orchestrator's fill-in consistent with Lucca's intent — flag before changing,
but build against it. Everything here supersedes conflicting plan text.

## GO signal

Phase I is ON. Target: **a good, demoable build by Saturday night.** Follow
architect's sequencing (types → data → engine → draft → sim), flags on `main`,
current game always playable with flags OFF.

## Ratings (players)

New anchor scale — tighter ceiling, defender-friendly, higher floor than the
PLAN-database ladder. Fixed points from Lucca:

- **Pelé 1970 = 97** (the ceiling; nobody higher).
- **Maradona 1986 = 96 · Messi 2014 = 96 · Ronaldo R9 2002 = 96.**
- **Messi 2026 = 92.**
- **Gabriel Magalhães 2026 = 89–90** ("an 89-90 kind of player") — his original
  complaint meant Magalhães was rated TOO LOW, not that defenders should be
  decompressed downward. Very good starters on top teams live in the high 80s.
- Rebuild the §3.3 ladder around these five anchors (interpolate the rest;
  e.g. Zidane 98 / Cruyff 74 ≈ 95, Mbappé 22 ≈ 93 — players proposes, keeps
  proportions sane). More calibration passes with Lucca later; don't block on it.

## Match engine (game-engine)

- **Strength→xG: +10 zonal strength ≈ +0.75 xG** to the stronger side.
- **Total goals target: 3.4/match** (balanced matchup ⇒ base xG ≈ 1.7/side).
  This is a deliberately spicier-than-real-football game feel.
- **Draw rate target ~15% (pre-shootout), and EVERY draw goes to a penalty
  shootout — no drawn matches exist. It's win or lose.** Shootout is part of
  the engine (deterministic, seeded) and part of the timeline (sim shows it).
  - DEFAULT points: regulation win = 3, shootout win = 2, shootout loss = 1,
    regulation loss = 0. Table tiebreakers unchanged.
- **Chemistry: REMOVED.** Delete the same-nation pair bonus and the cohesion
  reframe. Replaces with:
- **Morale (new):** a per-player, per-match transient buff. DEFAULT: score a
  goal = +2 rating next match, assist = +1, cap +3 per player; applies to the
  player's next match only, then resets; no negative morale (no death spirals);
  it is runtime state on the manager/XI, NOT in the player database. Timeline
  goal events must attribute a scorer (and DEFAULT an assister) to feed this.
  QA must measure the rich-get-richer effect in the BR (it's intended drama,
  but bound it).
- **No stamina. Ever.**
- **Off-position affinity: MORE FORGIVING** than the PLAN-engine §3.2 table.
  DEFAULT posture: same-zone moves ≥ .85, adjacent-zone ≥ .60, worst case
  (e.g. GK↔outfield) floor .25–.30; all cells strictly > 0 (contract
  invariant). Engine retunes the full matrix in this spirit.
- **Bot tactics: VARIED.** Bots get seeded-random (weighted-sane) formations
  and styles. QA's balance harness covers the matchup space accordingly.
- Star bonus: kept as planned (attack-zone shot quality).

## Match sim (match-sim) + engine, jointly

- **Actual 2D pitch, not just a bar.** Ball marker positioned by the engine's
  zone (band × lane) each virtual minute; smooth interpolation between ticks.
- **Pseudo-moving dots ARE in scope:** 22 dots at formation coordinates,
  drifting toward/away from the ball zone by possession & band. Pure function
  of (timeline, elapsed) — no per-dot simulation. Full agent-level ball physics
  stays out of scope (Tier B+).
- **Engine and sim agree the tick spec together BEFORE coding** (band/lane
  fields on each tick, shootout event sequence, scorer/assister on goals) and
  hand it to architect for CONTRACT. This is the "let them talk to each other"
  directive — direct coordination, not brief-passing.
- Momentum bar can stay as a secondary readout under the pitch if cheap.

## Between-match management (draft-page + match-sim + engine)

- **The manager can re-arrange players after every match**: re-slot/swap
  positions on the pitch board between matches (reuses the draft board UI).
  DEFAULT scope: player re-slotting + style change between matches; formation
  change only between rounds. Bots auto-re-arrange (best-affinity assignment).
  No stamina, no substitutions-for-fatigue — this is tactical, not fitness.

## Off-position / draft (draft-page)

- Affinity model confirmed (never dead-ends), with the more-forgiving matrix.
- Everything else per PLAN-draft Tier A: free pick-then-place, 12 positions,
  8 formations, styles, re-spin tokens ×3, year roll (graceful nation-only
  fallback), bots under identical rules.

## Deferred (Lucca will rule later)

- Full ratings calibration pass (he'll red-pen the ladder).
- Marquee-match selection, Memory mode, man-marking, halftime re-tactic UI.
- Engine questionnaire items not covered above take the plan's recommended
  defaults.
