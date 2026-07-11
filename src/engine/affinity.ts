/**
 * Position affinity — how much of a player's rating survives when he is fielded
 * off his natural position. Replaces v1's flat `OFF_POSITION_MULT = 0.75`.
 *
 * CONTRACT §1: the SHAPE (AffinityMatrix, matrix[natural][slot], diagonal = 1,
 * every cell strictly > 0, asymmetry allowed) is the architect's; the VALUES are
 * game-engine's (here). DECISIONS posture — deliberately FORGIVING so the free-pick
 * draft never dead-ends: same-zone moves ≥ .85, adjacent-zone ≥ .60, worst case
 * (GK ↔ outfield, DEF ↔ ATT) floored ~.25, ALL cells > 0.
 *
 * Authored as a 9×9 FAMILY table in canonical `[natural][slot]` orientation, then
 * expanded to the full 12×12 by the family map (RB/LB→FB, RM/LM→WM, LW/RW→W). This
 * keeps L/R symmetric and the table readable. Same family ⇒ 1.0 (a RB at LB is full).
 */
import type { Position } from './data/schema';
import { POSITION_ZONE } from './data/schema';
import type { Affinity, AffinityConfig, AffinityFn, AffinityMatrix } from './types';
import type { PlayerV2 } from './data/schema';

type Family = 'GK' | 'CB' | 'FB' | 'CDM' | 'CM' | 'CAM' | 'WM' | 'W' | 'ST';

const FAMILY_OF: Record<Position, Family> = {
  GK: 'GK',
  CB: 'CB',
  RB: 'FB', LB: 'FB',
  CDM: 'CDM', CM: 'CM', CAM: 'CAM',
  RM: 'WM', LM: 'WM',
  LW: 'W', RW: 'W',
  ST: 'ST',
};

/**
 * FAMILY[natural][slot] = fraction of rating retained. Rows read "a natural <row>
 * asked to play <col>". Zones: GK{GK} · DEF{CB,FB} · MID{CDM,CM,CAM,WM} · ATT{W,ST}.
 * Diagonal 1.0; same-zone ≥ .85; adjacent-zone (DEF↔MID, MID↔ATT) ≥ .60; far ~.25–.45.
 */
const FAMILY: Record<Family, Record<Family, number>> = {
  //          GK    CB    FB    CDM   CM    CAM   WM    W     ST
  GK:  { GK: 1.0, CB: .30, FB: .28, CDM: .28, CM: .26, CAM: .25, WM: .25, W: .25, ST: .25 },
  CB:  { GK: .30, CB: 1.0, FB: .85, CDM: .80, CM: .68, CAM: .60, WM: .62, W: .40, ST: .42 },
  FB:  { GK: .28, CB: .85, FB: 1.0, CDM: .68, CM: .66, CAM: .62, WM: .82, W: .72, ST: .45 },
  CDM: { GK: .27, CB: .82, FB: .70, CDM: 1.0, CM: .92, CAM: .85, WM: .85, W: .60, ST: .60 },
  CM:  { GK: .26, CB: .66, FB: .68, CDM: .90, CM: 1.0, CAM: .90, WM: .86, W: .72, ST: .68 },
  CAM: { GK: .25, CB: .60, FB: .62, CDM: .85, CM: .92, CAM: 1.0, WM: .85, W: .85, ST: .82 },
  WM:  { GK: .25, CB: .62, FB: .82, CDM: .85, CM: .86, CAM: .85, WM: 1.0, W: .88, ST: .66 },
  W:   { GK: .25, CB: .38, FB: .60, CDM: .60, CM: .66, CAM: .80, WM: .85, W: 1.0, ST: .85 },
  ST:  { GK: .25, CB: .40, FB: .38, CDM: .60, CM: .62, CAM: .82, WM: .64, W: .85, ST: 1.0 },
};

const POSITIONS: readonly Position[] = [
  'GK', 'RB', 'CB', 'LB', 'CDM', 'CM', 'CAM', 'RM', 'LM', 'LW', 'RW', 'ST',
];

/** The full 12×12 matrix, expanded once from FAMILY at module load. */
export const AFFINITY_MATRIX: AffinityMatrix = (() => {
  const m = {} as Record<Position, Record<Position, Affinity>>;
  for (const natural of POSITIONS) {
    m[natural] = {} as Record<Position, Affinity>;
    for (const slot of POSITIONS) {
      // Exact same position is always 1.0; otherwise map through families.
      m[natural][slot] = natural === slot ? 1.0 : FAMILY[FAMILY_OF[natural]][FAMILY_OF[slot]];
    }
  }
  return m as AffinityMatrix;
})();

/** matrix[natural][slot] accessor (CONTRACT §1 arg order: natural FIRST). */
export const affinity: AffinityFn = (natural, slot) => AFFINITY_MATRIX[natural][slot];

/**
 * Below this a slot is "incompatible" for draft-UI gating. Draft-page owns the
 * final value (CONTRACT §1 open Q8); this is the ASSUMPTION default. Every cell is
 * > 0 so the draft never dead-ends regardless.
 */
export const DEFAULT_AFFINITY_CONFIG: AffinityConfig = {
  matrix: AFFINITY_MATRIX,
  compatibleThreshold: 0.6,
};

/**
 * Effective rating of `player` fielded in `slot`. A slot that is the player's
 * natural OR a listed secondary position keeps full rating (affinity 1.0);
 * otherwise the affinity multiplier applies. This is THE single source of truth
 * for off-position value — the draft's `pickValue` and the engine's zonal sums
 * both call it (CONTRACT §1 "Consumers").
 */
export function effectiveRating(slot: Position, player: PlayerV2): number {
  if (player.position === slot) return player.rating;
  if (player.secondary?.includes(slot)) return player.rating;
  return player.rating * affinity(player.position, slot);
}

/** Convenience: the coarse zone a detailed slot rolls up to (re-export for engine). */
export { POSITION_ZONE };
