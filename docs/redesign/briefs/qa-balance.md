# Brief: QA, balance harness & plan review (owner: test-hardening)

You own quality and game balance for the redesign. Research + plan only.
Output: `docs/redesign/PLAN-qa.md`.

## Job 1 — balance harness plan

The engine v2 (see briefs/match-engine.md) will have many tunables (tactic
modifiers, affinity matrix, zonal weights). Design the headless harness that
keeps it honest:

- Metrics per N simulated tournaments/matches: goals/match distribution, draw
  rate, clean-sheet rate, upset rate (weaker-strength wins), tactic-vs-tactic
  win matrix (does 4-2-3-1 dominate everything?), style matrix, human-strategy
  curves (naive vs chem-aware vs troll picks — PROGRESS.md documents today's
  baselines: bots 940-1027, 2.69 goals/match, ~6% scoreless).
- Real-football reference targets (research: top-flight averages ~2.6-2.9
  goals, draw ~24%, etc.) and acceptable bands.
- How it runs: a vitest-tagged suite or a script (`npm run balance`)? Output
  format a human (Lucca) can read to make tuning calls.

## Job 2 — test strategy for the redesign

- What of the existing 54 tests survives, what must change per workstream
  (12 positions, formations, timeline determinism, fixed-duration playback,
  steal-pool v2, year rolls).
- New invariants worth locking: same seed ⇒ identical timeline; timeline goals
  sum == final score; every formation drafts to a legal XI for bots; affinity
  matrix symmetry/bounds; data validation for squads (ids unique, 12-position
  enum, rating bounds) as a test over the JSON.
- Determinism traps to guard (Date.now, Math.random, iteration order).

## Job 3 — adversarial review of the other plans

As PLAN-draft/database/engine/sim/architecture land in docs/redesign/, read
each and append a short review section to YOUR plan: gaps, contradictions
between plans, scope risks vs the Sun-noon deadline. Be blunt.

## Deliverable shape

Harness design → metric/target table → test migration map → review notes on
the other five plans → Tier A vs Tier B split → open decisions for Lucca.
