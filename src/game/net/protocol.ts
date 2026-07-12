/**
 * Multiplayer wire protocol (MVP — trust model, replay coordinates).
 *
 * Two directions on one Supabase Realtime broadcast channel per room:
 *  - client → host INTENTS (`intent` event): requests; the host validates and
 *    folds them into the next authoritative message.
 *  - host → room MESSAGES (`host` event): canonical; every client (and the host
 *    itself, self-broadcast ON) applies them in order.
 *
 * Kept deliberately tiny: pairings, bot squads, morale, pools and timelines are
 * all PURE functions of the room seed + this ordered message log (engine/mp.ts),
 * so they never cross the wire. Commit–reveal (ranked) slots in later as an
 * extra intent/message pair around TACTICS without touching anything here.
 */
import type { Tactics, XiSlotV2 } from '../../engine/types';

export const INTENT_EVENT = 'intent';
export const HOST_EVENT = 'host';

// ── Presence meta (who is in the room) ────────────────────────────────────────

export interface PresenceMeta {
  clientId: string;
  name: string;
  version: string; // MP_ENGINE_VERSION — mismatched clients must not play
}

// ── Client → Host intents ─────────────────────────────────────────────────────

export type Intent =
  | { t: 'hello'; clientId: string; name: string; version: string }
  /** Formation/style chosen in the lobby (also the AFK fallback source). */
  | { t: 'setup'; clientId: string; formationId: string; style: Tactics['style'] }
  | { t: 'startWithBots'; clientId: string }
  /** Pick for the CURRENT spin. playerId must be in the seat's assigned squad. */
  | { t: 'pick'; clientId: string; spinIndex: number; playerId: string; slotIndex: number }
  /** Mid-draft repositioning during the pick window (already-placed → open). */
  | { t: 'moveOnBoard'; clientId: string; from: number; to: number }
  /** Pit-stop submission: final slate order + tactics + optional steal. */
  | {
      t: 'pit';
      clientId: string;
      round: number;
      slate: XiSlotV2[];
      tactics: Tactics;
      steal: { playerId: string; slotIndex: number } | null;
    }
  /** Eliminated player's "rooting for" pick. */
  | { t: 'root'; clientId: string; forSeatId: string };

// ── Host → Room messages ──────────────────────────────────────────────────────

export interface SeatAssignment {
  seat: number;
  clientId: string | null; // null ⇒ bot seat
  name: string;
}

/** Every host message carries the host's wall clock (`hostNow`) so clients can
 *  estimate their device-clock offset — real phones proved to be SECONDS off
 *  NTP, which broke lockstep (playtest wave 2). `sync` is the host's mirror
 *  checksum after its previous apply; a client whose own checksum differs knows
 *  it has desynced and says so instead of silently showing different results. */
export type HostEnvelope = { hostNow?: number; sync?: string };

export type HostMsg = HostMsgBody & HostEnvelope;

export type HostMsgBody =
  /** Authoritative room snapshot — sent on every lobby change and to joiners. */
  | {
      t: 'room';
      roomSeed: number;
      code: string;
      version: string;
      hostClientId: string;
      seats: SeatAssignment[];
      phase: 'lobby' | 'draft' | 'round' | 'pit' | 'end';
    }
  /** The game begins: final seat map is locked; bots fill the rest. */
  | { t: 'gameStart'; seats: SeatAssignment[]; setups: Record<string, { formationId: string; style: Tactics['style'] }> }
  /** One spin for everyone: reels roll now, picks close at deadlineAt. The
   *  drafted set is deliberately NOT on the wire — every mirror derives it
   *  identically (bots at gameStart, picks at each spinResult), and a snapshot
   *  here raced the host's own gameStart apply (loopback test caught it). */
  | { t: 'spinStart'; spinIndex: number; deadlineAt: number }
  /** The spin's authoritative picks (incl. auto-picks) + each seat's board moves
   *  made during the window. Every client applies per seat: MOVES in order, then
   *  the pick — matching the sender's local (moves-before-pick) ordering, which
   *  the UI enforces by locking the board once you've picked. */
  | {
      t: 'spinResult';
      spinIndex: number;
      picks: Record<string, { playerId: string; slotIndex: number }>; // seatId → pick
      moves: Record<string, { from: number; to: number }[]>; // seatId → ordered moves
    }
  /** Lockstep round: everyone resolves round N locally and plays at startAt. */
  | { t: 'roundStart'; round: number; startAt: number }
  /** Combined pit stop opens (steal + re-slot + tactics), closes at deadlineAt. */
  | { t: 'pitStart'; round: number; deadlineAt: number }
  /** Authoritative pit outcome per surviving seat, applied atomically. */
  | {
      t: 'pitResult';
      round: number;
      updates: Record<
        string, // seatId
        { slate: XiSlotV2[]; tactics: Tactics; stolen: { playerId: string; slotIndex: number } | null }
      >;
      roots: Record<string, string>; // eliminated seatId → rooted-for seatId
    }
  /** Tournament over — clients already know the champion deterministically. */
  | { t: 'gameEnd' };
