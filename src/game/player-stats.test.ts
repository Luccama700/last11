import { describe, expect, it } from 'vitest';
import { accrueStats, buildNameLookup, topAssists, topScorers, type PlayerStats } from './player-stats';
import { initialState, reducer } from './state';
import { runTournament } from '../engine/tournament';
import type { RoundResult } from '../engine/tournament';

// JOB 2: per-player goals/assists across the tournament (incl. fast-forward).

function round(goals: { team: 'home' | 'away'; playerId?: string; assistPlayerId?: string }[]): RoundResult {
  return {
    round: 1,
    matches: [],
    table: [],
    eliminatedIds: [],
    resultsV2: [
      {
        homeId: 'a',
        awayId: 'b',
        homeGoals: 0,
        awayGoals: 0,
        goals: goals.map((g, i) => ({ minute: i + 1, ...g })),
      },
    ],
  };
}

describe('accrueStats', () => {
  it('counts goals + assists by playerId, and is pure', () => {
    const prev: PlayerStats = { messi: { goals: 1, assists: 0 } };
    const next = accrueStats(prev, [
      round([
        { team: 'home', playerId: 'messi', assistPlayerId: 'dimaria' },
        { team: 'home', playerId: 'messi' },
        { team: 'away', playerId: 'mbappe', assistPlayerId: 'messi' },
      ]),
    ]);
    expect(next.messi).toEqual({ goals: 3, assists: 1 });
    expect(next.dimaria).toEqual({ goals: 0, assists: 1 });
    expect(next.mbappe).toEqual({ goals: 1, assists: 0 });
    expect(prev.messi).toEqual({ goals: 1, assists: 0 }); // prev untouched
  });

  it('ignores v1 rounds with no resultsV2', () => {
    const r: RoundResult = { round: 1, matches: [], table: [], eliminatedIds: [] };
    expect(accrueStats({}, [r])).toEqual({});
  });
});

describe('topScorers / topAssists', () => {
  const stats: PlayerStats = {
    a: { goals: 5, assists: 1 },
    b: { goals: 5, assists: 3 },
    c: { goals: 2, assists: 7 },
    d: { goals: 0, assists: 4 },
  };
  const nameOf = (id: string) => id.toUpperCase();

  it('ranks scorers by goals desc, assists as tiebreak; drops zero-goal players', () => {
    const top = topScorers(stats, nameOf, 3);
    expect(top.map((l) => l.playerId)).toEqual(['b', 'a', 'c']); // b & a tie on 5 goals → b's 3 assists win
    expect(top[0].name).toBe('B');
    expect(top.every((l) => l.goals > 0)).toBe(true);
  });

  it('ranks assisters by assists desc; drops zero-assist players', () => {
    const top = topAssists(stats, nameOf);
    expect(top.map((l) => l.playerId)).toEqual(['c', 'd', 'b', 'a']);
    expect(top.find((l) => l.playerId === 'd')).toBeDefined(); // d has goals 0 but assists 4
  });
});

describe('reducer accrual (ROUND_PLAYED + FINISHED, no double count)', () => {
  it('accumulates a full engineV2 run and resolves names', () => {
    const { managers, log } = runTournament(9, true);

    // Live path: fold every round via ROUND_PLAYED.
    let s = { ...initialState, seed: 9 };
    for (const r of log.rounds) s = reducer(s, { type: 'ROUND_PLAYED', result: r });

    const nameOf = buildNameLookup(managers);
    const scorers = topScorers(s.playerStats ?? {}, nameOf);
    expect(scorers.length).toBeGreaterThan(0);
    expect(scorers[0].goals).toBeGreaterThan(0);
    expect(scorers[0].name).not.toBe(scorers[0].playerId); // a real name was resolved

    // Total goals accrued == total goal events across all rounds' resultsV2.
    const totalGoalEvents = log.rounds.reduce(
      (n, r) => n + (r.resultsV2 ?? []).reduce((k, m) => k + m.goals.length, 0),
      0,
    );
    const totalScored = Object.values(s.playerStats ?? {}).reduce((n, v) => n + v.goals, 0);
    expect(totalScored).toBe(totalGoalEvents);
  });

  it('FINISHED folds the fast-forward tail on top of prior ROUND_PLAYED stats', () => {
    const { managers, log } = runTournament(3, true);
    const firstRound = log.rounds[0];
    const rest = log.rounds.slice(1);

    let s = { ...initialState, seed: 3 };
    s = reducer(s, { type: 'ROUND_PLAYED', result: firstRound });
    const afterOne = Object.values(s.playerStats ?? {}).reduce((n, v) => n + v.goals, 0);
    s = reducer(s, { type: 'FINISHED', managers, rounds: rest });
    const afterAll = Object.values(s.playerStats ?? {}).reduce((n, v) => n + v.goals, 0);

    expect(afterAll).toBeGreaterThan(afterOne); // the tail added goals, no reset
  });
});
