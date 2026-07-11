import { describe, expect, it } from 'vitest';
import { NATIONS, PLAYERS, nationSquad } from './data';
import type { Position } from './types';

describe('squad data', () => {
  it('has 12 nations of 12 players each (144 total)', () => {
    expect(NATIONS.length).toBe(12);
    expect(PLAYERS.length).toBe(144);
    for (const nation of NATIONS) {
      expect(nationSquad(nation.code).length).toBe(12);
    }
  });

  it('every nation has exactly 2 GK, 4 DF, 3 MF, 3 FW', () => {
    const expected: Record<Position, number> = { GK: 2, DF: 4, MF: 3, FW: 3 };
    for (const nation of NATIONS) {
      const counts: Record<Position, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
      for (const player of nationSquad(nation.code)) {
        counts[player.position]++;
      }
      expect(counts, nation.code).toEqual(expected);
    }
  });

  it('player ids are unique', () => {
    const ids = new Set(PLAYERS.map((p) => p.id));
    expect(ids.size).toBe(PLAYERS.length);
  });

  it('ratings are in a sane range and nation codes match', () => {
    for (const player of PLAYERS) {
      expect(player.rating).toBeGreaterThanOrEqual(70);
      expect(player.rating).toBeLessThanOrEqual(95);
      expect(NATIONS.some((n) => n.code === player.nation)).toBe(true);
    }
  });
});
