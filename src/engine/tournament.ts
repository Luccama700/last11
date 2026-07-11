import { draftBotXi } from './draft';
import { simulateMatch } from './match';
import { teamStrength } from './rating';
import { createRng, type Rng } from './rng';
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

/**
 * Play one battle-royale round: MATCHES_PER_ROUND random pairings, points table,
 * bottom cut to `targetSurvivors`. Does not mutate managers — caller applies cuts.
 */
export function playRound(
  alive: readonly Manager[],
  targetSurvivors: number,
  round: number,
  rng: Rng,
): RoundResult {
  if (alive.length % 2 !== 0) throw new Error(`Odd lobby size: ${alive.length}`);
  const strengths = new Map<string, number>();
  const stats = new Map<string, { points: number; gf: number; ga: number }>();
  for (const m of alive) {
    strengths.set(m.id, teamStrength(m.xi).total);
    stats.set(m.id, { points: 0, gf: 0, ga: 0 });
  }

  const matches: MatchResult[] = [];
  for (let set = 0; set < MATCHES_PER_ROUND; set++) {
    const order = rng.shuffle(alive);
    for (let i = 0; i + 1 < order.length; i += 2) {
      const home = order[i];
      const away = order[i + 1];
      const { goalsA, goalsB } = simulateMatch(
        strengths.get(home.id)!,
        strengths.get(away.id)!,
        rng,
      );
      matches.push({ homeId: home.id, awayId: away.id, homeGoals: goalsA, awayGoals: goalsB });
      const hs = stats.get(home.id)!;
      const as = stats.get(away.id)!;
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

  return {
    round,
    matches,
    table,
    eliminatedIds: table.slice(targetSurvivors).map((r) => r.managerId),
  };
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
 */
export function runTournament(seed: number): { managers: Manager[]; log: TournamentLog } {
  const rng = createRng(seed);
  const managers = createBotLobby(rng);
  const rounds: RoundResult[] = [];
  let alive = managers.filter((m) => m.alive);

  SURVIVORS_PER_ROUND.forEach((target, i) => {
    const result = playRound(alive, target, i + 1, rng);
    rounds.push(result);
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
