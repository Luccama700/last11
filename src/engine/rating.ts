import type { Player, Position, XI } from './types';
// ── v2 zonal front-end imports (CONTRACT §4 boxScore; DECISIONS: chem deleted) ──
import type { Position as DetailedPosition } from './data/schema';
import type { XiSlotV2, ZoneBox } from './types';
import { effectiveRating as effRatingV2 } from './affinity';
import { STAR_THRESHOLD as STAR_THRESHOLD_V2 } from './params';

/** Fixed 4-3-3. Draft fills these 11 slots in order. */
export const FORMATION: readonly Position[] = [
  'GK',
  'DF',
  'DF',
  'DF',
  'DF',
  'MF',
  'MF',
  'MF',
  'FW',
  'FW',
  'FW',
];

/** Off-position picks keep this fraction of their rating. */
export const OFF_POSITION_MULT = 0.75;
/** Players at or above this rating are stars. */
export const STAR_THRESHOLD = 88;
/** Flat bonus per star in the XI. */
export const STAR_BONUS = 3;
/** Bonus per same-nation pair in the XI. */
export const CHEM_PAIR_BONUS = 1.5;

export function effectiveRating(slot: Position, player: Player): number {
  return player.position === slot ? player.rating : player.rating * OFF_POSITION_MULT;
}

export interface StrengthBreakdown {
  base: number;
  chemistry: number;
  star: number;
  total: number;
}

export function teamStrength(xi: XI): StrengthBreakdown {
  let base = 0;
  let star = 0;
  const nationCounts = new Map<string, number>();
  for (const { position, player } of xi) {
    base += effectiveRating(position, player);
    if (player.rating >= STAR_THRESHOLD) star += STAR_BONUS;
    nationCounts.set(player.nation, (nationCounts.get(player.nation) ?? 0) + 1);
  }
  let chemistry = 0;
  for (const count of nationCounts.values()) {
    chemistry += ((count * (count - 1)) / 2) * CHEM_PAIR_BONUS;
  }
  const total = base + chemistry + star;
  return { base, chemistry, star, total };
}

// ============================================================================
// v2 zonal front-end — CONTRACT §4 (ZoneBox) + DECISIONS (chemistry DELETED,
// morale added, star = attack-zone shot quality). Pure over (XiSlotV2[], morale).
// Consumes the affinity matrix via `effRatingV2`. Feeds match.ts / timeline.ts.
// ============================================================================

/** How each fielded SLOT's effective rating spreads across zones × lanes.
 *  Lanes: L/C/R. A slot may span two zones (e.g. CDM = holding + covering). */
type ZoneLaneKey =
  | 'gk'
  | 'defL' | 'defC' | 'defR'
  | 'midL' | 'midC' | 'midR'
  | 'attL' | 'attC' | 'attR';

const ZONE_WEIGHTS: Record<DetailedPosition, Partial<Record<ZoneLaneKey, number>>> = {
  GK: { gk: 1.0 },
  RB: { defR: 0.8, midR: 0.3 },
  CB: { defC: 1.0 },
  LB: { defL: 0.8, midL: 0.3 },
  CDM: { defC: 0.4, midC: 0.9 },
  CM: { midC: 1.0 },
  CAM: { midC: 0.7, attC: 0.5 },
  RM: { midR: 0.9, attR: 0.4 },
  LM: { midL: 0.9, attL: 0.4 },
  RW: { attR: 0.9, midR: 0.3 },
  LW: { attL: 0.9, midL: 0.3 },
  ST: { attC: 1.0 },
};

/** Per-lane averages + a zone average, all on the ~0-99 rating scale. */
export interface ZoneUnit {
  L: number;
  C: number;
  R: number;
  avg: number;
}
export interface ZoneStrength {
  gk: number;
  def: ZoneUnit;
  mid: ZoneUnit;
  att: ZoneUnit;
  overall: number; // mean effective rating of the fielded XI
}

/** Effective rating of a fielded slot including any transient morale buff. */
function slotEff(slot: XiSlotV2, morale?: Record<string, number>): number {
  return effRatingV2(slot.position, slot.player) + (morale?.[slot.player.id] ?? 0);
}

/**
 * Zonal strength vector for an XI. Averages (not sums) so numbers stay on the
 * rating scale — this is what makes Lucca's "+10 strength ≈ +0.75 xG" intuitive,
 * and what the box score displays. Lanes let wing play beat a narrow back-3.
 */
export function zonalStrength(xi: readonly XiSlotV2[], morale?: Record<string, number>): ZoneStrength {
  const sum: Record<ZoneLaneKey, number> = {
    gk: 0, defL: 0, defC: 0, defR: 0, midL: 0, midC: 0, midR: 0, attL: 0, attC: 0, attR: 0,
  };
  const wsum: Record<ZoneLaneKey, number> = { ...sum };

  let effTotal = 0;
  for (const slot of xi) {
    const eff = slotEff(slot, morale);
    effTotal += eff;
    const weights = ZONE_WEIGHTS[slot.position];
    for (const key in weights) {
      const k = key as ZoneLaneKey;
      const w = weights[k]!;
      sum[k] += eff * w;
      wsum[k] += w;
    }
  }

  const avg = (s: number, w: number): number => (w > 0 ? s / w : 0);
  const unit = (l: ZoneLaneKey, c: ZoneLaneKey, r: ZoneLaneKey): ZoneUnit => {
    const L = avg(sum[l], wsum[l]);
    const C = avg(sum[c], wsum[c]);
    const R = avg(sum[r], wsum[r]);
    const total = sum[l] + sum[c] + sum[r];
    const wtotal = wsum[l] + wsum[c] + wsum[r];
    return { L, C, R, avg: avg(total, wtotal) };
  };

  return {
    gk: avg(sum.gk, wsum.gk),
    def: unit('defL', 'defC', 'defR'),
    mid: unit('midL', 'midC', 'midR'),
    att: unit('attL', 'attC', 'attR'),
    overall: xi.length > 0 ? effTotal / xi.length : 0,
  };
}

/** 7a0-style "deserved" box score, straight off the zonal averages. */
export function boxScore(z: ZoneStrength): ZoneBox {
  return { gk: z.gk, def: z.def.avg, mid: z.mid.avg, att: z.att.avg, overall: z.overall };
}

/** Stars fielded in attack-contributing slots — feeds match.ts shot-quality bump. */
export function attackStars(xi: readonly XiSlotV2[]): number {
  let n = 0;
  for (const slot of xi) {
    const w = ZONE_WEIGHTS[slot.position];
    const inAttack = (w.attL ?? 0) + (w.attC ?? 0) + (w.attR ?? 0) > 0;
    if (inAttack && slot.player.rating >= STAR_THRESHOLD_V2) n++;
  }
  return n;
}

/** Scalar team strength for the BR table / upset buckets (v2 overall). */
export function overallStrength(xi: readonly XiSlotV2[], morale?: Record<string, number>): number {
  return zonalStrength(xi, morale).overall;
}

/** Selection weight for scorer / assister / penalty-taker: effective rating scaled
 *  by how attacking the slot is (attackers ≫ mids > defenders; a defender is never
 *  zero so a set-piece header is possible). Used by match.ts attribution + shootout. */
export function shotWeight(slot: XiSlotV2, morale?: Record<string, number>): number {
  const w = ZONE_WEIGHTS[slot.position];
  const att = (w.attL ?? 0) + (w.attC ?? 0) + (w.attR ?? 0);
  const mid = (w.midL ?? 0) + (w.midC ?? 0) + (w.midR ?? 0);
  return slotEff(slot, morale) * (0.15 + att + mid * 0.4);
}
