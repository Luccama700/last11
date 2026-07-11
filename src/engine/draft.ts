import { NATIONS, nationSquad } from './data';
import { CHEM_PAIR_BONUS, FORMATION, STAR_BONUS, STAR_THRESHOLD, effectiveRating } from './rating';
import { squadByRef, squadRefsV2 } from './data/loader';
import { POSITION_ZONE, type PlayerV2, type Position as DetailedPosition, type Zone } from './data/schema';
import { FORMATIONS } from './types';
import type { AffinityFn, Formation, PlayingStyle, RolledTeam, XiSlotV2 } from './types';
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

// ============================================================================
// v2 free-pick draft (behind FEATURES.draftV2). Pure + deterministic. The spin
// lands a (nation, year); the manager places any squad player into any open slot
// on their chosen formation, off-position allowed via affinity (never dead-ends).
// Chemistry is DELETED (DECISIONS: morale replaces it), so pick value is just the
// affinity-weighted rating plus a star nudge. Affinity VALUES are the engine's
// (CONTRACT §1); every fn here takes an `AffinityFn` so it is testable before the
// engine's matrix lands, with `placeholderAffinity` as the demo fallback.
// ============================================================================

/** Draft-heuristic star nudge (guides bot/human pick order only; NOT match rating). */
export const STAR_THRESHOLD_V2 = 88;
export const STAR_BONUS_V2 = 3;
/** Bots reject a rolled squad whose best pick falls below this, while tokens remain. */
export const BOT_RESPIN_FLOOR = 60;
export const BOT_RESPIN_TOKENS = 3;

const ZONE_RANK: Readonly<Record<Zone, number>> = { GK: 0, DEF: 1, MID: 2, ATT: 3 };

/**
 * Placeholder forgiving affinity until the engine ships its authored matrix
 * (CONTRACT §1). A zone-distance heuristic in the spirit of DECISIONS' "more
 * forgiving" posture: same position 1.0, same zone .85, adjacent zone .60, two
 * zones apart .40, any GK↔outfield move .28. All cells strictly > 0 (invariant).
 * Deliberately a FUNCTION, not a hand-authored table, so it is never mistaken for
 * the engine's real values — wiring swaps in `(n,s) => matrix[n][s]` when it lands.
 */
export const placeholderAffinity: AffinityFn = (natural, slot) => {
  if (natural === slot) return 1;
  const zn = POSITION_ZONE[natural];
  const zs = POSITION_ZONE[slot];
  if (zn === 'GK' || zs === 'GK') return 0.28;
  if (zn === zs) return 0.85;
  return Math.abs(ZONE_RANK[zn] - ZONE_RANK[zs]) === 1 ? 0.6 : 0.4;
};

/** Fraction of rating retained playing `player` at `slot`. Primary AND secondary
 *  positions are natural (1.0); everything else defers to the affinity fn. */
export function affinityForV2(player: PlayerV2, slot: DetailedPosition, aff: AffinityFn): number {
  if (player.position === slot) return 1;
  if (player.secondary?.includes(slot)) return 1;
  return aff(player.position, slot);
}

export function effectiveRatingV2(player: PlayerV2, slot: DetailedPosition, aff: AffinityFn): number {
  return player.rating * affinityForV2(player, slot, aff);
}

/** Draft pick value: affinity-weighted rating + star nudge. No chemistry (deleted). */
export function pickValueV2(player: PlayerV2, slot: DetailedPosition, aff: AffinityFn): number {
  return effectiveRatingV2(player, slot, aff) + (player.rating >= STAR_THRESHOLD_V2 ? STAR_BONUS_V2 : 0);
}

/** One spin: a random rolled (nation, year) from the v2 dataset. */
export function spinSquadV2(rng: Rng): RolledTeam {
  return rng.pick(squadRefsV2());
}

/** Players from a rolled squad not already on this slate (no dup within a team). */
export function draftOptionsV2(
  slate: readonly (XiSlotV2 | null)[],
  roll: RolledTeam,
): PlayerV2[] {
  const taken = new Set(slate.filter((s): s is XiSlotV2 => s !== null).map((s) => s.player.id));
  return squadByRef(roll.nation, roll.year).players.filter((p) => !taken.has(p.id));
}

/** Indices of the still-open slots on a slate. */
export function openSlots(slate: readonly (XiSlotV2 | null)[]): number[] {
  const out: number[] = [];
  slate.forEach((s, i) => {
    if (s === null) out.push(i);
  });
  return out;
}

export interface SlotFit {
  slotIndex: number;
  position: DetailedPosition;
  affinity: number;
  natural: boolean;
  effective: number;
}

/**
 * Every OPEN slot a player could fill, best-first (highest effective rating).
 * Because affinity is always > 0, this is never empty while a slot is open — the
 * draft can't dead-end. The UI decides which to "glow" via a threshold; a lone
 * natural (affinity===1) open slot means the pick auto-places.
 */
export function slotFitsForPlayer(
  slate: readonly (XiSlotV2 | null)[],
  formation: Formation,
  player: PlayerV2,
  aff: AffinityFn,
): SlotFit[] {
  return openSlots(slate)
    .map((slotIndex) => {
      const position = formation.slots[slotIndex];
      const a = affinityForV2(player, position, aff);
      return {
        slotIndex,
        position,
        affinity: a,
        natural: a === 1,
        effective: player.rating * a,
      };
    })
    .sort((x, y) => y.effective - x.effective || x.slotIndex - y.slotIndex);
}

export interface BotPlacement {
  player: PlayerV2;
  slotIndex: number;
  value: number;
}

/** Best (player, open-slot) placement from a rolled squad's candidates. Ties:
 *  higher value, then lower player id, then lower slot index — deterministic. */
export function botBestPlacement(
  slate: readonly (XiSlotV2 | null)[],
  formation: Formation,
  candidates: readonly PlayerV2[],
  aff: AffinityFn,
): BotPlacement | null {
  const open = openSlots(slate);
  if (open.length === 0 || candidates.length === 0) return null;
  let best: BotPlacement | null = null;
  for (const player of candidates) {
    for (const slotIndex of open) {
      const value = pickValueV2(player, formation.slots[slotIndex], aff);
      if (
        !best ||
        value > best.value ||
        (value === best.value && player.id < best.player.id) ||
        (value === best.value && player.id === best.player.id && slotIndex < best.slotIndex)
      ) {
        best = { player, slotIndex, value };
      }
    }
  }
  return best;
}

/**
 * Full free-pick draft for a bot: roll a squad, place the single best (player,
 * slot) pair, repeat until the slate is dense. Rolls with a below-floor best pick
 * are re-spun while tokens remain (mirrors the human wildcard). Deterministic.
 */
export function draftBotSlateV2(rng: Rng, formation: Formation, aff: AffinityFn): XiSlotV2[] {
  const slate: (XiSlotV2 | null)[] = new Array(formation.slots.length).fill(null);
  let tokens = BOT_RESPIN_TOKENS;
  let guard = 0;
  while (openSlots(slate).length > 0) {
    if (guard++ > 500) break; // safety: dataset always has enough players; never hit in practice
    const roll = spinSquadV2(rng);
    const best = botBestPlacement(slate, formation, draftOptionsV2(slate, roll), aff);
    if (!best) continue;
    if (best.value < BOT_RESPIN_FLOOR && tokens > 0) {
      tokens--;
      continue;
    }
    slate[best.slotIndex] = { position: formation.slots[best.slotIndex], player: best.player };
  }
  return slate as XiSlotV2[];
}

/** Swap the players in two slots, keeping each slot's formation position (the
 *  between-match re-slot primitive). Pure; returns a new XI. */
export function swapSlots(xi: readonly XiSlotV2[], a: number, b: number): XiSlotV2[] {
  if (a === b) return [...xi];
  return xi.map((s, i) => {
    if (i === a) return { position: s.position, player: xi[b].player };
    if (i === b) return { position: s.position, player: xi[a].player };
    return s;
  });
}

/** Weighted-sane seeded formation for a bot (favours the common shapes). */
export function pickBotFormation(rng: Rng): Formation {
  const weighted: string[] = [
    '4-3-3', '4-3-3', '4-3-3',
    '4-4-2', '4-4-2',
    '4-2-3-1', '4-2-3-1',
    '3-5-2', '5-3-2', '4-5-1', '4-2-4', '3-4-3',
  ];
  const id = rng.pick(weighted);
  return FORMATIONS.find((f) => f.id === id) ?? FORMATIONS[0];
}

/** Seeded playing style for a bot. */
export function pickBotStyle(rng: Rng): PlayingStyle {
  return rng.pick(['defensive', 'balanced', 'attacking'] as const);
}

/**
 * Best-affinity re-assignment of a set of players onto a formation (between-match
 * auto-arrange for bots, DECISIONS). Greedy: repeatedly take the (player, open
 * slot) pair with the highest effective rating. Deterministic; every player lands.
 */
export function autoArrange(
  players: readonly PlayerV2[],
  formation: Formation,
  aff: AffinityFn,
): XiSlotV2[] {
  const slate: (XiSlotV2 | null)[] = new Array(formation.slots.length).fill(null);
  const remaining = [...players];
  while (openSlots(slate).length > 0 && remaining.length > 0) {
    let bestPlayerIdx = 0;
    let bestSlot = openSlots(slate)[0];
    let bestEff = -Infinity;
    remaining.forEach((player, pi) => {
      for (const slotIndex of openSlots(slate)) {
        const eff = effectiveRatingV2(player, formation.slots[slotIndex], aff);
        if (
          eff > bestEff ||
          (eff === bestEff && player.id < remaining[bestPlayerIdx].id) ||
          (eff === bestEff && player.id === remaining[bestPlayerIdx].id && slotIndex < bestSlot)
        ) {
          bestEff = eff;
          bestPlayerIdx = pi;
          bestSlot = slotIndex;
        }
      }
    });
    const [player] = remaining.splice(bestPlayerIdx, 1);
    slate[bestSlot] = { position: formation.slots[bestSlot], player };
  }
  return slate as XiSlotV2[];
}
