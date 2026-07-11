import type { Rng } from './rng';

const BASE_XG = 1.35;
const STRENGTH_TO_XG = 0.012;
const MIN_XG = 0.15;
const MAX_XG = 4.5;

export interface MatchScore {
  goalsA: number;
  goalsB: number;
}

function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

/** Knuth Poisson sampler. Deterministic via the provided rng. */
export function poisson(lambda: number, rng: Rng): number {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.next();
  } while (p > limit);
  return k - 1;
}

/** Simulate one match between two team strengths. Higher strength => higher xG. */
export function simulateMatch(strengthA: number, strengthB: number, rng: Rng): MatchScore {
  const diff = strengthA - strengthB;
  const xgA = clamp(BASE_XG + diff * STRENGTH_TO_XG, MIN_XG, MAX_XG);
  const xgB = clamp(BASE_XG - diff * STRENGTH_TO_XG, MIN_XG, MAX_XG);
  return { goalsA: poisson(xgA, rng), goalsB: poisson(xgB, rng) };
}
