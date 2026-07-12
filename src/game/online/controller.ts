/**
 * OnlineController — the multiplayer room brain (MVP, host-authoritative, trust).
 *
 * ONE apply path: the host broadcasts canonical messages with self-receive ON,
 * so the host mutates its mirror exactly like every client — the only host-only
 * code is the TIMER (deadlines → fold intents → broadcast the next message).
 * Everything heavy (bots, pairings, scores, timelines, pools) is computed
 * locally and deterministically by engine/mp.ts from the room seed + the
 * ordered message log; the wire carries seeds, picks and deadlines only.
 *
 * MVP scope per FORMAT-REPORT §6b: lockstep viewing (1.5×), 10s picks, combined
 * 20s pit stop, trust tactics (commit–reveal later), rooting-for, no reconnect
 * (drop = AFK fallbacks), host-leaves = room over.
 */
import { affinity } from '../../engine/affinity';
import { movePlaced, openSlots, stealGainV2 } from '../../engine/draft';
import {
  MP_DRAFT_SPINS,
  MP_ENGINE_VERSION,
  MP_LOBBY_SIZE,
  MP_PICK_MS,
  MP_PIT_MS,
  MP_REEL_MS,
  MP_START_LEAD_MS,
  assignSquadsForSpin,
  autoPickForSlate,
  buildMpMatchday,
  defaultSeatTactics,
  draftBotSeats,
  makeRoomCode,
  mpDraftOptions,
  nextMorale,
  resolveMpRound,
  roundSlots,
  seatId,
  seatToManager,
  shuffledSquadOrder,
  squadHasPickLeft,
  type MpMatchday,
  type MpSeat,
  type MpSlot,
} from '../../engine/mp';
import type { MoraleMap } from '../../engine/morale';
import { createRng } from '../../engine/rng';
import type { Manager, RoundResult } from '../../engine/tournament';
import { formationById } from '../../engine/types';
import type { Formation, Tactics, XiSlotV2 } from '../../engine/types';
import type { PlayerV2, SquadRef } from '../../engine/data/schema';
import { playerV2ById } from '../../engine/draft';
import { RoomChannel, type RoomHandlers } from '../net/room';
import { onlineConfigured } from '../net/supa';
import type { HostMsg, Intent, PresenceMeta, SeatAssignment } from '../net/protocol';

/** The transport surface the controller needs — RoomChannel implements it; tests
 *  inject an in-memory loopback to run whole multi-client games with no network. */
export interface RoomTransport {
  join(): void;
  leave(): void;
  sendIntent(intent: Intent): void;
  sendHost(msg: HostMsg): void;
}
export type TransportFactory = (code: string, me: PresenceMeta, handlers: RoomHandlers) => RoomTransport;

export type OnlinePhase =
  | 'idle'
  | 'connecting'
  | 'lobby'
  | 'draft'
  | 'watching'
  | 'pit'
  | 'end'
  | 'error';

export interface OnlineView {
  phase: OnlinePhase;
  error: string | null;
  code: string;
  isHost: boolean;
  myName: string;
  mySeatId: string | null;
  /** Lobby: connected humans (presence), seat cap. */
  present: { name: string; you: boolean }[];
  lobbySize: number;
  // draft
  spinIndex: number; // 0-based; -1 before the first spin
  spinDeadline: number | null;
  reelSettled: boolean;
  myRoll: SquadRef | null;
  myOptions: PlayerV2[];
  myPick: { playerId: string; slotIndex: number } | null;
  formation: Formation;
  mySlate: (XiSlotV2 | null)[];
  style: Tactics['style'];
  // shared game state
  seats: MpSeat[];
  managers: Manager[]; // legacy projection for screens (Crest/standings/etc.)
  aliveIds: Set<string>;
  rounds: RoundResult[];
  // watching
  round: number;
  startAt: number | null;
  slots: MpSlot[];
  matchday: MpMatchday | null;
  featuredIndex: number;
  // pit
  pitDeadline: number | null;
  stealPool: PlayerV2[];
  myStealChoice: { playerId: string; slotIndex: number } | null;
  pitReady: boolean;
  roots: Record<string, string>;
  myRoot: string | null;
  eliminated: boolean; // am I out?
  placement: number | null;
  champion: MpSeat | null;
}

type Listener = () => void;

const now = () => Date.now();

export class OnlineController {
  private channel: RoomTransport | null = null;
  private listeners = new Set<Listener>();
  private view: OnlineView;
  private timer: ReturnType<typeof setInterval> | null = null;

  // room model (mirror; identical on every client)
  private clientId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  private roomSeed = 0;
  private hostClientId = '';
  private squadOrder: SquadRef[] = [];
  private draftedIds = new Set<string>();
  private setups: Record<string, { formationId: string; style: Tactics['style'] }> = {};
  private assignments: SquadRef[] = []; // current spin, by seat
  private morale: Record<string, MoraleMap> = {};
  private matchIndexStart = 0;
  private lastResult: RoundResult | null = null;
  private viewingEndsAt = 0;

  // host-only bookkeeping
  private joinOrder: { clientId: string; name: string }[] = [];
  private pendingPicks = new Map<string, { playerId: string; slotIndex: number }>(); // seatId →
  private pendingMoves = new Map<string, { from: number; to: number }[]>();
  private pendingPits = new Map<
    string,
    { slate: XiSlotV2[]; tactics: Tactics; steal: { playerId: string; slotIndex: number } | null }
  >();
  private pendingRoots: Record<string, string> = {};
  private hostPhaseDeadline = 0;
  private hostStage: 'lobby' | 'spin' | 'viewing' | 'pit' | 'done' = 'lobby';

  constructor(
    myName: string,
    private transportFactory: TransportFactory = (code, me, handlers) =>
      new RoomChannel(code, me, handlers),
    private injected = false, // tests: skip the onlineConfigured gate
  ) {
    const { formation, tactics } = defaultSeatTactics();
    this.view = {
      phase: 'idle',
      error: null,
      code: '',
      isHost: false,
      myName,
      mySeatId: null,
      present: [],
      lobbySize: MP_LOBBY_SIZE,
      spinIndex: -1,
      spinDeadline: null,
      reelSettled: false,
      myRoll: null,
      myOptions: [],
      myPick: null,
      formation,
      mySlate: new Array(formation.slots.length).fill(null),
      style: tactics.style,
      seats: [],
      managers: [],
      aliveIds: new Set(),
      rounds: [],
      round: 0,
      startAt: null,
      slots: [],
      matchday: null,
      featuredIndex: 0,
      pitDeadline: null,
      stealPool: [],
      myStealChoice: null,
      pitReady: false,
      roots: {},
      myRoot: null,
      eliminated: false,
      placement: null,
      champion: null,
    };
  }

  // ── React subscription ──────────────────────────────────────────────────────
  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getView = (): OnlineView => this.view;
  private emit(patch: Partial<OnlineView>): void {
    this.view = { ...this.view, ...patch };
    for (const fn of this.listeners) fn();
  }

  // ── Entry points ────────────────────────────────────────────────────────────

  create(fixedSeed?: number): void {
    const seed = fixedSeed ?? (Math.random() * 0xffffffff) >>> 0;
    const code = makeRoomCode(createRng(seed));
    this.roomSeed = seed;
    this.hostClientId = this.clientId;
    this.open(code, true);
  }

  join(code: string): void {
    this.open(code.trim().toUpperCase(), false);
  }

  private open(code: string, isHost: boolean): void {
    if (!this.injected && !onlineConfigured()) {
      this.emit({ phase: 'error', error: 'Online is not configured on this build.' });
      return;
    }
    this.emit({ phase: 'connecting', code, isHost });
    const me: PresenceMeta = {
      clientId: this.clientId,
      name: this.view.myName,
      version: MP_ENGINE_VERSION,
    };
    this.channel = this.transportFactory(code, me, {
      onHostMsg: (m) => this.applyHostMsg(m),
      onIntent: (i) => this.onIntent(i),
      onPresence: (p) => this.onPresence(p),
      onStatus: (s) => {
        if (s === 'joined') {
          this.startTicking();
          if (this.view.isHost) {
            this.joinOrder = [{ clientId: this.clientId, name: this.view.myName }];
            this.broadcastRoom('lobby');
          } else {
            this.channel!.sendIntent({
              t: 'hello',
              clientId: this.clientId,
              name: this.view.myName,
              version: MP_ENGINE_VERSION,
            });
          }
        } else if (s === 'error') {
          this.emit({ phase: 'error', error: 'Could not reach the room.' });
        }
      },
    });
    this.channel.join();
  }

  leave(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.channel?.leave();
    this.channel = null;
    this.emit({ phase: 'idle', error: null });
  }

  // ── Local UI actions ────────────────────────────────────────────────────────

  setSetup(formationId: string, style: Tactics['style']): void {
    const formation = formationById(formationId) ?? this.view.formation;
    this.emit({ formation, style, mySlate: new Array(formation.slots.length).fill(null) });
    this.channel?.sendIntent({ t: 'setup', clientId: this.clientId, formationId: formation.id, style });
  }

  fillWithBots(): void {
    this.channel?.sendIntent({ t: 'startWithBots', clientId: this.clientId });
  }

  pick(playerId: string, slotIndex: number): void {
    if (this.view.myPick || this.view.spinIndex < 0) return;
    // optimistic: the authoritative spinResult re-applies the same values
    this.emit({ myPick: { playerId, slotIndex } });
    this.channel?.sendIntent({
      t: 'pick',
      clientId: this.clientId,
      spinIndex: this.view.spinIndex,
      playerId,
      slotIndex,
    });
  }

  moveOnBoard(from: number, to: number): void {
    this.channel?.sendIntent({ t: 'moveOnBoard', clientId: this.clientId, from, to });
  }

  /** Pit-stop edits are local until submitted (or auto-submitted at deadline). */
  pitState: { slate: XiSlotV2[]; tactics: Tactics } | null = null;

  setPitSlate(slate: XiSlotV2[]): void {
    if (this.pitState) this.pitState = { ...this.pitState, slate };
    this.emit({});
  }
  setPitTactics(tactics: Tactics): void {
    if (this.pitState) this.pitState = { ...this.pitState, tactics };
    this.emit({ style: tactics.style });
  }
  setSteal(choice: { playerId: string; slotIndex: number } | null): void {
    this.emit({ myStealChoice: choice });
  }
  submitPit(): void {
    if (!this.pitState || this.view.pitReady) return;
    this.channel?.sendIntent({
      t: 'pit',
      clientId: this.clientId,
      round: this.view.round,
      slate: this.pitState.slate,
      tactics: this.pitState.tactics,
      steal: this.view.myStealChoice,
    });
    this.emit({ pitReady: true });
  }
  rootFor(seatIdArg: string): void {
    this.emit({ myRoot: seatIdArg });
    this.channel?.sendIntent({ t: 'root', clientId: this.clientId, forSeatId: seatIdArg });
  }

  reelSettled(): void {
    this.emit({ reelSettled: true });
  }

  // ── Presence ────────────────────────────────────────────────────────────────

  private onPresence(present: PresenceMeta[]): void {
    this.emit({
      present: present.map((p) => ({ name: p.name, you: p.clientId === this.clientId })),
    });
    if (this.view.isHost) {
      for (const p of present) {
        if (p.version === MP_ENGINE_VERSION && !this.joinOrder.some((j) => j.clientId === p.clientId)) {
          this.joinOrder.push({ clientId: p.clientId, name: p.name });
        }
      }
      if (this.hostStage === 'lobby') {
        this.broadcastRoom('lobby');
        if (this.joinOrder.length >= MP_LOBBY_SIZE) this.startGame();
      }
    } else if (
      this.hostClientId &&
      this.view.phase !== 'end' &&
      this.view.phase !== 'idle' &&
      present.length > 0 &&
      !present.some((p) => p.clientId === this.hostClientId)
    ) {
      this.emit({ phase: 'error', error: 'The host left — room closed.' });
    }
  }

  // ── Host: intents in ────────────────────────────────────────────────────────

  private onIntent(i: Intent): void {
    if (!this.view.isHost) return;
    switch (i.t) {
      case 'hello': {
        if (i.version !== MP_ENGINE_VERSION) return;
        if (!this.joinOrder.some((j) => j.clientId === i.clientId)) {
          this.joinOrder.push({ clientId: i.clientId, name: i.name });
        }
        this.broadcastRoom(this.hostStage === 'lobby' ? 'lobby' : 'draft');
        if (this.hostStage === 'lobby' && this.joinOrder.length >= MP_LOBBY_SIZE) this.startGame();
        break;
      }
      case 'setup':
        this.setups[i.clientId] = { formationId: i.formationId, style: i.style };
        break;
      case 'startWithBots':
        if (this.hostStage === 'lobby') this.startGame();
        break;
      case 'pick': {
        if (this.hostStage !== 'spin' || i.spinIndex !== this.view.spinIndex) return;
        const seat = this.seatOfClient(i.clientId);
        if (!seat) return;
        const roll = this.assignments[seat.seat];
        // validate against the slate WITH this spin's pending moves applied — the
        // sender moved first, so their "open slot" may differ from last spin's
        const moved = this.withMoves(seat);
        const legal =
          roll &&
          mpDraftOptions(moved, roll, this.draftedIds).some((p) => p.id === i.playerId) &&
          openSlots(moved).includes(i.slotIndex);
        if (legal) this.pendingPicks.set(seat.id, { playerId: i.playerId, slotIndex: i.slotIndex });
        break;
      }
      case 'moveOnBoard': {
        if (this.hostStage !== 'spin') return;
        const seat = this.seatOfClient(i.clientId);
        if (!seat) return;
        const list = this.pendingMoves.get(seat.id) ?? [];
        list.push({ from: i.from, to: i.to });
        this.pendingMoves.set(seat.id, list);
        break;
      }
      case 'pit': {
        if (this.hostStage !== 'pit' || i.round !== this.view.round) return;
        const seat = this.seatOfClient(i.clientId);
        if (!seat || !this.view.aliveIds.has(seat.id)) return;
        this.pendingPits.set(seat.id, { slate: i.slate, tactics: i.tactics, steal: i.steal });
        break;
      }
      case 'root': {
        const seat = this.seatOfClient(i.clientId);
        if (seat && !this.view.aliveIds.has(seat.id)) this.pendingRoots[seat.id] = i.forSeatId;
        break;
      }
    }
  }

  private seatOfClient(clientId: string): MpSeat | undefined {
    const idx = this.joinOrder.findIndex((j) => j.clientId === clientId);
    if (idx < 0) return undefined;
    return this.view.seats.find((s) => s.seat === idx);
  }

  /** A seat's slate with this spin's buffered moves applied (host validation). */
  private withMoves(seat: MpSeat): (XiSlotV2 | null)[] {
    let slate = seat.slate as (XiSlotV2 | null)[];
    for (const mv of this.pendingMoves.get(seat.id) ?? []) {
      slate = movePlaced(slate, seat.formation, mv.from, mv.to);
    }
    return slate;
  }

  // ── Host: phase driver ──────────────────────────────────────────────────────

  private broadcastRoom(phase: 'lobby' | 'draft' | 'round' | 'pit' | 'end'): void {
    const seats: SeatAssignment[] = this.joinOrder.map((j, idx) => ({
      seat: idx,
      clientId: j.clientId,
      name: j.name,
    }));
    this.channel?.sendHost({
      t: 'room',
      roomSeed: this.roomSeed,
      code: this.view.code,
      version: MP_ENGINE_VERSION,
      hostClientId: this.hostClientId,
      seats,
      phase,
    });
  }

  private startGame(): void {
    if (this.hostStage !== 'lobby') return;
    this.hostStage = 'spin';
    const humans = this.joinOrder.slice(0, MP_LOBBY_SIZE);
    const seats: SeatAssignment[] = [];
    for (let s = 0; s < MP_LOBBY_SIZE; s++) {
      seats.push({
        seat: s,
        clientId: humans[s]?.clientId ?? null,
        name: humans[s]?.name ?? '',
      });
    }
    this.channel?.sendHost({ t: 'gameStart', seats, setups: this.setups });
    // spin 0 is triggered from the APPLIED gameStart (one ordered stream) — firing
    // it here would race the host's own self-broadcast (bots not yet drafted).
  }

  private hostSpinStart(spinIndex: number): void {
    this.pendingPicks.clear();
    this.pendingMoves.clear();
    const deadlineAt = now() + MP_REEL_MS + MP_PICK_MS;
    this.hostPhaseDeadline = deadlineAt;
    this.channel?.sendHost({ t: 'spinStart', spinIndex, deadlineAt });
  }

  private hostCloseSpin(): void {
    const picks: Record<string, { playerId: string; slotIndex: number }> = {};
    for (const seat of this.view.seats) {
      if (!seat.isHuman) continue;
      const pending = this.pendingPicks.get(seat.id);
      if (pending) {
        picks[seat.id] = pending;
        continue;
      }
      const roll = this.assignments[seat.seat];
      const auto = roll
        ? autoPickForSlate(this.withMoves(seat), seat.formation, roll, this.draftedIds)
        : null;
      if (auto) picks[seat.id] = { playerId: auto.player.id, slotIndex: auto.slotIndex };
    }
    const moves: Record<string, { from: number; to: number }[]> = {};
    for (const [sid, list] of this.pendingMoves) moves[sid] = list;
    this.channel?.sendHost({ t: 'spinResult', spinIndex: this.view.spinIndex, picks, moves });
    const next = this.view.spinIndex + 1;
    if (next < MP_DRAFT_SPINS) {
      this.hostSpinStart(next);
    } else {
      this.hostStage = 'viewing';
      this.channel?.sendHost({ t: 'roundStart', round: 1, startAt: now() + MP_START_LEAD_MS });
    }
  }

  private hostAfterViewing(): void {
    const result = this.lastResult!;
    const aliveAfter = this.view.seats.filter(
      (s) => this.view.aliveIds.has(s.id) && !result.eliminatedIds.includes(s.id),
    );
    if (aliveAfter.length <= 1) {
      this.hostStage = 'done';
      this.channel?.sendHost({ t: 'gameEnd' });
      return;
    }
    this.hostStage = 'pit';
    this.pendingPits.clear();
    this.hostPhaseDeadline = now() + MP_PIT_MS;
    this.channel?.sendHost({ t: 'pitStart', round: result.round, deadlineAt: this.hostPhaseDeadline });
  }

  private hostClosePit(): void {
    const result = this.lastResult!;
    const survivors = this.view.seats.filter(
      (s) => this.view.aliveIds.has(s.id) && !result.eliminatedIds.includes(s.id),
    );
    // pool: everything on the freshly fallen squads, allocated in seat order
    const taken = new Set<string>();
    const upd: Record<
      string,
      { slate: XiSlotV2[]; tactics: Tactics; stolen: { playerId: string; slotIndex: number } | null }
    > = {};
    const poolIds = new Set(this.currentStealPool().map((p) => p.id));
    for (const seat of survivors) {
      const submitted = this.pendingPits.get(seat.id);
      const base = submitted ?? { slate: seat.slate, tactics: seat.tactics, steal: null };
      let stolen: { playerId: string; slotIndex: number } | null = null;
      let slate = base.slate;
      if (seat.isHuman) {
        const s = base.steal;
        if (s && poolIds.has(s.playerId) && !taken.has(s.playerId) && s.slotIndex < slate.length) {
          stolen = s;
        }
      } else {
        // bot: best strictly-improving steal from what's left
        let best: { playerId: string; slotIndex: number; gain: number } | null = null;
        for (const p of this.currentStealPool()) {
          if (taken.has(p.id)) continue;
          for (let idx = 0; idx < slate.length; idx++) {
            const gain = stealGainV2(slate, seat.formation, p, idx, affinity);
            if (gain > 0 && (!best || gain > best.gain)) best = { playerId: p.id, slotIndex: idx, gain };
          }
        }
        if (best) stolen = { playerId: best.playerId, slotIndex: best.slotIndex };
      }
      if (stolen) {
        const player = playerV2ById(stolen.playerId)!;
        taken.add(stolen.playerId);
        slate = slate.map((slot, idx) =>
          idx === stolen!.slotIndex ? { position: slot.position, player } : slot,
        );
      }
      upd[seat.id] = { slate, tactics: base.tactics, stolen };
    }
    this.channel?.sendHost({
      t: 'pitResult',
      round: result.round,
      updates: upd,
      roots: { ...this.pendingRoots },
    });
    this.hostStage = 'viewing';
    this.channel?.sendHost({
      t: 'roundStart',
      round: result.round + 1,
      startAt: now() + MP_START_LEAD_MS,
    });
  }

  // ── The tick (all clients: countdowns + featured index; host: deadlines) ────

  private startTicking(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 200);
  }

  private tick(): void {
    const t = now();
    // lockstep featured-index from the wall clock
    if (this.view.phase === 'watching' && this.view.startAt !== null) {
      const el = t - this.view.startAt;
      let idx = 0;
      for (const slot of this.view.slots) {
        if (el >= slot.offsetMs + slot.durationMs) idx++;
      }
      const capped = Math.min(idx, Math.max(0, this.view.matchday!.featured.length - 1));
      if (capped !== this.view.featuredIndex) this.emit({ featuredIndex: capped });
      else this.emit({}); // countdown refresh
    } else if (this.view.phase === 'draft' || this.view.phase === 'pit') {
      this.emit({}); // countdown refresh
    }
    // client auto-submit of the pit just before the deadline
    if (
      this.view.phase === 'pit' &&
      !this.view.pitReady &&
      this.view.pitDeadline !== null &&
      t > this.view.pitDeadline - 1500 &&
      this.view.aliveIds.has(this.view.mySeatId ?? '') &&
      !this.view.eliminated
    ) {
      this.submitPit();
    }
    if (!this.view.isHost) return;
    // host phase transitions
    if (this.hostStage === 'spin' && t >= this.hostPhaseDeadline) this.hostCloseSpin();
    else if (this.hostStage === 'viewing' && this.viewingEndsAt && t >= this.viewingEndsAt) {
      this.viewingEndsAt = 0;
      this.hostAfterViewing();
    } else if (this.hostStage === 'pit' && t >= this.hostPhaseDeadline) this.hostClosePit();
  }

  // ── The ONE apply path (host + clients) ─────────────────────────────────────

  private applyHostMsg(m: HostMsg): void {
    switch (m.t) {
      case 'room': {
        this.roomSeed = m.roomSeed;
        this.hostClientId = m.hostClientId;
        if (m.version !== MP_ENGINE_VERSION) {
          this.emit({ phase: 'error', error: 'Version mismatch — refresh to update.' });
          return;
        }
        if (this.view.phase === 'connecting' || this.view.phase === 'lobby') {
          if (m.phase !== 'lobby') {
            this.emit({ phase: 'error', error: 'That room is already playing.' });
            return;
          }
          this.emit({ phase: 'lobby' });
        }
        break;
      }
      case 'gameStart': {
        this.squadOrder = shuffledSquadOrder(this.roomSeed);
        this.draftedIds = new Set();
        const botSeatNos = m.seats.filter((s) => s.clientId === null).map((s) => s.seat);
        const bots = draftBotSeats(this.roomSeed, botSeatNos, this.draftedIds);
        const botBySeat = new Map(bots.map((b) => [b.seat, b]));
        const seats: MpSeat[] = m.seats.map((sa) => {
          if (sa.clientId === null) return botBySeat.get(sa.seat)!;
          const setup = m.setups[sa.clientId];
          const formation =
            (setup && formationById(setup.formationId)) ?? defaultSeatTactics().formation;
          return {
            seat: sa.seat,
            id: seatId(sa.seat),
            name: sa.name,
            isHuman: true,
            formation,
            tactics: { formationId: formation.id, style: setup?.style ?? 'balanced' },
            slate: [],
          };
        });
        // human slates start open (null-filled) — MpSeat.slate is dense-typed, so
        // we track humans' in-progress slates as (XiSlotV2|null)[] via `padded`
        for (const s of seats) {
          if (s.isHuman) s.slate = new Array(s.formation.slots.length).fill(null) as never;
        }
        const mySeatIdx = m.seats.find((sa) => sa.clientId === this.clientId)?.seat;
        const mine = mySeatIdx !== undefined ? seats.find((s) => s.seat === mySeatIdx) : undefined;
        this.emit({
          phase: 'draft',
          seats,
          aliveIds: new Set(seats.map((s) => s.id)),
          mySeatId: mine?.id ?? null,
          formation: mine?.formation ?? this.view.formation,
          style: mine?.tactics.style ?? this.view.style,
          mySlate: mine ? [...(mine.slate as (XiSlotV2 | null)[])] : this.view.mySlate,
          managers: [],
        });
        if (this.view.isHost) this.hostSpinStart(0);
        break;
      }
      case 'spinStart': {
        this.assignments = assignSquadsForSpin(
          this.squadOrder,
          m.spinIndex,
          MP_LOBBY_SIZE,
          (ref) => squadHasPickLeft(ref, this.draftedIds),
        );
        const mine = this.mySeat();
        const myRoll = mine ? this.assignments[mine.seat] : null;
        const myOptions =
          mine && myRoll
            ? mpDraftOptions(mine.slate as (XiSlotV2 | null)[], myRoll, this.draftedIds)
            : [];
        this.emit({
          spinIndex: m.spinIndex,
          spinDeadline: m.deadlineAt,
          reelSettled: false,
          myRoll,
          myOptions,
          myPick: null,
        });
        break;
      }
      case 'spinResult': {
        // Per seat: MOVES in order first, then the pick — the sender's ordering
        // (the UI locks the board once you've picked this spin).
        const seats = this.view.seats.map((s) => ({ ...s, slate: [...s.slate] }));
        for (const seat of seats) {
          let slate = seat.slate as (XiSlotV2 | null)[];
          for (const mv of m.moves[seat.id] ?? []) {
            slate = movePlaced(slate, seat.formation, mv.from, mv.to);
          }
          const pick = m.picks[seat.id];
          if (pick) {
            const player = playerV2ById(pick.playerId);
            if (player) {
              slate = slate.map((x, idx) =>
                idx === pick.slotIndex
                  ? { position: seat.formation.slots[pick.slotIndex], player }
                  : x,
              );
              this.draftedIds.add(pick.playerId);
            }
          }
          seat.slate = slate as XiSlotV2[];
        }
        const mine = seats.find((s) => s.id === this.view.mySeatId);
        this.emit({
          seats,
          mySlate: mine ? [...(mine.slate as (XiSlotV2 | null)[])] : this.view.mySlate,
          myPick: null,
        });
        break;
      }
      case 'roundStart': {
        const aliveSeats = this.view.seats
          .filter((s) => this.view.aliveIds.has(s.id))
          .sort((a, b) => a.seat - b.seat);
        const result = resolveMpRound({
          roomSeed: this.roomSeed,
          round: m.round,
          aliveSeats,
          matchIndexStart: this.matchIndexStart,
          moraleByManager: this.morale,
        });
        this.lastResult = result;
        const slots = roundSlots(result);
        const viewer = this.view.mySeatId ?? seatId(0);
        const matchday = buildMpMatchday(result, aliveSeats, viewer);
        const totalMs = slots.reduce((sum, s) => sum + s.durationMs, 0);
        this.viewingEndsAt = m.startAt + totalMs + 400;
        const managers = [...this.view.seats]
          .sort((a, b) => a.seat - b.seat)
          .map((s) => seatToManager(s, this.view.aliveIds.has(s.id)));
        this.emit({
          phase: 'watching',
          round: m.round,
          startAt: m.startAt,
          slots,
          matchday,
          featuredIndex: 0,
          rounds: [...this.view.rounds.filter((r) => r.round !== result.round), result],
          managers,
          pitReady: false,
          myStealChoice: null,
        });
        break;
      }
      case 'pitStart': {
        const result = this.lastResult!;
        const aliveIds = new Set(
          [...this.view.aliveIds].filter((id) => !result.eliminatedIds.includes(id)),
        );
        const iFell = this.view.mySeatId !== null && !aliveIds.has(this.view.mySeatId);
        const mine = this.mySeat();
        if (mine && aliveIds.has(mine.id)) {
          this.pitState = { slate: mine.slate, tactics: mine.tactics };
        } else {
          this.pitState = null;
        }
        let placement = this.view.placement;
        if (iFell && placement === null && this.view.mySeatId) {
          placement = result.table.findIndex((r) => r.managerId === this.view.mySeatId) + 1;
        }
        this.emit({
          phase: 'pit',
          aliveIds,
          pitDeadline: m.deadlineAt,
          stealPool: this.currentStealPool(),
          eliminated: iFell || this.view.eliminated,
          placement,
          pitReady: false,
          myStealChoice: null,
        });
        break;
      }
      case 'pitResult': {
        const seats = this.view.seats.map((s) => {
          const u = m.updates[s.id];
          if (!u) return s;
          for (const slot of u.slate) this.draftedIds.add(slot.player.id);
          return { ...s, slate: u.slate, tactics: u.tactics };
        });
        this.morale = {};
        if (this.lastResult) {
          this.morale = nextMorale(
            this.lastResult,
            seats.filter((s) => this.view.aliveIds.has(s.id)),
          );
          this.matchIndexStart = this.lastResult.engineNext?.matchIndex ?? this.matchIndexStart;
        }
        this.emit({ seats, roots: { ...this.view.roots, ...m.roots } });
        break;
      }
      case 'gameEnd': {
        const result = this.lastResult!;
        const aliveIds = new Set(
          [...this.view.aliveIds].filter((id) => !result.eliminatedIds.includes(id)),
        );
        const champion = this.view.seats.find((s) => aliveIds.has(s.id)) ?? null;
        let placement = this.view.placement;
        if (this.view.mySeatId) {
          if (aliveIds.has(this.view.mySeatId)) placement = 1;
          else if (placement === null) {
            placement = result.table.findIndex((r) => r.managerId === this.view.mySeatId) + 1;
          }
        }
        this.emit({ phase: 'end', aliveIds, champion, placement, eliminated: placement !== 1 });
        break;
      }
    }
  }

  private mySeat(): MpSeat | undefined {
    return this.view.seats.find((s) => s.id === this.view.mySeatId);
  }

  /** Loot = every player on the most recent round's freshly-fallen squads. */
  private currentStealPool(): PlayerV2[] {
    const result = this.lastResult;
    if (!result) return [];
    const fallen = new Set(result.eliminatedIds);
    const pool: PlayerV2[] = [];
    const seen = new Set<string>();
    for (const s of this.view.seats) {
      if (!fallen.has(s.id)) continue;
      for (const slot of s.slate as (XiSlotV2 | null)[]) {
        if (slot && !seen.has(slot.player.id)) {
          seen.add(slot.player.id);
          pool.push(slot.player);
        }
      }
    }
    return pool.sort((a, b) => b.rating - a.rating || (a.id < b.id ? -1 : 1));
  }

  /** Apply my board move locally + tell the host (echoed in the spin result). */
  applyLocalMove(from: number, to: number): void {
    const mine = this.mySeat();
    if (!mine || !this.view.formation) return;
    const next = movePlaced(this.view.mySlate, this.view.formation, from, to);
    if (next === this.view.mySlate) return;
    (mine.slate as (XiSlotV2 | null)[]).splice(0, mine.slate.length, ...next);
    this.emit({ mySlate: [...next] });
    this.moveOnBoard(from, to);
  }
}
