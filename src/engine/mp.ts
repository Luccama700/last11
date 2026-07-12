/**
 * Multiplayer — the PURE layer (locked format, FORMAT-REPORT-v1.1 §6b).
 *
 * Everything here is deterministic math shared by the HOST and every CLIENT:
 * squad assignment for simultaneous drafting, bot seats, auto-picks, round
 * resolution and lockstep slot timing. Nothing touches the network — given the
 * same room seed and the same ordered inputs, every machine computes identical
 * results. The wire layer (game/net) only moves seeds, picks and deadlines.
 *
 * Wire-format note: the MVP ships REPLAY coordinates (seeds + inputs), not full
 * timelines — every client runs this same engine build, and the version
 * handshake refuses mismatched builds. `kind:'timelines'` (RESEARCH-protocol §2)
 * remains the upgrade path for ranked/certified rooms.
 */
import { affinity } from './affinity';
import {
  draftOptionsV2,
  effectiveRatingV2,
  openSlots,
  pickBotFormation,
  pickBotStyle,
} from './draft';
import { matchSeed, type MatchSide } from './match';
import { moraleForManager, type MoraleMap } from './morale';
import { createRng, type Rng } from './rng';
import { simulateMatchTimeline } from './timeline';
import {
  BOT_NAMES,
  playRound,
  type Manager,
  type PlayRoundEngine,
  type RoundResult,
} from './tournament';
import { MATCH_DURATION_MS, formationById } from './types';
import type { Formation, MatchTimeline, Tactics, XiSlotV2 } from './types';
import { squadByRef, squadRefsV2 } from './data/loader';
import { detailedToCoarse } from './data/schema';
import type { PlayerV2, SquadRef } from './data/schema';
import { SHOOTOUT_KICK_MS } from '../game/playback';

// ── Locked format constants (Lucca's rulings) ─────────────────────────────────

export const MP_LOBBY_SIZE = 20;
/** Cut ladder: 20 → 16 → 8 → 4 → 2 → 1 (5 rounds; pens active from 16 alive). */
export const MP_SURVIVORS_PER_ROUND: readonly number[] = [16, 8, 4, 2, 1];
/** Lockstep playback runs 1.5× wall speed: 45 s of content in a 30 s slot. */
export const MP_TIME_SCALE = 1.5;
/** Pick timer per spin (Lucca: 20s — 10s too tight live, 30s dragged; the
 *  all-locked-in fast-forward absorbs the fast-lobby case anyway). */
export const MP_PICK_MS = 20_000;
/** Fixed slot-machine ceremony before the pick timer opens. */
export const MP_REEL_MS = 3_500;
/** The combined pit stop: loot + re-slot + tactics (playtest wave 2: 45s). */
export const MP_PIT_MS = 45_000;
/** When EVERY human has locked in, the countdown snaps to this short fuse
 *  instead of running out the full window (playtest wave 2 feedback). */
export const MP_HURRY_MS = 5_000;
/** startAt lead so every client has the round in hand before elapsed goes +. */
export const MP_START_LEAD_MS = 3_000;
/** Breath between lockstep match slots. */
export const MP_SLOT_GAP_MS = 1_500;
/** Engine build handshake — bump on ANY change that alters engine output.
 *  mp-2: goal minute spacing + furniture events (playtest wave 2).
 *  mp-3: player-data positions pass (Messi ST; wingers gain wide-mid altPos). */
export const MP_ENGINE_VERSION = 'last11-mp-3';

// ── Room codes ────────────────────────────────────────────────────────────────

/** Unambiguous alphabet (no I/O/0/1). 5 letters ≈ 33M codes. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeRoomCode(rng: Rng): string {
  let code = '';
  for (let i = 0; i < 5; i++) code += CODE_ALPHABET[rng.int(CODE_ALPHABET.length)];
  return code;
}

// ── Squad assignment (disjoint pools by construction) ─────────────────────────

/** The room's canonical squad order: ONE seeded shuffle of every squad ref.
 *  Every client computes the identical order from the room seed. */
export function shuffledSquadOrder(roomSeed: number): SquadRef[] {
  const rng = createRng(matchSeed(roomSeed, 777, 0));
  return rng.shuffle(squadRefsV2());
}

/**
 * Stride-rotation assignment for one spin: seat `m` gets squad
 * `eligible[(spinIndex·seats + m) mod N]`. Disjoint within a spin whenever
 * N ≥ seats, and (for N coprime with `seats`, true for today's 47) no seat sees
 * the same squad twice across an 11-spin draft. `isEligible` drops squads with
 * zero pickable players left (global-uniqueness drain) — the fallback then
 * allows rare per-seat repeats, which is fine (different players remain).
 */
export function assignSquadsForSpin(
  order: readonly SquadRef[],
  spinIndex: number,
  seats: number,
  isEligible: (ref: SquadRef) => boolean = () => true,
): SquadRef[] {
  const eligible = order.filter(isEligible);
  const n = eligible.length;
  if (n === 0) throw new Error('no eligible squads left');
  return Array.from({ length: seats }, (_, m) => eligible[(spinIndex * seats + m) % n]);
}

/** Pickable players of a squad for a given slate under GLOBAL uniqueness:
 *  not already drafted anywhere in the room, and not the same person as anyone
 *  already on THIS slate (the solo person rule, unchanged). */
export function mpDraftOptions(
  slate: readonly (XiSlotV2 | null)[],
  roll: SquadRef,
  draftedIds: ReadonlySet<string>,
): PlayerV2[] {
  return draftOptionsV2(slate, roll).filter((p) => !draftedIds.has(p.id));
}

/** A squad is eligible for assignment while it still has ≥1 undrafted player. */
export function squadHasPickLeft(roll: SquadRef, draftedIds: ReadonlySet<string>): boolean {
  return squadByRef(roll.nation, roll.year).players.some((p) => !draftedIds.has(p.id));
}

/** Deterministic AFK auto-pick: the highest effective rating over
 *  (eligible players × open slots). Null only if the squad is fully drained. */
export function autoPickForSlate(
  slate: readonly (XiSlotV2 | null)[],
  formation: Formation,
  roll: SquadRef,
  draftedIds: ReadonlySet<string>,
): { player: PlayerV2; slotIndex: number } | null {
  const options = mpDraftOptions(slate, roll, draftedIds);
  const open = openSlots(slate);
  if (options.length === 0 || open.length === 0) return null;
  let best: { player: PlayerV2; slotIndex: number; eff: number } | null = null;
  for (const player of options) {
    for (const slotIndex of open) {
      const eff = effectiveRatingV2(player, formation.slots[slotIndex], affinity);
      if (
        !best ||
        eff > best.eff ||
        (eff === best.eff && player.id < best.player.id) ||
        (eff === best.eff && player.id === best.player.id && slotIndex < best.slotIndex)
      ) {
        best = { player, slotIndex, eff };
      }
    }
  }
  return best && { player: best.player, slotIndex: best.slotIndex };
}

// ── Bot seats ─────────────────────────────────────────────────────────────────

export interface MpSeat {
  seat: number;
  id: string; // manager id: 'seat-0' … 'seat-19'
  name: string;
  isHuman: boolean;
  formation: Formation;
  tactics: Tactics;
  slate: XiSlotV2[]; // dense 11 once drafted
}

export const seatId = (seat: number): string => `seat-${seat}`;

/**
 * Deterministic bot squads for every unfilled seat, drafted SEQUENTIALLY in seat
 * order under the same global-uniqueness rule humans play by (bots never hold a
 * player a human could later be offered, and never duplicate each other).
 * Pure from (roomSeed, botSeatNumbers) — no bot state ever crosses the wire.
 */
export function draftBotSeats(
  roomSeed: number,
  botSeats: readonly number[],
  draftedIds: Set<string>, // MUTATED: bot picks accumulate into the room's drafted set
): MpSeat[] {
  const nameRng = createRng(matchSeed(roomSeed, 888, 0));
  const names = nameRng.shuffle(BOT_NAMES);
  const order = shuffledSquadOrder(roomSeed);
  return botSeats.map((seat, i) => {
    const rng = createRng(matchSeed(roomSeed, 888, seat + 1));
    const formation = pickBotFormation(rng);
    const style = pickBotStyle(rng);
    const slate: (XiSlotV2 | null)[] = new Array(formation.slots.length).fill(null);
    let cursor = rng.int(order.length);
    let guard = 0;
    while (openSlots(slate).length > 0 && guard++ < 400) {
      const roll = order[cursor % order.length];
      cursor++;
      const pick = autoPickForSlate(slate, formation, roll, draftedIds);
      if (!pick) continue;
      slate[pick.slotIndex] = {
        position: formation.slots[pick.slotIndex],
        player: pick.player,
      };
      draftedIds.add(pick.player.id);
    }
    return {
      seat,
      id: seatId(seat),
      name: names[i % names.length],
      isHuman: false,
      formation,
      tactics: { formationId: formation.id, style },
      slate: slate as XiSlotV2[],
    };
  });
}

// ── Round resolution (shared by host and every client) ───────────────────────

/** Project a seat to the legacy Manager the table/reducer machinery reads. */
export function seatToManager(s: MpSeat, alive: boolean): Manager {
  return {
    id: s.id,
    name: s.name,
    isHuman: s.isHuman,
    alive,
    xi: s.slate.map((slot) => ({
      position: detailedToCoarse(slot.position),
      player: {
        id: slot.player.id,
        name: slot.player.name,
        nation: slot.player.nation,
        position: detailedToCoarse(slot.player.position),
        rating: slot.player.rating,
      },
    })),
  };
}

/** DETAILED MatchSide for a seat — never the coarse projection (bug-A2 class). */
export function seatSide(s: MpSeat, morale?: MoraleMap): MatchSide {
  return { id: s.id, xi: s.slate, tactics: s.tactics, morale };
}

export interface MpRoundInput {
  roomSeed: number;
  round: number; // 1-based
  /** Alive seats in SEAT ORDER — every client must pass the identical list. */
  aliveSeats: readonly MpSeat[];
  matchIndexStart: number;
  moraleByManager: Record<string, MoraleMap>;
}

/**
 * Resolve one lockstep round — identical on every machine. Pairings come from a
 * round-scoped seeded rng (never the network); scores/timeline seeds are the
 * canonical matchSeed coordinates; sides are built from the DETAILED slates.
 */
export function resolveMpRound(input: MpRoundInput): RoundResult {
  const { roomSeed, round, aliveSeats } = input;
  const bySeat = new Map(aliveSeats.map((s) => [s.id, s]));
  const managers = aliveSeats.map((s) => seatToManager(s, true));
  const target = MP_SURVIVORS_PER_ROUND[round - 1];
  const pairingRng = createRng(matchSeed(roomSeed, round, 424242));
  const engine: PlayRoundEngine = {
    tournamentSeed: roomSeed,
    matchIndex: input.matchIndexStart,
    moraleByManager: input.moraleByManager,
    tacticsOf: (m) => bySeat.get(m.id)!.tactics,
    sideOf: (m, morale) => seatSide(bySeat.get(m.id)!, morale),
  };
  return playRound(managers, target, round, pairingRng, engine);
}

/** Morale carried into the next round — deterministic from this round's results. */
export function nextMorale(
  result: RoundResult,
  seats: readonly MpSeat[],
): Record<string, MoraleMap> {
  const out: Record<string, MoraleMap> = {};
  for (const s of seats) out[s.id] = moraleForManager(result.resultsV2 ?? [], s.id);
  return out;
}

// ── Lockstep slot timing ──────────────────────────────────────────────────────

export interface MpSlot {
  set: number; // 0..2
  /** Wall-clock offset of this slot's kickoff from the round's startAt. */
  offsetMs: number;
  /** Wall-clock length of the slot: longest match of the set, time-scaled. */
  durationMs: number;
}

const contentEndMs = (r: { shootout?: { kicks: unknown[] } }): number =>
  MATCH_DURATION_MS + (r.shootout ? r.shootout.kicks.length * SHOOTOUT_KICK_MS : 0);

/**
 * The round's three synchronized viewing slots. Slot k's length is the LONGEST
 * match of set k (pens matches run over), divided by MP_TIME_SCALE — every
 * client advances to the next slot at the same wall-clock instant, no messages.
 */
export function roundSlots(result: RoundResult): MpSlot[] {
  const results = result.resultsV2 ?? [];
  const setSize = Math.max(1, Math.floor(results.length / 3));
  const slots: MpSlot[] = [];
  let offset = 0;
  for (let set = 0; set < 3; set++) {
    const chunk = results.slice(set * setSize, (set + 1) * setSize);
    const longest = chunk.reduce((mx, r) => Math.max(mx, contentEndMs(r)), MATCH_DURATION_MS);
    const durationMs = Math.ceil(longest / MP_TIME_SCALE) + MP_SLOT_GAP_MS;
    slots.push({ set, offsetMs: offset, durationMs });
    offset += durationMs;
  }
  return slots;
}

/** Total watched wall-clock for the round (slots end-to-end). */
export const roundViewingMs = (result: RoundResult): number =>
  roundSlots(result).reduce((sum, s) => sum + s.durationMs, 0);

// ── A seat's watchable matchday ───────────────────────────────────────────────

export interface MpMatchday {
  featured: MatchTimeline[]; // this seat's match per set (empty if not playing)
  rail: {
    matchId: string;
    /** Which lockstep slot (0..2) this match plays in — the rail only shows
     *  the CURRENT slot's matches, so scores land as they happen, not early. */
    set: number;
    homeId: string;
    awayId: string;
    goals: { minute: number; team: 'home' | 'away' }[];
  }[];
}

/**
 * Rebuild a seat's watchable round from the result's stamped (seed, morale) —
 * the same trick as solo's watched matches: same sides + same seed ⇒ the
 * timeline's score is byte-identical to the table. Spectators pass any seat id.
 */
export function buildMpMatchday(
  result: RoundResult,
  seats: readonly MpSeat[],
  viewerSeatId: string,
): MpMatchday {
  const bySeat = new Map(seats.map((s) => [s.id, s]));
  const featured: MatchTimeline[] = [];
  const rail: MpMatchday['rail'] = [];
  const results = result.resultsV2 ?? [];
  // same set arithmetic as roundSlots: chunk k of the results order IS slot k
  const setSize = Math.max(1, Math.floor(results.length / 3));
  results.forEach((r, idx) => {
    const mine = r.homeId === viewerSeatId || r.awayId === viewerSeatId;
    if (mine) {
      const home = bySeat.get(r.homeId)!;
      const away = bySeat.get(r.awayId)!;
      featured.push(
        simulateMatchTimeline(
          seatSide(home, r.homeMorale),
          seatSide(away, r.awayMorale),
          r.seed!,
          r.shootoutEnabled ?? true,
        ),
      );
    } else {
      rail.push({
        matchId: `${result.round}-${r.homeId}-${r.awayId}`,
        set: Math.min(2, Math.floor(idx / setSize)),
        homeId: r.homeId,
        awayId: r.awayId,
        goals: r.goals.map((g) => ({ minute: g.minute, team: g.team })),
      });
    }
  });
  return { featured, rail };
}

// ── Misc shared helpers ───────────────────────────────────────────────────────

export const DEFAULT_MP_FORMATION_ID = '4-3-3';

export function defaultSeatTactics(): { formation: Formation; tactics: Tactics } {
  const formation = formationById(DEFAULT_MP_FORMATION_ID)!;
  return { formation, tactics: { formationId: formation.id, style: 'balanced' } };
}

/** Total picks a full draft makes (11 per seat) — spin count per seat is 11. */
export const MP_DRAFT_SPINS = 11;
