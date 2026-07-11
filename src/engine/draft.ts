import { NATIONS, nationSquad } from './data';
import { CHEM_PAIR_BONUS, FORMATION, STAR_BONUS, STAR_THRESHOLD, effectiveRating } from './rating';
import type { Rng } from './rng';
import type { Player, Position, XI } from './types';

/** One spin of the wheel: lands on a nation code. */
export function spinNation(rng: Rng): string {
  return rng.pick(NATIONS).code;
}

/** Players of a nation still available to this manager (no duplicates within a team). */
export function draftOptions(xi: XI, nationCode: string): Player[] {
  const taken = new Set(xi.map((s) => s.player.id));
  return nationSquad(nationCode).filter((p) => !taken.has(p.id));
}

/** How much this pick adds to the team right now (fit + chemistry gain + star). */
export function pickValue(xi: XI, slot: Position, player: Player): number {
  const sameNation = xi.filter((s) => s.player.nation === player.nation).length;
  return (
    effectiveRating(slot, player) +
    sameNation * CHEM_PAIR_BONUS +
    (player.rating >= STAR_THRESHOLD ? STAR_BONUS : 0)
  );
}

/** Bot strategy: take the highest-value option (ties: lower id, for determinism). */
export function botPick(options: readonly Player[], xi: XI, slot: Position): Player {
  let best = options[0];
  let bestValue = -Infinity;
  for (const player of options) {
    const value = pickValue(xi, slot, player);
    if (value > bestValue || (value === bestValue && player.id < best.id)) {
      best = player;
      bestValue = value;
    }
  }
  return best;
}

/** Full 11-spin draft for a bot. */
export function draftBotXi(rng: Rng): XI {
  const xi: XI = [];
  for (const slot of FORMATION) {
    const nation = spinNation(rng);
    const options = draftOptions(xi, nation);
    xi.push({ position: slot, player: botPick(options, xi, slot) });
  }
  return xi;
}
