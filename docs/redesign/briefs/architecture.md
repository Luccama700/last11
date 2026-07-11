# Brief: Architecture, contract & multiplayer-readiness (owner: worker-7)

You are the integrator. Research + plan only. Outputs:
`docs/redesign/PLAN-architecture.md` AND `docs/redesign/CONTRACT.md`.

## Job 1 — CONTRACT.md (the shared types all four streams build against)

Reconcile the assumptions the other briefs will state, and propose v2 shapes:

- `Position` (12 detailed positions) + a **position-affinity matrix** shape
  (how well a CM plays CDM/CAM, a RW plays RM/ST/LW…, replacing the flat 0.75
  off-position multiplier). The VALUES belong to the engine plan; the shape
  and its consumers (draft UI pick values, engine zonal strength) are yours.
- `PlayerV2` (detailed position, per-tournament rating) and `SquadEntry`
  keyed by (nation, year) — align with the database plan.
- `Formation` (name + ordered position list) and `Tactics` (formation, style,
  any extra levers the engine plan proposes).
- `MatchTimeline` (per-minute ball zone/possession + discrete events) — align
  engine (producer) and sim UI (consumer).
- Reducer/game-state deltas: new phases (tactics board, match playback),
  what `Manager` carries (tactics, rolled year…), steal-pool v2 (full squads
  of eliminated teams).

Watch the other PLAN-*.md files land in docs/redesign/ and reconcile — yours
should be written LAST-ish; start with a draft, then iterate as theirs arrive.

## Job 2 — multiplayer-readiness memo (answer Lucca's server question)

Lucca asked whether match playback "should all be server-side — correct me if
I'm wrong." Write the definitive memo:

- Evaluate: (a) fully server-authoritative sim streaming state; (b) pure
  deterministic engine + seed/tactics exchange, clients replay the identical
  timeline locally, synced by a shared start timestamp (thin server, cheap,
  and the engine is ALREADY deterministic — likely the winner, argue it
  honestly incl. anti-cheat trade-offs); (c) hybrid (server runs the same
  engine to certify results, clients render).
- What we must do NOW (in the solo game) so multiplayer is a refactor, not a
  rewrite: fixed-duration playback as pure(timeline, elapsed), no gameplay
  decisions made in components, all randomness through the seeded rng, round
  clock semantics (draft timers?).
- Recommend the eventual transport/host (Supabase realtime? tiny Node+WS?) —
  one page max, we are not building it this weekend.

## Job 3 — integration sequencing

Propose the merge order + migration path across the four streams so `main`
stays green and playable at every step (e.g. contract types → data v2 behind
adapter → engine v2 behind flag → draft UI → sim UI). Include how the current
4-position data keeps the game working until data v2 lands, and where the
existing 54 tests need updating vs preserving.

## Deliverable shape

CONTRACT.md (types, commented) + PLAN-architecture.md: multiplayer memo →
sequencing plan → risk list → Tier A vs Tier B split → open decisions for
Lucca (e.g. accept engine-v2 behind a flag for the hackathon demo?).
