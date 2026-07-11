# Brief: Player database v2 (owner: worker-6)

You own the player data expansion. Research + plan only. Output:
`docs/redesign/PLAN-database.md`. You may include SAMPLE data files under
`docs/redesign/samples/` (not `src/`).

## What Lucca wants

1. **Detailed positions** (12): GK, RB, CB, LB, CDM, CM, CAM, RM, LM, LW, RW,
   ST. Every player gets a primary detailed position (optionally: secondary
   positions — propose whether v2 supports them).
2. **Historical World Cup squads**, keyed by (nation, year) — like 7a0, which
   covers 1950→2026 with 250+ squads and 5,700+ players. We don't need that
   scale; propose a realistic v1 target (e.g. ~12 nations × ~4-6 tournament
   years, 14-18 players per squad) and a growth path.
3. **Accurate, consistent ratings.** Lucca's calibration complaints: Gabriel
   Magalhães at 85 is too low relative to a Messi at 90 — the scale is
   compressed and era-blind. Design a ratings RUBRIC first (anchors: what does
   99 mean? 1970 Pelé? prime Messi 97-98? current top players 90-94? solid
   starters 80-86?), era-relative vs absolute — recommend one, justify it, and
   rate within it. Ratings for a (nation, year) squad reflect the player AT
   that tournament (Messi 2014 ≠ Messi 2026).
4. **Steal pool expansion**: with squads-by-year, the between-round steal pool
   becomes the FULL squads of eliminated managers' rolled teams, not just their
   fielded XIs. Flag data-shape implications.

## Research

- How 7a0/38-0 structure their data (squad sizes, which years, rating display).
- Real squad lists for the tournaments you propose (FIFA archives, Wikipedia
  squad pages) — cite sourcing strategy; you will generate data from model
  knowledge but VERIFY names/squads against the web for the sample.
- Note the licensing caution (real names/data) already flagged in the project
  docs — one paragraph, not a legal essay.

## Constraints

- Current shape: `src/engine/data/squads.json` (12 nations × 12 players,
  4 coarse positions, flat ratings). Migration must let the current game keep
  working until the new draft/engine land (worker-7 owns sequencing).
- IDs must stay unique across (nation, year) — propose the ID scheme.
- Deterministic engine: data is static JSON, bundled, no runtime fetching.

## Deliverable shape

Findings → schema v2 proposal (TypeScript types + JSON example) → ratings
rubric with ~15 named anchor players across eras → coverage plan (which
nation-years, in priority order) → ONE complete sample squad file (e.g.
Brazil 2002, verified) → Tier A vs Tier B split → open decisions for Lucca
(he "knows ball" — give him the rubric and 10-15 contested ratings to
calibrate, e.g. Magalhães, current Messi vs prime Messi, R9 vs Haaland).
