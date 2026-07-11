import { describe, expect, it } from 'vitest';
import { evaluateStealV2, stealSlotDeltas } from './steal-v2';
import { affinity } from './affinity';
import type { PlayerV2 } from './data/schema';
import type { Position } from './data/schema';
import type { XiSlotV2 } from './types';

// JOB 1 (Main night-shift): steal eval on the DETAILED slate + affinity, so a
// secondary-position superstar (Messi CAM/RW) is valued correctly — no more
// "Romário +26 over Messi" from the coarse projection.

function p(id: string, position: Position, rating: number, secondary?: Position[]): PlayerV2 {
  return { id, name: id, nation: 'XXX', year: 2026, position, rating, secondary };
}
function s(pos: Position, player: PlayerV2): XiSlotV2 {
  return { position: pos, player };
}

const MESSI = p('messi', 'CAM', 96, ['RW']); // secondary RW ⇒ full 96 at an RW slot
const WINGER = p('winger', 'RW', 86); // natural RW, decent but not elite

// A slate with a weak RW (70) and weak ST (70) — both upgradeable.
const SLATE: XiSlotV2[] = [
  s('GK', p('gk', 'GK', 80)),
  s('RB', p('rb', 'RB', 78)),
  s('CB', p('cb1', 'CB', 80)),
  s('CB', p('cb2', 'CB', 79)),
  s('LB', p('lb', 'LB', 78)),
  s('CDM', p('cdm', 'CDM', 80)),
  s('CM', p('cm1', 'CM', 81)),
  s('CM', p('cm2', 'CM', 80)),
  s('RW', p('weakrw', 'RW', 70)), // slot 8
  s('ST', p('weakst', 'ST', 70)), // slot 9
  s('LW', p('lw', 'LW', 82)),
];

describe('evaluateStealV2 — affinity-aware, secondary respected', () => {
  it('prefers Messi (secondary RW, 96) into the RW slot over a merely-decent natural winger', () => {
    const best = evaluateStealV2(SLATE, [MESSI, WINGER]);
    expect(best).not.toBeNull();
    expect(best!.player.id).toBe('messi');
    expect(best!.bestPosition).toBe('RW');
    expect(best!.bestSlotIndex).toBe(8);
    // Gain is the pure effective-rating delta: 96 (secondary-exempt) − 70 = 26.
    expect(best!.gain).toBeCloseTo(26, 5);
  });

  it('would pick the winger if the secondary exemption did not apply (proves the fix is load-bearing)', () => {
    // Buggy fallthrough: Messi at RW = 96 × affinity(CAM,RW) < 96; winger = 86.
    const buggyMessiRw = 96 * affinity('CAM', 'RW');
    expect(buggyMessiRw).toBeLessThan(86); // the inversion the bug caused
  });

  it('returns null when no pool player improves any slot', () => {
    const best = evaluateStealV2(SLATE, [p('scrub', 'RW', 60)]);
    expect(best).toBeNull();
  });

  it('is deterministic', () => {
    const a = evaluateStealV2(SLATE, [MESSI, WINGER]);
    const b = evaluateStealV2(SLATE, [MESSI, WINGER]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('stealSlotDeltas — "where does X play?"', () => {
  it('rates Messi highest at his RW slot, above an off-position ST slot', () => {
    const deltas = stealSlotDeltas(SLATE, MESSI);
    expect(deltas[8]).toBeCloseTo(26, 5); // RW: 96 − 70
    // ST slot: CAM→ST affinity < 1, so 96×aff − 70 is a smaller (but positive) gain.
    expect(deltas[9]).toBeGreaterThan(0);
    expect(deltas[8]).toBeGreaterThan(deltas[9]);
  });
});
