import { describe, expect, it } from 'vitest';
import { resolveMatch, type MatchSide } from './match';
import { simulateMatchTimeline } from './timeline';
import { formationById, type Tactics } from './types';
import type { PlayerV2, Position } from './data/schema';

/**
 * QA-owned cross-cutting hard invariants for the v2 engine (DECISIONS.md /
 * PLAN-qa.md Job 2). Most of the originally-queued invariants are ALREADY
 * covered by game-engine's own `engine.v2.test.ts` (affinity bounds +
 * diagonal, shootout-present-iff-level, a single-scenario goal-events-sum
 * check) — deliberately not duplicated here. This file only adds the ONE
 * genuine gap found on review: full-object timeline determinism (their
 * determinism test checks `resolveMatch`'s score-only output; nothing
 * checks that `simulateMatchTimeline`'s complete output — ticks, events,
 * captions, box score — is byte-identical for a repeated seed, which is
 * the actual multiplayer-readiness guarantee CONTRACT §4 promises).
 *
 * "Legal XI per formation for bots" stays QUEUED, not stubbed here: there is
 * no v2 bot draft yet (draft.v2.test.ts is draft-page's in-progress work,
 * uncommitted as of this writing), so there is nothing real to assert
 * against. Add it once bots draft real v2 XIs.
 */

const NATIONS = ['BRA', 'ARG', 'FRA', 'ENG', 'ESP', 'GER'];

function player(id: string, position: Position, rating: number, nation = 'BRA'): PlayerV2 {
  return { id, name: `${position}-${id}`, nation, year: 2026, position, rating };
}

function makeXi(formationId: string, ratingAt: (i: number) => number, tag: string): MatchSide['xi'] {
  const f = formationById(formationId)!;
  return f.slots.map((pos, i) => ({
    position: pos,
    player: player(`${tag}-${i}`, pos, ratingAt(i), NATIONS[i % NATIONS.length]),
  }));
}

function side(id: string, xi: MatchSide['xi'], tactics: Partial<Tactics> = {}): MatchSide {
  return { id, xi, tactics: { formationId: '4-3-3', style: 'balanced', ...tactics } };
}

describe('simulateMatchTimeline determinism (full object, not just score)', () => {
  const home = side('h', makeXi('4-3-3', (i) => 78 + (i % 6), 'h'), { style: 'attacking', lineHeight: 'high' });
  const away = side('a', makeXi('4-2-3-1', (i) => 75 + (i % 5), 'a'), { style: 'defensive', lineHeight: 'deep' });

  it('same seed => byte-identical MatchTimeline (ticks, events, captions, box score)', () => {
    for (const seed of [1, 2, 12345, 999999]) {
      const t1 = simulateMatchTimeline(home, away, seed);
      const t2 = simulateMatchTimeline(home, away, seed);
      expect(t1).toEqual(t2);
    }
  });

  it('different seeds diverge somewhere (sanity: not a constant function)', () => {
    const a = simulateMatchTimeline(home, away, 1);
    const b = simulateMatchTimeline(home, away, 2);
    expect(a).not.toEqual(b);
  });

  it('a level regulation match also has an identical shootout across repeats', () => {
    const flatHome = side('fh', makeXi('4-3-3', () => 80, 'fh'));
    const flatAway = side('fa', makeXi('4-3-3', () => 80, 'fa'));
    // Seed 0 already known (from engine.v2.test.ts's shootout coverage) to
    // sometimes produce a level score for identical-strength sides; scan a
    // small range to find one deterministically rather than hard-coding it.
    let found = false;
    for (let seed = 0; seed < 50 && !found; seed++) {
      const r = resolveMatch(flatHome, flatAway, seed);
      if (r.homeGoals !== r.awayGoals) continue;
      found = true;
      const t1 = simulateMatchTimeline(flatHome, flatAway, seed);
      const t2 = simulateMatchTimeline(flatHome, flatAway, seed);
      expect(t1.shootout).toBeDefined();
      expect(t1).toEqual(t2);
    }
    expect(found).toBe(true); // fails loudly if no level match turns up in range
  });
});
