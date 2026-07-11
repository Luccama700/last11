import { describe, expect, it } from 'vitest';
import { affinity, AFFINITY_MATRIX } from './affinity';
import { POSITIONS } from './data/schema';

// Locks in Lucca's NIGHT BATCH 2 rating-point calibration (see affinity.ts's
// header comment for the penalty->mult derivation) so a future retune is a
// deliberate, visible diff here rather than a silent drift.
describe('AFFINITY_MATRIX — Lucca calibration (night batch 2)', () => {
  it('W<->WM anchors: LW<->LM, RW<->RM ~ 0.989 (−1pt), both directions', () => {
    expect(affinity('LW', 'LM')).toBeCloseTo(0.989, 3);
    expect(affinity('LM', 'LW')).toBeCloseTo(0.989, 3);
    expect(affinity('RW', 'RM')).toBeCloseTo(0.989, 3);
    expect(affinity('RM', 'RW')).toBeCloseTo(0.989, 3);
  });

  it('WM->FB anchor: LM->LB, RM->RB ~ 0.967 (−3pt)', () => {
    expect(affinity('LM', 'LB')).toBeCloseTo(0.967, 3);
    expect(affinity('RM', 'RB')).toBeCloseTo(0.967, 3);
  });

  it('CAM->CM anchor ~ 0.956 (−4pt)', () => {
    expect(affinity('CAM', 'CM')).toBeCloseTo(0.956, 3);
  });

  it('mirrors L/R exactly — every left-flank cell equals its right-flank counterpart', () => {
    const MIRROR: [string, string][] = [
      ['LW', 'LM'], ['LM', 'LW'], ['LM', 'LB'], ['LB', 'LM'],
      ['LW', 'LB'], ['LB', 'LW'],
    ];
    const toRight = (p: string) => (p.startsWith('L') ? 'R' + p.slice(1) : p);
    for (const [natural, slot] of MIRROR) {
      expect(affinity(toRight(natural) as any, toRight(slot) as any)).toBeCloseTo(
        affinity(natural as any, slot as any),
        6,
      );
    }
  });

  it('diagonal is exactly 1 for every position', () => {
    for (const p of POSITIONS) expect(AFFINITY_MATRIX[p][p]).toBe(1);
  });

  it('every cell is strictly > 0 (draft never dead-ends)', () => {
    for (const natural of POSITIONS) {
      for (const slot of POSITIONS) {
        expect(AFFINITY_MATRIX[natural][slot]).toBeGreaterThan(0);
      }
    }
  });
});
