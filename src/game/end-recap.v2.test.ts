import { describe, expect, it } from 'vitest';
import { initialState, reducer } from './state';
import { runTournament } from '../engine/tournament';

// JOB 2 (Main night-shift): after a human is eliminated the fast-forward must keep
// the run watchable. FINISHED rebuilds the FINAL match's full timeline (pure — from
// the stamped seed + carried morale) and records the champion, for the EndScreen.

describe('FINISHED reducer: end-screen recap data (finalTimeline + champion)', () => {
  it('builds the final timeline (score matches the table) and records the champion', () => {
    const { managers, log } = runTournament(9, true); // engineV2 → resultsV2 stamped
    const s = reducer({ ...initialState, seed: 9 }, { type: 'FINISHED', managers, rounds: log.rounds });

    expect(s.screen).toBe('end');
    expect(s.champion).toBeDefined();
    expect(s.champion!.alive).toBe(true);
    expect(managers.filter((m) => m.alive)).toHaveLength(1);
    expect(s.champion!.id).toBe(managers.find((m) => m.alive)!.id);

    // The rebuilt timeline reproduces the final match's regulation scoreline exactly
    // (score/timeline agreement via the same toMatchSide + stamped seed).
    const finalRound = log.rounds[log.rounds.length - 1];
    const fm = finalRound.resultsV2![finalRound.resultsV2!.length - 1];
    expect(s.finalTimeline).toBeDefined();
    expect(s.finalTimeline!.finalScore.home).toBe(fm.homeGoals);
    expect(s.finalTimeline!.finalScore.away).toBe(fm.awayGoals);
    // Per-round resultsV2 are preserved for the recap.
    expect(s.rounds[s.rounds.length - 1].resultsV2).toBeDefined();
  });

  it('the v1 path (no resultsV2) records the champion but no timeline', () => {
    const { managers, log } = runTournament(9, false);
    const s = reducer({ ...initialState, seed: 9 }, { type: 'FINISHED', managers, rounds: log.rounds });
    expect(s.champion).toBeDefined();
    expect(s.finalTimeline).toBeUndefined();
  });
});
