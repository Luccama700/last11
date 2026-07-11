import { describe, expect, it } from 'vitest';
import { AFFINITY_MATRIX, affinity } from './affinity';
import { effectiveRatingV2 } from './draft';
import { displayedSquadRating } from './squad-rating';
import { playersV2 } from './data/loader';
import { FORMATIONS } from './types';
import { POSITIONS } from './data/schema';
import type { XiSlotV2 } from './types';

/**
 * INVARIANT LOCK for the rating pipeline (supports playtest bug A2 — natural-position
 * players displaying LOWERED ratings). These are hard, exhaustive invariants over the
 * REAL v2 database and REAL formations, not sampled scenarios: if any one fails, the
 * bug is engine-side and this file names exactly which guarantee broke.
 *
 * The single unbreakable law this locks: a player fielded at his OWN natural position
 * (or a listed secondary) keeps his rating EXACTLY — no affinity haircut, ever. Bug A2
 * showed a lowered number on-screen; draft-page owns the state-plumbing side (stale
 * `.position` after MOVE_PLACED). This is the engine-side lock so the same class of bug
 * can never silently return through `effectiveRatingV2` / `displayedSquadRating`.
 */

const ALL = playersV2();

describe('LOCK (1): natural & secondary positions keep FULL rating, exactly', () => {
  it('every v2 player at his natural position scores exactly his rating', () => {
    for (const p of ALL) {
      // === (not toBeCloseTo): a natural-position rating is the rating, bit-for-bit.
      expect(effectiveRatingV2(p, p.position, affinity)).toBe(p.rating);
    }
  });

  it('every v2 player at each of his secondary positions scores exactly his rating', () => {
    for (const p of ALL) {
      for (const s of p.secondary ?? []) {
        expect(effectiveRatingV2(p, s, affinity)).toBe(p.rating);
      }
    }
  });

  // The exact bug shape: a player dropped into a FORMATION slot that matches his
  // natural (or secondary) position must read full rating in that formation context.
  it('in EVERY formation, EVERY natural/secondary slot keeps full rating for EVERY player', () => {
    for (const p of ALL) {
      const home = new Set<string>([p.position, ...(p.secondary ?? [])]);
      for (const f of FORMATIONS) {
        for (const slot of f.slots) {
          if (home.has(slot)) {
            expect(effectiveRatingV2(p, slot, affinity)).toBe(p.rating);
          }
        }
      }
    }
  });
});

describe('LOCK (2): AFFINITY_MATRIX shape', () => {
  it('diagonal is exactly 1.0 for all 12 positions', () => {
    expect(POSITIONS).toHaveLength(12);
    for (const pos of POSITIONS) {
      expect(AFFINITY_MATRIX[pos][pos]).toBe(1.0);
    }
  });

  it('every cell is strictly > 0 (the draft can never dead-end)', () => {
    for (const natural of POSITIONS) {
      for (const slot of POSITIONS) {
        expect(AFFINITY_MATRIX[natural][slot]).toBeGreaterThan(0);
      }
    }
  });
});

describe('LOCK (3): retuned anchors + L/R family symmetry hold exactly', () => {
  it('W<->WM both directions = .989 (both flanks)', () => {
    expect(affinity('LW', 'LM')).toBe(0.989);
    expect(affinity('LM', 'LW')).toBe(0.989);
    expect(affinity('RW', 'RM')).toBe(0.989);
    expect(affinity('RM', 'RW')).toBe(0.989);
  });

  it('WM->FB = .967 (both flanks)', () => {
    expect(affinity('LM', 'LB')).toBe(0.967);
    expect(affinity('RM', 'RB')).toBe(0.967);
  });

  it('CAM->CM = .956', () => {
    expect(affinity('CAM', 'CM')).toBe(0.956);
  });

  it('L/R family symmetry: every left-flank cell equals its right-flank mirror', () => {
    const LEFT: readonly string[] = ['LW', 'LM', 'LB'];
    const RIGHT: readonly string[] = ['RW', 'RM', 'RB'];
    const mirror = (pos: string) => {
      const i = LEFT.indexOf(pos);
      return i === -1 ? pos : RIGHT[i];
    };
    for (const natural of POSITIONS) {
      for (const slot of POSITIONS) {
        expect(affinity(mirror(natural) as any, mirror(slot) as any)).toBe(
          affinity(natural, slot),
        );
      }
    }
  });
});

describe('LOCK (4): displayedSquadRating of an all-natural slate == sum of base ratings', () => {
  it('a slate where every player sits at his natural position sums to the rounded base total', () => {
    // Build an 11-slot slate placing each player at his OWN natural position.
    const eleven = ALL.slice(0, 11);
    expect(eleven).toHaveLength(11);
    const slate: XiSlotV2[] = eleven.map((player) => ({ position: player.position, player }));
    const base = Math.round(eleven.reduce((sum, p) => sum + p.rating, 0));
    expect(displayedSquadRating(slate)).toBe(base);
  });

  it('holds for a natural slate drawn from every squad across the database', () => {
    // Stress it beyond one slate: for each distinct nation/year block, take 11
    // players at their natural slots and confirm no affinity haircut leaks in.
    for (let start = 0; start + 11 <= ALL.length; start += 11) {
      const block = ALL.slice(start, start + 11);
      const slate: XiSlotV2[] = block.map((player) => ({ position: player.position, player }));
      const base = Math.round(block.reduce((sum, p) => sum + p.rating, 0));
      expect(displayedSquadRating(slate)).toBe(base);
    }
  });
});
