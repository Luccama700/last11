# Brief: Match engine v2 (owner: hackathon-builder)

You own the match engine rebuild — Lucca calls this "the bulk of the work" and
wants it VERY good, with a lot of his own input. Research + plan only. Output:
`docs/redesign/PLAN-engine.md`.

## What Lucca wants

1. **Tactics that matter.** Formation (8 schemes), playing style
   (defensive/balanced/attacking), and more tactical levers (research what else:
   pressing intensity? line height? counter vs possession? man-marking a star?)
   — all genuinely moving match outcomes, not cosmetic.
2. **12 positions** (GK, RB, CB, LB, CDM, CM, CAM, RM, LM, LW, RW, ST) feeding
   the model — e.g. zonal strengths (GK / defense / midfield / attack, or
   finer: flanks vs center) computed from who plays where and how well they fit.
3. **A minute-by-minute event timeline** as the engine's output — REQUIRED by
   the match-sim UI workstream. Think: per-minute ball zone/possession value
   (for the on-pitch momentum meter), plus discrete events (chance, save, goal,
   maybe cards) with minute stamps. Deterministic given (teams, tactics, seed).
4. Still **pure TypeScript, deterministic, unit-tested** — that discipline is
   the project's technical-complexity core. 38-0 markets exactly this:
   "every result deserved, never random."

## Research (do this properly — compare, don't just pick)

- Candidate architectures, with trade-offs and a recommendation:
  a) upgraded Poisson/xG (current approach + tactic modifiers) — cheap, opaque;
  b) zonal possession model (Markov chain over pitch zones: defense→mid→attack
     transition probs from zonal strength matchups; shots sampled in attack
     zone) — naturally produces the ball-position meter;
  c) full event/agent sim (FM-style) — likely overkill; say why or why not.
- How formation matchups should work (e.g. 3-5-2 midfield overload vs 4-4-2;
  wing play vs narrow back 3). How styles shift risk (attacking = more xG both
  ways?).
- Real-football statistical targets the sim must hit: ~2.6-2.9 goals/game,
  ~22-27% draws, upset frequency, scoreline distributions. Cite sources.
- How 38-0 and 7a0 present engine outcomes (box scores, "deserved" results).

## Constraints

- Current: `src/engine/match.ts` (Poisson on strength diff), `rating.ts`
  (flat sum + chem + stars). Team strength inputs will come from the new
  positions/tactics — coordinate shapes with worker-7's CONTRACT.md.
- Battle-royale pacing: a round = 3 matches per manager, 32 managers — the
  engine must stay fast headless (timeline generation can be lazy/on-demand
  for watched matches only — propose how).
- Keep chemistry & star mechanics unless you argue for replacing them.

## Deliverable shape

Findings (with sources) → compared architectures + recommendation → the model
spec (zones, tactic modifiers table, parameter list with proposed defaults) →
timeline event schema (coordinate with worker-7) → test/balance plan hooks →
Tier A vs Tier B split → **a decision questionnaire for Lucca: 12-18 concrete,
opinionated questions** (e.g. "how many goals should a 10-point strength gap
be worth?", "should a bad tactic matchup ever beat better players?", "draw
rate target?", "how swingy should styles be?"). He wants to co-design this.
