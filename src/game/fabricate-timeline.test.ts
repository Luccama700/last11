import { describe, expect, it } from 'vitest';
import { FORMATIONS, VIRTUAL_MINUTES, type Team } from '../engine/types';
import { assignGoals, fabricateTimeline, type V1Match } from './fabricate-timeline';

const match: V1Match = { homeId: 'you', awayId: 'bot-3', homeGoals: 2, awayGoals: 1 };
const opts = { round: 2, matchIndex: 5, homeName: 'You', awayName: 'Rival' };
const validFormation = (id: string) => FORMATIONS.some((f) => f.id === id);

describe('fabricateTimeline', () => {
  it('is deterministic — same fixture ⇒ byte-identical timeline', () => {
    expect(fabricateTimeline(match, opts)).toEqual(fabricateTimeline(match, opts));
  });

  it('does not depend on any external rng (different fixtures differ, same fixture repeats)', () => {
    const other = fabricateTimeline({ ...match, awayId: 'bot-9' }, opts);
    expect(other).not.toEqual(fabricateTimeline(match, opts));
  });

  it('emits durationMinutes+1 ticks, all coordinates in [0,1]', () => {
    const t = fabricateTimeline(match, opts);
    expect(t.ticks).toHaveLength(VIRTUAL_MINUTES + 1);
    for (const tk of t.ticks) {
      expect(tk.ballPosition).toBeGreaterThanOrEqual(0);
      expect(tk.ballPosition).toBeLessThanOrEqual(1);
      expect(tk.ballLane).toBeGreaterThanOrEqual(0);
      expect(tk.ballLane).toBeLessThanOrEqual(1);
      expect(tk.momentum).toBeGreaterThanOrEqual(-1);
      expect(tk.momentum).toBeLessThanOrEqual(1);
    }
  });

  it('goal events reconcile with the scoreline (invariant Σ goals == finalScore)', () => {
    const t = fabricateTimeline(match, opts);
    const homeGoals = t.events.filter((e) => e.type === 'goal' && e.team === 'home').length;
    const awayGoals = t.events.filter((e) => e.type === 'goal' && e.team === 'away').length;
    expect(homeGoals).toBe(match.homeGoals);
    expect(awayGoals).toBe(match.awayGoals);
    expect(t.finalScore).toEqual({ home: match.homeGoals, away: match.awayGoals });
    // running scoreAfter on the last goal equals the final score
    const lastGoal = [...t.events].reverse().find((e) => e.type === 'goal');
    expect(lastGoal?.scoreAfter).toEqual({ home: 2, away: 1 });
  });

  it('assignGoals matches the timeline goal minutes (rail ≡ featured consistency)', () => {
    const stamps = assignGoals(match, opts);
    const fromTimeline = fabricateTimeline(match, opts)
      .events.filter((e) => e.type === 'goal')
      .map((e) => ({ minute: e.minute, team: e.team as Team }));
    expect(fromTimeline).toEqual(stamps);
  });

  it('never fabricates a shootout for a level v1 match (draws stay draws)', () => {
    const draw = fabricateTimeline({ homeId: 'a', awayId: 'b', homeGoals: 1, awayGoals: 1 }, opts);
    expect(draw.shootout).toBeUndefined();
    expect(draw.finalScore).toEqual({ home: 1, away: 1 });
  });

  it('uses valid formation ids (home honoured, away a real formation)', () => {
    const t = fabricateTimeline(match, { ...opts, homeFormationId: '3-5-2' });
    expect(t.homeFormationId).toBe('3-5-2');
    expect(validFormation(t.awayFormationId)).toBe(true);
  });

  it('keeps the ticker non-empty even for a 0-0', () => {
    const nilnil = fabricateTimeline({ homeId: 'a', awayId: 'b', homeGoals: 0, awayGoals: 0 }, opts);
    expect(nilnil.events.some((e) => e.type !== 'kickoff' && e.type !== 'fulltime' && e.type !== 'halftime')).toBe(true);
  });
});
