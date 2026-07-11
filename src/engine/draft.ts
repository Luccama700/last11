import { NATIONS, nationSquad } from './data';
import { CHEM_PAIR_BONUS, FORMATION, STAR_BONUS, STAR_THRESHOLD, effectiveRating } from './rating';
import { playersV2, squadByRef, squadRefsV2 } from './data/loader';
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

/**
 * Person identity across tournament snapshots. Player ids are `${nation}-${year}-${slug}`
 * (loader §2), so the SAME real person has a different id each year (Mbappé 2018 vs
 * 2026). The person key drops the year segment → `${nation}-${slug}`, so both map to
 * `fra-mbappe`. Used to forbid the same person twice in one XI even via different-year
 * snapshots (the Image-#12 glitch). Nation codes carry no hyphen, so index 1 is always
 * the year; slugs may contain hyphens (`arg-2026-e-martinez` → `arg-e-martinez`).
 */
export function personKey(id: string): string {
  const parts = id.split('-');
  if (parts.length >= 3) parts.splice(1, 1); // drop the year segment
  return parts.join('-');
}

/** True when two player ids are the same real person (any tournament year). */
export function isSamePerson(idA: string, idB: string): boolean {
  return personKey(idA) === personKey(idB);
}

/** Person keys already on a slate — the "no same person twice" filter set. */
function personsOn(slate: readonly (XiSlotV2 | null)[]): Set<string> {
  return new Set(
    slate.filter((s): s is XiSlotV2 => s !== null).map((s) => personKey(s.player.id)),
  );
}

/** Players from a rolled squad not already on this slate. Excludes the same PERSON,
 *  not just the same id — a different-year snapshot of an owned player is filtered too. */
export function draftOptionsV2(
  slate: readonly (XiSlotV2 | null)[],
  roll: RolledTeam,
): PlayerV2[] {
  const taken = personsOn(slate);
  return squadByRef(roll.nation, roll.year).players.filter((p) => !taken.has(personKey(p.id)));
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

/**
 * Move an already-placed player to an OPEN slot during the draft (Lucca: "in case I
 * find a better player for a position"). `from` must be filled, `to` must be open;
 * the player takes `to`'s formation position (off-position allowed via affinity —
 * no gating here). Nothing else recomputes. Invalid moves (from empty, to filled,
 * same slot, out of range) return the slate UNCHANGED. Pure.
 */
export function movePlaced(
  slate: readonly (XiSlotV2 | null)[],
  formation: Formation,
  from: number,
  to: number,
): (XiSlotV2 | null)[] {
  const inRange = (i: number) => i >= 0 && i < slate.length;
  if (from === to || !inRange(from) || !inRange(to)) return [...slate];
  const moving = slate[from];
  if (moving === null || slate[to] !== null) return [...slate]; // from must be filled, to open
  const next = [...slate];
  next[to] = { position: formation.slots[to], player: moving.player };
  next[from] = null;
  return next;
}

/**
 * Bot formation weights (favours the common shapes). Every key MUST be a real
 * FORMATIONS id, and every catalog shape should carry a positive weight so none is
 * starved. Exported so the distribution is directly testable — when a new shape lands
 * in FORMATIONS (e.g. the 4-1-2-1-2 diamonds), add its weight here or the reachability
 * test goes red. Keep the spread sane (no shape grossly heavier than another).
 */
export const BOT_FORMATION_WEIGHTS: Readonly<Record<string, number>> = {
  '4-3-3': 3,
  '4-4-2': 2,
  '4-2-3-1': 2,
  '3-5-2': 1,
  '5-3-2': 1,
  '4-5-1': 1,
  '4-2-4': 1,
  '3-4-3': 1,
  '4-1-2-1-2': 1,
  '4-1-2-1-2-wide': 1,
};

/** Weighted-sane seeded formation for a bot (favours the common shapes). */
export function pickBotFormation(rng: Rng): Formation {
  const weighted: string[] = [];
  for (const [id, w] of Object.entries(BOT_FORMATION_WEIGHTS))
    for (let i = 0; i < w; i++) weighted.push(id);
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

// ---- Squad-card ranking + steal-list helpers (pure; consumed by the UI) -------

const V2_BY_ID: Map<string, PlayerV2> = new Map(playersV2().map((p) => [p.id, p]));

/** Recover the DETAILED PlayerV2 for an id — lets a coarse steal pool (legacy
 *  `Player[]`) be lifted back to detailed positions (ids are stable across the
 *  coarse projection). Returns undefined for a non-v2 id. */
export function playerV2ById(id: string): PlayerV2 | undefined {
  return V2_BY_ID.get(id);
}

export interface RankedOption {
  player: PlayerV2;
  /** The player's best OPEN slot on the current slate (null if the slate is full). */
  bestSlot: SlotFit | null;
  /** Points this pick can ADD right now = pickValue at his best open slot. */
  boost: number;
}

/**
 * Rank squad-card options by the best points they can add right now: for each
 * option, the max pickValue over the open slots (its best achievable placement).
 * Descending; deterministic ties (higher rating, then id). Pure — no chemistry.
 */
export function sortByBoost(
  options: readonly PlayerV2[],
  slate: readonly (XiSlotV2 | null)[],
  formation: Formation,
  aff: AffinityFn,
): RankedOption[] {
  return options
    .map((player): RankedOption => {
      const bestSlot = slotFitsForPlayer(slate, formation, player, aff)[0] ?? null;
      return { player, bestSlot, boost: bestSlot ? pickValueV2(player, bestSlot.position, aff) : 0 };
    })
    .sort(
      (a, b) =>
        b.boost - a.boost ||
        b.player.rating - a.player.rating ||
        (a.player.id < b.player.id ? -1 : 1),
    );
}

/**
 * Effective-rating gain of dropping the current occupant of slot `slotIndex` for
 * `incoming`, both rated at that slot's formation position via `effectiveRatingV2`.
 * The single source of truth for "how much does this steal improve slot i" — the
 * StealScreen delta, `rankStealCandidates`, and the bot auto-swap all read it, so a
 * NATURAL incoming (affinity 1.0 at his slot) is credited his FULL base rating and a
 * natural-into-natural swap of equal ratings is exactly 0 (bug A2 guard). Pure. The
 * caller guarantees `slate[slotIndex]` is filled (a dense fielded XI).
 */
export function stealGainV2(
  slate: readonly XiSlotV2[],
  formation: Formation,
  incoming: PlayerV2,
  slotIndex: number,
  aff: AffinityFn,
): number {
  const slot = formation.slots[slotIndex];
  return effectiveRatingV2(incoming, slot, aff) - effectiveRatingV2(slate[slotIndex].player, slot, aff);
}

export interface StealCandidate {
  player: PlayerV2;
  /** Detailed position label (no coarse GK/DF/MF/FW). */
  position: DetailedPosition;
  /** Slot to swap him into for the biggest effective-rating gain. */
  bestSlotIndex: number;
  /** That slot's formation position. */
  bestPosition: DetailedPosition;
  /** Effective-rating improvement vs the current occupant (may be ≤ 0). */
  gain: number;
}

/**
 * Rank a DETAILED steal pool for a FULL XI (steals REPLACE a starter): for each
 * pool player, the slot whose current occupant he most improves on (max effective-
 * rating gain), carrying his detailed position label + best-slot data. Best gain
 * first; players already on the XI are excluded. Pure.
 *
 * Shares its gain metric (`effectiveRatingV2`) with the bot auto-swap so the human
 * ranking and `evaluateStealV2` agree on "best swap" (coordinate: architect).
 */
export function rankStealCandidates(
  pool: readonly PlayerV2[],
  slate: readonly XiSlotV2[],
  formation: Formation,
  aff: AffinityFn,
): StealCandidate[] {
  const onTeam = new Set(slate.map((s) => personKey(s.player.id)));
  const out: StealCandidate[] = [];
  for (const player of pool) {
    if (onTeam.has(personKey(player.id))) continue;
    let best: StealCandidate | null = null;
    for (let i = 0; i < slate.length; i++) {
      const slot = formation.slots[i];
      const gain = stealGainV2(slate, formation, player, i, aff);
      if (!best || gain > best.gain) {
        best = { player, position: player.position, bestSlotIndex: i, bestPosition: slot, gain };
      }
    }
    if (best) out.push(best);
  }
  return out.sort(
    (a, b) =>
      b.gain - a.gain ||
      b.player.rating - a.player.rating ||
      (a.player.id < b.player.id ? -1 : 1),
  );
}
