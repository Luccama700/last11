import { describe, expect, it } from 'vitest';
import {
  affinityForV2,
  autoArrange,
  botBestPlacement,
  draftBotSlateV2,
  draftOptionsV2,
  effectiveRatingV2,
  openSlots,
  pickBotFormation,
  pickBotStyle,
  pickValueV2,
  placeholderAffinity,
  slotFitsForPlayer,
  spinSquadV2,
  swapSlots,
} from './draft';
import { squadByRef } from './data/loader';
import { POSITIONS, type PlayerV2, type Position } from './data/schema';
import { FORMATIONS, formationById, type AffinityFn, type XiSlotV2 } from './types';
import { createRng } from './rng';

const F433 = formationById('4-3-3')!;
const bra2002 = squadByRef('BRA', 2002).players;
const emptySlate = (n: number): (XiSlotV2 | null)[] => new Array(n).fill(null);

// A blunt test matrix so fit tests don't depend on the placeholder's exact numbers.
const testAff: AffinityFn = (natural, slot) => (natural === slot ? 1 : 0.5);

describe('placeholderAffinity — CONTRACT §1 invariants', () => {
  it('diagonal is exactly 1', () => {
    for (const p of POSITIONS) expect(placeholderAffinity(p, p)).toBe(1);
  });
  it('every cell is strictly > 0 and ≤ 1', () => {
    for (const a of POSITIONS)
      for (const b of POSITIONS) {
        const v = placeholderAffinity(a, b);
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThanOrEqual(1);
      }
  });
  it('is forgiving: same-zone ≥ .85, any GK↔outfield = .28', () => {
    expect(placeholderAffinity('CB', 'RB')).toBeGreaterThanOrEqual(0.85); // both DEF
    expect(placeholderAffinity('CM', 'CAM')).toBeGreaterThanOrEqual(0.85); // both MID
    expect(placeholderAffinity('GK', 'ST')).toBe(0.28);
    expect(placeholderAffinity('ST', 'GK')).toBe(0.28);
  });
});

describe('affinityForV2 / effectiveRatingV2', () => {
  const p: PlayerV2 = { id: 'x', name: 'X', nation: 'BRA', year: 2026, position: 'CM', secondary: ['CAM'], rating: 80 };
  it('primary and secondary positions are natural (1.0)', () => {
    expect(affinityForV2(p, 'CM', testAff)).toBe(1);
    expect(affinityForV2(p, 'CAM', testAff)).toBe(1);
  });
  it('off-position defers to the affinity fn', () => {
    expect(affinityForV2(p, 'ST', testAff)).toBe(0.5);
    expect(effectiveRatingV2(p, 'ST', testAff)).toBe(40);
  });
});

describe('pickValueV2 — affinity-weighted rating + star, no chemistry', () => {
  it('adds a star nudge at/above threshold', () => {
    const star: PlayerV2 = { id: 's', name: 'S', nation: 'BRA', year: 2026, position: 'ST', rating: 90 };
    const plain: PlayerV2 = { id: 'p', name: 'P', nation: 'BRA', year: 2026, position: 'ST', rating: 87 };
    expect(pickValueV2(star, 'ST', testAff)).toBe(93); // 90 + 3
    expect(pickValueV2(plain, 'ST', testAff)).toBe(87); // no star
  });
});

describe('spinSquadV2 — deterministic roll', () => {
  it('same seed ⇒ same roll sequence', () => {
    const a = createRng(7);
    const b = createRng(7);
    for (let i = 0; i < 5; i++) expect(spinSquadV2(a)).toEqual(spinSquadV2(b));
  });
});

describe('draftOptionsV2 / openSlots', () => {
  it('excludes players already on the slate', () => {
    const slate = emptySlate(11);
    slate[0] = { position: 'GK', player: bra2002[0] };
    const opts = draftOptionsV2(slate, { nation: 'BRA', year: 2002 });
    expect(opts.some((p) => p.id === bra2002[0].id)).toBe(false);
    expect(openSlots(slate)).not.toContain(0);
    expect(openSlots(slate)).toHaveLength(10);
  });
});

describe('slotFitsForPlayer — never dead-ends, best-first', () => {
  const player = bra2002.find((p) => p.position === 'ST')!;
  it('returns a fit for every open slot (affinity always > 0)', () => {
    const fits = slotFitsForPlayer(emptySlate(11), F433, player, placeholderAffinity);
    expect(fits).toHaveLength(11);
  });
  it('is sorted by effective rating, natural flag set on primary/secondary slots', () => {
    const fits = slotFitsForPlayer(emptySlate(11), F433, player, placeholderAffinity);
    for (let i = 1; i < fits.length; i++) expect(fits[i - 1].effective).toBeGreaterThanOrEqual(fits[i].effective);
    const stFit = fits.find((f) => f.position === 'ST')!;
    expect(stFit.natural).toBe(true);
  });
});

describe('botBestPlacement — deterministic argmax', () => {
  it('picks the highest-value (player, slot) pair', () => {
    const cands = squadByRef('BRA', 2002).players;
    const best = botBestPlacement(emptySlate(11), F433, cands, placeholderAffinity)!;
    expect(best).toBeTruthy();
    // no candidate/slot beats the chosen one
    for (const p of cands)
      for (const s of openSlots(emptySlate(11)))
        expect(pickValueV2(p, F433.slots[s], placeholderAffinity)).toBeLessThanOrEqual(best.value + 1e-9);
  });
  it('returns null when no slot is open', () => {
    const full = bra2002.slice(0, 11).map((player, i) => ({ position: F433.slots[i], player }));
    expect(botBestPlacement(full, F433, bra2002, placeholderAffinity)).toBeNull();
  });
});

describe('draftBotSlateV2 — full legal XI, deterministic', () => {
  it('fills all 11 slots with no duplicate players', () => {
    const slate = draftBotSlateV2(createRng(42), F433, placeholderAffinity);
    expect(slate).toHaveLength(11);
    expect(slate.every((s) => s !== null)).toBe(true);
    const ids = slate.map((s) => s.player.id);
    expect(new Set(ids).size).toBe(11);
    slate.forEach((s, i) => expect(s.position).toBe(F433.slots[i]));
  });
  it('same seed + formation ⇒ identical slate', () => {
    const a = draftBotSlateV2(createRng(99), F433, placeholderAffinity);
    const b = draftBotSlateV2(createRng(99), F433, placeholderAffinity);
    expect(a.map((s) => s.player.id)).toEqual(b.map((s) => s.player.id));
  });
  it('drafts a legal XI for every formation', () => {
    for (const f of FORMATIONS) {
      const slate = draftBotSlateV2(createRng(5), f, placeholderAffinity);
      expect(slate.every((s) => s !== null)).toBe(true);
      expect(slate).toHaveLength(f.slots.length);
    }
  });
});

describe('pickBotFormation / pickBotStyle — deterministic + valid', () => {
  it('same seed ⇒ same choice; results are in-domain', () => {
    expect(pickBotFormation(createRng(3)).id).toBe(pickBotFormation(createRng(3)).id);
    expect(FORMATIONS).toContainEqual(pickBotFormation(createRng(3)));
    expect(['defensive', 'balanced', 'attacking']).toContain(pickBotStyle(createRng(3)));
  });
});

describe('swapSlots — between-match re-slot primitive', () => {
  it('swaps two players but keeps each slot position', () => {
    const xi: XiSlotV2[] = bra2002.slice(0, 11).map((player, i) => ({ position: F433.slots[i], player }));
    const out = swapSlots(xi, 1, 9);
    expect(out[1].player.id).toBe(xi[9].player.id);
    expect(out[9].player.id).toBe(xi[1].player.id);
    expect(out[1].position).toBe(F433.slots[1]);
    expect(out[9].position).toBe(F433.slots[9]);
    // untouched slots unchanged
    expect(out[5]).toBe(xi[5]);
  });
  it('is a no-op copy when a === b', () => {
    const xi: XiSlotV2[] = bra2002.slice(0, 11).map((player, i) => ({ position: F433.slots[i], player }));
    expect(swapSlots(xi, 3, 3).map((s) => s.player.id)).toEqual(xi.map((s) => s.player.id));
  });
});

describe('autoArrange — best-affinity assignment, deterministic', () => {
  it('places every player and fills every slot', () => {
    const eleven = bra2002.slice(0, 11);
    const arranged = autoArrange(eleven, F433, placeholderAffinity);
    expect(arranged.every((s) => s !== null)).toBe(true);
    expect(new Set(arranged.map((s) => s.player.id)).size).toBe(11);
  });
  it('prefers natural slots when possible (a GK lands in the GK slot)', () => {
    const gk = bra2002.find((p) => p.position === 'GK')!;
    const outfield = bra2002.filter((p) => p.position !== 'GK').slice(0, 10);
    const arranged = autoArrange([gk, ...outfield], F433, placeholderAffinity);
    const gkSlot = arranged[F433.slots.indexOf('GK' as Position)];
    expect(gkSlot.player.id).toBe(gk.id);
  });
});
