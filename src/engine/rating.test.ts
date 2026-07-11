import { describe, expect, it } from 'vitest';
import {
  CHEM_PAIR_BONUS,
  FORMATION,
  OFF_POSITION_MULT,
  STAR_BONUS,
  STAR_THRESHOLD,
  effectiveRating,
  teamStrength,
} from './rating';
import type { Player, Position, XI } from './types';

let nextId = 0;
function makePlayer(overrides: Partial<Player> = {}): Player {
  nextId++;
  return {
    id: `test-${nextId}`,
    name: `Test Player ${nextId}`,
    nation: `N${nextId}`, // unique nation by default => zero chemistry
    position: 'MF',
    rating: 80,
    ...overrides,
  };
}

/** XI matching FORMATION, one player per slot, all on-position. */
function makeXi(rating: number, nation?: string): XI {
  return FORMATION.map((position) =>
    ({ position, player: makePlayer({ position, rating, ...(nation ? { nation } : {}) }) }),
  );
}

describe('effectiveRating', () => {
  it('keeps full rating on-position', () => {
    const p = makePlayer({ position: 'FW', rating: 90 });
    expect(effectiveRating('FW', p)).toBe(90);
  });

  it('penalizes off-position picks', () => {
    const p = makePlayer({ position: 'FW', rating: 90 });
    expect(effectiveRating('MF', p)).toBe(90 * OFF_POSITION_MULT);
  });
});

describe('teamStrength', () => {
  it('FORMATION is 11 slots: 1 GK, 4 DF, 3 MF, 3 FW', () => {
    expect(FORMATION.length).toBe(11);
    const counts: Record<Position, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
    for (const pos of FORMATION) counts[pos]++;
    expect(counts).toEqual({ GK: 1, DF: 4, MF: 3, FW: 3 });
  });

  it('a higher-rated XI out-rates a lower-rated XI', () => {
    expect(teamStrength(makeXi(85)).total).toBeGreaterThan(teamStrength(makeXi(75)).total);
  });

  it('base equals sum of ratings when all on-position, no stars, no chemistry', () => {
    const s = teamStrength(makeXi(80));
    expect(s.base).toBe(80 * 11);
    expect(s.chemistry).toBe(0);
    expect(s.star).toBe(0);
    expect(s.total).toBe(880);
  });

  it('an off-position player lowers the total vs the same player on-position', () => {
    const xi = makeXi(80);
    const offXi: XI = [...xi];
    // put a FW into the GK slot
    offXi[0] = { position: 'GK', player: makePlayer({ position: 'FW', rating: 80 }) };
    expect(teamStrength(offXi).total).toBeLessThan(teamStrength(xi).total);
  });

  it('same-nation stacking adds pair chemistry', () => {
    const mixed = teamStrength(makeXi(80)); // 11 distinct nations
    const stacked = teamStrength(makeXi(80, 'BRA')); // all same nation
    expect(mixed.chemistry).toBe(0);
    expect(stacked.chemistry).toBe(((11 * 10) / 2) * CHEM_PAIR_BONUS);
    expect(stacked.total).toBeGreaterThan(mixed.total);
  });

  it('two same-nation players count as exactly one pair', () => {
    const xi = makeXi(80);
    const twoBra: XI = xi.map((slot, i) =>
      i < 2
        ? { ...slot, player: { ...slot.player, nation: 'BRA' } }
        : slot,
    );
    expect(teamStrength(twoBra).chemistry).toBe(CHEM_PAIR_BONUS);
  });

  it('stars at/above the threshold add a flat bonus', () => {
    const justBelow = makeXi(STAR_THRESHOLD - 1);
    const atThreshold = makeXi(STAR_THRESHOLD);
    const below = teamStrength(justBelow);
    const at = teamStrength(atThreshold);
    expect(below.star).toBe(0);
    expect(at.star).toBe(11 * STAR_BONUS);
    expect(at.total - below.total).toBe(11 + 11 * STAR_BONUS); // +1 rating each, +star each
  });
});
