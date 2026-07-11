# CONTRACT.md — shared types for the Last11 redesign

Owner: **architect** (integrator). Status: **v0.4 (2026-07-11) — PHASE I / BINDING.**
Folds `DECISIONS.md` (Lucca's rulings) over the six reconciled plans. This is the
shape the Phase-I skeleton in `src/engine/types.ts` + `src/game/state.ts` is built
against. Each block marks whether the SHAPE is frozen (mine) or whether VALUES/extra
fields are owned by another workstream.

> **Fleet roles (renamed 2026-07-11).** architect (was worker-7, integrator/CONTRACT) ·
> game-engine (was hackathon-builder, match/affinity/timeline) · match-sim (was
> codex-ui, playback UI) · players (was worker-6, data v2 in `src/engine/data/`) ·
> QA (was test-hardening, balance/tests) · draft-page (was bug-hunt, draft UX) ·
> Main (orchestrator). "Owner" tags throughout this file use the new names.

### v0.4 changes (from DECISIONS.md — supersede plan text)

- **Chemistry DELETED.** Remove the same-nation pair bonus and the cohesion reframe
  entirely. `Tactics` never carried it; §2's chem flag is now resolved = removed.
- **Morale (new)** replaces chemistry: a per-player, per-match transient rating buff,
  **runtime state on the manager**, NOT in the player DB. Added to `ManagerV2` (§6).
  Goal events must attribute a **scorer + assister** to feed it (§4).
- **No draws — every level match goes to a deterministic penalty shootout.** New
  timeline shootout events + `MatchResultV2.shootout` (§4). Points **W3 / PW2 / PL1 /
  L0** (regulation win / shootout win / shootout loss / regulation loss) — `POINTS` (§4).
- **2D pitch:** each `TimelineTick` gains discrete **`band` × `lane`** (engine's zone
  output) alongside the continuous `ballPosition`/`momentum` (§4). Proposed spec —
  engine + sim confirm final field names per the "let them talk" directive.
- **More-forgiving affinity** (§1): same-zone ≥ .85, adjacent-zone ≥ .60, worst case
  floor .25–.30, all cells strictly > 0. Engine retunes the §3.2 matrix in this spirit.
- **Bots run varied (seeded) formations + styles**; **no stamina, ever**; star bonus
  kept (attack-zone shot quality).
- **Between-match rearrange:** re-slot players + style change between matches (reuses
  the draft board); formation change only between rounds. Reducer skeleton includes
  the action (§6).

> This is the single source of truth for the *shapes* the four build-streams
> compile against. If your plan needs a shared type, it matches a block here.
> Where two plans disagreed, the resolution is called out **loudly** inline —
> those are the integration bugs this file exists to kill before code.

Legend: 🔒 shape frozen by me · 🎛️ values owned by engine · 🗄️ shape aligns with
database · 🎬 shape aligns with sim.

### v0.3 reconciliation summary (the seven conflicts the orchestrator flagged)

1. **Affinity table was authored TRANSPOSED** — engine §3.2 is `affinity[slot][natural]`,
   canonical is `matrix[natural][slot]`. Since the matrix is asymmetric this changes
   values. **Transcription rule + flipped examples in §1.** ⚠️
2. **Formation-set mismatch** — engine listed `4-2-2-2` and dropped `4-2-4`; canonical
   is the **draft/7a0 set (keeps `4-2-4`, no `4-2-2-2`)**. Engine: swap it. §3.
3. **Timeline field set ratified** — `TimelineTick` carries BOTH `ballPosition` (0..1)
   and `momentum` (−1..+1); `MatchTimeline` gains `boxScore`; events get nullable `team`,
   required `text`, `scoreAfter` required-on-goal, and a `'counter'` type. §4.
4. **Rail goal stamps** — `MatchResult.goals:{minute,team}[]`, engine-produced in the
   shared score core (NOT UI-fabricated). §4.
5. **Affinity cells strictly > 0** locked as an invariant (engine floor .20 → free). §1.
6. **Chemistry is structurally broken by the new draft** — flagged as a DESIGN DECISION
   for Lucca (Q9), not decided here. §2 note + open questions.
7. **Tier-A demo contract** published — see `PLAN-architecture.md` (new section).

Also: `PlayerV2` field-name reconciliation (raw `pos`/`altPos` → in-memory
`position`/`secondary`; loader denormalizes `nation`/`year`); `Squad` → `SquadEntry`;
`rolledTeams` → `rolledSquads`.

---

## 1. Position & affinity (🔒 shape / 🎛️ values)

```ts
// 12 detailed positions. Order is deliberate (goal → back line R→L → pivots →
// wide mids → wingers → striker); UI layout + bucketing depend on it.
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

// Coarse zone rollup (database §2). Used by the back-compat adapter, the engine's
// zonal sums, and the box score. Every detailed position maps to exactly one zone.
export type Zone = 'GK' | 'DEF' | 'MID' | 'ATT';
export const POSITION_ZONE: Readonly<Record<Position, Zone>> = {
  GK: 'GK',
  RB: 'DEF', CB: 'DEF', LB: 'DEF',
  CDM: 'MID', CM: 'MID', CAM: 'MID', RM: 'MID', LM: 'MID',
  LW: 'ATT', RW: 'ATT', ST: 'ATT',
};
```

### Position affinity matrix

`matrix[natural][slot]` (equivalently the accessor `affinity(natural, slot)`) is
the fraction of a player's rating retained when his PRIMARY position `natural` is
played in formation `slot`. Replaces the flat `OFF_POSITION_MULT = 0.75`.

```ts
export type Affinity = number; // (0, 1]  — see invariants
export type AffinityMatrix = Readonly<Record<Position, Readonly<Record<Position, Affinity>>>>;
export type AffinityFn = (natural: Position, slot: Position) => Affinity; // natural FIRST

export interface AffinityConfig {
  matrix: AffinityMatrix;
  /** Below this a slot is "incompatible" for draft-UI gating (draft §2c). Also the
   *  lever for 7a0-strict eligibility (draft Q1): high = only natural/secondary slots
   *  offered; low = any slot placeable at a penalty (never dead-ends the BR). */
  compatibleThreshold: Affinity; // ASSUMPTION 0.6 — draft may retune
}
```

**INVARIANTS (locked as QA tests — QA §Job-2, conflict 5):**
- **Every cell strictly > 0**: `0 < matrix[a][b] ≤ 1`. A zero could dead-end the
  draft or zero out a zone. Engine's proposed floor is `.20`, so this is free.
- **Diagonal == 1.0**: `matrix[p][p] === 1` for all p.
- **Symmetry NOT required** (and NOT asserted): `matrix['CM']['CDM']` may differ
  from `matrix['CDM']['CM']`. QA tests bounds + diagonal only.

**DECISIONS posture (more forgiving than engine §3.2):** same-zone moves ≥ **.85**,
adjacent-zone ≥ **.60**, worst case (e.g. GK↔outfield) floor **.25–.30**; all cells
strictly > 0. The engine retunes the full matrix in this spirit (the values stay
engine-owned; this is the target posture, not the table). The transposition rule
above still applies when transcribing whatever table the engine ships.

**⚠️ TRANSPOSITION — read before transcribing engine §3.2 values.** The engine's
table is authored as `affinity[slot][natural]` (its header reads "Slot ↓ / plays →",
rows = slot, cols = the player's natural position). Canonical here is the FLIP:

```
matrix[natural][slot]  =  engineTable[slot][natural]
```

Because the matrix is asymmetric, transcribing without flipping corrupts values.
Worked examples (engine numbers, restated in canonical orientation):
- Engine row `CB`, col `FB` = **.80** → a natural **full-back played at CB** →
  `matrix['RB']['CB'] = matrix['LB']['CB'] = .80`.
- Engine row `FB`, col `CB` = **.75** → a natural **CB played at full-back** →
  `matrix['CB']['RB'] = matrix['CB']['LB'] = .75`.
- Engine row `ST`, col `CAM` = **.80** → a natural **CAM played at ST** →
  `matrix['CAM']['ST'] = .80`.

**Family-level authoring + L/R expansion (🔒).** The engine authored a 9×9
*family* table (GK, CB, FB, CDM, CM, CAM, WM, W, ST), assuming L/R symmetry. Expand
to the full 12×12 by the family map — `RB,LB → FB`; `RM,LM → WM`; `LW,RW → W`; the
rest map to themselves — applied to BOTH indices. So `matrix[RB][CB] = matrix[LB][CB]
= familyTable[CB-slot][FB-natural]`. This keeps the 12×12 well-defined from the
9×9 source and is where the transposition flip is applied once, at build time.

**Consumers (mine to wire, single source of truth):** draft `pickValue`, engine
`effectiveRating(slot, player) = rating × matrix[player.position][slot]`, engine
zonal strength. Draft bots MUST read this same matrix (engine §7) or they draft
against a different model than the engine rewards.

---

## 2. PlayerV2 & SquadEntry (🗄️ database owns; reconciled)

**Two shapes, bridged by the loader (extends today's `RawPlayer`→`Player` pattern
in `data.ts`).** The raw JSON is lean; the in-memory type is denormalized and is
what every engine/draft/sim consumer sees.

```ts
// ---- RAW (on disk, database owns; see samples/brazil-2002.json) ----
interface RawPlayerV2 {
  id: string;            // `${nationLower}-${year}-${slug}`, e.g. 'bra-2002-ronaldo'
  name: string;
  pos: Position;         // primary, detailed  (NOTE: field is `pos` on disk)
  altPos?: Position[];   // 0..2 secondaries, treated as natural (affinity 1.0)
  rating: number;        // 1..99, per-tournament snapshot
  fullName?: string; club?: string; shirt?: number; // Tier B flavor
}
interface RawSquadEntry {
  nation: string; name: string; year: number;   // (nation, year) lives HERE, once
  players: RawPlayerV2[];                        // 16..23 (target 16-18)
  result?: string; notes?: string;
}
interface SquadsFileV2 { version: 2; squads: RawSquadEntry[]; }

// ---- IN-MEMORY (what consumers use; loader produces this) ----
export interface PlayerV2 {
  id: string;
  name: string;
  nation: string;        // DENORMALIZED from the squad by the loader
  year: number;          // DENORMALIZED — makes the steal pool self-describing
  position: Position;    // renamed from raw `pos`
  secondary?: Position[]; // renamed from raw `altPos`; treated as affinity 1.0
  rating: number;
  fullName?: string; club?: string; shirt?: number;
}
export interface SquadEntry {   // in-memory; players carry nation/year
  nation: string; name: string; year: number;
  players: PlayerV2[];
  result?: string; notes?: string;
}
export type SquadKey = `${string}-${number}`;      // `${nationCode}-${year}`
export const squadKey = (nation: string, year: number): SquadKey => `${nation}-${year}`;
```

**Why nation/year are denormalized onto the player (reconciliation):** the engine's
chemistry reads `player.nation` (today's `teamStrength` already does), and the steal
pool flattens squads into a bare `PlayerV2[]` — both need the player self-describing.
Database's raw type keeps them on the squad (correct for storage); the loader stamps
them down, exactly as `data.ts` already stamps `nation: nation.code` today. Field
renames `pos→position`, `altPos→secondary` also happen in the loader.

**ID scheme (database §2):** `${nationLower}-${year}-${slug}`, unique across
(nation, year) by construction. The SAME real player in two tournaments = two ids,
two ratings, separately draftable (genre norm, preserved).

**✅ Chemistry RESOLVED (was conflict 6): DELETED.** Lucca ruled chemistry out
entirely — no same-nation pair bonus, no cohesion multiplier. It is replaced by
**morale** (a runtime buff on the manager, §6), NOT a player-DB or nation property.
`nation`/`year` stay on `PlayerV2` for the id scheme, steal-pool display, and roll
grouping, but nothing computes chemistry from them anymore.

---

## 3. Roll, Formation, Tactics (🔒 shape / 🎛️ levers)

```ts
/** One spin result AND one entry in a manager's rolled set. Type name `RolledTeam`;
 *  database calls the same thing `SquadRef` — alias, identical fields. */
export interface RolledTeam { nation: string; year: number; }
export type SquadRef = RolledTeam;

export interface Formation {
  id: string;         // '4-3-3' (may equal name)
  name: string;
  slots: Position[];  // length 11, GK first, repeats allowed
}

export type PlayingStyle = 'defensive' | 'balanced' | 'attacking';

export interface Tactics {
  formationId: string;
  style: PlayingStyle;
  // 🎛️ engine-owned levers (§3.3). Optional + additive so older Tactics never break.
  // Engine ships Line height in Tier A (rec); pressing/tempo/man-mark are Tier B.
  lineHeight?: 'deep' | 'mid' | 'high';
  pressing?: 'low' | 'mid' | 'high';
  tempo?: 'possession' | 'balanced' | 'direct';
  markKeyPlayer?: string; // opponent playerId (Tier B)
}
```

**⚠️ CANONICAL FORMATION SET (conflict 2) — the draft/7a0 eight:**

```ts
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

**Engine §3.3 must change to match:** it listed `4-2-2-2` and omitted `4-2-4`.
Canonical drops `4-2-2-2`, keeps `4-2-4` (7a0's actual set, per draft §1a). Engine's
zone-weight map should be authored for THESE eight.

---

## 4. Match timeline (🔒 shape / 🎬 sim consumes / 🎛️ engine produces)

Engine output for a WATCHED match. Deterministic given `(homeXI, awayXI, homeTactics,
awayTactics, seed)`. Headless BR rounds use the score-only path (§ MatchResult).

```ts
export type Team = 'home' | 'away'; // per-MATCH roles, not the human. UI maps "you" on.

/** Per-virtual-minute sample. RATIFIED from TICKSPEC.md v0.2 (engine+sim co-signed).
 *  2D pitch = two CONTINUOUS coords: `ballPosition` (length) + `ballLane` (width).
 *  NO discrete band/lane on the tick — the sim buckets `ballPosition` into a band
 *  itself and reads `ballLane` for the lateral marker; the engine bins internally
 *  (5 bands × 3 lanes) then emits center+jitter. 22 dots drift as a pure function of
 *  (ballPosition, ballLane, possession) + both formations (below). */
export interface TimelineTick {
  minute: number;          // 0..durationMinutes
  ballPosition: number;    // 0..1  longitudinal — 0 = home goal line, 1 = away goal line
  ballLane: number;        // 0..1  lateral — 0 = home-left touchline (attacking frame) … 1 = right
  momentum: number;        // -1..+1 — smoothed pressure, + toward home
  possession: Team;
}

export type TimelineEventType =
  | 'kickoff' | 'halftime' | 'fulltime'
  | 'chance' | 'shot' | 'save' | 'goal' | 'counter'
  | 'card'                             // card = Tier B
  | 'shootout_start' | 'penalty_scored' | 'penalty_missed' | 'shootout_end';

export interface TimelineEvent {
  minute: number;
  type: TimelineEventType;
  team: Team | null;       // null for neutral events (kickoff/halftime/fulltime/shootout_start)
  text: string;            // engine-authored ticker caption, rendered verbatim
  scoreAfter?: { home: number; away: number }; // REQUIRED on type==='goal'
  playerId?: string;       // scorer on 'goal' (REQUIRED — feeds morale); taker on penalty_* ; keeper on 'save'
  assistPlayerId?: string; // assister on 'goal' (omitted = unassisted — feeds morale)
}

/** 7a0-style "deserved" box score (engine §3.1 / §4). */
export interface ZoneBox { gk: number; def: number; mid: number; att: number; overall: number; }

/** Present iff regulation ended level AND shootouts were enabled for the round
 *  (≤16 alive; NIGHT-SHIFT rule). A level match with shootouts OFF (>16 alive) is a
 *  genuine draw and carries no Shootout. RATIFIED from TICKSPEC.md v0.3: v0.4's
 *  {winner,home,away} + a `kicks[]` array. Sudden death guarantees a non-null winner. */
export interface Shootout {
  winner: Team;                              // never null
  home: number;                              // penalties scored
  away: number;
  kicks: { team: Team; scored: boolean; playerId: string }[]; // ordered; sim animates + tallies
}

export interface MatchTimeline {
  matchId: string;
  homeId: string; awayId: string;
  seed: number;
  durationMinutes: number;               // virtual minutes; ASSUMPTION 90
  ticks: TimelineTick[];                 // length = durationMinutes + 1, minutes 0..N (stop at 90; pens are events)
  events: TimelineEvent[];               // minute-sorted; shootout_* appended at minute==90
  finalScore: { home: number; away: number };  // REGULATION goals (may be level)
  shootout?: Shootout;                   // present iff finalScore is level
  homeFormationId: string;               // self-contained for pure(timeline,elapsed) dot placement
  awayFormationId: string;
  boxScore: { home: ZoneBox; away: ZoneBox; xg: { home: number; away: number } };
}
```

**Points + the ≤16 shootout rule (NIGHT-SHIFT amendment to "no draws").** Shootouts
fire ONLY in rounds with **≤16 managers alive** (`SHOOTOUT_ALIVE_MAX = 16`,
`shootoutEnabledForRound(aliveCount)` — both exported from `tournament.ts`). In the
bigger early rounds a level match is a **genuine draw (D1)**; from the round of 16 on,
a level match goes to penalties (PW2 / PL1). Points are therefore conditional:

```ts
export const POINTS = {
  REG_WIN: 3,       // won in regulation
  SHOOTOUT_WIN: 2,  // level in regulation, won on penalties (≤16 alive)
  SHOOTOUT_LOSS: 1, // level in regulation, lost on penalties
  REG_LOSS: 0,      // lost in regulation
  DRAW: 1,          // level, shootouts OFF (>16 alive) — a classic draw point
} as const;
```

**Classify via `matchVerdict`, NEVER by goals.** The canonical classifier lives in
`match.ts` and is the ONE source every consumer (tournament points, table, sim) reads —
so a shootout is never mis-scored as a draw and a >16 draw never mis-scored as a loss:

```ts
export type DecidedBy = 'regulation' | 'pens' | 'draw';
export function matchVerdict(r: MatchResultV2):
  { winner: Team | null; decidedBy: DecidedBy; homePoints: number; awayPoints: number };
```

Table tiebreakers (gd → gf → strength → id) are unchanged; regulation goals feed gf/gd.

**Range reconciliation (conflict 3):** engine emits `ballPos ∈ [-1,+1]`; canonical
`ballPosition ∈ [0,1]`. Engine converts at emit: `ballPosition = (ballPos + 1) / 2`.
Momentum stays `[-1,+1]` (engine's `momentum` == sim's `pressure`, same field).

**Invariants (locked as QA tests):**
- `Σ events(type='goal', team='home') === finalScore.home` (and away).
- Every `goal` event carries `scoreAfter`; ticks are contiguous `0..durationMinutes`;
  `ballPosition ∈ [0,1]`, `momentum ∈ [-1,+1]`.
- Same seed+inputs ⇒ byte-identical timeline.

**Lazy generation + score/timeline agreement (conflict 4).** Two entry points share
ONE core loop with ONE rng draw sequence:
- `resolveMatch(...) → MatchResult` — score-only, used for all ~48 matches/round.
- `simulateMatchTimeline(...) → MatchTimeline` — full timeline, ONLY for watched matches.
Their scorelines MUST agree for the same seed (QA determinism test). **`MatchResult`
gains engine-stamped goal minutes** so the sim's scoreboard rail can tick every match
without a full timeline — stamped inside the shared score core (one rng draw per goal),
NOT fabricated UI-side (fabrication would desync from the real timeline and break MP):

```ts
export interface MatchResultV2 {
  homeId: string; awayId: string;
  homeGoals: number; awayGoals: number;             // REGULATION goals
  goals: { minute: number; team: Team; playerId?: string; assistPlayerId?: string }[];
  shootout?: Shootout;        // present iff level in regulation AND shootouts enabled (≤16 alive)
  // engineV2 bookkeeping stamped by playRound (absent on a bare resolveMatch) — enough to
  // rebuild the identical watched timeline via simulateMatchTimeline (score/timeline agree):
  seed?: number;
  shootoutEnabled?: boolean;
  homeMorale?: Record<string, number>;  // morale each side carried INTO this match
  awayMorale?: Record<string, number>;
}
```
`goals[]` carries scorer/assister so the fast score path accrues **morale** for the rail
matches too (not just watched ones) — one already-drawn rng pick per goal, negligible.
The score/timeline agreement invariant is on the regulation scoreline + winner; the
shootout is decided by the same seeded rng in both paths (TICKSPEC §5). Note: the
existing `tournament.ts` `MatchResult` gains these fields at engine-v2 time; during
migration the shape lives as `MatchResultV2` in `types.ts` to avoid clashing with the
in-flight legacy type.

Per-match seed derives deterministically from `(tournamentSeed, round, matchIndex)`
so a server names a match by coordinates (sim §6, engine §4.1).

---

## 5. Playback contract (🎬 sim owns, multiplayer-critical)

Playback is a **pure function of `(timeline, elapsedMs)`** — no local randomness, no
per-frame engine calls. (Sim §6 ratified this; it's the hinge of the MP memo.)

```ts
export interface PlaybackState {
  virtualMinute: number;                  // pure linear map from elapsedMs
  clockLabel: string;                     // "45' HT", "90' FT"
  score: { home: number; away: number };  // goals with minute <= virtualMinute
  ballPosition: number;                   // interpolated between ticks (length)
  ballLane: number;                       // interpolated (width, 2D pitch)
  momentum: number;                       // interpolated
  possession: Team;
  ticker: TimelineEvent[];                // events at/before now, last ~3
  celebrating: TimelineEvent | null;      // a goal within [t, t+CELEBRATION_MS]
}
export type RenderPlayback = (timeline: MatchTimeline, elapsedMs: number) => PlaybackState;

// Shared MP-critical constants (sim §5e / TICKSPEC §4.3) — belong in CONTRACT:
export const MATCH_DURATION_MS = 45000;   // wall-clock per match @1× (regulation)
export const SHOOTOUT_MS       = 12000;   // fixed appended window if pens (→ 45s or 57s, never variable)
export const VIRTUAL_MINUTES   = 90;
export const CELEBRATION_MS    = 2600;
// POSITION_ANCHOR (12-position formation coords for the 22 dots) is sim-owned per
// TICKSPEC §2 — listed there for bot-formation consistency, not duplicated here.
```

`animate === false` (headless/tests) ⇒ clock returns `end` immediately, `RenderPlayback`
yields the final frame synchronously; playback is skipped, `intro → results` directly.

---

## 6. Game state deltas (🔒 shape / reconciled with draft + sim)

```ts
export type Screen = 'home' | 'setup' | 'draft' | 'battle' | 'steal' | 'end';
export type BattleView = 'intro' | 'playback' | 'results';
export type DraftMode = 'classic' | 'memory';

export interface ManagerV2 {
  id: string;
  name: string;
  isHuman: boolean;
  tactics: Tactics;
  xi: XiSlotV2[];               // fielded 11 (dense — see invariant)
  rolledSquads: RolledTeam[];   // every (nation,year) rolled — feeds steal pool v2
  /** DECISIONS: transient per-player rating buff for the NEXT match only, then reset.
   *  playerId → buff (0..+3): +2 per goal, +1 per assist last match, capped +3, never
   *  negative. Runtime state, NOT persisted to the player DB. Consumed & cleared each
   *  match; the match writer re-populates it from that match's goal/assist events. */
  morale: Record<string, number>;
  alive: boolean;
}
export interface XiSlotV2 { position: Position; player: PlayerV2; }
export const MORALE_GOAL = 2, MORALE_ASSIST = 1, MORALE_CAP = 3; // DECISIONS defaults

// Draft: spin yields a ROLL; free placement fills slots in any order.
export interface DraftStateDelta {
  formation: Formation;                 // chosen in 'setup'
  mode: DraftMode;                      // Classic vs Memory (draft §2b)
  respinTokens: number;                 // ASSUMPTION 3 (draft §2c)
  spunRoll: RolledTeam | null;          // was `spunNation`
  humanSlate: (XiSlotV2 | null)[];      // length = formation.slots.length
}

// Sim: matchday drives playback (sim §5a).
export interface BattleStateDelta {
  matchday: {
    featured: MatchTimeline[];          // your 1..3 watched matches, in order
    featuredIndex: number;
    rail: { matchId: string; homeId: string; awayId: string;
            goals: { minute: number; team: Team }[] }[]; // all other matches
  } | null;
}
```

**INVARIANT (frozen):** a manager's `xi` is SPARSE (`(XiSlotV2|null)[]`) ONLY during
the draft phase (`humanSlate`). Entering `'battle'` requires a COMPLETE XI (no nulls);
`teamStrength`/match/steal only ever see a dense 11. Draft-complete check =
`humanSlate.every(s => s !== null)` (replaces `draftSlotIndex >= FORMATION.length`).

**Steal pool v2 (🗄️+🔒):** loot = deduped union of the FULL `SquadEntry` rosters of
every `rolledSquads` entry belonging to eliminated managers, minus already-owned ids
(database §6). Signature `stealPool(eliminated: ManagerV2[]): PlayerV2[]`; body now
expands `rolledSquads → squadByRef → players`. Data layer supplies
`squadByRef(nation, year): SquadEntry`. A late round can dump ~thousands of entries —
scope to THIS round's eliminations, dedup by id, UI ranks by `pickValue` (open Q7).

**Steal EVALUATION runs on the DETAILED slate (NIGHT-SHIFT JOB 1).** The v1
`evaluateSteal` scored the COARSE projected XI, so a secondary-position superstar
(Messi CAM/RW) at an off-slot showed absurd swings. Evaluate on `XiSlotV2` through the
affinity matrix + the secondary exemption instead:
- `draft.ts::rankStealCandidates(pool, slate, formation, aff)` — the human's ranked list.
- `steal-v2.ts::evaluateStealV2(slate, pool) → StealCandidate | null` — the single best
  swap (bot auto-swap), a thin wrapper over `rankStealCandidates` so the two AGREE.
- `steal-v2.ts::stealSlotDeltas(slate, player) → number[]` — per-slot "where does X play"
  upgrade preview. Same `effectiveRating` (secondary-aware) as the ranked list.
Bots in the legacy tournament path still use v1 `evaluateSteal` (coarse data has no
detailed positions to exploit); switching them to `evaluateStealV2` awaits v2 bot data +
a QA balance re-baseline.

**End-of-run recap (NIGHT-SHIFT JOB 2).** `GameState` gains `champion?: Manager` and
`finalTimeline?: MatchTimeline`. On `FINISHED` (fast-forward after a human is eliminated)
the reducer records the champion and REBUILDS the final match's full `MatchTimeline` —
pure, from the final `MatchResultV2`'s stamped `seed` + `homeMorale`/`awayMorale` +
`shootoutEnabled`, via `toMatchSide` + `simulateMatchTimeline` — so an eliminated player
can still watch the final. Per-round `resultsV2` (already on `RoundResult`) carry the recap.

**Reducer actions (v2 skeleton — see the Phase-I note below).** The v2 free-pick
draft uses **`ROLL {roll}`** and **`PLACE {player, slotIndex}`** (distinct from the
legacy `SPIN {nation}` / `PICK {player}`, which stay live until `draftV2` is default-on
so all 54 tests keep passing). Full set:
`SET_FORMATION {formation}`, `SET_MODE {mode}`, `SET_TACTICS {managerId, tactics}`,
`RESPIN`, `ROLL {roll}`, `PLACE {player, slotIndex}`,
`REARRANGE_XI {managerId, xi}` (between-match re-slot — DECISIONS),
`ENTER_PLAYBACK {matchday}`, `NEXT_FEATURED`, `WATCH_MARQUEE {timeline}`,
`PLAYBACK_DONE` → existing `ROUND_PLAYED` (reveal after playback).

**Phase-I skeleton note.** `src/game/state.ts` ships these actions + the new
`Screen`/`BattleView` values + the new (optional) `GameState` fields with **stub
handlers**, ADDITIVELY over the current v1 reducer. Flags OFF ⇒ only the v1 path runs
⇒ current game, 54 tests green. Draft (bug-hunt) and sim (codex-ui) flesh out the ROLL/
PLACE/REARRANGE_XI and ENTER_PLAYBACK/NEXT_FEATURED/WATCH_MARQUEE handlers respectively,
extending the skeleton instead of colliding on the file.

---

## 7. Migration adapter (back-compat, 🔒)

Keeps `main` playable while data/engine v2 land behind flags.

```ts
// Coarse→detailed representative mapping for the CURRENT 4-position data.
export const COARSE_TO_DETAILED: Record<'GK'|'DF'|'MF'|'FW', Position> = {
  GK: 'GK', DF: 'CB', MF: 'CM', FW: 'ST',
};
// Detailed→coarse (database §2 rollup) via POSITION_ZONE for the reverse adapter.
```

- Old `Player` → `PlayerV2`: `{ position: COARSE_TO_DETAILED[pos], year: 2026,
  id: 'legacy-'+id, ... }` behind `dataV2` flag.
- Placeholder `AffinityMatrix` = diagonal 1.0 + `0.75` off-diagonal reproduces today's
  flat behavior exactly (bounds-safe, >0), so engine v1≡v2 until real values land.
- Default `Tactics = { formationId: '4-3-3', style: 'balanced' }` reproduces fixed 4-3-3.

---

## Open contract questions (for Lucca / peers)

1. **Squad size** for the steal pool: 16–18 (db rec) or fuller 23? (db Q8)
2. **Secondary positions** `secondary`/`altPos`: keep lightweight (db rec) or drop and
   let the matrix do all the work? (db Q7)
3. **Formation locked at kickoff**, or re-choosable between rounds? (draft Q3)
4. **Which extra `Tactics` levers** in Tier A vs B — engine recommends **line height**
   in Tier A; pressing/tempo/man-mark Tier B. (engine Q9/Q12)
5. **Match duration** `MATCH_DURATION_MS` — engine/sim propose 45s ≙ 90 virtual min. (sim Q1)
6. **Cards** in the timeline: in scope or cut? (engine/sim — currently Tier B)
7. **Steal-pool v2 mechanics**: stolen player REPLACES a fielded starter (default,
   keeps `xi` dense) or EXPANDS a bench (adds `bench` to `ManagerV2`)? (draft Q10, QA)
8. **Off-position model**: affinity-with-penalty (low `compatibleThreshold`) vs 7a0-strict
   eligibility (high). Shape supports both; answer only sets the value. (draft Q1)
9. **✅ Chemistry — RULED (DECISIONS): DELETED**, replaced by **morale** (§6). No open
   question remains; the same-nation bonus and cohesion reframe are removed.

_Reconciliation log:_
- **v0.1** — pre-peer draft from the six briefs + engine source.
- **v0.2** — folded PLAN-draft + PLAN-qa (affinity arg order, `year` on player,
  `mode`/`respinTokens`, sparse-XI, off-position threshold, asymmetric affinity).
- **v0.3** — folded PLAN-engine, PLAN-database, PLAN-sim and resolved the seven
  orchestrator conflicts (affinity transposition + family expansion; canonical
  formation set; timeline field set/ranges + boxScore + nullable team + goal
  scoreAfter + `counter`; `MatchResult.goals`; affinity strictly-`>0`; chemistry
  design flag; Tier-A demo contract → PLAN-architecture). Field-name reconciliation
  `pos/altPos`↔`position/secondary`, `Squad`→`SquadEntry`, `rolledTeams`→`rolledSquads`.
- **v0.4 (Phase I / binding):** folded `DECISIONS.md` — chemistry DELETED + morale
  runtime state; no-draws penalty shootouts (events + `MatchResultV2.shootout` + `POINTS`
  W3/PW2/PL1/L0); 2D-pitch `band`/`lane` ticks; scorer/assister on goals; more-forgiving
  affinity posture; varied bot tactics; between-match `REARRANGE_XI`; no stamina. Names
  the v2 draft actions `ROLL`/`PLACE` (legacy `SPIN`/`PICK` retained for green tests).
- **v0.4 + TICKSPEC v0.3:** ratified `docs/redesign/TICKSPEC.md` v0.3 (engine+sim
  co-signed, committed d93ab71) into §4. It is a **minimal** diff over the v0.4
  placeholder — only four changes, everything else in v0.4 stands verbatim
  (`playerId`/`assistPlayerId`, `penalty_scored`/`penalty_missed` enum, `MatchResultV2`,
  `POINTS`, morale consts): (1) `TimelineTick` drops discrete `band`/`lane`, adds
  continuous `ballLane:number` (0..1); (2) `MatchTimeline` adds `homeFormationId`/
  `awayFormationId`; (3) `Shootout` adds `kicks[]` to `{winner,home,away}`; (4) records
  `SHOOTOUT_MS=12000` + sim-owned `POSITION_ANCHOR`. Hard dep: `FORMATIONS[id].slots`
  stays the source of truth for a formation's fielded positions.
- **Homes of the v2 types (single source, no forks):** data + `Position`/`Zone` +
  migration adapter live in **`src/engine/data/schema.ts`** (worker-6); feature flags
  in **`src/game/features.ts`** (worker-6-seeded, worker-7 owns the matrix — I did NOT
  create a duplicate `flags.ts`; the legacy `flags.ts` stays the emoji map). The
  match/tactics/timeline/manager types go in **`src/engine/types.ts`**, importing
  `Position`/`PlayerV2`/`SquadRef` from schema (aliased to avoid the legacy-`Position`
  name clash).
- **Now implementing:** sequencing step 1 — v2 match types (`src/engine/types.ts`) +
  the additive reducer skeleton (`src/game/state.ts`); flags already exist in
  `features.ts`; the data migration adapter already exists in `schema.ts`/`loader.ts`.
- **Next:** remaining calibration is Lucca's later red-pen pass (rating ladder, Tier-A
  lever tuning); not blocking. Steps 2–5 (data → engine → draft → sim) build on this.
