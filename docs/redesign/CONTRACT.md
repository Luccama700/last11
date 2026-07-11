# CONTRACT.md — shared types for the Last11 redesign

Owner: worker-7 (integrator). Status: **v0.2 (2026-07-11)** — reconciled against
`PLAN-draft.md` (bug-hunt) and `PLAN-qa.md` (test-hardening). Awaiting
`PLAN-database`, `PLAN-engine`, `PLAN-sim`. Every block below marks whether the
SHAPE is frozen (mine to own) or whether VALUES/extra fields are still owned by
another workstream. When a peer plan lands I reconcile here and bump the version.

> **v0.2 reconciliation summary:** canonicalized the affinity signature to
> `affinity(natural, slot)` / `matrix[natural][slot]` (draft wrote the args
> flipped — resolved here); declared the matrix **asymmetric-allowed** (answers
> QA's open symmetry question); added `year` to `PlayerV2` (draft wants
> self-describing players for the steal pool); added draft `mode` +
> `respinTokens` to the game-state deltas; froze the sparse-XI-during-draft /
> dense-after-draft invariant.

> How to read this file: this is the single source of truth for the *shapes* the
> four streams build against. If your plan needs a shared type, it must match a
> block here or add an `ASSUMPTION:` note that I fold in. Do not silently invent a
> conflicting shape — that is exactly the integration bug this file exists to
> prevent.

Legend: 🔒 shape frozen by me · 🎛️ values owned by engine · 🗄️ shape aligns with
database · 🎬 shape aligns with sim · ⏳ awaiting a peer plan to confirm.

---

## 1. Position & affinity (🔒 shape / 🎛️ values)

The 12 detailed positions replace the 4 coarse ones (`GK|DF|MF|FW`).

```ts
// The vocabulary. A formation selects 11 of these (with repeats); a player has
// one PRIMARY position (optionally secondaries). Ordering is deliberate:
// goal → back line (R→L) → pivots → line (R→L) → wings → striker. Keep this
// order; the tactics-board pitch layout and any bucketed UI depend on it.
export type Position =
  | 'GK'
  | 'RB' | 'CB' | 'LB'
  | 'CDM' | 'CM' | 'CAM'
  | 'RM' | 'LM'
  | 'LW' | 'RW'
  | 'ST';

export const POSITIONS: readonly Position[] = [
  'GK', 'RB', 'CB', 'LB', 'CDM', 'CM', 'CAM', 'RM', 'LM', 'LW', 'RW', 'ST',
];
```

### Position affinity matrix

Replaces the flat `OFF_POSITION_MULT = 0.75`. `matrix[natural][slot]` is the
fraction of a player's rating retained when his PRIMARY position `natural` is
played in formation `slot`. Diagonal is `1.0`. A CM in CDM/CAM should keep most
of it; a ST at GK almost none.

**CANONICAL SIGNATURE (resolves a cross-plan disagreement):** the accessor is
`affinity(natural, slot)` — natural position FIRST, slot SECOND — matching the
matrix index order `matrix[natural][slot]`. `PLAN-draft.md §6` wrote it flipped
as `affinity(slot, natural)`; **this order wins**, draft adopts it. (It also
matches the mental model "how well does THIS PLAYER play THAT slot".)

```ts
export type Affinity = number; // 0..1 inclusive

// Full 12×12. Row = player's natural position, Col = slot he is placed in.
export type AffinityMatrix = Readonly<Record<Position, Readonly<Record<Position, Affinity>>>>;

/** Canonical accessor. natural = player's primary position; slot = formation slot. */
export type AffinityFn = (natural: Position, slot: Position) => Affinity;

export interface AffinityConfig {
  matrix: AffinityMatrix;
  /** Values below this make a slot "incompatible" for draft-UI gating (see draft plan).
   *  This is ALSO the lever for the 7a0-strict eligibility model (draft §5 Q1): set
   *  it high and the draft only offers natural/secondary slots; keep it low and any
   *  slot is placeable at a penalty (never dead-ends the BR). Lucca's Q1 answer picks. */
  compatibleThreshold: Affinity; // ASSUMPTION: 0.6 — draft plan may retune
}
```

- **Shape owner:** me. It is a full 12×12 lookup. **Symmetry is NOT guaranteed**
  — `affinity('CM','CDM')` may differ from `affinity('CDM','CM')` (a CM dropping
  to CDM plausibly loses less than a CDM pushing to CM). This answers QA's open
  question: **write bounds+diagonal tests unconditionally; do NOT assert
  symmetry.** Engine may still author a symmetric matrix; the contract just
  doesn't require it.
- **Values owner:** engine plan (`PLAN-engine.md`) fills every cell + the
  threshold. I ship a shape + a placeholder identity/diagonal matrix so the type
  compiles before values land.
- **Consumers (mine to wire):**
  - Draft UI `pickValue()` — an off-slot pick is worth `rating × affinity[nat][slot] + chem + star`.
  - Engine zonal strength — `effectiveRating(slot, player) = rating × affinity[player.position][slot]`.
  - QA invariant: all cells in `[0,1]`, diagonal `== 1` (see `PLAN-qa.md`).

---

## 2. PlayerV2 & Squad (🗄️ aligns database)

```ts
export interface PlayerV2 {
  /** Globally unique across (nation, year). Scheme: `${nation}-${year}-${slug}`,
   *  e.g. 'bra-2002-ronaldo'. The SAME real person in two tournaments is two
   *  entries with two ids and two ratings — this preserves the genre-norm that a
   *  player rolled from two different teams is separately draftable. */
  id: string;
  name: string;
  nation: string;          // 3-letter code, e.g. 'BRA'
  year: number;            // World Cup year — makes a player self-describing once
                           // flattened out of its Squad into the steal pool
                           // (draft §6 wants this; db plan owns the value). Redundant
                           // with the id scheme + Squad.year, kept for convenience.
  position: Position;      // primary, detailed
  secondary?: Position[];  // ASSUMPTION: v2 supports 0..2 secondaries; database plan confirms
  /** Rating of this player AT this tournament (Messi 2014 ≠ Messi 2026). ~40..99. */
  rating: number;
}

/** A squad keyed by (nation, year). Full squad (not just a fielded XI) so the
 *  steal pool v2 can loot the whole roster of eliminated teams. */
export interface Squad {
  nation: string;          // code
  year: number;            // World Cup year, e.g. 2002
  name: string;            // display, e.g. 'Brazil 2002'
  players: PlayerV2[];     // ASSUMPTION: 14..18 per squad; database plan sets the target
}

/** Stable string key for maps/sets. */
export type SquadKey = `${string}-${number}`; // `${nationCode}-${year}`
export const squadKey = (nation: string, year: number): SquadKey => `${nation}-${year}`;
```

- **Owner:** database plan owns squad sizes, the rating rubric, and which
  nation-years exist. I own only that `PlayerV2.rating` is per-tournament and
  the id scheme guarantees global uniqueness.
- **Back-compat:** the current `Player` (`GK|DF|MF|FW`, flat rating, `bra-alisson`
  ids) is adapted forward, not deleted, until data v2 lands (see sequencing §7).

---

## 3. Roll, Formation, Tactics (🔒 shape / 🎛️ levers / ⏳ draft+engine)

```ts
/** One spin result: a nation AND a World Cup year (the "year roll"). */
export interface RolledTeam {
  nation: string; // code
  year: number;
}

/** A formation is an ordered list of 11 slots drawn from the 12 positions.
 *  Draft §6 proposed `{name, slots}`; I keep an explicit `id` for stable keys/
 *  flags — `id === name` is fine (both are '4-3-3'), so draft's shape is a subset. */
export interface Formation {
  id: string;         // '4-3-3', '4-2-3-1', ... (may equal `name`)
  name: string;       // display
  slots: Position[];  // length 11, repeats allowed, GK first by convention
}

export type PlayingStyle = 'defensive' | 'balanced' | 'attacking';

/** The tactical config a manager takes into a match. `formationId` + `style` are
 *  frozen; the extra levers are RESERVED here so the engine plan can populate
 *  them without a contract break. Engine plan finalizes which levers exist and
 *  their enums — until then they are optional and default to the middle value. */
export interface Tactics {
  formationId: string;
  style: PlayingStyle;
  // 🎛️ RESERVED for engine plan (ASSUMPTION — likely subset of these):
  pressing?: 'low' | 'mid' | 'high';
  lineHeight?: 'deep' | 'mid' | 'high';
  tempo?: 'patient' | 'balanced' | 'direct'; // possession ↔ counter
  markKeyPlayer?: boolean;                    // man-mark opponent's best
}

/** The 8 formations from the draft brief (7a0's set). `slots` here is my
 *  proposed canonical mapping; draft+engine reconcile exact slot labels. */
export const FORMATIONS: readonly Formation[] = [
  { id: '4-3-3',   name: '4-3-3',   slots: ['GK','RB','CB','CB','LB','CDM','CM','CM','RW','ST','LW'] },
  { id: '4-4-2',   name: '4-4-2',   slots: ['GK','RB','CB','CB','LB','RM','CM','CM','LM','ST','ST'] },
  { id: '4-2-3-1', name: '4-2-3-1', slots: ['GK','RB','CB','CB','LB','CDM','CDM','CAM','RW','LW','ST'] },
  { id: '4-2-4',   name: '4-2-4',   slots: ['GK','RB','CB','CB','LB','CM','CM','RW','LW','ST','ST'] },
  { id: '3-5-2',   name: '3-5-2',   slots: ['GK','CB','CB','CB','RM','CDM','CM','CAM','LM','ST','ST'] },
  { id: '5-3-2',   name: '5-3-2',   slots: ['GK','RB','CB','CB','CB','LB','CM','CM','CM','ST','ST'] },
  { id: '4-5-1',   name: '4-5-1',   slots: ['GK','RB','CB','CB','LB','RM','CM','CM','CM','LM','ST'] },
  { id: '3-4-3',   name: '3-4-3',   slots: ['GK','CB','CB','CB','RM','CM','CM','LM','RW','ST','LW'] },
];
```

- **Owner split:** draft plan owns formation-picker UX + whether formation is
  locked at kickoff; engine plan owns which extra levers exist and how they move
  results. My contract: `Tactics` always carries `formationId + style`, extra
  levers are optional and additive (never break older `Tactics` objects).

---

## 4. Match timeline (🔒 shape / 🎬 sim consumes / 🎛️ engine produces)

The engine's output for a WATCHED match. Deterministic given `(homeXI, awayXI,
homeTactics, awayTactics, seed)`. Headless BR rounds do NOT need the full
timeline — see the lazy-generation note.

```ts
export type Team = 'home' | 'away';

/** Per-virtual-minute sample driving the momentum/field-position meter.
 *  `ballPosition` 0..1: 0 = deep in HOME's half (home defending), 1 = HOME
 *  attacking / in AWAY's box. `possession` = who has the ball this minute. */
export interface TimelineTick {
  minute: number;          // 0..durationMinutes
  ballPosition: number;    // 0..1 (see above)
  possession: Team;
}

export type TimelineEventType =
  | 'kickoff' | 'halftime' | 'fulltime'
  | 'chance' | 'shot' | 'save' | 'goal'
  | 'card';                // ASSUMPTION: cards optional; engine plan confirms

/** A discrete moment for the ticker + goal animations. */
export interface TimelineEvent {
  minute: number;
  type: TimelineEventType;
  team: Team;
  playerId?: string;       // scorer/keeper when known
  text?: string;           // pre-rendered caption ("SAVED!"), sim may restyle
}

export interface MatchTimeline {
  matchId: string;
  homeId: string;
  awayId: string;
  seed: number;
  durationMinutes: number;               // virtual minutes, ASSUMPTION 90
  ticks: TimelineTick[];                 // one per virtual minute (length = duration+1)
  events: TimelineEvent[];               // minute-sorted
  finalScore: { home: number; away: number };
}
```

**Invariants (locked as QA tests):**
- `events.filter(e => e.type === 'goal' && e.team === 'home').length === finalScore.home` (and away).
- `ticks` minutes are contiguous `0..durationMinutes`; every `ballPosition ∈ [0,1]`.
- Same seed+inputs ⇒ byte-identical timeline (determinism).

**Lazy generation:** the engine exposes two entry points so headless BR stays
fast — `resolveMatch(...) → MatchScore` (score only, used for 32×3 pairings)
and `simulateMatchTimeline(...) → MatchTimeline` (full timeline, called ONLY for
watched matches). `resolveMatch` and the score field of `simulateMatchTimeline`
MUST agree for the same seed (a QA invariant). Engine plan owns how.

---

## 5. Playback contract (🎬 sim owns, multiplayer-critical)

Playback is a **pure function of `(timeline, elapsedMs)`** — no local randomness,
no per-frame engine calls. This is the hinge the multiplayer memo swings on.

```ts
export interface PlaybackState {
  virtualMinute: number;                 // derived from elapsedMs & duration
  score: { home: number; away: number }; // goals with minute <= virtualMinute
  ballPosition: number;                  // interpolated between ticks
  possession: Team;
  activeEvent: TimelineEvent | null;     // event firing at ~this moment (for captions)
}

export type RenderPlayback = (timeline: MatchTimeline, elapsedMs: number) => PlaybackState;
```

- Fixed wall-clock duration per match (ASSUMPTION 45s ≙ 90 virtual min; sim plan
  sets it). `elapsedMs → virtualMinute` is a pure linear map.
- Headless/tests pass `elapsedMs = ∞` (or duration) to get the final frame
  instantly — preserves the `animate={false}` synchronous path.

---

## 6. Game state deltas (🔒 shape / reconcile with draft + sim)

Additions to `src/game/state.ts`. Current shape kept where unchanged.

```ts
// Screens: +'setup' (formation/style before draft). Battle gains a playback view.
export type Screen = 'home' | 'setup' | 'draft' | 'battle' | 'steal' | 'end';
export type BattleView = 'intro' | 'playback' | 'results';

export interface ManagerV2 {
  id: string;
  name: string;
  isHuman: boolean;
  tactics: Tactics;
  xi: XiSlotV2[];              // fielded 11 (see below)
  rolledTeams: RolledTeam[];  // every (nation,year) this manager rolled — feeds steal pool v2
  alive: boolean;
}

export interface XiSlotV2 {
  position: Position;         // the formation slot this fills
  player: PlayerV2;
}

// Draft state changes: spin yields a ROLL (nation+year), not a bare nation, and
// free placement means slots fill out of order. Track filled slots explicitly
// instead of a single advancing index (drop `draftSlotIndex`).
export type DraftMode = 'classic' | 'memory'; // Memory = ratings hidden (7a0 Almanaque)

export interface DraftStateDelta {
  formation: Formation;                 // chosen pre-draft (setup phase)
  mode: DraftMode;                      // Classic vs Memory (draft §2b)
  respinTokens: number;                 // remaining re-spins (draft §2c, ASSUMPTION 3)
  spunRoll: RolledTeam | null;          // was `spunNation: string | null`
  // XI during draft is a fixed-length slate; null = open slot.
  humanSlate: (XiSlotV2 | null)[];      // length = formation.slots.length; indexed by slot
}

// INVARIANT (frozen): a Manager's `xi` is SPARSE — `(XiSlotV2|null)[]` — ONLY
// during the draft phase. Entering 'battle' requires a COMPLETE XI (no nulls);
// teamStrength / match / steal only ever see a dense 11. This keeps every
// engine consumer on a dense array while letting the draft fill slots in any
// order. The reducer's draft-complete check = `humanSlate.every(s => s !== null)`
// (replaces `draftSlotIndex >= FORMATION.length`).

// Playback state during battle:
export interface BattleStateDelta {
  currentTimeline: MatchTimeline | null; // the human's watched match; null when summarized
}
```

**Steal pool v2 (🗄️+🔒):** loot = full `Squad` rosters of every `rolledTeam`
belonging to eliminated managers, deduped by `PlayerV2.id`, minus players already
on the stealing XI. Signature stays `stealPool(eliminated: ManagerV2[]): PlayerV2[]`
but its BODY now expands `rolledTeams → squads → players` instead of reading only
fielded XIs.

**Reducer actions (renames/additions, draft plan finalizes):**
`SPIN {nation}` → `SPIN {roll: RolledTeam}`; `PICK {player}` →
`PICK {player, slotIndex}`; new `SET_FORMATION {formation}`, `SET_MODE {mode}`,
`SET_TACTICS {tactics}` (style + levers), `RESPIN` (burns a token, re-rolls);
new `PLAY_MATCH {timeline}` (enter playback) → existing `ROUND_PLAYED` (reveal
table after playback). `PICK` no longer advances a single `draftSlotIndex`; it
fills `humanSlate[slotIndex]`.

---

## 7. Migration adapter (back-compat, 🔒)

Keeps `main` playable while data/engine v2 land behind flags.

```ts
// Coarse→detailed representative mapping for the CURRENT 4-position data, so the
// old squads.json still drafts into a 12-position formation until data v2 ships.
export const COARSE_TO_DETAILED: Record<'GK'|'DF'|'MF'|'FW', Position> = {
  GK: 'GK', DF: 'CB', MF: 'CM', FW: 'ST',
};
```

- Old `Player` → `PlayerV2` via `{ ...p, position: COARSE_TO_DETAILED[p.pos],
  id: 'legacy-' + p.id }` behind a `dataV2` flag.
- Placeholder `AffinityMatrix` = diagonal 1.0 + `0.75` off-diagonal reproduces
  today's flat behavior exactly, so engine v1 and v2 agree until real values land.
- `Tactics` default = `{ formationId: '4-3-3', style: 'balanced' }` reproduces the
  current fixed 4-3-3.

---

## Open contract questions (for Lucca / peers)

1. **Squad size** for the steal pool: full 23-man roster or trimmed 16-18? (db plan)
2. **Secondary positions** on `PlayerV2`: support in v2, or primary-only for the
   hackathon? (db plan — affects affinity vs secondary lookups)
3. **Formation locked at kickoff**, or re-choosable between rounds on the tactics
   board? (draft plan — changes whether `Tactics` is per-round state)
4. **Which extra tactical levers** are real for Tier A vs Tier B (pressing / line
   height / tempo / man-mark)? (engine plan — I reserved all four)
5. **Virtual match duration** and wall-clock (90 min ≙ ?s). (sim plan)
6. **Cards** in the timeline: in scope or cut? (engine + sim)
7. **Steal-pool v2 mechanics** (flagged by BOTH draft §5 Q10 and QA): does a
   stolen player REPLACE a fielded starter (keeps `xi` a dense 11 — my default)
   or EXPAND a bench the UI then manages (adds a `bench` field to `ManagerV2`,
   a bigger shape change)? **Contract default = replace-a-starter** until Lucca
   says otherwise; noted here because it's the one steal decision that changes a
   shared type.
8. **Off-position model** (draft §5 Q1): affinity-with-penalty (any slot
   placeable, my `compatibleThreshold` low) vs 7a0-strict eligibility
   (`compatibleThreshold` high). The SHAPE supports both; Lucca's answer only
   sets the threshold value — no contract change either way.

_Reconciliation log:_
- **v0.1** — authored pre-peer-plans from the six briefs + engine source.
- **v0.2** — folded in PLAN-draft (affinity arg order flipped to canonical;
  `year` on player; `mode`/`respinTokens`; sparse-XI invariant; formation shape;
  off-position via threshold) and PLAN-qa (affinity declared asymmetric-allowed
  → bounds+diagonal tests only; steal-pool mechanics surfaced as Q7). **Note:**
  `samples/brazil-2002.json` and `samples/match-playback.html` have landed but
  `PLAN-database.md` / `PLAN-sim.md` have NOT — those samples are provisional.
- **Next:** fold in PLAN-database (squad size, id scheme, secondaries, rating
  bounds) and PLAN-engine (affinity VALUES, which `Tactics` levers, timeline
  producer details) and PLAN-sim (match duration → `MatchTimeline.durationMinutes`
  + the wall-clock constant).
