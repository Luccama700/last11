/**
 * MP draft calibration ceiling (Lucca's ruling, via Main).
 *
 * The in-game "strength" of a drafted XI is the sum of its 11 slots' affinity-
 * weighted ratings (`effectiveRatingV2`). Lucca's target for the roster data is a
 * CEILING, not a climb-to: in the worst case — a full 20-human lobby where every
 * seat shares one global uniqueness set and each spin is CONSTRAINED to the squad
 * the stride assigns it — no more than ~25% of drafted XIs should come out below
 * 935. This test rebuilds that worst case from the real pure MP functions over a
 * bank of fixed room seeds and pins the ceiling so a future data edit can't
 * silently make drafted teams routinely sub-935 again. A broad mean band guards the
 * other direction (data can't inflate to absurdity either).
 *
 * Deterministic: fixed seeds, no RNG outside the seeded engine.
 */
import { describe, expect, it } from 'vitest';
import {
  MP_DRAFT_SPINS,
  MP_LOBBY_SIZE,
  assignSquadsForSpin,
  autoPickForSlate,
  shuffledSquadOrder,
  squadHasPickLeft,
} from '../mp';
import { effectiveRatingV2, pickBotFormation } from '../draft';
import { affinity } from '../affinity';
import { createRng } from '../rng';
import { matchSeed } from '../match';
import type { Formation, XiSlotV2 } from '../types';

const SUB_935_CEILING_PCT = 25; // Lucca: at most ~25% of drafted XIs below 935.
const MEAN_BAND: readonly [number, number] = [935, 990]; // sanity floor + anti-inflation.

function strengthOf(slate: readonly (XiSlotV2 | null)[]): number {
  let t = 0;
  for (const s of slate) if (s) t += effectiveRatingV2(s.player, s.position, affinity);
  return t;
}

/** Worst case: 20 seats share ONE draftedIds set; every spin assigns disjoint
 *  squads via the real stride and each seat auto-picks from its assigned squad. */
function draft20HumanStrengths(roomSeed: number): number[] {
  const order = shuffledSquadOrder(roomSeed);
  const seats = MP_LOBBY_SIZE;
  const formations: Formation[] = Array.from({ length: seats }, (_, s) =>
    pickBotFormation(createRng(matchSeed(roomSeed, 888, s + 1))),
  );
  const slates: (XiSlotV2 | null)[][] = formations.map((f) => new Array(f.slots.length).fill(null));
  const draftedIds = new Set<string>();
  for (let spin = 0; spin < MP_DRAFT_SPINS; spin++) {
    const assigned = assignSquadsForSpin(order, spin, seats, (ref) =>
      squadHasPickLeft(ref, draftedIds),
    );
    for (let seat = 0; seat < seats; seat++) {
      const pick = autoPickForSlate(slates[seat], formations[seat], assigned[seat], draftedIds);
      if (!pick) continue;
      slates[seat][pick.slotIndex] = {
        position: formations[seat].slots[pick.slotIndex],
        player: pick.player,
      };
      draftedIds.add(pick.player.id);
    }
  }
  return slates.map(strengthOf);
}

describe('MP draft calibration ceiling (20-human worst case)', () => {
  // A fixed bank of room seeds — deterministic, and enough seats (60×20=1200 XIs)
  // that the percentage is stable across runs.
  const seeds = Array.from({ length: 60 }, (_, i) => 1000 + i * 7);
  const sums = seeds.flatMap(draft20HumanStrengths);
  const n = sums.length;
  const belowPct = (sums.filter((s) => s < 935).length / n) * 100;
  const mean = sums.reduce((a, b) => a + b, 0) / n;

  it('every seat fields a full 11 (draft never dead-ends)', () => {
    expect(n).toBe(seeds.length * MP_LOBBY_SIZE);
    expect(Math.min(...sums)).toBeGreaterThan(0);
  });

  it(`≤ ${SUB_935_CEILING_PCT}% of drafted XIs fall below 935`, () => {
    expect(belowPct).toBeLessThanOrEqual(SUB_935_CEILING_PCT);
  });

  it(`mean drafted strength stays in a sane band ${MEAN_BAND[0]}..${MEAN_BAND[1]}`, () => {
    expect(mean).toBeGreaterThanOrEqual(MEAN_BAND[0]);
    expect(mean).toBeLessThanOrEqual(MEAN_BAND[1]);
  });
});
