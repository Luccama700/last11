/**
 * v2 steal evaluation — the affinity-aware "best swap" for a DETAILED XI.
 *
 * Night-shift JOB 1 (Main, 2026-07-11): the v1 `evaluateSteal` (tournament.ts)
 * runs on the COARSE projected XI, so a secondary-position superstar (Messi CAM /
 * RW altPos) evaluated at an ST slot showed absurd swings (Romário +26 over Messi).
 * This module evaluates on the DETAILED slate (`XiSlotV2`) through the affinity
 * matrix + the secondary-position exemption, so the numbers are right.
 *
 * It REUSES draft-page's `rankStealCandidates` (draft.ts) — the exact gain metric +
 * tie-break the human's ranked steal list uses — so a bot's auto-swap and the human's
 * top-ranked option AGREE on "best swap" (coordinated: draft-page ↔ architect). Steals
 * REPLACE a fielded starter (CONTRACT §6 default).
 */
import { rankStealCandidates, type StealCandidate } from './draft';
import { affinity, effectiveRating } from './affinity';
import type { PlayerV2 } from './data/schema';
import type { Formation, XiSlotV2 } from './types';

/** A formation whose slots ARE the slate's own positions, so the gain is measured at
 *  each occupant's actual slot. For a real v2 slate this equals the drafted formation;
 *  for a coarse-bridged bot XI it evaluates at the projected positions. */
function slateFormation(slate: readonly XiSlotV2[]): Formation {
  return { id: '_slate', name: '_slate', slots: slate.map((s) => s.position) };
}

/**
 * Best strictly-improving steal for a full detailed XI, or null if no pool player
 * improves any slot. Deterministic (rankStealCandidates: gain desc → rating desc →
 * id asc). Pure. `StealCandidate.bestSlotIndex` + `.player` is the swap to apply.
 */
export function evaluateStealV2(
  slate: readonly XiSlotV2[],
  pool: readonly PlayerV2[],
): StealCandidate | null {
  const ranked = rankStealCandidates(pool, slate, slateFormation(slate), affinity);
  return ranked.length > 0 && ranked[0].gain > 0 ? ranked[0] : null;
}

/**
 * Per-slot effective-rating delta for placing `player` into each slot of `slate`
 * ("where does X play?" — the UI's per-slot upgrade preview). Positive = improves
 * that slot. Uses the same secondary-aware `effectiveRating` that backs
 * `rankStealCandidates`, so per-slot deltas and the ranked list agree.
 */
export function stealSlotDeltas(
  slate: readonly XiSlotV2[],
  player: PlayerV2,
): number[] {
  return slate.map(
    (s) => effectiveRating(s.position, player) - effectiveRating(s.position, s.player),
  );
}
