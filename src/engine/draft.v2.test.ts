import { describe, expect, it } from 'vitest';
import {
  affinityForV2,
  autoArrange,
  BOT_FORMATION_WEIGHTS,
  botBestPlacement,
  draftBotSlateV2,
  draftOptionsV2,
  effectiveRatingV2,
  openSlots,
  pickBotFormation,
  pickBotStyle,
  isSamePerson,
  movePlaced,
  personKey,
  pickValueV2,
  placeholderAffinity,
  playerV2ById,
  rankStealCandidates,
  slotFitsForPlayer,
  sortByBoost,
  spinSquadV2,
  swapSlots,
} from './draft';
import { squadByRef } from './data/loader';
import { affinity as realAffinity } from './affinity';
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

describe('BOT_FORMATION_WEIGHTS — sensible spread, no shape starved or overweighted', () => {
  const catalog = new Set(FORMATIONS.map((f) => f.id));
  const weights = Object.entries(BOT_FORMATION_WEIGHTS);

  it('every weighted id is a real catalog formation (no typo → silent 4-3-3 fallback)', () => {
    for (const [id] of weights) expect(catalog.has(id)).toBe(true);
  });

  it('every catalog formation carries a positive weight — none starved', () => {
    // Tripwire: when a new shape (e.g. the 4-1-2-1-2 diamonds) lands in FORMATIONS,
    // this goes red until its weight is added to BOT_FORMATION_WEIGHTS.
    for (const f of FORMATIONS) {
      expect(BOT_FORMATION_WEIGHTS[f.id] ?? 0).toBeGreaterThan(0);
    }
  });

  it('no shape is grossly overweighted (heaviest ≤ 4× lightest)', () => {
    const ws = weights.map(([, w]) => w);
    expect(Math.max(...ws)).toBeLessThanOrEqual(4 * Math.min(...ws));
    for (const w of ws) expect(w).toBeGreaterThanOrEqual(1);
  });

  it('pickBotFormation actually reaches every catalog shape across seeds', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 4000; seed++) seen.add(pickBotFormation(createRng(seed)).id);
    for (const f of FORMATIONS) expect(seen.has(f.id)).toBe(true);
    for (const id of seen) expect(catalog.has(id)).toBe(true); // never an out-of-catalog fallback
  });
});

describe('integration with game-engine AFFINITY_MATRIX (the wired-in values)', () => {
  it('upholds the invariants the draft relies on: diagonal 1, every cell > 0', () => {
    for (const a of POSITIONS)
      for (const b of POSITIONS) {
        const v = realAffinity(a, b);
        expect(v).toBeGreaterThan(0); // never dead-ends the free-pick draft
        expect(v).toBeLessThanOrEqual(1);
        if (a === b) expect(v).toBe(1);
      }
  });
  it('bots draft a full legal XI for every formation on the real matrix', () => {
    for (const f of FORMATIONS) {
      const slate = draftBotSlateV2(createRng(11), f, realAffinity);
      expect(slate.every((s) => s !== null)).toBe(true);
      expect(new Set(slate.map((s) => s.player.id)).size).toBe(f.slots.length);
    }
  });
  it('rewards natural fit: a CB values a CB slot over a distant ST slot', () => {
    const cb = bra2002.find((p) => p.position === 'CB')!;
    expect(pickValueV2(cb, 'CB', realAffinity)).toBeGreaterThan(pickValueV2(cb, 'ST', realAffinity));
  });
});

describe('sortByBoost — squad-card options ranked by achievable points added', () => {
  it('ranks by best-slot pickValue, descending and deterministic', () => {
    const ranked = sortByBoost(bra2002, emptySlate(11), F433, placeholderAffinity);
    expect(ranked).toHaveLength(bra2002.length);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].boost).toBeGreaterThanOrEqual(ranked[i].boost);
    // boost equals pickValue at the chosen best open slot
    for (const r of ranked) {
      expect(r.bestSlot).not.toBeNull();
      expect(r.boost).toBeCloseTo(pickValueV2(r.player, r.bestSlot!.position, placeholderAffinity), 6);
    }
    // deterministic
    const again = sortByBoost(bra2002, emptySlate(11), F433, placeholderAffinity);
    expect(again.map((r) => r.player.id)).toEqual(ranked.map((r) => r.player.id));
  });
  it('the top option is the strongest available pick', () => {
    const ranked = sortByBoost(bra2002, emptySlate(11), F433, placeholderAffinity);
    const maxBoost = Math.max(
      ...bra2002.map((p) => Math.max(...slotFitsForPlayer(emptySlate(11), F433, p, placeholderAffinity).map((f) => pickValueV2(p, f.position, placeholderAffinity)))),
    );
    expect(ranked[0].boost).toBeCloseTo(maxBoost, 6);
  });
  it('boost is 0 when the slate is full (no open slot)', () => {
    const full = bra2002.slice(0, 11).map((player, i) => ({ position: F433.slots[i], player }));
    const ranked = sortByBoost([bra2002[12]], full, F433, placeholderAffinity);
    expect(ranked[0].boost).toBe(0);
    expect(ranked[0].bestSlot).toBeNull();
  });
});

describe('rankStealCandidates — detailed steal list for a full XI', () => {
  const xi = bra2002.slice(0, 11).map((player, i) => ({ position: F433.slots[i], player }));
  const pool = squadByRef('ARG', 1986).players;
  it('carries the DETAILED position label and best swap slot, best gain first', () => {
    const ranked = rankStealCandidates(pool, xi, F433, placeholderAffinity);
    expect(ranked.length).toBeGreaterThan(0);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].gain).toBeGreaterThanOrEqual(ranked[i].gain);
    for (const c of ranked) {
      expect(POSITIONS).toContain(c.position); // detailed, never GK/DF/MF/FW
      expect(c.bestSlotIndex).toBeGreaterThanOrEqual(0);
      expect(c.bestSlotIndex).toBeLessThan(11);
      expect(c.bestPosition).toBe(F433.slots[c.bestSlotIndex]);
    }
  });
  it('excludes players already on the XI', () => {
    const withOwn = [...pool, xi[0].player];
    const ranked = rankStealCandidates(withOwn, xi, F433, placeholderAffinity);
    expect(ranked.some((c) => c.player.id === xi[0].player.id)).toBe(false);
  });
});

describe('playerV2ById — lift a coarse-projected id back to detailed', () => {
  it('resolves a known id and misses an unknown one', () => {
    const known = bra2002[0];
    expect(playerV2ById(known.id)?.position).toBe(known.position);
    expect(playerV2ById('nope-9999-x')).toBeUndefined();
  });
});

describe('personKey / isSamePerson — same person across year snapshots (Image-#12)', () => {
  it('strips the year segment; nation+slug identifies the person', () => {
    expect(personKey('fra-2026-mbappe')).toBe('fra-mbappe');
    expect(personKey('fra-2018-mbappe')).toBe('fra-mbappe');
    expect(personKey('arg-2026-e-martinez')).toBe('arg-e-martinez'); // hyphenated slug
    expect(isSamePerson('fra-2026-mbappe', 'fra-2018-mbappe')).toBe(true);
    expect(isSamePerson('fra-2026-mbappe', 'bra-2002-ronaldo')).toBe(false);
  });
});

describe('person-uniqueness — never the same person twice in one XI', () => {
  const fra2026 = squadByRef('FRA', 2026).players;
  const fra2018 = squadByRef('FRA', 2018).players;
  const mbappe26 = fra2026.find((p) => p.id === 'fra-2026-mbappe')!;
  const mbappe18 = fra2018.find((p) => p.id === 'fra-2018-mbappe')!;

  it('the exact Mbappé fixture exists (owned 2026 + stealable 2018)', () => {
    expect(mbappe26).toBeTruthy();
    expect(mbappe18).toBeTruthy();
    expect(isSamePerson(mbappe26.id, mbappe18.id)).toBe(true);
  });
  it('draftOptionsV2 hides a different-year snapshot of an owned player', () => {
    const slate = emptySlate(11);
    slate[9] = { position: F433.slots[9], player: mbappe26 };
    const opts = draftOptionsV2(slate, { nation: 'FRA', year: 2018 });
    expect(opts.some((p) => p.id === 'fra-2018-mbappe')).toBe(false);
    expect(opts.length).toBeGreaterThan(0); // other 2018 France players still offered
  });
  it('rankStealCandidates excludes a different-year snapshot of a starter', () => {
    const xi = [...bra2002.slice(0, 10), mbappe26].map((player, i) => ({ position: F433.slots[i], player }));
    const ranked = rankStealCandidates([mbappe18, ...squadByRef('ARG', 1986).players], xi, F433, placeholderAffinity);
    expect(ranked.some((c) => c.player.id === 'fra-2018-mbappe')).toBe(false);
  });
});

describe('movePlaced — mid-draft move to an open slot', () => {
  it('moves a placed player to an open slot, taking that slot position', () => {
    const slate = emptySlate(11);
    slate[9] = { position: F433.slots[9], player: bra2002[0] };
    const moved = movePlaced(slate, F433, 9, 2);
    expect(moved[9]).toBeNull();
    expect(moved[2]!.player.id).toBe(bra2002[0].id);
    expect(moved[2]!.position).toBe(F433.slots[2]);
  });
  it('is a no-op when the target is filled, the source is empty, or from===to', () => {
    const slate = emptySlate(11);
    slate[9] = { position: F433.slots[9], player: bra2002[0] };
    slate[2] = { position: F433.slots[2], player: bra2002[1] };
    const ids = (s: readonly (typeof slate)[number][]) => s.map((x) => x?.player.id ?? null);
    expect(ids(movePlaced(slate, F433, 9, 2))).toEqual(ids(slate)); // to filled
    expect(movePlaced(emptySlate(11), F433, 0, 1).every((s) => s === null)).toBe(true); // from empty
    expect(ids(movePlaced(slate, F433, 9, 9))).toEqual(ids(slate)); // same slot
    expect(ids(movePlaced(slate, F433, 9, 99))).toEqual(ids(slate)); // out of range
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
