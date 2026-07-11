/**
 * Match timeline producer — the WATCHED-match output (CONTRACT §4 + TICKSPEC v0.3).
 *
 * `simulateMatchTimeline` calls the SHARED core `resolveMatchOutcome` (so its
 * scoreline/winner are byte-identical to the headless `resolveMatch` for the same
 * seed — the score/timeline agreement invariant), then layers on:
 *   • per-minute ticks (ballPosition + ballLane + momentum + possession) for the
 *     2D pitch + 22 drifting dots (sim renders; engine only emits the ball zone);
 *   • a minute-stamped event ticker with engine-authored captions;
 *   • the box score; and the shootout events when the match was level.
 *
 * All tick/caption cosmetics use a SEPARATE derived rng so they never perturb the
 * outcome draws in `resolveMatchOutcome` (TICKSPEC §5). Deterministic throughout.
 */
import { resolveMatchOutcome, outcomeBoxScore, type MatchSide } from './match';
import { createRng } from './rng';
import * as P from './params';
import {
  VIRTUAL_MINUTES,
  type MatchTimeline,
  type Team,
  type TimelineEvent,
  type TimelineTick,
} from './types';

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Independent cosmetic stream, deterministically derived from the match seed. */
const cosmeticSeed = (seed: number): number => (seed ^ 0x9e3779b9) >>> 0;

const LANES = ['L', 'C', 'R'] as const;

export function simulateMatchTimeline(
  home: MatchSide,
  away: MatchSide,
  seed: number,
  matchId?: string,
): MatchTimeline {
  const o = resolveMatchOutcome(home, away, seed);
  const cos = createRng(cosmeticSeed(seed));

  // Player id → display name, for caption authoring.
  const names = new Map<string, string>();
  for (const s of [...home.xi, ...away.xi]) names.set(s.player.id, s.player.name);

  // ── Ticks: an AR(1) momentum walk biased toward the stronger/attacking side ──
  const territory =
    (P.LINE_HEIGHT_TERRITORY[home.tactics.lineHeight ?? 'mid'] -
      P.LINE_HEIGHT_TERRITORY[away.tactics.lineHeight ?? 'mid']);
  const bias = Math.max(-0.6, Math.min(0.6, (o.xg.home - o.xg.away) * 0.25 + territory));

  const ticks: TimelineTick[] = [];
  let momentum = bias;
  for (let minute = 0; minute <= VIRTUAL_MINUTES; minute++) {
    // Mean-reverting toward bias with jitter — lively but bounded.
    momentum = Math.max(-1, Math.min(1, 0.7 * momentum + 0.3 * bias + (cos.next() - 0.5) * 0.6));
    const possession: Team = momentum >= 0 ? 'home' : 'away';
    const band = Math.max(0, Math.min(4, Math.round(((momentum + 1) / 2) * 4)));
    const ballPosition = clamp01(P.BAND_CENTER_X[band] + (cos.next() * 2 - 1) * P.BALL_JITTER);
    const lane = LANES[Math.min(2, Math.floor(cos.next() * 3))];
    const ballLane = clamp01(P.LANE_CENTER_Y[lane] + (cos.next() * 2 - 1) * P.BALL_JITTER);
    ticks.push({ minute, ballPosition, ballLane, momentum, possession });
  }

  // ── Events ──
  const events: TimelineEvent[] = [];
  events.push({ minute: 0, type: 'kickoff', team: null, text: 'Kick-off' });

  // Goals (already minute-sorted by the core); running score → scoreAfter.
  let h = 0;
  let a = 0;
  const goalMinutes = new Set<number>();
  for (const g of o.goals) {
    if (g.team === 'home') h++;
    else a++;
    goalMinutes.add(g.minute);
    const scorer = names.get(g.playerId) ?? 'Someone';
    const assist = g.assistPlayerId ? names.get(g.assistPlayerId) : undefined;
    events.push({
      minute: g.minute,
      type: 'goal',
      team: g.team,
      text: `GOAL! ${scorer}${assist ? ` (assist: ${assist})` : ''} — ${h}-${a}`,
      scoreAfter: { home: h, away: a },
      playerId: g.playerId,
      ...(g.assistPlayerId ? { assistPlayerId: g.assistPlayerId } : {}),
    });
  }

  events.push({ minute: 45, type: 'halftime', team: null, text: 'Half-time' });

  // A light sprinkle of no-goal flavour on high-pressure minutes (ticker life).
  let flavour = 0;
  for (let minute = 3; minute < VIRTUAL_MINUTES && flavour < 5; minute++) {
    if (goalMinutes.has(minute)) continue;
    const t = ticks[minute];
    if (Math.abs(t.momentum) > 0.75 && cos.next() < 0.12) {
      const team = t.possession;
      const roll = cos.next();
      const [type, text] =
        roll < 0.45
          ? (['chance', 'Big chance — just wide!'] as const)
          : roll < 0.8
            ? (['save', 'Great save keeps it level!'] as const)
            : (['counter', 'Lightning counter-attack!'] as const);
      events.push({ minute, type, team, text });
      flavour++;
    }
  }

  events.push({ minute: VIRTUAL_MINUTES, type: 'fulltime', team: null, text: 'Full-time' });

  // Shootout events (all stamped at minute 90, in kick order).
  if (o.shootout) {
    const so = o.shootout;
    events.push({ minute: VIRTUAL_MINUTES, type: 'shootout_start', team: null, text: 'Penalties!' });
    for (const k of so.kicks) {
      const taker = names.get(k.playerId) ?? 'Taker';
      events.push({
        minute: VIRTUAL_MINUTES,
        type: k.scored ? 'penalty_scored' : 'penalty_missed',
        team: k.team,
        text: k.scored ? `${taker} scores` : `${taker}'s penalty saved!`,
        playerId: k.playerId,
      });
    }
    const winnerName = so.winner === 'home' ? home.id : away.id;
    events.push({
      minute: VIRTUAL_MINUTES,
      type: 'shootout_end',
      team: so.winner,
      text: `${winnerName} win ${so.home}-${so.away} on penalties`,
    });
  }

  // Stable minute-sort (preserves within-minute authored order, incl. shootout).
  events.sort((x, y) => x.minute - y.minute);

  return {
    matchId: matchId ?? `${home.id}-v-${away.id}-${seed}`,
    homeId: home.id,
    awayId: away.id,
    seed,
    durationMinutes: VIRTUAL_MINUTES,
    ticks,
    events,
    finalScore: { home: o.homeGoals, away: o.awayGoals },
    ...(o.shootout ? { shootout: o.shootout } : {}),
    homeFormationId: home.tactics.formationId,
    awayFormationId: away.tactics.formationId,
    boxScore: outcomeBoxScore(o),
  };
}
