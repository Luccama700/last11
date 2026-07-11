import { describe, expect, it } from 'vitest';
import { layoutFormation } from './board-layout';
import { FORMATIONS } from '../../engine/types';

describe('layoutFormation', () => {
  it('returns one coord per slot, all in-bounds', () => {
    for (const f of FORMATIONS) {
      const coords = layoutFormation(f.slots);
      expect(coords).toHaveLength(f.slots.length);
      coords.forEach((c, i) => {
        expect(c.slotIndex).toBe(i);
        expect(c.position).toBe(f.slots[i]);
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.x).toBeLessThanOrEqual(1);
        expect(c.y).toBeGreaterThan(0);
        expect(c.y).toBeLessThan(1);
      });
    }
  });

  it('puts the GK deepest and a striker furthest forward', () => {
    const coords = layoutFormation(FORMATIONS.find((f) => f.id === '4-3-3')!.slots);
    const gk = coords.find((c) => c.position === 'GK')!;
    const st = coords.find((c) => c.position === 'ST')!;
    expect(gk.y).toBeLessThan(st.y);
    expect(coords.every((c) => c.y >= gk.y)).toBe(true);
  });

  it('places right-lane positions right of left-lane ones in the same band', () => {
    const coords = layoutFormation(FORMATIONS.find((f) => f.id === '4-3-3')!.slots);
    const rb = coords.find((c) => c.position === 'RB')!;
    const lb = coords.find((c) => c.position === 'LB')!;
    expect(rb.x).toBeGreaterThan(lb.x);
  });

  it('is deterministic', () => {
    const a = layoutFormation(FORMATIONS[0].slots);
    const b = layoutFormation(FORMATIONS[0].slots);
    expect(a).toEqual(b);
  });

  it('lays out the 4-1-2-1-2 diamond sanely (twin STs split, CDM behind CAM)', () => {
    const coords = layoutFormation(FORMATIONS.find((f) => f.id === '4-1-2-1-2')!.slots);
    const sts = coords.filter((c) => c.position === 'ST');
    expect(sts).toHaveLength(2);
    expect(sts[0].x).not.toBeCloseTo(sts[1].x, 5); // strikers don't stack on one point
    const cms = coords.filter((c) => c.position === 'CM');
    expect(cms[0].x).not.toBeCloseTo(cms[1].x, 5); // twin CMs split around centre
    const cdm = coords.find((c) => c.position === 'CDM')!;
    const cam = coords.find((c) => c.position === 'CAM')!;
    expect(cdm.y).toBeLessThan(cam.y); // holding mid sits deeper than the No.10
  });

  it('lays out the wide 4-1-2-1-2 with RM/LM hugging the touchlines', () => {
    const coords = layoutFormation(FORMATIONS.find((f) => f.id === '4-1-2-1-2-wide')!.slots);
    const rm = coords.find((c) => c.position === 'RM')!;
    const lm = coords.find((c) => c.position === 'LM')!;
    expect(rm.x).toBeGreaterThan(lm.x); // right of left
    expect(rm.x).toBeGreaterThan(0.5);
    expect(lm.x).toBeLessThan(0.5);
  });
});
