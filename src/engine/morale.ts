/**
 * Morale — the transient per-player rating buff that REPLACES chemistry (DECISIONS).
 *
 * Rules (CONTRACT §6): a goal grants the scorer +2 and the assister +1 to their
 * effective rating for their NEXT match only; capped at +3 per player; never
 * negative (no death spirals). Runtime state on the manager (`ManagerV2.morale`),
 * NOT persisted to the player DB.
 *
 * This module is the pure buff math. Granularity (per-match vs per-round) is the
 * caller's (tournament's) choice — the BR applies it per ROUND: goals in round N
 * build each manager's `morale` map consumed in round N+1, then reset. QA measures
 * the rich-get-richer effect over the BR and bounds it (balance.report `lootSnowball`,
 * extended for morale). The +3 cap + no-accumulation-across-rounds is what bounds it.
 */
import { MORALE_ASSIST, MORALE_CAP, MORALE_GOAL, type MatchResultV2, type Team } from './types';

export type MoraleMap = Record<string, number>;

export const emptyMorale = (): MoraleMap => ({});

/** Add `amount` to a player's buff, clamped to [0, MORALE_CAP]. Pure. */
function bump(map: MoraleMap, playerId: string | undefined, amount: number): void {
  if (!playerId) return;
  const next = (map[playerId] ?? 0) + amount;
  map[playerId] = Math.max(0, Math.min(MORALE_CAP, next));
}

/** A single goal's contribution: scorer +2, assister +1 (both capped). */
export function accrueGoal(map: MoraleMap, scorerId?: string, assistId?: string): void {
  bump(map, scorerId, MORALE_GOAL);
  bump(map, assistId, MORALE_ASSIST);
}

/**
 * Build a fresh morale map from a set of goal events (one manager's own goals for
 * the period). Caps per player at +3. Not accumulated across periods — call once
 * per round with THAT round's goals, replacing the old map (reset semantics).
 */
export function moraleFromGoals(
  goals: readonly { playerId?: string; assistPlayerId?: string }[],
): MoraleMap {
  const map = emptyMorale();
  for (const g of goals) accrueGoal(map, g.playerId, g.assistPlayerId);
  return map;
}

/**
 * Extract a manager's OWN goals from a round's results. A goal is the manager's
 * when they were the scoring side of that match — keyed by manager id so a player
 * duplicated on two managers' XIs never cross-feeds morale.
 */
export function collectManagerGoals(
  results: readonly MatchResultV2[],
  managerId: string,
): { playerId?: string; assistPlayerId?: string }[] {
  const out: { playerId?: string; assistPlayerId?: string }[] = [];
  for (const r of results) {
    const side: Team | null =
      r.homeId === managerId ? 'home' : r.awayId === managerId ? 'away' : null;
    if (!side) continue;
    for (const g of r.goals) {
      if (g.team === side) out.push({ playerId: g.playerId, assistPlayerId: g.assistPlayerId });
    }
  }
  return out;
}

/** Convenience: a manager's next-period morale map straight from a round's results. */
export function moraleForManager(
  results: readonly MatchResultV2[],
  managerId: string,
): MoraleMap {
  return moraleFromGoals(collectManagerGoals(results, managerId));
}
