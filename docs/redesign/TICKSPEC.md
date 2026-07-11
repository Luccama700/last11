# TICKSPEC.md — per-minute tick, dot drift, shootout & goal attribution

**Status: CO-SIGNED v0.3** (hackathon-builder + codex-ui, 2026-07-11). Agreed spec
between **engine (hackathon-builder, producer)** and **sim (codex-ui, consumer)**;
**awaiting worker-7 ratification** into `CONTRACT.md §4`.

Sign-off:
- [x] engine (hackathon-builder) — authored, reconciled to codex-ui's asks + CONTRACT v0.4
- [x] sim (codex-ui) — **CO-SIGNED** (all confirms YES; §2 dot refinements folded in)
- [ ] worker-7 — ratify the (small) deltas below into CONTRACT §4

**Authoritative over CONTRACT v0.4 §4's tick/shootout block**, which worker-7 shipped
marked *"PROPOSED — engine + sim confirm final names/ranges per the 'let them talk'
directive; worker-7 ratifies whatever they agree."* This is that agreement.

v0.3 deliberately **keeps CONTRACT v0.4's names and enums** wherever they exist
(`playerId` scorer, `assistPlayerId`, `MatchResultV2`, `Shootout`, `POINTS`, morale
consts, the `penalty_scored`/`penalty_missed` events) so ratification is a minimal diff.
Only **four** things change vs v0.4, all re-agreed by engine+sim:

1. **`TimelineTick`**: replace the discrete `band`+`lane` with **one continuous
   `ballLane: number` (0..1)**. `ballPosition` stays (sim derives the longitudinal band
   from it), so the pitch gets its lateral axis with a single added float.
2. **`MatchTimeline`**: add **`homeFormationId` + `awayFormationId`** so playback is
   self-contained (`pure(timeline, elapsed)`, MP-clean — no `Tactics` needed to place dots).
3. **`Shootout`**: extend v0.4's `{home,away,winner}` with a **`kicks[]`** array (sim
   animates each kick + drives the pip grid/tally from it).
4. New shared render constants: **`POSITION_ANCHOR`** (dot layout) and **`SHOOTOUT_MS = 12000`**
   (fixed appended shootout window). Both **sim-owned**; listed for cross-team consistency.

---

## 0. Why this file exists

CONTRACT v0.3 §4 froze a **1-D** timeline (`ballPosition` + `momentum`). `DECISIONS.md`
then upgraded three things needing concrete, agreed fields before either of us codes:

1. **Actual 2D pitch** — the ball marker needs a lateral coordinate; **22 dots** drift
   by possession/band.
2. **Every draw → seeded penalty shootout** — no drawn matches exist; the shootout is
   part of the engine AND the timeline.
3. **Morale** — timeline goals must attribute a **scorer + assister** so the +2/+1
   next-match buff applies (including in headless matches).

---

## 1. Pitch coordinates — one longitudinal + one lateral value per tick

Home renders left→right against a **single fixed camera frame** (codex-ui C1), attacks
toward `ballPosition = 1`.

- **Longitudinal** = existing `ballPosition ∈ [0,1]` (0 = home goal line, 1 = away goal
  line). Sim buckets this itself → **no `band` field on the tick**. Engine bins
  internally to **5 bands** for its zonal model, then projects
  `ballPosition = bandCenterX[band] + jitter`:

  | engine band (internal) | meaning (home POV) | bandCenterX |
  |---|---|---|
  | 0 home box / defending · 1 home third · 2 midfield · 3 away third · 4 away box | | 0.10 / 0.30 / 0.50 / 0.70 / 0.90 |

- **Lateral** = **NEW `ballLane ∈ [0,1]`** — `0` = home's **left** touchline = **top** of
  the fixed camera frame, `1` = right/bottom (codex-ui C1, one shared frame for both
  teams). Engine bins internally to 3 lane zones (L/C/R, driven by the zonal L/C/R
  strengths + tactics so wing play vs a narrow back-3 is *visible*), then emits
  `ballLane = {L:0.17, C:0.50, R:0.83}[lane] + jitterY`.

`jitter`/`jitterY ∈ [±0.06]` are pure functions of `(seed, minute)` → identical on every
client. `momentum ∈ [-1,+1]` unchanged.

**Producer coherence guarantee:** the possessing team trends up-band; `ballLane` reflects
the flank/center used; a turnover flips possession and mirrors the band trend.

### 1.1 `TimelineTick` (delta vs CONTRACT v0.4 §4)

```ts
export interface TimelineTick {
  minute: number;        // 0..durationMinutes                     (unchanged)
  ballPosition: number;  // 0..1  longitudinal, 0 = home goal line (unchanged; sim derives band)
  ballLane: number;      // 0..1  ADD — lateral, 0 = home-left/top of frame … 1 = right/bottom
  momentum: number;      // -1..+1                                  (unchanged)
  possession: Team;      // 'home' | 'away'                         (unchanged)
  // REMOVE from v0.4: band: Band; lane: Lane;  (sim buckets ballPosition + reads ballLane)
}
```

---

## 2. Dot drift model (22 dots) — sim-owned, engine-fed

Per DECISIONS: *22 dots at formation coordinates, drifting by possession & band, a pure
function of (timeline, elapsed), no per-dot simulation.* **Engine emits nothing per-dot.**
Dots are a pure render of `(tick.ballPosition, tick.ballLane, tick.possession)` + both
formations — which the timeline now carries directly (§4.4), so playback stays
self-contained.

**Dependency recorded for worker-7 (codex-ui C3):** dot placement uses
`FORMATIONS[formationId].slots` (the ordered `Position[]` from CONTRACT §3) → `POSITION_ANCHOR`.
So **`FORMATIONS[id].slots` must remain the source of truth for which positions a formation
fields** (it already is). `formationId` + `FORMATIONS.slots` + `POSITION_ANCHOR` is
complete — no extra timeline field for dots.

Shared **position-anchor table** (home frame). Sim owns the exact values + drift curve;
listed so **varied bot formations** render consistently:

```ts
// x: 0 own goal … 1 opp goal ; y: 0 left touchline/top … 1 right/bottom (home frame)
export const POSITION_ANCHOR: Record<Position, { x: number; y: number }> = {
  GK:  { x: .05, y: .50 },
  RB:  { x: .30, y: .83 }, CB: { x: .22, y: .50 }, LB: { x: .30, y: .17 },
  CDM: { x: .40, y: .50 }, CM: { x: .52, y: .50 }, CAM:{ x: .63, y: .50 },
  RM:  { x: .55, y: .83 }, LM: { x: .55, y: .17 },
  RW:  { x: .78, y: .83 }, LW: { x: .78, y: .17 }, ST: { x: .82, y: .50 },
};
```

**Sim-owned placement refinements (codex-ui, supersede v0.1's notes — render only,
engine-invisible):**
- **Away dots** use a **full 180° point-reflection** of `POSITION_ANCHOR`
  (`x → 1−x` AND `y → 1−y`), so the two teams are rotationally symmetric like a real
  kickoff. (Supersedes the earlier "x-only mirror" for *placement*; `ballLane` itself
  stays exactly camera-frame.)
- **Repeated-position slots** (e.g. two CBs) are **centered symmetrically** (2×CB →
  y .43/.57, etc.), **not** `±0.14 * index`.

Reference drift (sim finalizes constants), dot anchor `(ax,ay)`, ball `(bx,by) =
(ballPosition, ballLane)`, possession flag `poss`:

```
if poss:  driftX = clamp(0.22*(bx−ax), ±0.14)                  // push up toward ball band
else:     driftX = clamp(0.14*(ownGoalX−ax), ±0.10)*|momentum| // compress toward own goal
driftY   = clamp(0.10*(by−ay), ±0.08)                          // shade to ball lane, both teams
dot.pos  = (ax+driftX, ay+driftY)   // interpolated between ticks by elapsed
```

Deterministic, no rng at render. codex-ui has a working prototype validating all of this
at `docs/redesign/samples/match-pitch-2d.html`.

---

## 3. Goal attribution — scorer + assister (feeds morale)

Morale (CONTRACT §6): **scorer +2, assister +1, cap +3/player, next match only, no
negatives, runtime state on the manager — NOT in the DB.** Uses CONTRACT v0.4's existing
fields verbatim: **`playerId` = scorer (required on `goal`), `assistPlayerId` = assister.**

### 3.1 Selection rule (engine, deterministic)

Per goal, from the scoring team's fielded XI, seeded rng:
- **scorer** (`playerId`): weighted pick, weight `= effectiveRating × attackAffinity`
  (ST/W/CAM favored; a defender can score but rarely).
- **assister** (`assistPlayerId`): weighted pick over the rest (mid/att favored), ≠ scorer;
  with `P_SOLO` (default **0.18**) unassisted → `assistPlayerId` omitted.

Runs in **both** cores (§5) → attribution identical watched or headless. (Already the
CONTRACT v0.4 shape — no `TimelineEvent`/`MatchResultV2` change needed here.)

---

## 4. Shootout — every level match resolves

**Trigger:** regulation `finalScore.home === finalScore.away`. Engine runs a
deterministic seeded shootout; `finalScore` **stays the regulation draw**, the shootout
winner rides alongside.

### 4.1 `Shootout` (delta: v0.4 shape + `kicks[]`)

```ts
export interface Shootout {
  winner: Team;                 // never null — sudden death guarantees a decision
  home: number;                 // penalties scored (v0.4)
  away: number;                 // v0.4
  kicks: { team: Team; scored: boolean; playerId: string }[];  // ADD — ordered; sim animates + tallies
}
```

On `MatchResultV2.shootout?` and `MatchTimeline.shootout?` (both already typed `Shootout`
in v0.4; they inherit the `kicks[]` extension).

### 4.2 Kick order & conversion (engine, deterministic)

- **Order**: rng coin picks first shooter; standard alternating H,A,H,A for **5 rounds**;
  if level, **sudden death** one-each until decided.
- **Takers**: scoring team's XI by `attackAffinity × effectiveRating` desc (ties → slot
  index), wrapping in sudden death.
- **Conversion**: `P = clamp(0.75 + (taker−75)*0.010 − (gk−75)*0.008, 0.30, 0.95)` vs rng.

### 4.3 Timeline events (unchanged from CONTRACT v0.4 — kept as-is)

v0.4's four types stand; **no new event fields**. codex-ui drives the pip grid + tally
from `shootout.kicks`, so the events are only for the ticker caption:

```ts
// (already in CONTRACT v0.4 §4)
| 'shootout_start' | 'penalty_scored' | 'penalty_missed' | 'shootout_end'
```

Appended after `fulltime`, all `minute = durationMinutes` (90), in kick order; `playerId`
= taker on penalty events; `shootout_start` has `team:null`; `shootout_end` `team:winner`.

### 4.4 `MatchTimeline` (delta)

```ts
export interface MatchTimeline {
  /* …all v0.4 fields (ticks/events/finalScore/shootout?/boxScore)… */
  homeFormationId: string;   // ADD — dot placement, self-contained (codex-ui ASK 2)
  awayFormationId: string;   // ADD
}
```

### 4.5 Fixed-duration timing (MP-critical, sim-owned)

Regulation `MATCH_DURATION_MS = 45000` (0..90′). Shootout is a **fixed appended window
`SHOOTOUT_MS = 12000`**; sim paces however many kicks to FIT it → a watched match is
**45s (no SO) or 57s (SO), never variable**. Engine just emits ordered events; all
shootout playback timing is sim-owned. `ticks` still stop at 90 (pitch frozen during pens;
sim renders the shootout as its own sub-view). codex-ui reads the pip tally from
`shootout.kicks`.

### 4.6 Points (tournament — consumes `MatchResultV2`)

CONTRACT v0.4 `POINTS`: **reg win 3 / SO win 2 / SO loss 1 / reg loss 0.**
`!shootout` → winner +3, loser +0; else → `shootout.winner` +2, other +1. Lives in
`tournament.ts` (not my file); stated so the "no draws exist" invariant is unambiguous.

---

## 5. Determinism & the two cores

One core loop, two entry points, **one rng draw sequence** → scores agree:
- `resolveMatch(...) → MatchResultV2` (score-only; all ~48 matches/round; runs the same
  attribution + shootout → **headless winners & morale == a watched replay**).
- `simulateMatchTimeline(...) → MatchTimeline` (watched only; adds `ticks`, event `text`,
  shootout `kicks`).

QA gates: same inputs+seed ⇒ byte-identical on both paths; regulation score/winner agree
across paths; `Σ goal events(home) === finalScore.home`; every level `finalScore` has a
`shootout` with non-null `winner`; `ballPosition, ballLane ∈ [0,1]`; morale deltas = pure
function of the round's `MatchResultV2[]`.

---

## 6. Ratification checklist for worker-7 (CONTRACT §4)

Apply these to CONTRACT v0.4 §4 — everything else in v0.4 stands:

1. `TimelineTick`: **remove** `band`/`lane`, **add** `ballLane: number` (0..1). Keep the
   `Band`/`Lane` type aliases only if used elsewhere; otherwise drop.
2. `MatchTimeline`: **add** `homeFormationId: string`, `awayFormationId: string`.
3. `Shootout`: **add** `kicks: { team: Team; scored: boolean; playerId: string }[]`.
4. Record shared render constant `POSITION_ANCHOR` and `SHOOTOUT_MS = 12000` (sim-owned).
5. Note the hard dep: `FORMATIONS[id].slots` remains the source of truth for a formation's
   fielded positions (already true).

No change needed to: goal attribution (`playerId`/`assistPlayerId` already present),
shootout event enum, `POINTS`, morale consts, `MatchResultV2.goals[]`.
