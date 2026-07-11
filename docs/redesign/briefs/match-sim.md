# Brief: Match sim / on-screen playback (owner: codex-ui)

You own the watchable match experience. Research + plan only. Output:
`docs/redesign/PLAN-sim.md`. HTML/ASCII wireframes welcome under
`docs/redesign/samples/`.

## What Lucca wants

1. Matches **play out on screen, one match at a time** (today: instant table).
2. A **pitch view** per match with a **meter showing where the ball is and
   which team has it** — a horizontal momentum/field-position bar over the
   pitch, driven by the engine's minute-by-minute timeline (engine workstream
   emits it; you consume it).
3. **Visuals of what's happening**: event captions/ticker (chance! save!
   counter-attack!), and on a goal: a celebration animation, score change,
   ball resets to the center for the conceding team.
4. **Fixed real-time duration per match** — this is a hard requirement because
   of future multiplayer: every client must see the same match take the same
   wall-clock time. Propose the duration (e.g. 30-60s per match, 90 virtual
   minutes) and a speed-up/skip affordance for solo play.
5. Rounds have many matches (32 managers × 3 pairings): propose what's watched
   vs summarized — e.g. YOUR match plays out fully; others tick on a compact
   scoreboard rail; marquee bot matches watchable on demand.

## Architecture requirement (from Lucca's multiplayer question)

Playback must be a PURE function of (timeline, elapsedTime) — no incremental
local randomness — so that later a server can hand every client the same
timeline + start timestamp and all screens stay in sync. Design the component
API around that now (worker-7 documents the broader multiplayer story).

## Research

- How 38-0's live 1v1 "90-minute" matches are presented (ticker? momentum
  bar?); any footage/reviews of 7a0's simulate step and box score reveal.
- Prior art for 2D momentum/attack meters: FlashScore/SofaScore "attack
  momentum" graph, football-manager-style 2D match views. What reads well at
  a glance.
- Animation approach: CSS transitions vs requestAnimationFrame on the existing
  Tailwind stack (no new heavy deps without a strong case).

## Constraints

- Existing screens: `BattleScreen.tsx` (reveal table stagger — keep the drama,
  move it to AFTER matches play), `state.ts` phases. `animate={false}` must
  keep tests synchronous — your design must preserve a headless instant path.
- Timeline event schema is owned by the engine plan + CONTRACT.md — state your
  assumed shape explicitly.

## Deliverable shape

Findings → screen flow (round intro → your match playback → other results →
elimination reveal) → wireframe(s) → component + state-machine change list →
timeline-consumption API → Tier A vs Tier B split → open decisions for Lucca
(match duration, what's skippable, how much of other managers' matches to show).
