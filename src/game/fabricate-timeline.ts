/**
 * Tier-A timeline adapter (sim workstream, MATCH-SIM).
 *
 * Turns a v1 scoreline (`homeGoals`/`awayGoals`) into a full `MatchTimeline` so
 * on-screen playback is demoable on the CURRENT engine, without waiting for
 * engine-v2's `simulateMatchTimeline`. Deterministic: seeded from a stable hash
 * of the fixture (NOT the game rng — so fabricating never disturbs the tournament
 * sequence). When engine-v2 lands, App sources real timelines instead and this
 * adapter is simply unused; the `MatchTimeline` shape is identical either way.
 *
 * Note: the v1 engine has DRAWS (level = 1 pt each), so a level match fabricates
 * as an honest draw — NO shootout (a fabricated pen winner would contradict the
 * v1 table). Real shootouts arrive on engine-v2 timelines via `timeline.shootout`;
 * `projectMatch` + the playback screen already render them.
 */
import { createRng } from '../engine/rng';
import { VIRTUAL_MINUTES, formationById, type MatchTimeline, type Team, type TimelineEvent } from '../engine/types';

export interface V1Match {
  homeId: string;
  awayId: string;
  homeGoals: number;
  awayGoals: number;
}

export interface FabricateOpts {
  round: number;
  matchIndex: number;
  homeName?: string;
  awayName?: string;
  homeFormationId?: string;
  /** Cosmetic variety for the demo pitch; defaults to a seeded pick. */
  awayFormationId?: string;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function seedFor(match: V1Match, o: FabricateOpts): number {
  return hashSeed(`${match.homeId}|${match.awayId}|${match.homeGoals}|${match.awayGoals}|${o.round}|${o.matchIndex}`);
}

/** Deterministic goal minutes/teams (shared by the rail + the full timeline). */
export function assignGoals(match: V1Match, o: FabricateOpts): { minute: number; team: Team }[] {
  const rng = createRng(seedFor(match, o));
  const goals: { minute: number; team: Team }[] = [];
  const place = (count: number, team: Team) => {
    for (let k = 0; k < count; k++) goals.push({ minute: 3 + rng.int(85), team }); // 3..87
  };
  place(match.homeGoals, 'home');
  place(match.awayGoals, 'away');
  return goals.sort((a, b) => a.minute - b.minute || (a.team === b.team ? 0 : a.team === 'home' ? -1 : 1));
}

const FORMATION_IDS = ['4-3-3', '4-4-2', '4-2-3-1', '4-2-4', '3-5-2', '5-3-2', '4-5-1', '3-4-3'];

/** Full timeline for a WATCHED match (the human's featured games). */
export function fabricateTimeline(match: V1Match, o: FabricateOpts): MatchTimeline {
  const rng = createRng(seedFor(match, o) ^ 0x9e3779b9);
  const N = VIRTUAL_MINUTES;
  const goals = assignGoals(match, o);
  const homeName = o.homeName ?? 'Home';
  const awayName = o.awayName ?? 'Away';
  const homeFormationId = (o.homeFormationId && formationById(o.homeFormationId)) ? o.homeFormationId : '4-3-3';
  const awayFormationId = (o.awayFormationId && formationById(o.awayFormationId)) ? o.awayFormationId : rng.pick(FORMATION_IDS);

  // phases for the base field-position waves (seeded so it's deterministic)
  const pA = rng.next() * Math.PI * 2;
  const pB = rng.next() * Math.PI * 2;
  const pC = rng.next() * Math.PI * 2;
  const base = (m: number) => clamp(0.5 + 0.3 * Math.sin(m * 0.5 + pA) + 0.14 * Math.sin(m * 0.17 + pB), 0.06, 0.94);

  const ticks = Array.from({ length: N + 1 }, (_, m) => {
    let ballPosition = base(m);
    // in the ~3 minutes before a goal, drag the ball to the scoring team's end (a "deserved" build-up)
    for (const g of goals) {
      if (m > g.minute || m < g.minute - 3) continue;
      const t = (m - (g.minute - 3)) / 3; // 0..1 approaching the goal
      const target = g.team === 'home' ? 0.92 : 0.08;
      ballPosition = lerp(ballPosition, target, t * t);
    }
    const ballLane = clamp(0.5 + 0.34 * Math.sin(m * 0.2 + pC), 0.1, 0.9);
    const momentum = clamp((ballPosition - 0.5) * 2, -1, 1);
    return { minute: m, ballPosition, ballLane, momentum, possession: (momentum >= 0 ? 'home' : 'away') as Team };
  });

  // events: kickoff, a couple of neutral beats, the goals with running score, HT, FT
  const events: TimelineEvent[] = [{ minute: 0, type: 'kickoff', team: null, text: `Kick-off: ${homeName} v ${awayName}.` }];
  let h = 0;
  let aw = 0;
  const flavourFor = (team: Team, scorer: string) =>
    team === 'home' ? `GOAL! ${scorer} strikes for ${homeName}.` : `GOAL! ${scorer} replies for ${awayName}.`;
  for (const g of goals) {
    if (g.team === 'home') h++;
    else aw++;
    events.push({
      minute: g.minute,
      type: 'goal',
      team: g.team,
      text: flavourFor(g.team, g.team === 'home' ? homeName : awayName),
      scoreAfter: { home: h, away: aw },
    });
  }
  // a light non-goal beat if the match was quiet, so the ticker isn't empty
  if (goals.length === 0) events.push({ minute: 27, type: 'chance', team: 'home', text: 'A half-chance goes begging.' });
  events.push({ minute: N / 2, type: 'halftime', team: null, text: `Half-time: ${h}–${aw}.` });
  events.push({ minute: N, type: 'fulltime', team: null, text: `Full-time: ${h}–${aw}.` });
  events.sort((a, b) => a.minute - b.minute);

  // cosmetic box score (att tracks goals; the rest a plausible spread)
  const boxOf = (goalsFor: number): { gk: number; def: number; mid: number; att: number; overall: number } => {
    const att = clamp(55 + goalsFor * 8, 40, 95);
    const def = 60 + rng.int(20);
    const mid = 60 + rng.int(20);
    const gk = 60 + rng.int(20);
    return { gk, def, mid, att, overall: Math.round((gk + def + mid + att) / 4) };
  };

  return {
    matchId: `r${o.round}-m${o.matchIndex}`,
    homeId: match.homeId,
    awayId: match.awayId,
    seed: seedFor(match, o),
    durationMinutes: N,
    ticks,
    events,
    finalScore: { home: match.homeGoals, away: match.awayGoals },
    // no `shootout` — v1 level matches are honest draws (see file header)
    homeFormationId,
    awayFormationId,
    boxScore: { home: boxOf(match.homeGoals), away: boxOf(match.awayGoals), xg: { home: match.homeGoals, away: match.awayGoals } },
  };
}
