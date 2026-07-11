import { describe, expect, it } from 'vitest';
import { NATIONS, nationSquad } from './data';
import { botPick, draftBotXi, draftOptions, spinNation } from './draft';
import { FORMATION } from './rating';
import { createRng } from './rng';
import type { Player, XI } from './types';

describe('spinNation', () => {
  it('returns a valid nation code, deterministically per seed', () => {
    const codes = new Set(NATIONS.map((n) => n.code));
    const a = createRng(5);
    const b = createRng(5);
    for (let i = 0; i < 30; i++) {
      const spun = spinNation(a);
      expect(codes.has(spun)).toBe(true);
      expect(spinNation(b)).toBe(spun);
    }
  });
});

describe('draftOptions', () => {
  it('excludes players already on the team', () => {
    const squad = nationSquad('BRA');
    const xi: XI = [{ position: 'GK', player: squad[0] }];
    const options = draftOptions(xi, 'BRA');
    expect(options.length).toBe(squad.length - 1);
    expect(options.some((p) => p.id === squad[0].id)).toBe(false);
  });

  it('returns the full squad when nothing is taken', () => {
    expect(draftOptions([], 'ARG').length).toBe(nationSquad('ARG').length);
  });
});

describe('botPick', () => {
  const mf85: Player = { id: 'a-mf', name: 'A', nation: 'AAA', position: 'MF', rating: 85 };
  const fw90: Player = { id: 'b-fw', name: 'B', nation: 'BBB', position: 'FW', rating: 90 };

  it('prefers position fit over raw rating when the math says so', () => {
    // For the MF slot: MF 85 (eff 85) beats FW 90 (eff 67.5 + star 3 = 70.5)
    expect(botPick([fw90, mf85], [], 'MF').id).toBe('a-mf');
  });

  it('breaks near-ties with chemistry', () => {
    const braMf: Player = { id: 'c-mf', name: 'C', nation: 'BRA', position: 'MF', rating: 85 };
    const teammate: Player = { id: 'd-df', name: 'D', nation: 'BRA', position: 'DF', rating: 80 };
    const xi: XI = [{ position: 'DF', player: teammate }];
    expect(botPick([mf85, braMf], xi, 'MF').id).toBe('c-mf');
  });
});

describe('draftBotXi', () => {
  it('produces a full XI matching FORMATION with no duplicate players', () => {
    const xi = draftBotXi(createRng(77));
    expect(xi.length).toBe(11);
    expect(xi.map((s) => s.position)).toEqual([...FORMATION]);
    const ids = new Set(xi.map((s) => s.player.id));
    expect(ids.size).toBe(11);
  });

  it('is deterministic per seed', () => {
    const a = draftBotXi(createRng(42));
    const b = draftBotXi(createRng(42));
    expect(a.map((s) => s.player.id)).toEqual(b.map((s) => s.player.id));
  });
});
