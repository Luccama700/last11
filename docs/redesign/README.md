# Last11 Redesign — Phase R (Research & Plan)

Post-Tier-1 redesign of Last11, directed by Lucca (2026-07-11). Six workstreams,
one worker each. **This phase is RESEARCH + PLAN ONLY — do not touch `src/`.**

## Context (read first)

- `PLAN.md`, `PROGRESS.md` — what shipped (Tier 1 + core Tier 2, 54 tests green).
- Hackathon: United Hacks V7, submission **Sun Jul 12, 12:00pm EST** (~24h away).
  Every plan MUST split its proposal into:
  - **Tier A — shippable by Saturday night** (small, safe, demo-visible)
  - **Tier B — post-hackathon** (the full vision, done right)
- Inspiration: 7a0.app (nation+year roll, 8 formations, defensive/balanced/attacking
  styles, 12-position pitch board with per-position attack/defense box score,
  Classic vs From-Memory modes) and 38-0 (deterministic engine — "every result
  deserved, never random", live fixed-duration 1v1 matches with tactic changes
  before kickoff and at halftime).

## The five product directives from Lucca

1. **Draft**: spin should NOT lock you to one position — pick any player from the
   rolled squad into any open slot. Full position set: GK, RB, CB, LB, CDM, CM,
   CAM, RM, LM, LW, RW, ST (12). Formation picker + playing style + a 7a0-style
   tactics board. Add a **year roll** (nation + World Cup year).
2. **Tactics must matter**: more tactics, and they must genuinely affect match
   results via the engine.
3. **Match engine**: rebuilt to be very good; Lucca wants heavy personal input —
   every engine plan ends in a decision questionnaire for him.
4. **Match sim**: matches play out on screen one at a time, fixed duration,
   pitch + ball-position/momentum meter, goal animations, score updates, ball
   reset. Designed so a future server can drive it (multiplayer).
5. **Player DB**: much larger (historical World Cups), consistent/accurate
   ratings (current scale is off: Gabriel Magalhães 85 vs Messi 90), squads
   keyed by nation+year. Steal pool widens to full squads of eliminated teams.

## Workstreams & owners

| Brief | Worker | Area |
|---|---|---|
| `briefs/draft-redesign.md` | bug-hunt | Draft UX, positions, formations, tactics board, year roll |
| `briefs/player-database.md` | worker-6 | Data schema v2, historical squads, ratings rubric |
| `briefs/match-engine.md` | hackathon-builder | Tactics-aware deterministic engine + event timeline |
| `briefs/match-sim.md` | codex-ui | On-screen match playback UI |
| `briefs/architecture.md` | worker-7 | Shared contract, multiplayer-readiness, integration order |
| `briefs/qa-balance.md` | test-hardening | Balance harness, test strategy, plan review |

## Rules of engagement

1. Read this file, your brief, `PLAN.md`, `PROGRESS.md`, and the engine source
   (`src/engine/`) before anything else.
2. Research the web where your brief says to (WebSearch/WebFetch are available).
3. Write your plan to `docs/redesign/PLAN-<area>.md`. Structure:
   **Findings → Proposed design → Tier A vs Tier B split → Open decisions for
   Lucca → Dependencies on other workstreams.**
4. Where your design needs a shared type (positions, player schema, timeline
   events), state your ASSUMPTION explicitly — worker-7 reconciles all of them
   in `CONTRACT.md`. Do not silently invent conflicting shapes.
5. Commit ONLY your own plan file: `git pull --rebase` then
   `git commit -m "PLAN(<area>): <summary>"`. Never touch `src/`.
6. When done, print a 5-line summary and go idle. Lucca will review every plan
   before any implementation starts.
