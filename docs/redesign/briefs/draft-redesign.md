# Brief: Draft redesign (owner: bug-hunt)

You own the draft experience rework. Research + plan only. Output:
`docs/redesign/PLAN-draft.md`.

## What Lucca wants

1. **Free picking after a spin.** Today the draft walks FORMATION slot-by-slot
   and the spin supplies players only for the current slot. New model (like 7a0):
   the spin lands a nation (+ year, see below); the manager may pick ANY player
   from that squad and place him into any compatible OPEN slot of their
   formation. Propose the exact UX: pick player → auto-slot to his natural
   position? pick player then choose slot? what if his natural slot is full —
   off-position placement with a penalty (position-affinity, see CONTRACT
   assumption)? What if NO slot fits — forced off-position pick, or re-spin,
   or skip token? Look at how 7a0 handles "no compatible player" cases.
2. **12 positions**: GK, RB, CB, LB, CDM, CM, CAM, RM, LM, LW, RW, ST.
3. **Formation picker** before drafting: 4-3-3, 4-4-2, 4-2-3-1, 4-2-4, 3-5-2,
   5-3-2, 4-5-1, 3-4-3 (7a0's set). Each formation = an ordered list of the 12
   positions (with repeats). Changing formation mid-draft: allowed? (7a0: chosen
   up front; propose what's right for a BR where you draft under pressure.)
4. **Playing style**: Defensive / Balanced / Attacking — chosen on the tactics
   board, feeds the engine (engine worker owns the effect; you own the UI).
5. **Tactics board UI** modeled on the 7a0 screenshot Lucca shared: left panel
   (formation grid + style + mode), center pitch with dashed position circles
   laid out per formation, right panel box score (per-position attack/defense
   contribution). Plan the React component structure; reuse the existing
   Tailwind dark theme.
6. **Year roll**: the spin result becomes (nation, World Cup year) — e.g.
   "Brazil 2002". Depends on player-database workstream for squads-by-year.
   Plan the wheel UX for the two-part roll.

## Research

- 7a0.app/pt, seteazero.org, techtudo/omelete coverage — draft flow details,
  formation requirements, Classic vs Almanac modes.
- The current implementation: `src/screens/DraftScreen.tsx`,
  `src/engine/draft.ts`, `src/game/state.ts` (reducer actions/phases).

## Constraints

- Bots must draft under the SAME rules (botPick needs a slot-choice strategy).
- Reducer stays pure; RNG consumed in event handlers (see PROGRESS.md).
- Keep the existing spin-wheel juice; extend, don't regress, the animations.
- State your assumed Position/affinity/squad types explicitly for worker-7.

## Deliverable shape

Findings → proposed UX flow (step diagram) → component/reducer change list →
Tier A (Sat night) vs Tier B split → open decisions for Lucca (aim for 6-10
sharp questions, e.g. "re-spin token: yes/no", "formation locked at kickoff?").
