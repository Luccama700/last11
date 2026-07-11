import { describe, expect, it } from 'vitest';
import { stealGainV2, effectiveRatingV2 } from './draft';
import { affinity } from './affinity';
import { formationById, type XiSlotV2 } from './types';
import type { PlayerV2, Position } from './data/schema';

// The exact math the StealScreen's `gainAt` runs (it now calls stealGainV2). A steal's
// gain = effectiveRatingV2(incoming @ slot) − effectiveRatingV2(occupant @ slot), both
// rated at the slot's FORMATION position — so NATURAL always retains full base rating.

const F433 = formationById('4-3-3')!;
// 4-3-3 slots: GK RB CB CB LB CDM CM CM RW ST LW
const RW_SLOT = F433.slots.indexOf('RW'); // 8
const LW_SLOT = F433.slots.indexOf('LW'); // 10
const CM_SLOT = F433.slots.indexOf('CM'); // 6

const mk = (position: Position, rating: number, id: string = position, secondary?: Position[]): PlayerV2 => ({
  id,
  name: id,
  nation: 'BRA',
  year: 2026,
  position,
  rating,
  secondary,
});

/** A dense fielded XI where every slot's occupant is NATURAL at that slot (base 80). */
function naturalSlate(): XiSlotV2[] {
  return F433.slots.map((position, i) => ({ position, player: mk(position, 80, `p${i}`) }));
}

describe('stealGainV2 — natural placement is a zero delta (bug A2)', () => {
  it('a natural incoming swapped for an equal-rated natural occupant gains exactly 0', () => {
    const slate = naturalSlate();
    // slate[8] is a natural RW/80; bring in another natural RW/80.
    expect(stealGainV2(slate, F433, mk('RW', 80, 'in'), RW_SLOT, affinity)).toBeCloseTo(0, 6);
    expect(stealGainV2(slate, F433, mk('LW', 80, 'in'), LW_SLOT, affinity)).toBeCloseTo(0, 6);
  });

  it('a natural incoming is credited his FULL base rating at his slot', () => {
    const slate = naturalSlate();
    // Empty-value baseline: occupant rating 0 ⇒ gain == the incoming\'s credited rating.
    const slate0 = slate.map((s, i) => (i === RW_SLOT ? { ...s, player: mk('RW', 0, 'z') } : s));
    expect(stealGainV2(slate0, F433, mk('RW', 91, 'in'), RW_SLOT, affinity)).toBeCloseTo(91, 6);
  });

  it('a listed secondary position is natural too (zero loss)', () => {
    const slate = naturalSlate();
    const slate0 = slate.map((s, i) => (i === CM_SLOT ? { ...s, player: mk('CM', 0, 'z') } : s));
    // A CAM whose secondary includes CM keeps full rating in the CM slot.
    const camWithCmSecondary = mk('CAM', 88, 'in', ['CM']);
    expect(stealGainV2(slate0, F433, camWithCmSecondary, CM_SLOT, affinity)).toBeCloseTo(88, 6);
  });
});

describe('effectiveRatingV2 — retuned off-position calibration @ 90 baseline', () => {
  // Lucca's rating-point anchors: the loss (90 − effective) at a 90-rated baseline.
  const cases: Array<{ natural: Position; slot: Position; lossPts: number }> = [
    { natural: 'LW', slot: 'LM', lossPts: 1 }, // W→WM  (−1 pt, wing-adjacent, both flanks)
    { natural: 'RW', slot: 'RM', lossPts: 1 },
    { natural: 'LM', slot: 'LB', lossPts: 3 }, // WM→FB (−3 pt, mid→back, same flank)
    { natural: 'RM', slot: 'RB', lossPts: 3 },
    { natural: 'CAM', slot: 'CM', lossPts: 4 }, // CAM→CM (−4 pt)
  ];
  for (const { natural, slot, lossPts } of cases) {
    it(`${natural} at ${slot} loses ~${lossPts} pt`, () => {
      const eff = effectiveRatingV2(mk(natural, 90), slot, affinity);
      expect(90 - eff).toBeCloseTo(lossPts, 1); // within 0.05 pt of the anchor
    });
  }

  it('scales with the player — a 60-rated CAM at CM loses ~4×(60/90)', () => {
    const eff = effectiveRatingV2(mk('CAM', 60), 'CM', affinity);
    expect(60 - eff).toBeCloseTo(4 * (60 / 90), 1);
  });
});

describe('stealGainV2 — off-position incoming through the full steal path', () => {
  it('a natural CAM swapped into a CM slot over an equal-rated natural CM is the −4 anchor', () => {
    const slate = naturalSlate(); // slate[CM_SLOT] is a natural CM
    const slate90 = slate.map((s, i) => (i === CM_SLOT ? { ...s, player: mk('CM', 90, 'occ') } : s));
    const gain = stealGainV2(slate90, F433, mk('CAM', 90, 'in'), CM_SLOT, affinity);
    expect(gain).toBeCloseTo(-4, 1); // 90*aff(CAM,CM) − 90 ≈ −4
  });
});
