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
import { shotWeight } from './rating';
import { createRng, type Rng } from './rng';
import * as P from './params';
import {
  VIRTUAL_MINUTES,
  type MatchTimeline,
  type Team,
  type TimelineEvent,
  type TimelineTick,
  type XiSlotV2,
} from './types';
import type { Position } from './data/schema';

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Independent cosmetic stream, deterministically derived from the match seed. */
const cosmeticSeed = (seed: number): number => (seed ^ 0x9e3779b9) >>> 0;

const LANES = ['L', 'C', 'R'] as const;

export function simulateMatchTimeline(
  home: MatchSide,
  away: MatchSide,
  seed: number,
  shootoutEnabled = true,
  matchId?: string,
): MatchTimeline {
  // shootoutEnabled must match what the tournament used for this match (≤16 alive),
  // so the watched timeline reproduces the table result — draw or shootout (TICKSPEC §5).
  const o = resolveMatchOutcome(home, away, seed, shootoutEnabled);
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

  // ── Match furniture (Lucca, 2026-07-11 playtest): fouls, corners, goal kicks,
  // throw-ins — cosmetic ticker events with CORRECTLY attributed players, drawn
  // ONLY from the cosmetic rng so the outcome is untouched. ──
  addFurnitureEvents(events, ticks, home, away, goalMinutes, names, cos);

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

// ── Match furniture ───────────────────────────────────────────────────────────

const WIDE: readonly Position[] = ['LW', 'RW', 'LM', 'RM', 'LB', 'RB'];
const DEFENSIVE: readonly Position[] = ['CB', 'RB', 'LB', 'CDM', 'CM'];
const FORWARD: readonly Position[] = ['CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST'];

const inGroup = (xi: readonly XiSlotV2[], group: readonly Position[]): XiSlotV2[] =>
  xi.filter((s) => group.includes(s.position));

const pickFrom = (list: readonly XiSlotV2[], fallback: readonly XiSlotV2[], rng: Rng): XiSlotV2 => {
  const pool = list.length > 0 ? list : fallback;
  return pool[Math.min(pool.length - 1, Math.floor(rng.next() * pool.length))];
};

/** The side's set-piece taker: highest shot weight among WIDE players, falling
 *  back to the best attacker — the same corner taker all match, like real life. */
const cornerTaker = (xi: readonly XiSlotV2[]): XiSlotV2 => {
  const wide = inGroup(xi, WIDE);
  const pool = wide.length > 0 ? wide : xi;
  return pool.reduce((best, s) => (shotWeight(s) > shotWeight(best) ? s : best), pool[0]);
};

/**
 * 5–9 attributed furniture events per match, minutes drawn (cosmetic rng) with
 * rejection against goal minutes, each other, and the 0/45/90 landmarks. The
 * side an event favors follows that minute's possession tick: corners and
 * throw-ins go to the attacking side, goal kicks to the defending side, and a
 * foul is committed by the defending side's DEF/MID on an attacking MID/ATT
 * (the fouled player's team is the event's team — they get the free kick).
 */
function addFurnitureEvents(
  events: TimelineEvent[],
  ticks: readonly TimelineTick[],
  home: MatchSide,
  away: MatchSide,
  goalMinutes: ReadonlySet<number>,
  names: ReadonlyMap<string, string>,
  cos: Rng,
): void {
  const xiOf = (team: Team) => (team === 'home' ? home.xi : away.xi);
  const nameOf = (s: XiSlotV2) => names.get(s.player.id) ?? s.player.name;
  const used = new Set<number>([0, 45, VIRTUAL_MINUTES]);
  const count = 5 + Math.floor(cos.next() * 5); // 5..9
  for (let i = 0; i < count; i++) {
    let minute = 2 + Math.floor(cos.next() * (VIRTUAL_MINUTES - 4));
    let guard = 0;
    while ((used.has(minute) || goalMinutes.has(minute)) && guard++ < 50) {
      minute = 2 + Math.floor(cos.next() * (VIRTUAL_MINUTES - 4));
    }
    used.add(minute);
    const attacking: Team = ticks[minute]?.possession ?? 'home';
    const defending: Team = attacking === 'home' ? 'away' : 'home';
    const roll = cos.next();
    if (roll < 0.3) {
      // throw-in: the attacking side's wide man hurls it back in
      const s = pickFrom(inGroup(xiOf(attacking), WIDE), xiOf(attacking), cos);
      events.push({
        minute,
        type: 'throw_in',
        team: attacking,
        text: `Out of bounds — throw-in, ${nameOf(s)}`,
        playerId: s.player.id,
      });
    } else if (roll < 0.6) {
      // foul: defending DEF/MID chops down an attacking MID/ATT — free kick
      const by = pickFrom(inGroup(xiOf(defending), DEFENSIVE), xiOf(defending), cos);
      const on = pickFrom(inGroup(xiOf(attacking), FORWARD), xiOf(attacking), cos);
      events.push({
        minute,
        type: 'foul',
        team: attacking,
        text: `Foul: ${nameOf(by)} brings down ${nameOf(on)}`,
        playerId: by.player.id,
      });
    } else if (roll < 0.85) {
      // corner to the attacking side, taken by their set-piece man
      const s = cornerTaker(xiOf(attacking));
      events.push({
        minute,
        type: 'corner',
        team: attacking,
        text: `Corner — ${nameOf(s)} swings it in`,
        playerId: s.player.id,
      });
    } else {
      // goal kick: the DEFENDING side's keeper restarts
      const gk = xiOf(defending).find((s) => s.position === 'GK') ?? xiOf(defending)[0];
      events.push({
        minute,
        type: 'goal_kick',
        team: defending,
        text: `Goal kick — ${nameOf(gk)}`,
        playerId: gk.player.id,
      });
    }
  }
}
