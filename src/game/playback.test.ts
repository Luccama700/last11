import { describe, expect, it } from 'vitest';
import {
  CELEBRATION_MS,
  FORMATIONS,
  MATCH_DURATION_MS,
  type MatchTimeline,
  type TimelineTick,
} from '../engine/types';
import {
  SHOOTOUT_KICK_MS,
  dotView,
  formationAnchors,
  matchEndMs,
  projectMatch,
  POSITION_ANCHOR,
} from './playback';

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

  // Contract with useMatchClock: the clock fires onEnd EXACTLY when
  // elapsed >= durationMs, and durationMs === matchEndMs(timeline). So the frame
  // the clock ends on must already read finished — no off-by-one where the match
  // is "still live" at the elapsed the skip/terminal fire uses. Locks the exact
  // boundary (matchEndMs, not MATCH_DURATION_MS + slack) for a regulation match.
  it('reads finished at exactly matchEndMs — the elapsed the clock ends on', () => {
    expect(matchEndMs(base)).toBe(MATCH_DURATION_MS);
    expect(projectMatch(base, matchEndMs(base)).finished).toBe(true);
    expect(projectMatch(base, matchEndMs(base) - 1).finished).toBe(false);
  });
});

describe('projectMatch — multigoal celebrations', () => {
  // two home goals one minute apart → overlapping celebration windows
  const stacked: MatchTimeline = {
    ...base,
    events: [
      { minute: 0, type: 'kickoff', team: null, text: 'ko' },
      { minute: 30, type: 'goal', team: 'home', text: 'g1', scoreAfter: { home: 1, away: 0 } },
      { minute: 31, type: 'goal', team: 'home', text: 'g2', scoreAfter: { home: 2, away: 0 } },
      { minute: 90, type: 'fulltime', team: null, text: 'ft' },
    ],
    finalScore: { home: 2, away: 0 },
  };

  it('reports a single live celebration before the second goal lands', () => {
    const s = projectMatch(stacked, goalMs(30) + 100);
    expect(s.celebratingCount).toBe(1);
    expect(s.celebrating?.text).toBe('g1');
    expect(s.celebratingTeams).toEqual(['home']);
  });

  it('counts both goals while their windows overlap (multigoal), freshest is primary', () => {
    const s = projectMatch(stacked, goalMs(31) + 100);
    expect(s.celebratingCount).toBe(2);
    expect(s.celebrating?.text).toBe('g2'); // freshest goal drives the primary display
    expect(s.celebratingTeams).toEqual(['home']);
    expect(s.ball).toEqual({ x: 0.5, y: 0.5 }); // ball still centred during the stacked beat
  });

  it('clears once both windows expire', () => {
    const s = projectMatch(stacked, goalMs(31) + CELEBRATION_MS + 100);
    expect(s.celebratingCount).toBe(0);
    expect(s.celebrating).toBeNull();
    expect(s.celebratingTeams).toEqual([]);
  });

  it('lists both teams when each scores in the same minute', () => {
    const bothTeams: MatchTimeline = {
      ...base,
      events: [
        { minute: 0, type: 'kickoff', team: null, text: 'ko' },
        { minute: 40, type: 'goal', team: 'home', text: 'gh', scoreAfter: { home: 1, away: 0 } },
        { minute: 40, type: 'goal', team: 'away', text: 'ga', scoreAfter: { home: 1, away: 1 } },
        { minute: 90, type: 'fulltime', team: null, text: 'ft' },
      ],
      finalScore: { home: 1, away: 1 },
    };
    const s = projectMatch(bothTeams, goalMs(40) + 100);
    expect(s.celebratingCount).toBe(2);
    expect([...s.celebratingTeams].sort()).toEqual(['away', 'home']);
  });

  it('a lone goal reads as count 1 (single, not multigoal)', () => {
    const s = projectMatch(base, goalMs(30) + 100); // base scores home @30 only in this window
    expect(s.celebratingCount).toBe(1);
    expect(s.celebratingTeams).toEqual(['home']);
  });

  it('is deterministic', () => {
    expect(projectMatch(stacked, goalMs(31) + 100)).toEqual(projectMatch(stacked, goalMs(31) + 100));
  });
});

describe('projectMatch — shootout (6s-per-kick cadence)', () => {
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
    shootout: { winner: 'home', home: 3, away: 2, kicks }, // home scored h1,h2,h3; away a1,a3
  };
  const soStart = MATCH_DURATION_MS;

  it('extends the watched duration by 6s per kick', () => {
    expect(matchEndMs(base)).toBe(MATCH_DURATION_MS);
    expect(matchEndMs(so)).toBe(MATCH_DURATION_MS + kicks.length * SHOOTOUT_KICK_MS);
  });

  it('stays regulation at exactly full-time, flips to pens just after', () => {
    expect(projectMatch(so, MATCH_DURATION_MS).phase).toBe('regulation');
    const pens = projectMatch(so, MATCH_DURATION_MS + 10);
    expect(pens.phase).toBe('shootout');
    expect(pens.clockLabel).toBe('PENS');
  });

  it('NO PENS SPOILER: the shootout view is null for the whole of regulation', () => {
    // Regression (Lucca 2026-07-11): the overlay used to mount at kickoff because the
    // view existed whenever timeline.shootout did, revealing the draw before it happened.
    for (const el of [0, 1, MATCH_DURATION_MS * 0.5, MATCH_DURATION_MS - 1, MATCH_DURATION_MS]) {
      expect(projectMatch(so, el).shootout).toBeNull();
    }
    expect(projectMatch(so, MATCH_DURATION_MS + 1).shootout).not.toBeNull();
  });

  it('winds up the taker before revealing each kick', () => {
    // early in kick 0's 6s beat: h1 is stepping up, nothing revealed yet
    const windup = projectMatch(so, soStart + SHOOTOUT_KICK_MS * 0.2).shootout!;
    expect(windup.kicks.length).toBe(0);
    expect(windup.pendingKicker).toEqual({ team: 'home', playerId: 'h1' });
    expect(windup.tally).toEqual({ home: 0, away: 0 });
  });

  it('reveals kicks one by one on the cadence, tallying scored pens', () => {
    // deep into kick 0's beat (result shown): 1 revealed, home 1, no pending
    const k0 = projectMatch(so, soStart + SHOOTOUT_KICK_MS * 0.8).shootout!;
    expect(k0.kicks.length).toBe(1);
    expect(k0.tally).toEqual({ home: 1, away: 0 });
    expect(k0.pendingKicker).toBeNull();
    // into kick 2's wind-up: h1+a1 revealed (both scored), h2 now stepping up
    const k2 = projectMatch(so, soStart + SHOOTOUT_KICK_MS * 2.2).shootout!;
    expect(k2.kicks.length).toBe(2);
    expect(k2.tally).toEqual({ home: 1, away: 1 });
    expect(k2.pendingKicker).toEqual({ team: 'home', playerId: 'h2' });
  });

  it('finishes with the full tally, decided winner, and no pending kicker', () => {
    const end = projectMatch(so, matchEndMs(so)).shootout!;
    expect(end.kicks.length).toBe(kicks.length);
    expect(end.tally).toEqual({ home: 3, away: 2 });
    expect(end.winner).toBe('home');
    expect(end.pendingKicker).toBeNull();
    expect(projectMatch(so, matchEndMs(so)).finished).toBe(true);
  });

  it('elapsed=∞ returns the final frame instantly (headless)', () => {
    const inf = projectMatch(so, Number.MAX_SAFE_INTEGER);
    expect(inf.finished).toBe(true);
    expect(inf.shootout!.kicks.length).toBe(kicks.length);
    expect(inf.shootout!.winner).toBe('home');
    expect(inf.shootout!.pendingKicker).toBeNull();
  });

  it('never reveals more kicks than exist; legacy aliases stay in sync', () => {
    // start just past full-time — AT soStart the view is null (no-spoiler rule)
    for (let el = soStart + 1; el <= matchEndMs(so) + 500; el += 173) {
      const s = projectMatch(so, el).shootout!;
      expect(s.kicks.length).toBeLessThanOrEqual(kicks.length);
      expect(s.taken).toBe(s.kicks);
      expect(s.home).toBe(s.tally.home);
      expect(s.away).toBe(s.tally.away);
      expect(s.stepping).toBe(s.pendingKicker?.team ?? null);
    }
  });

  it('early-round timeline with NO shootout stays regulation to the end', () => {
    expect(base.shootout).toBeUndefined();
    const end = projectMatch(base, Number.MAX_SAFE_INTEGER);
    expect(end.phase).toBe('regulation');
    expect(end.shootout).toBeNull();
    expect(matchEndMs(base)).toBe(MATCH_DURATION_MS);
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
