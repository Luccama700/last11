/**
 * Per-player tournament stats — Golden Boot / Playmaker source data.
 *
 * Morning JOB 2 (Main, 2026-07-11): accumulate goals + assists across the whole
 * tournament from `RoundResult.resultsV2[].goals` (scorer `playerId`, assister
 * `assistPlayerId`), INCLUDING fast-forwarded rounds. The reducer folds this on
 * ROUND_PLAYED (live rounds) and FINISHED (the fast-forward tail) — no double count,
 * since a round appears in exactly one of those. v1 rounds (no resultsV2) contribute
 * nothing. Main renders the Golden Boot / Playmaker UI from `topScorers`/`topAssists`.
 */
import type { Manager, RoundResult } from '../engine/tournament';

export type PlayerStats = Record<string, { goals: number; assists: number }>;

export interface StatLine {
  playerId: string;
  name: string;
  goals: number;
  assists: number;
}

/** Fold a batch of rounds' resultsV2 goals into a NEW stats map (pure; `prev` and its
 *  entry objects are never mutated). */
export function accrueStats(prev: PlayerStats, rounds: readonly RoundResult[]): PlayerStats {
  const next: PlayerStats = { ...prev };
  const bump = (id: string, key: 'goals' | 'assists') => {
    const cur = next[id] ?? { goals: 0, assists: 0 };
    next[id] = { ...cur, [key]: cur[key] + 1 };
  };
  for (const round of rounds) {
    for (const m of round.resultsV2 ?? []) {
      for (const g of m.goals) {
        if (g.playerId) bump(g.playerId, 'goals');
        if (g.assistPlayerId) bump(g.assistPlayerId, 'assists');
      }
    }
  }
  return next;
}

/** playerId → display name, from every manager's XI (covers bots + the human's
 *  projected players; unknown ids fall back to the id itself). */
export function buildNameLookup(managers: readonly Manager[]): (id: string) => string {
  const names = new Map<string, string>();
  for (const m of managers) for (const s of m.xi) names.set(s.player.id, s.player.name);
  return (id) => names.get(id) ?? id;
}

function lines(stats: PlayerStats, nameOf: (id: string) => string): StatLine[] {
  return Object.entries(stats).map(([playerId, s]) => ({
    playerId,
    name: nameOf(playerId),
    goals: s.goals,
    assists: s.assists,
  }));
}

/** Golden Boot: goals desc → assists desc → id asc. Zero-goal players dropped. */
export function topScorers(
  stats: PlayerStats,
  nameOf: (id: string) => string,
  limit = 10,
): StatLine[] {
  return lines(stats, nameOf)
    .filter((l) => l.goals > 0)
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists || (a.playerId < b.playerId ? -1 : 1))
    .slice(0, limit);
}

/** Playmaker: assists desc → goals desc → id asc. Zero-assist players dropped. */
export function topAssists(
  stats: PlayerStats,
  nameOf: (id: string) => string,
  limit = 10,
): StatLine[] {
  return lines(stats, nameOf)
    .filter((l) => l.assists > 0)
    .sort((a, b) => b.assists - a.assists || b.goals - a.goals || (a.playerId < b.playerId ? -1 : 1))
    .slice(0, limit);
}
