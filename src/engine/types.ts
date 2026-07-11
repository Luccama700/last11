export type Position = 'GK' | 'DF' | 'MF' | 'FW';

export interface Player {
  id: string;
  name: string;
  nation: string; // 3-letter code, e.g. 'BRA'
  position: Position;
  rating: number; // ~70-95
}

export interface XiSlot {
  position: Position;
  player: Player;
}

/** A complete team is 11 slots (see FORMATION in rating.ts). */
export type XI = XiSlot[];

// ============================================================================
// v2 (redesign) match-domain types — CONTRACT.md §1/§3/§4/§6 + TICKSPEC.md v0.3.
//
// ADDITIVE: the legacy Position/Player/XiSlot/XI above stay live while every v2
// feature sits behind a flag in `src/game/features.ts` (all OFF ⇒ current game).
// Data + Position/Zone + the migration adapter are the single source of truth in
// `src/engine/data/schema.ts` — imported here (aliased), never re-declared.
// ============================================================================

import type { Position as DetailedPosition, PlayerV2, SquadRef } from './data/schema';

/** A spin result AND one entry in a manager's rolled set (CONTRACT §3). */
export type RolledTeam = SquadRef;

// ---- Tactics (CONTRACT §3; chemistry DELETED per DECISIONS) ------------------

export type PlayingStyle = 'defensive' | 'balanced' | 'attacking';
export type DraftMode = 'classic' | 'memory';

export interface Tactics {
  formationId: string;
  style: PlayingStyle;
  /** Engine-owned optional levers — Tier A ships `lineHeight`; the rest are Tier B.
   *  Additive so older Tactics objects never break. */
  lineHeight?: 'deep' | 'mid' | 'high';
  pressing?: 'low' | 'mid' | 'high';
  tempo?: 'possession' | 'balanced' | 'direct';
  markKeyPlayer?: string; // opponent playerId (Tier B)
}

// ---- Formations (CONTRACT §3 — FORMATIONS[id].slots is the SOURCE OF TRUTH ---
//      for a formation's fielded positions; TICKSPEC §2 dot placement depends on it) ---

export interface Formation {
  id: string;
  name: string;
  slots: DetailedPosition[]; // length 11, GK first, repeats allowed
}

export const FORMATIONS: readonly Formation[] = [
  { id: '4-3-3',   name: '4-3-3',   slots: ['GK', 'RB', 'CB', 'CB', 'LB', 'CDM', 'CM', 'CM', 'RW', 'ST', 'LW'] },
  { id: '4-4-2',   name: '4-4-2',   slots: ['GK', 'RB', 'CB', 'CB', 'LB', 'RM', 'CM', 'CM', 'LM', 'ST', 'ST'] },
  { id: '4-2-3-1', name: '4-2-3-1', slots: ['GK', 'RB', 'CB', 'CB', 'LB', 'CDM', 'CDM', 'CAM', 'RW', 'LW', 'ST'] },
  { id: '4-2-4',   name: '4-2-4',   slots: ['GK', 'RB', 'CB', 'CB', 'LB', 'CM', 'CM', 'RW', 'LW', 'ST', 'ST'] },
  { id: '3-5-2',   name: '3-5-2',   slots: ['GK', 'CB', 'CB', 'CB', 'RM', 'CDM', 'CM', 'CAM', 'LM', 'ST', 'ST'] },
  { id: '5-3-2',   name: '5-3-2',   slots: ['GK', 'RB', 'CB', 'CB', 'CB', 'LB', 'CM', 'CM', 'CM', 'ST', 'ST'] },
  { id: '4-5-1',   name: '4-5-1',   slots: ['GK', 'RB', 'CB', 'CB', 'LB', 'RM', 'CM', 'CM', 'CM', 'LM', 'ST'] },
  { id: '3-4-3',   name: '3-4-3',   slots: ['GK', 'CB', 'CB', 'CB', 'RM', 'CM', 'CM', 'LM', 'RW', 'ST', 'LW'] },
  { id: '4-1-2-1-2',      name: '4-1-2-1-2',      slots: ['GK', 'RB', 'CB', 'CB', 'LB', 'CDM', 'CM', 'CM', 'CAM', 'ST', 'ST'] },
  { id: '4-1-2-1-2-wide', name: '4-1-2-1-2 wide', slots: ['GK', 'RB', 'CB', 'CB', 'LB', 'CDM', 'RM', 'LM', 'CAM', 'ST', 'ST'] },
];

export function formationById(id: string): Formation | undefined {
  return FORMATIONS.find((f) => f.id === id);
}

// ---- Position affinity (CONTRACT §1 — shape mine, values engine's) -----------
//      matrix[natural][slot]; diagonal = 1; every cell strictly > 0; asymmetric OK.

export type Affinity = number; // (0, 1]
export type AffinityMatrix = Readonly<Record<DetailedPosition, Readonly<Record<DetailedPosition, Affinity>>>>;
export type AffinityFn = (natural: DetailedPosition, slot: DetailedPosition) => Affinity;
export interface AffinityConfig {
  matrix: AffinityMatrix;
  compatibleThreshold: Affinity;
}

// ---- Match timeline (CONTRACT §4 + TICKSPEC v0.3) ----------------------------

export type Team = 'home' | 'away';

export interface TimelineTick {
  minute: number;       // 0..durationMinutes
  ballPosition: number; // 0..1 longitudinal, 0 = home goal line
  ballLane: number;     // 0..1 lateral, 0 = home-left/top of frame … 1 = right/bottom
  momentum: number;     // -1..+1, + toward home
  possession: Team;
}

export type TimelineEventType =
  | 'kickoff' | 'halftime' | 'fulltime'
  | 'chance' | 'shot' | 'save' | 'goal' | 'counter'
  | 'card'
  | 'shootout_start' | 'penalty_scored' | 'penalty_missed' | 'shootout_end';

export interface TimelineEvent {
  minute: number;
  type: TimelineEventType;
  team: Team | null;                            // null for neutral events
  text: string;                                 // engine-authored ticker caption
  scoreAfter?: { home: number; away: number };  // REQUIRED on type==='goal'
  playerId?: string;                            // scorer on 'goal'; taker on penalty_*; keeper on 'save'
  assistPlayerId?: string;                      // assister on 'goal' (feeds morale)
}

export interface ZoneBox { gk: number; def: number; mid: number; att: number; overall: number; }

export interface Shootout {
  winner: Team;                                 // never null (sudden death decides)
  home: number;                                 // penalties scored
  away: number;
  kicks: { team: Team; scored: boolean; playerId: string }[]; // ordered
}

export interface MatchTimeline {
  matchId: string;
  homeId: string;
  awayId: string;
  seed: number;
  durationMinutes: number;                      // virtual minutes (90); ticks stop here
  ticks: TimelineTick[];                        // length = durationMinutes + 1
  events: TimelineEvent[];                      // minute-sorted; shootout_* appended at minute==90
  finalScore: { home: number; away: number };   // regulation; may be level
  shootout?: Shootout;                          // present iff finalScore is level
  homeFormationId: string;                      // self-contained dot placement (pure playback)
  awayFormationId: string;
  boxScore: { home: ZoneBox; away: ZoneBox; xg: { home: number; away: number } };
}

export interface MatchResultV2 {
  homeId: string;
  awayId: string;
  homeGoals: number; // regulation
  awayGoals: number;
  goals: { minute: number; team: Team; playerId?: string; assistPlayerId?: string }[];
  /** Present iff the match was level in regulation AND shootouts were enabled for
   *  the round (≤16 alive; NIGHT-SHIFT rule). A level match with no shootout is a
   *  genuine DRAW (early rounds). Classify via `matchVerdict` — never by goals alone. */
  shootout?: Shootout;
  /** engineV2 bookkeeping (stamped by playRound, absent on bare resolveMatch):
   *  the canonical per-match seed, whether shootouts were enabled this round, and
   *  the morale each side carried INTO this match — everything App needs to rebuild
   *  the identical watched timeline via simulateMatchTimeline (score/timeline agreement). */
  seed?: number;
  shootoutEnabled?: boolean;
  homeMorale?: Record<string, number>;
  awayMorale?: Record<string, number>;
}

// ---- Manager / XI v2 (CONTRACT §6) -------------------------------------------

export interface XiSlotV2 {
  position: DetailedPosition;
  player: PlayerV2;
}

export interface ManagerV2 {
  id: string;
  name: string;
  isHuman: boolean;
  tactics: Tactics;
  xi: XiSlotV2[];                   // dense 11 once drafted (sparse only mid-draft)
  rolledSquads: RolledTeam[];       // feeds steal pool v2
  /** playerId → next-match rating buff (0..MORALE_CAP). Runtime only; NOT persisted. */
  morale: Record<string, number>;
  alive: boolean;
}

/** Morale defaults (DECISIONS): scorer +2, assister +1, cap +3, next match only, no negatives. */
export const MORALE_GOAL = 2;
export const MORALE_ASSIST = 1;
export const MORALE_CAP = 3;

// ---- Shared constants (CONTRACT §4/§5; MP-critical fixed durations) ----------

export const MATCH_DURATION_MS = 45000; // regulation wall-clock @1×
export const SHOOTOUT_MS = 12000;       // fixed appended shootout window (→ 45s or 57s watched)
export const VIRTUAL_MINUTES = 90;
export const CELEBRATION_MS = 2600;

/**
 * Points (Lucca's ruling, 2026-07-11: "it should be either 3 or 0"). Shootouts only
 * when ≤16 managers are alive at round start; those rounds have NO draws and a pens
 * result is worth the FULL win/loss (3/0) — same stakes as regulation. Rounds with
 * >16 alive keep CLASSIC draws (win 3 / DRAW 1 / loss 0).
 */
export const POINTS = {
  REG_WIN: 3,
  SHOOTOUT_WIN: 3,
  SHOOTOUT_LOSS: 0,
  REG_LOSS: 0,
  DRAW: 1, // classic draw point — only in rounds where shootouts are disabled
} as const;
