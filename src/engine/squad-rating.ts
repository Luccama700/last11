/**
 * displayedSquadRating — the ONE squad-strength number shown everywhere.
 *
 * Morning JOB 1 (Main, 2026-07-11): the leaderboard "Squad" value for the HUMAN was
 * wrong — the round table read v1 `teamStrength(coarse xi)` (flat 0.75 off-position +
 * star + the now-dead chem) while the draft rail summed the DETAILED affinity rating,
 * so the two disagreed. This is the single metric both must use.
 *
 * The metric = Σ `effectiveRatingV2(player, slotPosition, affinity)` over the fielded
 * slots — exactly what `DraftScreenV2` and `BetweenMatchBoard` already display
 * (coordinated with game-engine: this is the DISPLAY sum, distinct from the engine's
 * internal `overallStrength` AVERAGE used for xG). For the HUMAN pass the detailed
 * slate (`state.humanSlate`); for bots pass the `Manager` (coarse XI → detailed via
 * `COARSE_TO_DETAILED` in `toMatchSide`). Same metric for all → rail == table ==
 * standings == intro rank.
 */
import { effectiveRatingV2 } from './draft';
import { affinity } from './affinity';
import { DEFAULT_TACTICS, toMatchSide, type Manager } from './tournament';
import type { XiSlotV2 } from './types';

function sumDetailed(slots: readonly (XiSlotV2 | null)[]): number {
  let total = 0;
  for (const s of slots) if (s) total += effectiveRatingV2(s.player, s.position, affinity);
  return Math.round(total);
}

/**
 * Squad rating for display. Accepts a detailed slate (human — `(XiSlotV2|null)[]`,
 * open slots skipped) or a legacy `Manager` (bot — its coarse XI is projected to
 * detailed). Pure + deterministic. Use this EVERYWHERE a "Squad" number is shown so
 * the human's rail and table values finally agree.
 */
export function displayedSquadRating(input: Manager | readonly (XiSlotV2 | null)[]): number {
  if (Array.isArray(input)) return sumDetailed(input);
  return sumDetailed(toMatchSide(input as Manager, DEFAULT_TACTICS).xi);
}
