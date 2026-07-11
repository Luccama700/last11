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
});
