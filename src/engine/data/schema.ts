/**
 * Player database v2 — shared shapes (CONTRACT.md §1, §2, §7).
 *
 * These types are the single source of truth the engine/draft/sim consumers
 * compile against. worker-6 owns `src/engine/data/*`; the shapes here MATCH
 * CONTRACT.md verbatim (worker-7 reconciled them). If worker-7 later hoists
 * `Position`/`Zone` into a top-level `contract.ts`, re-export from there — do
 * not fork the definitions.
 *
 * Nothing here touches the legacy `../types.ts` / `../data.ts` path, which the
 * shipped game and its 54 tests still use with all feature flags OFF.
 */

// ---- Positions (CONTRACT §1) --------------------------------------------------

/** 12 detailed positions. Order is deliberate (goal → back line R→L → pivots →
 *  wide mids → wingers → striker); UI layout + bucketing depend on it. */
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

/** Coarse zone rollup. Used by the back-compat adapter, the engine's zonal sums,
 *  and the box score. Every detailed position maps to exactly one zone. */
export type Zone = 'GK' | 'DEF' | 'MID' | 'ATT';

export const POSITION_ZONE: Readonly<Record<Position, Zone>> = {
  GK: 'GK',
  RB: 'DEF', CB: 'DEF', LB: 'DEF',
  CDM: 'MID', CM: 'MID', CAM: 'MID', RM: 'MID', LM: 'MID',
  LW: 'ATT', RW: 'ATT', ST: 'ATT',
};

// ---- RAW shapes (on disk; see squads-v2.json + samples/*.json) ----------------

export interface RawPlayerV2 {
  id: string;            // `${nationLower}-${year}-${slug}`, e.g. 'bra-2002-ronaldo'
  name: string;
  pos: Position;         // primary, detailed (NOTE: field is `pos` on disk)
  altPos?: Position[];   // 0..2 secondaries, treated as natural (affinity 1.0)
  rating: number;        // 1..99, per-tournament snapshot
  fullName?: string;
  club?: string;
  shirt?: number;
}

export interface RawSquadEntry {
  nation: string;        // (nation, year) lives HERE, once
  name: string;
  year: number;
  players: RawPlayerV2[]; // 16..23 (target 16-18)
  result?: string;
  notes?: string;
}

export interface SquadsFileV2 {
  version: 2;
  squads: RawSquadEntry[];
}

// ---- IN-MEMORY shapes (what consumers use; the loader produces these) ---------

export interface PlayerV2 {
  id: string;
  name: string;
  nation: string;         // DENORMALIZED from the squad by the loader
  year: number;           // DENORMALIZED — makes the steal pool self-describing
  position: Position;     // renamed from raw `pos`
  secondary?: Position[]; // renamed from raw `altPos`; treated as affinity 1.0
  rating: number;
  fullName?: string;
  club?: string;
  shirt?: number;
}

export interface SquadEntry {
  nation: string;
  name: string;
  year: number;
  players: PlayerV2[];
  result?: string;
  notes?: string;
}

export type SquadKey = `${string}-${number}`; // `${nationCode}-${year}`
export const squadKey = (nation: string, year: number): SquadKey => `${nation}-${year}`;

/** One spin result AND one entry in a manager's rolled set (CONTRACT §3). */
export interface SquadRef {
  nation: string;
  year: number;
}

// ---- Migration adapter (CONTRACT §7) ------------------------------------------

/** Legacy coarse position (`../types.ts`). Kept local so schema.ts has no import
 *  from the legacy module — the adapter is the only bridge. */
export type CoarsePosition = 'GK' | 'DF' | 'MF' | 'FW';

/** Coarse → representative detailed, for projecting the CURRENT 4-position data
 *  into the v2 shape behind the `dataV2` flag. */
export const COARSE_TO_DETAILED: Readonly<Record<CoarsePosition, Position>> = {
  GK: 'GK', DF: 'CB', MF: 'CM', FW: 'ST',
};

/** Detailed → coarse, via the zone rollup, for the reverse adapter (projecting a
 *  v2 squad down to what the current Poisson engine consumes until engine v2 lands). */
export function detailedToCoarse(pos: Position): CoarsePosition {
  const zone = POSITION_ZONE[pos];
  return zone === 'GK' ? 'GK' : zone === 'DEF' ? 'DF' : zone === 'MID' ? 'MF' : 'FW';
}
