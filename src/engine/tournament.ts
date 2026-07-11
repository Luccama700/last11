import { draftBotXi } from './draft';
import { matchSeed, resolveMatch, simulateMatch, type MatchSide } from './match';
import { moraleForManager, type MoraleMap } from './morale';
import { teamStrength } from './rating';
import { createRng, type Rng } from './rng';
import { COARSE_TO_DETAILED, type CoarsePosition } from './data/schema';
import { FEATURES } from '../game/features';
import { POINTS, type MatchResultV2, type Tactics, type XiSlotV2 } from './types';
import type { Player, XI } from './types';

export interface Manager {
  id: string;
  name: string;
  isHuman: boolean;
  xi: XI;
  alive: boolean;
}

export interface MatchResult {
  homeId: string;
  awayId: string;
  homeGoals: number;
  awayGoals: number;
}

export interface TableRow {
  managerId: string;
  points: number;
  gf: number;
  ga: number;
  gd: number;
  strength: number;
}

export interface RoundResult {
  round: number;
  matches: MatchResult[];
  /** Sorted best-first. The bottom entries past the survivor target are out. */
  table: TableRow[];
  eliminatedIds: string[];
  /** v2 only (engineV2 ON): full per-match results incl. regulation goals + scorer/
   *  assist + shootout. Feeds morale + the sim's real timelines. Absent on the v1 path. */
  resultsV2?: MatchResultV2[];
  /** v2 only: state to carry into the next round — the running match counter (for
   *  per-match seeds) and each manager's morale after this round's last match. */
  engineNext?: { matchIndex: number; moraleByManager: Record<string, MoraleMap> };
}

export const LOBBY_SIZE = 32;
/** Survivor count after each round: 32 -> 24 -> 16 -> 8 -> 4 -> 2 -> champion. */
export const SURVIVORS_PER_ROUND: readonly number[] = [24, 16, 8, 4, 2, 1];
/** Each alive manager plays this many matches per round. */
export const MATCHES_PER_ROUND = 3;

export const BOT_NAMES: readonly string[] = [
  'Pep Talkiola',
  'José Moanrinho',
  'Zizou Zidone',
  'Sir Alex Fergie-son',
  'Carlo Anceloco',
  'Jürgen Klopp-out',
  'Didier Deschampagne',
  'Xavi Hernandeus',
  'Hansi Flickr',
  'Luis Enrique-sta',
  'Antonio Content',
  'Diego Simehome',
  'Marcelo Bielsanity',
  'Arsène Whinger',
  'Thomas Tuchill',
  'Unai Emery-gency',
  'Erik ten Haggle',
  'Mikel Artetacos',
  'Roberto Manciniamo',
  'Vicente del Bosquecito',
  'Fabio Capellow',
  'Joachim Löwkey',
  'Tite Deadline',
  'Dunga Dünger',
  'Óscar Tabáreze',
  'Marcello Lippizza',
  'Aimé Jacquetship',
  'Sven-Göran Erikssong',
  'Otto Rehhagel-berg',
  'Guus Hiddinkding',
  'Bora Milutinovictory',
  'Louis van Goal',
];

/** 1 human (empty XI, drafts via UI) + 31 drafted bots. */
export function createLobby(rng: Rng, humanName: string): Manager[] {
  const names = rng.shuffle(BOT_NAMES);
  const managers: Manager[] = [
    { id: 'you', name: humanName, isHuman: true, xi: [], alive: true },
  ];
  for (let i = 0; i < LOBBY_SIZE - 1; i++) {
    managers.push({
      id: `bot-${i + 1}`,
      name: names[i],
      isHuman: false,
      xi: draftBotXi(rng),
      alive: true,
    });
  }
  return managers;
}

/** All-bot lobby for headless runs and tests. */
export function createBotLobby(rng: Rng): Manager[] {
  const names = rng.shuffle(BOT_NAMES);
  return Array.from({ length: LOBBY_SIZE }, (_, i) => ({
    id: `bot-${i + 1}`,
    name: names[i],
    isHuman: false,
    xi: draftBotXi(rng),
    alive: true,
  }));
}

function compareRows(a: TableRow, b: TableRow): number {
  if (a.points !== b.points) return b.points - a.points;
  if (a.gd !== b.gd) return b.gd - a.gd;
  if (a.gf !== b.gf) return b.gf - a.gf;
  if (a.strength !== b.strength) return b.strength - a.strength;
  return a.managerId < b.managerId ? -1 : 1;
}

// ============================================================================
// engineV2 wiring (CONTRACT §4 + TICKSPEC v0.3; behind FEATURES.engineV2).
// The v1 path (flag OFF) is byte-identical to before. The v2 path swaps
// simulateMatch → resolveMatch (tactics-aware, shootouts), applies the POINTS
// table incl. shootout W2/L1, and threads morale match-to-match (DECISIONS).
// ============================================================================

/** Default bot tactics for the legacy→v2 bridge. The current bot XI is a coarse
 *  4-3-3, so this is the honest formation; varied bot tactics arrive with draft v2. */
export const DEFAULT_TACTICS: Tactics = { formationId: '4-3-3', style: 'balanced' };

// Per-match seeds use the CANONICAL `matchSeed(tournamentSeed, round, matchIndex)`
// from engine/match.ts (game-engine, c4fa341) — the same helper App passes to
// `simulateMatchTimeline`, guaranteeing table score === watched score.

/** Project a legacy Manager into a v2 MatchSide: coarse position → representative
 *  detailed (natural == slot ⇒ affinity 1.0), legacy Player → PlayerV2 (year 2026).
 *  Exported so App builds the SAME sides it hands to `simulateMatchTimeline`. */
export function toMatchSide(m: Manager, tactics: Tactics, morale?: MoraleMap): MatchSide {
  const xi: XiSlotV2[] = m.xi.map((s) => {
    const pos = COARSE_TO_DETAILED[s.position as CoarsePosition];
    return {
      position: pos,
      player: {
        id: s.player.id,
        name: s.player.name,
        nation: s.player.nation,
        year: 2026,
        position: pos,
        rating: s.player.rating,
      },
    };
  });
  return { id: m.id, xi, tactics, morale };
}

/** engineV2 config threaded through a round (built by runTournament / App). */
export interface PlayRoundEngine {
  tournamentSeed: number;
  /** Running global match counter (unique per-match seeds across sets/rounds). */
  matchIndex: number;
  /** Morale to apply this round's first set, per manager (carried from last round). */
  moraleByManager: Record<string, MoraleMap>;
  tacticsOf: (m: Manager) => Tactics;
}

/**
 * Play one battle-royale round: MATCHES_PER_ROUND random pairings, points table,
 * bottom cut to `targetSurvivors`. Does not mutate managers — caller applies cuts.
 * With `engine` set (engineV2 ON) it uses the tactics-aware engine + shootout points
 * + morale; without it, the original v1 Poisson path runs unchanged.
 */
export function playRound(
  alive: readonly Manager[],
  targetSurvivors: number,
  round: number,
  rng: Rng,
  engine?: PlayRoundEngine,
): RoundResult {
  if (alive.length % 2 !== 0) throw new Error(`Odd lobby size: ${alive.length}`);
  const strengths = new Map<string, number>();
  const stats = new Map<string, { points: number; gf: number; ga: number }>();
  for (const m of alive) {
    strengths.set(m.id, teamStrength(m.xi).total);
    stats.set(m.id, { points: 0, gf: 0, ga: 0 });
  }

  const matches: MatchResult[] = [];
  const resultsV2: MatchResultV2[] = [];
  let morale: Record<string, MoraleMap> = engine ? engine.moraleByManager : {};
  let matchIndex = engine ? engine.matchIndex : 0;

  for (let set = 0; set < MATCHES_PER_ROUND; set++) {
    const order = rng.shuffle(alive);
    const setResults: MatchResultV2[] = [];
    for (let i = 0; i + 1 < order.length; i += 2) {
      const home = order[i];
      const away = order[i + 1];
      const hs = stats.get(home.id)!;
      const as = stats.get(away.id)!;

      if (engine) {
        const seed = matchSeed(engine.tournamentSeed, round, matchIndex++);
        const r = resolveMatch(
          toMatchSide(home, engine.tacticsOf(home), morale[home.id]),
          toMatchSide(away, engine.tacticsOf(away), morale[away.id]),
          seed,
        );
        r.seed = seed;
        r.homeMorale = morale[home.id];
        r.awayMorale = morale[away.id];
        resultsV2.push(r);
        setResults.push(r);
        matches.push({ homeId: home.id, awayId: away.id, homeGoals: r.homeGoals, awayGoals: r.awayGoals });
        hs.gf += r.homeGoals;
        hs.ga += r.awayGoals;
        as.gf += r.awayGoals;
        as.ga += r.homeGoals;
        // No draws: a level regulation match is decided on penalties (W2/L1).
        if (r.shootout) {
          if (r.shootout.winner === 'home') {
            hs.points += POINTS.SHOOTOUT_WIN;
            as.points += POINTS.SHOOTOUT_LOSS;
          } else {
            as.points += POINTS.SHOOTOUT_WIN;
            hs.points += POINTS.SHOOTOUT_LOSS;
          }
        } else if (r.homeGoals > r.awayGoals) {
          hs.points += POINTS.REG_WIN;
        } else {
          as.points += POINTS.REG_WIN;
        }
      } else {
        const { goalsA, goalsB } = simulateMatch(
          strengths.get(home.id)!,
          strengths.get(away.id)!,
          rng,
        );
        matches.push({ homeId: home.id, awayId: away.id, homeGoals: goalsA, awayGoals: goalsB });
        hs.gf += goalsA;
        hs.ga += goalsB;
        as.gf += goalsB;
        as.ga += goalsA;
        if (goalsA > goalsB) hs.points += 3;
        else if (goalsB > goalsA) as.points += 3;
        else {
          hs.points += 1;
          as.points += 1;
        }
      }
    }

    // Morale is "next match only": recompute each manager's buff from THIS set's
    // goals, replacing (not accumulating), for the following set / round.
    if (engine) {
      const next: Record<string, MoraleMap> = {};
      for (const m of alive) next[m.id] = moraleForManager(setResults, m.id);
      morale = next;
    }
  }

  const table = [...alive]
    .map((m) => {
      const s = stats.get(m.id)!;
      return {
        managerId: m.id,
        points: s.points,
        gf: s.gf,
        ga: s.ga,
        gd: s.gf - s.ga,
        strength: strengths.get(m.id)!,
      };
    })
    .sort(compareRows);

  const result: RoundResult = {
    round,
    matches,
    table,
    eliminatedIds: table.slice(targetSurvivors).map((r) => r.managerId),
  };
  if (engine) {
    result.resultsV2 = resultsV2;
    result.engineNext = { matchIndex, moraleByManager: morale };
  }
  return result;
}

/** Unique players from freshly eliminated teams — loot for the survivors. */
export function stealPool(eliminated: readonly Manager[]): Player[] {
  const seen = new Set<string>();
  const pool: Player[] = [];
  for (const m of eliminated) {
    for (const { player } of m.xi) {
      if (!seen.has(player.id)) {
        seen.add(player.id);
        pool.push(player);
      }
    }
  }
  return pool;
}

export interface StealOption {
  slotIndex: number;
  player: Player;
  gain: number;
}

/** Best strictly-improving swap from the pool into the XI, or null. */
export function evaluateSteal(xi: XI, pool: readonly Player[]): StealOption | null {
  const current = teamStrength(xi).total;
  const onTeam = new Set(xi.map((s) => s.player.id));
  let best: StealOption | null = null;
  for (const player of pool) {
    if (onTeam.has(player.id)) continue;
    for (let i = 0; i < xi.length; i++) {
      const candidate = xi.map((s, j) => (j === i ? { position: s.position, player } : s));
      const gain = teamStrength(candidate).total - current;
      if (gain <= 0) continue;
      if (!best || gain > best.gain || (gain === best.gain && player.id < best.player.id)) {
        best = { slotIndex: i, player, gain };
      }
    }
  }
  return best;
}

/** Swap `player` into slot `slotIndex`, returning a new XI. */
export function applySteal(xi: XI, slotIndex: number, player: Player): XI {
  return xi.map((s, i) => (i === slotIndex ? { position: s.position, player } : s));
}

export interface TournamentLog {
  seed: number;
  winnerId: string;
  rounds: RoundResult[];
}

/**
 * Full headless battle royale: 32 bots draft, then rounds of matches with
 * elimination cuts and post-round steals until one manager stands.
 *
 * `engineV2` defaults to the live feature flag; pass it explicitly (true/false) to
 * exercise both flag states in tests. Both states resolve to exactly one winner
 * deterministically — the v2 path threads morale + per-match seeds across rounds.
 */
export function runTournament(
  seed: number,
  engineV2: boolean = FEATURES.engineV2,
): { managers: Manager[]; log: TournamentLog } {
  const rng = createRng(seed);
  const managers = createBotLobby(rng);
  const rounds: RoundResult[] = [];
  let alive = managers.filter((m) => m.alive);
  let moraleByManager: Record<string, MoraleMap> = {};
  let matchIndex = 0;

  SURVIVORS_PER_ROUND.forEach((target, i) => {
    const engine: PlayRoundEngine | undefined = engineV2
      ? { tournamentSeed: seed, matchIndex, moraleByManager, tacticsOf: () => DEFAULT_TACTICS }
      : undefined;
    const result = playRound(alive, target, i + 1, rng, engine);
    rounds.push(result);
    if (result.engineNext) {
      matchIndex = result.engineNext.matchIndex;
      moraleByManager = result.engineNext.moraleByManager;
    }
    const eliminatedSet = new Set(result.eliminatedIds);
    const eliminated = alive.filter((m) => eliminatedSet.has(m.id));
    for (const m of eliminated) m.alive = false;
    alive = alive.filter((m) => m.alive);
    if (alive.length > 1) {
      const pool = stealPool(eliminated);
      for (const m of alive) {
        const steal = evaluateSteal(m.xi, pool);
        if (steal) m.xi = applySteal(m.xi, steal.slotIndex, steal.player);
      }
    }
  });

  return { managers, log: { seed, winnerId: alive[0].id, rounds } };
}
