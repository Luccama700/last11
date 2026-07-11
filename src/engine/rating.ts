import type { Player, Position, XI } from './types';

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
