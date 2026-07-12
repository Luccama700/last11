/**
 * Playtest wave 2 (Lucca, 2026-07-11): goal minute spacing + match furniture.
 * Locks: (1) no two goals ever share a minute; (2) furniture events exist, are
 * correctly attributed by position, and consume ZERO outcome rng — the score
 * agreement invariant (resolveMatch ≡ simulateMatchTimeline) stays exact.
 */
import { describe, expect, it } from 'vitest';
import { resolveMatch, type MatchSide } from './match';
import { simulateMatchTimeline } from './timeline';
import { squadByRef } from './data/loader';
import { autoArrange } from './draft';
import { affinity } from './affinity';
import { formationById } from './types';

const F433 = formationById('4-3-3')!;
const F442 = formationById('4-4-2')!;

function side(id: string, nation: string, year: number, formationId: string): MatchSide {
  const formation = formationById(formationId)!;
  const players = squadByRef(nation, year).players.slice(0, 16);
  return {
    id,
    xi: autoArrange(players, formation, affinity),
    tactics: { formationId, style: 'balanced' },
  };
}

const home = side('h', 'BRA', 2002, F433.id);
const away = side('a', 'ESP', 2010, F442.id);

describe('goal minute spacing (no same-minute goals)', () => {
  it('across many seeds, all goal minutes in a match are pairwise distinct', () => {
    for (let seed = 0; seed < 300; seed++) {
      const r = resolveMatch(home, away, seed);
      const minutes = r.goals.map((g) => g.minute);
      expect(new Set(minutes).size).toBe(minutes.length);
    }
  });

  it('stays deterministic: same seed ⇒ identical goals', () => {
    expect(resolveMatch(home, away, 77)).toEqual(resolveMatch(home, away, 77));
  });
});

describe('match furniture events', () => {
  const FURNITURE = new Set(['foul', 'corner', 'goal_kick', 'throw_in']);

  it('every match carries 5–9 furniture events on non-goal minutes', () => {
    for (let seed = 0; seed < 40; seed++) {
      const t = simulateMatchTimeline(home, away, seed);
      const furniture = t.events.filter((e) => FURNITURE.has(e.type));
      expect(furniture.length).toBeGreaterThanOrEqual(5);
      expect(furniture.length).toBeLessThanOrEqual(9);
      const goalMinutes = new Set(t.events.filter((e) => e.type === 'goal').map((e) => e.minute));
      for (const e of furniture) {
        expect(goalMinutes.has(e.minute)).toBe(false);
        expect(e.minute).toBeGreaterThan(0);
        expect(e.minute).toBeLessThan(90);
        expect(e.text.length).toBeGreaterThan(0);
        expect(e.playerId).toBeDefined();
      }
    }
  });

  it('attribution is position-correct: goal kicks by the GK, corners by a wide/attacking taker', () => {
    const posOf = new Map(
      [...home.xi, ...away.xi].map((s) => [s.player.id, s.position] as const),
    );
    let sawGoalKick = false;
    let sawCorner = false;
    let sawFoul = false;
    for (let seed = 0; seed < 60; seed++) {
      const t = simulateMatchTimeline(home, away, seed);
      for (const e of t.events) {
        if (e.type === 'goal_kick') {
          sawGoalKick = true;
          expect(posOf.get(e.playerId!)).toBe('GK');
        }
        if (e.type === 'corner') {
          sawCorner = true;
          expect(posOf.get(e.playerId!)).not.toBe('GK');
        }
        if (e.type === 'foul') {
          sawFoul = true;
          // committed by a defensive-group player (playerId = the fouler)
          expect(['CB', 'RB', 'LB', 'CDM', 'CM']).toContain(posOf.get(e.playerId!));
          expect(e.text).toContain('brings down');
        }
      }
    }
    expect(sawGoalKick && sawCorner && sawFoul).toBe(true);
  });

  it('consumes ZERO outcome rng: timeline score remains byte-identical to resolveMatch', () => {
    for (let seed = 0; seed < 120; seed++) {
      const r = resolveMatch(home, away, seed);
      const t = simulateMatchTimeline(home, away, seed);
      expect(t.finalScore).toEqual({ home: r.homeGoals, away: r.awayGoals });
      expect(t.shootout?.winner).toBe(r.shootout?.winner);
    }
  });
});
