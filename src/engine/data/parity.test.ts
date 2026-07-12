/**
 * SP ↔ MP universe parity (brief §4). Singleplayer and multiplayer draft from the
 * SAME data file via `squadRefsV2()`; these pins guarantee the multiplayer squad
 * order is exactly that universe (a permutation, nothing added or dropped), every
 * player id in the file resolves back to a detailed PlayerV2, and every rollable
 * (nation, year) round-trips through `squadByRef`. If a future data edit desyncs
 * the two, one of these goes red.
 */
import { describe, expect, it } from 'vitest';
import { playerV2ById } from '../draft';
import { shuffledSquadOrder } from '../mp';
import { playersV2, squadByRef, squadRefsV2 } from './loader';
import { squadKey } from './schema';

const keyOf = (r: { nation: string; year: number }) => squadKey(r.nation, r.year);

describe('SP ↔ MP draft the same universe (brief §4)', () => {
  it('shuffledSquadOrder(seed) is a permutation of exactly squadRefsV2()', () => {
    const refs = squadRefsV2();
    for (const seed of [0, 1, 42, 777, 123456]) {
      const order = shuffledSquadOrder(seed);
      expect(order.length).toBe(refs.length);
      const orderKeys = order.map(keyOf).sort();
      const refKeys = refs.map(keyOf).sort();
      expect(orderKeys).toEqual(refKeys); // same multiset — nothing added/dropped
      expect(new Set(orderKeys).size).toBe(order.length); // and no duplicates
    }
  });

  it('every player id in the file resolves via playerV2ById', () => {
    for (const p of playersV2()) {
      const found = playerV2ById(p.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(p.id);
    }
  });

  it('every rollable squad ref round-trips through squadByRef', () => {
    for (const ref of squadRefsV2()) {
      const squad = squadByRef(ref.nation, ref.year);
      expect(squad.nation).toBe(ref.nation);
      expect(squad.year).toBe(ref.year);
      expect(squad.players.length).toBeGreaterThanOrEqual(11);
      expect(squad.players.some((p) => p.position === 'GK')).toBe(true);
    }
  });
});
