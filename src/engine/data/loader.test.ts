import { describe, expect, it } from 'vitest';
import {
  SquadDataError,
  activeCoarseSquads,
  allSquadsV2,
  parseSquadsFile,
  playersV2,
  squadByRef,
  squadRefsV2,
  v2Nations,
  v2PlayerToCoarse,
} from './loader';
import { POSITIONS, detailedToCoarse, squadKey, type SquadsFileV2 } from './schema';

describe('schema helpers', () => {
  it('every detailed position maps to a coarse zone', () => {
    for (const p of POSITIONS) expect(['GK', 'DF', 'MF', 'FW']).toContain(detailedToCoarse(p));
  });
  it('squadKey is (nation, year)', () => {
    expect(squadKey('BRA', 2002)).toBe('BRA-2002');
  });
});

describe('bundled squads-v2.json', () => {
  const squads = allSquadsV2();
  const players = playersV2();

  it('loads, validates and denormalizes without throwing', () => {
    expect(squads.length).toBeGreaterThanOrEqual(15);
    expect(players.length).toBeGreaterThan(200);
  });

  it('stamps nation/year down onto every player, renames pos→position', () => {
    for (const p of players) {
      expect(p.nation).toBeTruthy();
      expect(typeof p.year).toBe('number');
      expect(POSITIONS).toContain(p.position);
      expect(p.id.startsWith(`${p.nation.toLowerCase()}-${p.year}-`)).toBe(true);
    }
  });

  it('player ids are globally unique across (nation, year)', () => {
    const ids = players.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('(nation, year) keys are unique', () => {
    const keys = squads.map((s) => squadKey(s.nation, s.year));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every squad can field an XI: >=11 players and >=1 GK', () => {
    for (const s of squads) {
      expect(s.players.length).toBeGreaterThanOrEqual(11);
      expect(s.players.some((p) => p.position === 'GK')).toBe(true);
    }
  });

  it('ratings sit on the new scale (1..97 ceiling, high floor)', () => {
    for (const p of players) {
      expect(p.rating).toBeGreaterThanOrEqual(1);
      expect(p.rating).toBeLessThanOrEqual(97);
    }
  });

  it('the same real player across years is distinct, draftable entries', () => {
    // Brazil appears at multiple tournament years as separate keys; the same real
    // player (Cafu 1994/2002, Ronaldo 1994/2002) is a distinct entry per year.
    const braKeys = squads.filter((s) => s.nation === 'BRA').map((s) => s.year).sort();
    expect(braKeys).toEqual([1970, 1994, 2002, 2026]);
    const cafus = players.filter((p) => p.name === 'Cafu').map((p) => p.year).sort();
    expect(cafus).toEqual([1994, 2002]); // young rotation → peak captain
  });
});

describe('ratings rubric anchors (Lucca DECISIONS.md — lock these)', () => {
  const find = (id: string) => playersV2().find((p) => p.id === id);

  it('Pelé 1970 = 97 is the unique ceiling; nobody higher', () => {
    expect(find('bra-1970-pele')?.rating).toBe(97);
    const max = Math.max(...playersV2().map((p) => p.rating));
    expect(max).toBe(97);
    expect(playersV2().filter((p) => p.rating === 97)).toHaveLength(1);
  });

  it('Maradona 1986 = 96 and R9 Ronaldo 2002 = 96', () => {
    expect(find('arg-1986-maradona')?.rating).toBe(96);
    expect(find('bra-2002-ronaldo')?.rating).toBe(96);
  });

  it('Messi 2026 = 92', () => {
    expect(find('arg-2026-messi')?.rating).toBe(92);
  });

  it('Gabriel Magalhães 2026 sits high-80s (89–90), not compressed low', () => {
    const r = find('bra-2026-gabriel')?.rating ?? 0;
    expect(r).toBeGreaterThanOrEqual(89);
    expect(r).toBeLessThanOrEqual(90);
  });

  it('all-time-great peaks sit at 95 (Zidane 98, Cruyff 74, Romário 94)', () => {
    expect(find('fra-1998-zidane')?.rating).toBe(95);
    expect(find('ned-1974-cruyff')?.rating).toBe(95);
    expect(find('bra-1994-romario')?.rating).toBe(95);
  });

  it('Messi 2022 = 96 (crowning tournament), veteran-drops to his fixed 92 in 2026', () => {
    expect(find('arg-2022-messi')?.rating).toBe(96);
    expect(find('arg-2026-messi')?.rating).toBe(92);
  });
});

describe('back-compat adapter (CONTRACT §7)', () => {
  it('v2 detailed position projects to the coarse zone', () => {
    const cafu = playersV2().find((p) => p.id === 'bra-2002-cafu')!;
    expect(v2PlayerToCoarse(cafu).position).toBe('DF'); // RB → DEF → DF
  });

  it('dataV2 OFF returns the legacy 12×12 dataset (144 players)', () => {
    const coarse = activeCoarseSquads(false);
    expect(coarse.length).toBe(144);
    for (const p of coarse) expect(['GK', 'DF', 'MF', 'FW']).toContain(p.position);
  });

  it('dataV2 ON returns the 12 2026 nations as coarse players', () => {
    const coarse = activeCoarseSquads(true, 2026);
    expect(v2Nations(2026).length).toBe(12);
    expect(coarse.length).toBe(12 * 16);
    for (const p of coarse) expect(['GK', 'DF', 'MF', 'FW']).toContain(p.position);
  });
});

describe('squadByRef + steal-pool source', () => {
  it('returns the full verified roster for a rolled (nation, year)', () => {
    const bra02 = squadByRef('BRA', 2002);
    expect(bra02.players.length).toBe(23);
    expect(bra02.players.find((p) => p.name === 'Ronaldo')?.rating).toBe(96);
  });
  it('every rollable ref resolves', () => {
    for (const ref of squadRefsV2()) expect(squadByRef(ref.nation, ref.year).players.length).toBeGreaterThan(0);
  });
  it('throws on an unknown squad', () => {
    expect(() => squadByRef('BRA', 1999)).toThrow(SquadDataError);
  });
});

describe('validation rejects malformed data', () => {
  const good = (): SquadsFileV2 => ({
    version: 2,
    squads: [
      {
        nation: 'TST', name: 'Test', year: 2026,
        players: Array.from({ length: 11 }, (_, i) => ({
          id: `tst-2026-p${i}`, name: `P${i}`, pos: i === 0 ? 'GK' : 'CM', rating: 80,
        })),
      },
    ],
  });

  it('accepts a well-formed file', () => {
    expect(() => parseSquadsFile(good())).not.toThrow();
  });
  it('rejects wrong version', () => {
    expect(() => parseSquadsFile({ ...good(), version: 1 as unknown as 2 })).toThrow(SquadDataError);
  });
  it('rejects an unknown position', () => {
    const f = good();
    (f.squads[0].players[1] as { pos: string }).pos = 'SW';
    expect(() => parseSquadsFile(f)).toThrow(/invalid position/);
  });
  it('rejects an out-of-range rating', () => {
    const f = good();
    f.squads[0].players[1].rating = 140;
    expect(() => parseSquadsFile(f)).toThrow(/rating/);
  });
  it('rejects a squad with no GK', () => {
    const f = good();
    f.squads[0].players[0].pos = 'CB';
    expect(() => parseSquadsFile(f)).toThrow(/GK/);
  });
  it('rejects a mis-prefixed id', () => {
    const f = good();
    f.squads[0].players[1].id = 'wrong-id';
    expect(() => parseSquadsFile(f)).toThrow(/prefixed/);
  });
  it('rejects duplicate (nation, year)', () => {
    const f = good();
    f.squads.push(JSON.parse(JSON.stringify(f.squads[0])));
    expect(() => parseSquadsFile(f)).toThrow(/duplicate squad key/);
  });
});
