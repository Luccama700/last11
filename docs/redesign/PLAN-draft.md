# PLAN: Draft redesign (owner: bug-hunt)

Phase R — research + plan only. Reworks the draft into a 7a0-style free-pick
tactics board while keeping Last11's battle-royale identity. Scope: draft UX,
12 positions, formation picker, playing style, tactics board UI, year roll.

---

## 1. Findings

### 1a. How 7a0 actually does it (verified on the web, 2026-07-11)

- **Roll = (nation, World Cup year).** Each spin lands a national team from a
  specific World Cup (e.g. "Brazil 2002"). You then pick ONE player from that
  squad into an open slot of your formation, and the pot reshuffles. Repeat ×11.
- **Formation & mode chosen up front.** 8 formations: 4-3-3, 4-4-2, 4-2-3-1,
  3-5-2, 5-3-2, 4-5-1, 4-2-4, 3-4-3. Two modes: **Classic** (ratings shown) vs
  **Almanaque / Memory** (ratings hidden — a football-knowledge test).
- **Position eligibility, not a smooth penalty.** "Each slot only accepts
  compatible positions. If Klose can play right wing the system lets him; if not,
  he stays out of the XI." 7a0 gates placement on a discrete eligibility set, not
  a 0.75× multiplier. This is the single biggest divergence from our current code.
- **Wildcards / re-spins.** 3 re-spins in Classic, 1 in Memory. Lets you reject a
  squad you can't use.
- **Balance signal (engine's domain, but shapes the board).** Attack has no
  ceiling; defense saturates. Full-backs (RB/LB) are the scarcest, weakest slots —
  which is *why* 3-at-the-back formations are strong. The board must make the
  weakest OPEN slot obvious, because "fix your weakest hole now" is the core skill.

### 1b. What Last11 has today

- `Position` is 4 coarse buckets: `GK | DF | MF | FW` (`src/engine/types.ts`).
- `FORMATION` is a hard-coded ordered `Position[]` of length 11, fixed 4-3-3
  (`src/engine/rating.ts`).
- Draft is **sequential**: `state.draftSlotIndex` walks 0→10; each spin lands a
  **nation only** and supplies players **for the current slot**. You cannot choose
  the slot (`DraftScreen.tsx`, `reducer` `PICK` in `src/game/state.ts`).
- Off-position handled by a flat `OFF_POSITION_MULT = 0.75` in `effectiveRating`.
- Bots draft headlessly in `draftBotXi`: 11 spins, `botPick` takes the
  highest-`pickValue` player for the fixed current slot.
- RNG lives in a ref and is consumed only in App event handlers (`handleSpin`);
  the reducer is pure. This constraint is load-bearing and must be preserved.

### 1c. The Last11-specific twist 7a0 doesn't have

7a0 is single-player: draft once, sim a bracket. Last11 is a **battle royale** —
draft, then survive 6 elimination rounds vs 31 bots, with a **steal window**
between rounds (per the database brief, the steal pool becomes the *full squads*
of eliminated managers, not just their XIs). Consequences the draft plan must
respect:

- **Bots must draft under the identical free-pick rules** — `botPick` needs a
  slot-choice strategy, not just a player-choice one.
- **Draft happens under time/roll pressure**, so re-spins and formation choice
  should feel like fast, punchy levers, not a slow tactics-editor.
- The tactics board (formation + style) is not just a draft screen — `style` and
  `formation` become part of `Manager` and feed the engine at match time.

---

## 2. Proposed design

### 2a. Draft flow (step diagram)

```
[Pre-draft setup]  ──►  [Board draft loop ×11]  ──►  [Confirm & tactics]  ──►  ENTER ARENA
     │                        │                             │
  formation                spin → (nation, year)         style: Def/Bal/Att
  mode (Classic/Memory)     squad card appears           final board review
  style (can pre-set)       pick player → place slot      (re-spins spent here too)
                            re-spin token (≤3)
                            repeat until XI full
```

Detailed loop, one pick:

```
SPIN ─► roll (nation, year) ─► reveal squad card (grid of that squad's players)
  │                                   │
  │                         player is tappable IFF it has ≥1 open compatible slot
  ▼                                   ▼
[re-spin?] ◄── token>0 ──  tap player ─► how many open slots fit him?
  │  no token / keep                    ├─ exactly 1  → auto-place, pip the slot
  ▼                                     ├─ several    → pitch enters "place mode":
 (must pick a                           │              compatible open circles glow;
  playable player)                      │              tap one to place
                                        └─ 0 natural  → see §2c (off-position rule)
```

### 2b. The board IS the draft surface (unifies "tactics board" + "free pick")

Model the tactics-board screenshot Lucca shared as the live draft screen, not a
separate step:

- **Left panel** — formation grid (tap to preview/select a formation), playing
  style toggle (Defensive / Balanced / Attacking), mode badge (Classic/Memory),
  re-spin tokens remaining, team-strength readout (base / chemistry / stars /
  total, reused from `teamStrength`).
- **Center pitch** — dashed position circles laid out per the chosen formation.
  Empty slots are dashed ghosts labelled with their position (RB, CDM…). Filled
  slots show flag + name + rating (rating hidden in Memory mode). This replaces
  today's plain "Your XI" sidebar list — the sidebar list becomes the pitch.
- **Right panel** — per-position box score (attack/defense contribution per
  slot). **Tier B**: real numbers come from the engine's zonal model. **Tier A**:
  a lightweight proxy (slot's effective rating split by a fixed attack/defense
  weight per position) so the panel exists and demos, upgraded when the engine
  lands. Flagged as a dependency, not a blocker.

The spin animation stays: reuse `SpinWheel`'s chase, extended to reveal
(nation, year) instead of nation only (§2e). Do **not** regress the juice.

### 2c. The three hard cases (pick → place)

1. **Player fits multiple open slots** → *pick-then-place*. Tap the player, the
   pitch glows every compatible open circle, tap the target. Default hint: his
   natural slot pulses brightest.
2. **Player fits exactly one open slot** → auto-place immediately (no extra tap).
   This keeps the common case one-tap-fast under BR pressure.
3. **Player has no *natural* open slot** → **off-position placement via affinity**
   (recommended) rather than 7a0's hard "he stays out". Any player can be placed
   into any open slot; affinity < 1 docks his effective rating and the circle
   shows an orange "off-position" tag with the reduced number. This means the
   draft can **never dead-end** — critical for a BR that must always reach a full
   XI. Re-spin tokens become an *optional* "I dislike this squad" lever, not a
   required escape hatch. (Strict-eligibility is offered as an open decision, §5.)

Re-spin: while a squad is revealed and nothing placed yet, "re-spin" burns a
token and rolls a fresh (nation, year). 3 tokens (Classic). Spent tokens persist
across the draft, not per-slot.

### 2d. Bot draft under the same rules

`draftBotXi` rewrites to the free-pick model so bots and humans play one ruleset:

```
for each bot:
  xi = empty board for its formation (bots get a formation too — see §5 Q7)
  respins = 3
  while board has an open slot:
    (nation, year) = spin(rng)
    candidates = squad(nation, year) minus already-taken-by-this-bot
    best = argmax over (player p, open slot s compatible-or-affinity) of
           pickValue(xi, s, p)      // fit×affinity + chem + star, reuse pickValue
    if bestValue < RESPIN_FLOOR and respins > 0:
        respins--; continue          // reject weak squad, like a human wildcard
    place best.player into best.slot
```

`pickValue` already exists and extends cleanly once `effectiveRating` consults
the affinity matrix instead of the flat 0.75. Determinism is preserved (ties
broken by lower player id, as today). `RESPIN_FLOOR` is a tunable constant handed
to the balance/QA workstream.

### 2e. Year roll (two-part spin)

Depends on database v2 supplying squads keyed by (nation, year). Wheel UX:

- **One combined reveal, sequenced.** The nation wheel chases and lands first
  (existing animation), then a compact **year strip** for that nation rolls and
  snaps (e.g. BRA → 1970 / 1982 / 1994 / 2002 / 2022). Two eased snaps in one
  spin read as "Brazil… 2002!" — punchier than two separate buttons.
- The squad card header shows flag + "Brazil 2002" + a small era tag.
- **Graceful degradation:** if DB v2 (years) hasn't merged, the year strip is
  skipped and the roll is nation-only against the current flat squads, so the new
  board ships and demos even if the data lands late. Year is additive.

---

## 3. Component / reducer change list

### Types (ASSUMPTIONS for worker-7 / CONTRACT — see §6)

- Widen `Position` to the 12-position union.
- Replace `OFF_POSITION_MULT` with an **affinity lookup** `affinity(slot, player)`
  → number in `[0,1]` (values owned by engine plan; shape owned here + worker-7).
- `Formation = { name: string; slots: Position[] }`; a `FORMATIONS` catalog of 8.
- Draft XI becomes **sparse/positional**: slots fill in any order.

### `src/game/state.ts` (reducer)

- `GameState`: drop `draftSlotIndex`; add
  `formation: Formation`, `mode: 'classic' | 'memory'`, `style: Style`,
  `spun: { nation: string; year: number } | null` (replaces `spunNation`),
  `respinTokens: number`, and make the human's `xi` a fixed-length
  `(XiSlot | null)[]` sized to the formation.
- New actions: `SET_FORMATION`, `SET_STYLE`, `SET_MODE`, `RESPIN`,
  and change `PICK` to `{ type: 'PICK'; player; slotIndex }`.
- `SPIN` payload becomes `{ nation, year }`.
- Draft-complete test: no `null` left in the human XI (replaces
  `draftSlotIndex >= FORMATION.length`).
- Reducer stays pure; RNG still consumed in App handlers.

### `src/engine/draft.ts`

- `spinNation` → `spinSquad(rng): { nation, year }`.
- `draftOptions` unchanged in spirit (exclude taken), now takes (nation, year).
- `pickValue` unchanged signature; `effectiveRating` swaps 0.75 → affinity.
- `botPick` → `botBestPlacement(candidates, xi, formation)` returning
  `{ player, slotIndex }`; `draftBotXi` rewritten per §2d.
- New helper: `openCompatibleSlots(xi, formation, player)` (also used by UI).

### `src/engine/rating.ts`

- `FORMATION` const removed / replaced by `FORMATIONS` catalog + a
  `formationSlots(name)` accessor.
- `effectiveRating` consults affinity; `teamStrength` iterates the sparse XI.

### `src/screens/DraftScreen.tsx` → split into board components

- `PreDraftSetup` (formation + mode + style chooser).
- `TacticsBoard` (left panel / center pitch / right box score container).
- `PitchBoard` (position circles per formation; place-mode highlighting).
- `SquadCard` (revealed (nation, year) squad grid; tappable players).
- `SpinReveal` (extend existing `SpinWheel` for the two-part roll).
- Keep the Tailwind dark theme + `animate` prop pattern for sync DOM tests.

### `src/App.tsx`

- `handleSpin` → rolls `{nation, year}`; add `handleRespin`, `handlePick(player,
  slotIndex)`, `handleSetFormation/Style/Mode`. RNG stays in the ref.

---

## 4. Tier A (ship Saturday night) vs Tier B (post-hackathon)

**Tier A — small, safe, demo-visible:**

- 12-position `Position`, `FORMATIONS` catalog, formation picker (offer all 8 —
  they're cheap data; 3-4 if time-boxed).
- Free-pick-into-open-slot on the pitch board (the headline visible change).
- Pick-then-place + auto-place-when-one + off-position via affinity (never
  dead-ends). Re-spin tokens (3).
- Playing style toggle (3) written to `Manager` for the engine to consume.
- Bots drafting under the new rules (`draftBotXi` rewrite) — required for
  correctness, not optional.
- Keep/extend the spin juice. Left panel + pitch + a **proxy** box-score panel.
- Year roll **if** DB v2 lands in time; otherwise nation-only with the year
  reveal stubbed (additive, non-blocking).

**Tier B — the full vision, done right:**

- Real per-position attack/defense box score from the engine's zonal model.
- Classic vs Memory mode fully wired (hidden ratings across board + squad card).
- Affinity matrix fully tuned with the engine + QA workstreams; secondary
  positions surfaced in the UI.
- Formation change mid-draft (auto-remap already-placed players; §5 Q6).
- Two-part year wheel with full era polish; per-nation year availability.
- Draft-clock / pressure timer (ties into multiplayer readiness).

---

## 5. Open decisions for Lucca (6-10 sharp questions)

1. **Off-position model:** affinity (any player placeable anywhere, penalty scales
   by distance — my recommendation, never dead-ends the BR) **vs** 7a0-strict
   (a player only fits his eligible positions; unusable squads force a re-spin)?
2. **Re-spin tokens:** yes, and how many — 3 like 7a0 Classic? Do bots get the
   same count, or a different budget (affects balance)?
3. **Formation locked at kickoff?** Locked once drafting starts (simplest, 7a0's
   model) vs changeable mid-draft (needs a re-map rule) vs changeable *only*
   before the first spin?
4. **Auto-slot vs always-choose:** when a picked player fits exactly one open
   slot, auto-place him (fast, my rec) or always make the manager tap the slot
   (deliberate, slower)?
5. **Memory/Classic mode in the hackathon build?** It's cheap (hide rating
   numbers) and a strong differentiator, but adds a pre-draft choice. Tier A
   optional or hold to Tier B?
6. **Mid-draft formation change re-map:** if allowed, when switching formation do
   we (a) keep players whose position still exists and drop the rest, or (b)
   best-effort re-slot everyone by affinity? (Only matters if Q3 allows it.)
7. **Do bots pick a formation/style too,** or do all bots run a fixed 4-3-3 +
   Balanced for determinism/balance simplicity? (Bots visibly varied is nicer;
   fixed is safer to balance in 24h.)
8. **Which formations for Tier A** — all 8, or a curated 3-4 (e.g. 4-3-3, 3-5-2,
   4-4-2, 4-2-3-1) to cut pitch-layout work?
9. **Box-score panel in Tier A:** ship the proxy (fixed attack/defense weights)
   so the panel exists for the demo, or hide it until the engine's real zonal
   numbers land?
10. **Steal window + free-pick:** with the full-squad steal pool (DB brief),
    should a stolen player also be free-placed into any open/weaker slot (same
    board UX), or keep steals as the current best-positive-swap? (Coordinate with
    engine/steal logic.)

---

## 6. CONTRACT assumptions (explicit, for worker-7 to reconcile)

Stated as assumptions — worker-7 owns the final shapes in `CONTRACT.md`. I will
build against these unless reconciled otherwise.

```ts
// 12 detailed positions
type Position =
  | 'GK' | 'RB' | 'CB' | 'LB'
  | 'CDM' | 'CM' | 'CAM' | 'RM' | 'LM'
  | 'LW' | 'RW' | 'ST';

type Style = 'defensive' | 'balanced' | 'attacking';

interface Formation { name: string; slots: Position[] } // ordered, GK first, len 11

// Affinity replaces the flat 0.75 off-position multiplier.
// SHAPE is mine + worker-7; VALUES are the engine plan's.
// affinity(slot, playerNaturalPos) -> [0,1]; natural == 1.0.
type Affinity = (slot: Position, natural: Position) => number;

// Player: aligns with database v2 (primary + optional secondary eligibility).
interface PlayerV2 {
  id: string;            // unique across (nation, year) — DB brief owns scheme
  name: string;
  nation: string;        // 3-letter code
  year: number;          // World Cup year
  position: Position;    // primary
  secondary?: Position[];// optional extra natural positions (affinity 1.0)
  rating: number;
}

// Draft-time roll + sparse board
interface Roll { nation: string; year: number }
type DraftXI = (XiSlot | null)[]; // fixed length = formation.slots.length
```

Key assumption flags for reconciliation:
- **XI becomes sparse/positional** (fill in any order) — touches reducer, steal
  logic, and every `teamStrength`/match consumer that assumes a dense 11.
- **`effectiveRating` depends on affinity**, so engine + draft share that fn.
- **Roll is (nation, year)** — the engine's match code never sees years, but the
  data layer and steal-pool (full squads by year) do.

---

## 7. Dependencies on other workstreams

- **Player database (worker-6):** squads keyed by (nation, year); 12-position
  primary (+ optional secondary); the id scheme unique across (nation, year).
  Year roll and Memory mode both ride on this. Hard dependency for the year roll;
  soft for everything else (nation-only fallback ships without it).
- **Match engine (hackathon-builder):** owns affinity *values*, the effect of
  `style`, and the zonal attack/defense numbers the box-score panel renders. My
  board consumes these; I supply the shapes.
- **Match sim (codex-ui):** none inbound; we both consume the shared contract.
  The draft hands off a complete `Manager` (xi + formation + style) to the sim.
- **Architecture (worker-7):** reconciles §6 into `CONTRACT.md` — especially the
  sparse-XI reducer delta and the affinity shape. I flagged the sparse-XI change
  as the highest-risk cross-cutting assumption.
- **QA / balance (test-hardening):** `RESPIN_FLOOR`, bot formation/style policy
  (Q7), and affinity tuning all feed the balance harness; the existing 54 tests
  that assume 4-position `FORMATION` / sequential `draftSlotIndex` will need
  updating (worker-7 sequences migrate-vs-preserve).

Sources: [7A0 official](https://7a0.app/), [7-0 strategy guide](https://www.7-0.online/blog/how-to-go-7-0),
[seteazero.wiki](https://seteazero.wiki/), [seteazero.online guide](https://www.seteazero.online/en),
[techtudo coverage](https://www.techtudo.com.br/noticias/2026/06/7-a-0-veja-dicas-para-dominar-jogo-da-copa-do-mundo-e-montar-sua-selecao-edjogos.ghtml),
[World Soccer Talk](https://worldsoccertalk.com/world-cup/what-is-7a0-sete-a-zero-how-to-play-the-viral-world-cup-browser-game-taking-over-social-media/).
