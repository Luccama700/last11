import { describe, expect, it } from 'vitest';
import {
  MATCHES_PER_ROUND,
  SURVIVORS_PER_ROUND,
  runTournament,
  type RoundResult,
} from './tournament';

// engineV2 tournament path (FEATURES.engineV2 forced ON via the explicit override).
// The v1 path stays covered by tournament.test.ts; this locks "green in BOTH flag
// states" (Main's directive) + the v2-specific invariants. Coordinated with QA.

const LOBBY_BY_ROUND = [32, ...SURVIVORS_PER_ROUND.slice(0, -1)]; // alive at the start of each round

describe('runTournament (engineV2 ON)', () => {
  it('resolves to exactly one winner, monotonic shrink, correct cut counts', () => {
    const { managers, log } = runTournament(7, true);
    const alive = managers.filter((m) => m.alive);
    expect(alive.length).toBe(1);
    expect(alive[0].id).toBe(log.winnerId);
    expect(log.rounds.length).toBe(SURVIVORS_PER_ROUND.length);

    log.rounds.forEach((r: RoundResult, i) => {
      expect(r.table.length).toBe(LOBBY_BY_ROUND[i]);
      expect(r.eliminatedIds.length).toBe(LOBBY_BY_ROUND[i] - SURVIVORS_PER_ROUND[i]);
      // table is sorted best-first: points non-increasing down the table.
      for (let k = 1; k < r.table.length; k++) {
        expect(r.table[k - 1].points).toBeGreaterThanOrEqual(r.table[k].points);
      }
    });
  });

  it('is deterministic for a given seed', () => {
    expect(runTournament(11, true).log.winnerId).toBe(runTournament(11, true).log.winnerId);
    expect(JSON.stringify(runTournament(3, true).log)).toBe(JSON.stringify(runTournament(3, true).log));
  });

  it('NIGHT-SHIFT: shootouts only at ≤16 alive; draws stand in bigger rounds', () => {
    const { log } = runTournament(42, true);
    for (const round of log.rounds) {
      expect(round.resultsV2).toBeDefined();
      expect(round.resultsV2!.length).toBe((LOBBY_BY_ROUND[round.round - 1] / 2) * MATCHES_PER_ROUND);
      // table.length == managers alive at round start ⇒ the shootout predicate.
      const shootoutRound = round.table.length <= 16;
      for (const m of round.resultsV2!) {
        if (m.homeGoals === m.awayGoals && shootoutRound) {
          expect(m.shootout).toBeDefined();
          expect(['home', 'away']).toContain(m.shootout!.winner);
        } else {
          // decisive match, OR a level match in a >16 round (a genuine draw)
          expect(m.shootout).toBeUndefined();
        }
      }
    }
    // A 32-lobby BR always has both a >16 round (R1/R2) and ≤16 rounds (R3+).
    expect(log.rounds.some((r) => r.table.length > 16)).toBe(true);
    expect(log.rounds.some((r) => r.table.length <= 16)).toBe(true);
  });

  it('goal events reconcile with the regulation scoreline (morale source of truth)', () => {
    const { log } = runTournament(5, true);
    for (const round of log.rounds) {
      for (const m of round.resultsV2!) {
        const home = m.goals.filter((g) => g.team === 'home').length;
        const away = m.goals.filter((g) => g.team === 'away').length;
        expect(home).toBe(m.homeGoals);
        expect(away).toBe(m.awayGoals);
      }
    }
  });

  it('the v1 path (flag OFF) still resolves to one winner', () => {
    const { managers } = runTournament(7, false);
    expect(managers.filter((m) => m.alive).length).toBe(1);
  });
});
