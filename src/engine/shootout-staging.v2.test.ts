import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TACTICS,
  SHOOTOUT_ALIVE_MAX,
  createBotLobby,
  playRound,
  shootoutEnabledForRound,
  type PlayRoundEngine,
} from './tournament';
import { createRng } from './rng';

/**
 * QA-owned integration check for the NIGHT-SHIFT staged-shootout rule
 * (`ce6c5b4`). The four originally-queued hard invariants (shootout only
 * when alive<=16, timelines carry zero shootout events in early rounds,
 * >16-alive rounds use 3/1/0 with real draws, <=16-alive rounds use 3/2/1/0
 * with zero draws) are ALREADY thoroughly covered by game-engine's own
 * `engine.v2.test.ts` ("shootouts & the ≤16 night-shift rule" — unit-level,
 * both regimes, exact point sums, timeline event absence) and
 * `tournament.v2.test.ts` ("NIGHT-SHIFT: shootouts only at ≤16 alive" — a
 * real 32-lobby tournament hitting both regimes). Not duplicated here.
 *
 * The one gap: those tests verify `matchVerdict`'s per-match points in
 * isolation, and shootout presence/absence across a real tournament — but
 * nothing directly sums a REAL ROUND's total points-per-manager against the
 * regime-specific formula (3/1/0 vs 3/2/1/0) through `playRound` end to end.
 * `playRound` mechanically composes from `matchVerdict` (low bug risk by
 * construction), but this closes the loop with one real integration check.
 */

describe('playRound points sum, real round, both regimes', () => {
  it('a round with alive > SHOOTOUT_ALIVE_MAX awards points ONLY from {3,1,0} per match, and some round DOES contain a genuine draw over enough seeds', () => {
    // 32 alive (>16): shootoutEnabled=false for this round.
    let sawDraw = false;
    for (let seed = 0; seed < 20 && !sawDraw; seed++) {
      const rng = createRng(seed);
      const alive = createBotLobby(rng);
      expect(shootoutEnabledForRound(alive.length)).toBe(false);
      const engine: PlayRoundEngine = {
        tournamentSeed: seed,
        matchIndex: 0,
        moraleByManager: {},
        tacticsOf: () => DEFAULT_TACTICS,
      };
      const result = playRound(alive, 24, 1, rng, engine);
      for (const r of result.resultsV2!) {
        if (r.homeGoals === r.awayGoals) {
          sawDraw = true;
          expect(r.shootout).toBeUndefined();
        }
      }
      // Classic points: decisive sums to 3 (3+0), a genuine draw sums to 2 (1+1).
      const pointsBefore = new Map(alive.map((m) => [m.id, 0]));
      for (const r of result.resultsV2!) {
        const decisive = r.homeGoals !== r.awayGoals;
        const homePts = decisive ? (r.homeGoals > r.awayGoals ? 3 : 0) : 1;
        const awayPts = decisive ? (r.awayGoals > r.homeGoals ? 3 : 0) : 1;
        expect(homePts + awayPts).toBe(decisive ? 3 : 2);
        pointsBefore.set(r.homeId, pointsBefore.get(r.homeId)! + homePts);
        pointsBefore.set(r.awayId, pointsBefore.get(r.awayId)! + awayPts);
      }
      for (const row of result.table) {
        expect(row.points).toBe(pointsBefore.get(row.managerId));
      }
    }
    expect(sawDraw).toBe(true);
  });

  it('a round with alive <= SHOOTOUT_ALIVE_MAX awards points ONLY from {3,0} per match — zero real draws', () => {
    for (let seed = 0; seed < 10; seed++) {
      const rng = createRng(seed);
      const full = createBotLobby(rng);
      const alive = full.slice(0, SHOOTOUT_ALIVE_MAX); // 16 alive, at the boundary (inclusive)
      expect(shootoutEnabledForRound(alive.length)).toBe(true);
      const engine: PlayRoundEngine = {
        tournamentSeed: seed,
        matchIndex: 0,
        moraleByManager: {},
        tacticsOf: () => DEFAULT_TACTICS,
      };
      const result = playRound(alive, 8, 1, rng, engine);
      const pointsBefore = new Map(alive.map((m) => [m.id, 0]));
      for (const r of result.resultsV2!) {
        if (r.homeGoals === r.awayGoals) {
          expect(r.shootout).toBeDefined(); // never a genuine draw here
        }
        // Pens carry FULL stakes (Lucca 2026-07-11): 3 to the winner, 0 to the loser,
        // exactly like a regulation result — never 1+1.
        const decidedByPens = r.homeGoals === r.awayGoals;
        const homePts = decidedByPens
          ? r.shootout!.winner === 'home' ? 3 : 0
          : r.homeGoals > r.awayGoals ? 3 : 0;
        const awayPts = decidedByPens
          ? r.shootout!.winner === 'away' ? 3 : 0
          : r.awayGoals > r.homeGoals ? 3 : 0;
        expect(homePts + awayPts).toBe(3);
        expect([homePts, awayPts].every((p) => [0, 3].includes(p))).toBe(true);
        pointsBefore.set(r.homeId, pointsBefore.get(r.homeId)! + homePts);
        pointsBefore.set(r.awayId, pointsBefore.get(r.awayId)! + awayPts);
      }
      // The REAL table must award exactly these points — this is the line that
      // catches a wrong POINTS entry, not just a wrong recomputation.
      for (const row of result.table) {
        expect(row.points).toBe(pointsBefore.get(row.managerId));
      }
    }
  });
});
