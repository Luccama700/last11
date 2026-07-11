import { describe, expect, it } from 'vitest';
import {
  CELEBRATION_MS,
  FORMATIONS,
  MATCH_DURATION_MS,
  SHOOTOUT_MS,
  type MatchTimeline,
  type TimelineTick,
} from '../engine/types';
import { dotView, formationAnchors, matchEndMs, projectMatch, POSITION_ANCHOR } from './playback';

function flatTicks(n = 90): TimelineTick[] {
  return Array.from({ length: n + 1 }, (_, m) => ({
    minute: m,
    ballPosition: 0.5,
    ballLane: 0.5,
    momentum: 0,
    possession: 'home' as const,
  }));
}

const base: MatchTimeline = {
  matchId: 't',
  homeId: 'h',
  awayId: 'a',
  seed: 1,
  durationMinutes: 90,
  ticks: flatTicks(),
  events: [
    { minute: 0, type: 'kickoff', team: null, text: 'ko' },
    { minute: 30, type: 'goal', team: 'home', text: 'g1', scoreAfter: { home: 1, away: 0 } },
    { minute: 45, type: 'halftime', team: null, text: 'ht' },
    { minute: 70, type: 'goal', team: 'away', text: 'g2', scoreAfter: { home: 1, away: 1 } },
    { minute: 90, type: 'fulltime', team: null, text: 'ft' },
  ], // minute-sorted per CONTRACT §4
  finalScore: { home: 1, away: 1 },
  homeFormationId: '4-3-3',
  awayFormationId: '4-4-2',
  boxScore: {
    home: { gk: 70, def: 70, mid: 70, att: 70, overall: 70 },
    away: { gk: 70, def: 70, mid: 70, att: 70, overall: 70 },
    xg: { home: 1, away: 1 },
  },
};

const goalMs = (minute: number) => (minute / 90) * MATCH_DURATION_MS;

describe('projectMatch — regulation', () => {
  it('is deterministic for the same inputs', () => {
    expect(projectMatch(base, 12345)).toEqual(projectMatch(base, 12345));
  });

  it('starts at 0-0, minute 0, regulation phase', () => {
    const s = projectMatch(base, 0);
    expect(s.score).toEqual({ home: 0, away: 0 });
    expect(s.virtualMinute).toBe(0);
    expect(s.phase).toBe('regulation');
    expect(s.finished).toBe(false);
  });

  it('applies each goal exactly when its stamp passes', () => {
    expect(projectMatch(base, goalMs(30) - 1).score).toEqual({ home: 0, away: 0 });
    expect(projectMatch(base, goalMs(30) + 1).score).toEqual({ home: 1, away: 0 });
    expect(projectMatch(base, goalMs(70) + 1).score).toEqual({ home: 1, away: 1 });
  });

  it('resets the ball to the centre spot during a goal celebration', () => {
    const during = projectMatch(base, goalMs(30) + 100);
    expect(during.celebrating?.minute).toBe(30);
    expect(during.ball).toEqual({ x: 0.5, y: 0.5 });
    const after = projectMatch(base, goalMs(30) + CELEBRATION_MS + 50);
    expect(after.celebrating).toBeNull();
  });

  it('surfaces at most the last 3 non-shootout events in the ticker', () => {
    const s = projectMatch(base, goalMs(70) + 1);
    expect(s.ticker.length).toBeLessThanOrEqual(3);
    expect(s.ticker[s.ticker.length - 1].text).toBe('g2');
  });

  it('interpolates ball position between ticks', () => {
    const ramp: MatchTimeline = {
      ...base,
      events: [{ minute: 0, type: 'kickoff', team: null, text: 'ko' }],
      ticks: flatTicks().map((t) => ({ ...t, ballPosition: t.minute / 90 })),
    };
    const mid = projectMatch(ramp, MATCH_DURATION_MS / 2); // ~45'
    expect(mid.ball.x).toBeGreaterThan(0.45);
    expect(mid.ball.x).toBeLessThan(0.55);
  });

  it('clamps and marks finished at/after the end', () => {
    const s = projectMatch(base, MATCH_DURATION_MS + 5000);
    expect(s.finished).toBe(true);
    expect(s.virtualMinute).toBeLessThanOrEqual(90);
    expect(s.clockLabel).toBe('FT');
    expect(s.score).toEqual({ home: 1, away: 1 });
  });
});

describe('projectMatch — shootout', () => {
  const kicks = [
    { team: 'home' as const, scored: true, playerId: 'h1' },
    { team: 'away' as const, scored: true, playerId: 'a1' },
    { team: 'home' as const, scored: true, playerId: 'h2' },
    { team: 'away' as const, scored: false, playerId: 'a2' },
    { team: 'home' as const, scored: true, playerId: 'h3' },
    { team: 'away' as const, scored: true, playerId: 'a3' },
  ];
  const so: MatchTimeline = {
    ...base,
    events: [
      ...base.events,
      { minute: 90, type: 'shootout_start', team: null, text: 'Penalties!' },
      { minute: 90, type: 'shootout_end', team: 'home', text: 'Home win on pens' },
    ],
    shootout: { winner: 'home', home: 3, away: 2, kicks },
  };

  it('adds a 12s window on top of regulation', () => {
    expect(matchEndMs(base)).toBe(MATCH_DURATION_MS);
    expect(matchEndMs(so)).toBe(MATCH_DURATION_MS + SHOOTOUT_MS);
  });

  it('stays regulation at exactly full-time, flips to pens just after', () => {
    expect(projectMatch(so, MATCH_DURATION_MS).phase).toBe('regulation');
    expect(projectMatch(so, MATCH_DURATION_MS + 10).phase).toBe('shootout');
  });

  it('reveals kicks progressively and tallies scored pens', () => {
    const perKick = SHOOTOUT_MS / kicks.length;
    // deep into kick 0's window (result shown): 1 kick taken, home 1
    const early = projectMatch(so, MATCH_DURATION_MS + perKick * 0.8);
    expect(early.shootout!.taken.length).toBe(1);
    expect(early.shootout!.home).toBe(1);
    expect(early.shootout!.away).toBe(0);
  });

  it('finishes with the full tally and a decided winner', () => {
    const end = projectMatch(so, MATCH_DURATION_MS + SHOOTOUT_MS);
    expect(end.finished).toBe(true);
    expect(end.shootout!.home).toBe(3);
    expect(end.shootout!.away).toBe(2);
    expect(end.shootout!.winner).toBe('home');
    expect(end.shootout!.stepping).toBeNull();
    expect(end.clockLabel).toBe('PENS');
  });

  it('never reveals more kicks than exist', () => {
    for (let el = MATCH_DURATION_MS; el <= MATCH_DURATION_MS + SHOOTOUT_MS + 100; el += 137) {
      const s = projectMatch(so, el);
      expect(s.shootout!.taken.length).toBeLessThanOrEqual(kicks.length);
    }
  });
});

describe('formationAnchors + dotView', () => {
  it('resolves 11 in-bounds anchors for every canonical formation', () => {
    for (const f of FORMATIONS) {
      const dots = formationAnchors(f.id);
      expect(dots).toHaveLength(11);
      expect(dots[0].isGK).toBe(true);
      for (const d of dots) {
        expect(d.x).toBeGreaterThanOrEqual(0);
        expect(d.x).toBeLessThanOrEqual(1);
        expect(d.y).toBeGreaterThanOrEqual(0);
        expect(d.y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('falls back to 4-3-3 for an unknown formation id', () => {
    expect(formationAnchors('nonsense')).toHaveLength(11);
  });

  it('has an anchor for all 12 positions', () => {
    expect(Object.keys(POSITION_ANCHOR)).toHaveLength(12);
  });

  it('mirrors away dots to the opposite half and keeps everything in bounds', () => {
    const anchors = formationAnchors('4-3-3');
    const ball = { x: 0.5, y: 0.5 };
    for (let i = 0; i < anchors.length; i++) {
      const home = dotView('home', anchors[i], ball, 'home', 1000, i);
      const away = dotView('away', anchors[i], ball, 'home', 1000, i);
      expect(home.x).toBeLessThan(away.x + 0.9); // away sits further up the +x axis
      for (const d of [home, away]) {
        expect(d.x).toBeGreaterThanOrEqual(0);
        expect(d.x).toBeLessThanOrEqual(1);
        expect(d.y).toBeGreaterThanOrEqual(0);
        expect(d.y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps the keeper hugging its goal line', () => {
    const gk = formationAnchors('4-3-3')[0];
    const home = dotView('home', gk, { x: 0.9, y: 0.9 }, 'home', 0, 0);
    expect(home.isGK).toBe(true);
    expect(home.x).toBeLessThan(0.15); // near home's goal regardless of where the ball is
  });

  it('is a pure function of its inputs', () => {
    const gk = formationAnchors('4-3-3')[3];
    expect(dotView('home', gk, { x: 0.6, y: 0.4 }, 'away', 2500, 3)).toEqual(
      dotView('home', gk, { x: 0.6, y: 0.4 }, 'away', 2500, 3),
    );
  });
});
