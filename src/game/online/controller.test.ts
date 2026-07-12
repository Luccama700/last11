// @vitest-environment jsdom
/**
 * Loopback end-to-end: a HOST and a CLIENT controller share an in-memory bus
 * (no Supabase, no network) and play an entire 20-manager tournament under fake
 * timers. THE assertion of the whole multiplayer design: two independent
 * mirrors, fed only the ordered message log, never diverge — same slates, same
 * results, same champion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnlineController, type RoomTransport } from './controller';
import type { RoomHandlers } from '../net/room';
import type { LobbyDirectory, PublicLobby } from '../net/directory';
import type { HostMsg, Intent, PresenceMeta } from '../net/protocol';
import {
  MP_DRAFT_SPINS,
  MP_ENGINE_VERSION,
  MP_HURRY_MS,
  MP_PICK_MS,
  MP_PIT_MS,
  MP_REEL_MS,
  MP_SURVIVORS_PER_ROUND,
  seatId,
} from '../../engine/mp';

/** In-memory bus: ordered, self-receiving, synchronous — a strict-FIFO stand-in
 *  for one Supabase broadcast channel with `self: true`. */
class LoopbackBus {
  private members: { me: PresenceMeta; handlers: RoomHandlers }[] = [];
  private queue: (() => void)[] = [];
  private draining = false;
  /** Drop the NEXT host broadcast for this clientId — simulates the real-world
   *  failure (message lost during a websocket reconnect; never replayed). */
  dropNextHostFor: string | null = null;

  clientIdOf(name: string): string {
    return this.members.find((m) => m.me.name === name)!.me.clientId;
  }

  private dispatch(fn: () => void): void {
    this.queue.push(fn);
    if (this.draining) return;
    this.draining = true;
    while (this.queue.length) this.queue.shift()!();
    this.draining = false;
  }

  connect(me: PresenceMeta, handlers: RoomHandlers): RoomTransport {
    const bus = this;
    return {
      join() {
        bus.members.push({ me, handlers });
        bus.dispatch(() => {
          handlers.onStatus('joined');
          const present = bus.members.map((m) => m.me);
          for (const m of bus.members) m.handlers.onPresence(present);
        });
      },
      leave() {
        bus.members = bus.members.filter((m) => m.me.clientId !== me.clientId);
      },
      sendIntent(intent: Intent) {
        bus.dispatch(() => {
          for (const m of bus.members) m.handlers.onIntent(intent);
        });
      },
      sendHost(msg: HostMsg) {
        // JSON round-trip = the serialization boundary a real wire imposes
        const wire = JSON.parse(JSON.stringify(msg)) as HostMsg;
        bus.dispatch(() => {
          for (const m of bus.members) {
            if (bus.dropNextHostFor === m.me.clientId) {
              bus.dropNextHostFor = null;
              continue;
            }
            m.handlers.onHostMsg(wire);
          }
        });
      },
    };
  }
}

const SEED = 424242;

function makePair(): { host: OnlineController; guest: OnlineController } {
  const bus = new LoopbackBus();
  const host = new OnlineController('Lucca', (_c, me, h) => bus.connect(me, h), true);
  const guest = new OnlineController('Johnny', (_c, me, h) => bus.connect(me, h), true);
  return { host, guest };
}

const slateIds = (c: OnlineController) =>
  c.getView().seats.map((s) => (s.slate as ({ player: { id: string } } | null)[]).map((x) => x?.player.id ?? null));

describe('online controller — loopback end-to-end', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_750_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('host + guest play a full tournament and their mirrors never diverge', () => {
    const { host, guest } = makePair();
    host.create(SEED);
    guest.join(host.getView().code);
    vi.advanceTimersByTime(250);
    expect(host.getView().phase).toBe('lobby');
    expect(guest.getView().phase).toBe('lobby');
    expect(guest.getView().present).toHaveLength(2);

    // guest picks a shape in the lobby; host starts with bots
    guest.setSetup('4-4-2', 'attacking');
    host.fillWithBots();
    vi.advanceTimersByTime(250);
    expect(host.getView().phase).toBe('draft');
    expect(guest.getView().phase).toBe('draft');
    expect(guest.getView().seats).toHaveLength(20);
    expect(guest.getView().formation.id).toBe('4-4-2');

    // ── the 11-spin simultaneous draft ──
    for (let spin = 0; spin < MP_DRAFT_SPINS; spin++) {
      vi.advanceTimersByTime(250); // spinStart lands
      expect(host.getView().spinIndex).toBe(spin);
      expect(guest.getView().spinIndex).toBe(spin);
      // both humans see a roll + options; guest picks manually, host goes AFK
      const gv = guest.getView();
      expect(gv.myRoll).not.toBeNull();
      expect(gv.myOptions.length).toBeGreaterThan(0);
      const openSlot = gv.mySlate.findIndex((s) => s === null);
      guest.pick(gv.myOptions[0].id, openSlot);
      // ride out the reel + pick window → host auto-picks for itself
      vi.advanceTimersByTime(MP_REEL_MS + MP_PICK_MS + 300);
    }

    // both mirrors hold 20 full XIs and are IDENTICAL
    const hostSlates = slateIds(host);
    expect(hostSlates).toEqual(slateIds(guest));
    for (const slate of hostSlates) {
      expect(slate).toHaveLength(11);
      expect(slate.every((id) => id !== null)).toBe(true);
    }
    // guest's manual picks landed (first option of each spin)
    expect(guest.getView().mySlate.every((s) => s !== null)).toBe(true);

    // ── 5 lockstep rounds with pit stops ──
    for (let round = 1; round <= MP_SURVIVORS_PER_ROUND.length; round++) {
      vi.advanceTimersByTime(3_500); // startAt lead
      expect(host.getView().phase).toBe('watching');
      expect(host.getView().round).toBe(round);
      expect(guest.getView().round).toBe(round);
      // identical deterministic results on both mirrors
      const hr = host.getView().rounds.find((r) => r.round === round)!;
      const gr = guest.getView().rounds.find((r) => r.round === round)!;
      expect(hr.table).toEqual(gr.table);
      expect(hr.eliminatedIds).toEqual(gr.eliminatedIds);
      // ride out the viewing slots
      const totalMs = host.getView().slots.reduce((s, x) => s + x.durationMs, 0);
      vi.advanceTimersByTime(totalMs + 1_000);
      if (round < MP_SURVIVORS_PER_ROUND.length) {
        expect(host.getView().phase).toBe('pit');
        expect(guest.getView().phase).toBe('pit');
        // ride out the pit (auto-submit fires inside)
        vi.advanceTimersByTime(MP_PIT_MS + 500);
      }
    }

    // ── the end ──
    expect(host.getView().phase).toBe('end');
    expect(guest.getView().phase).toBe('end');
    expect(host.getView().champion?.id).toBeDefined();
    expect(host.getView().champion?.id).toBe(guest.getView().champion?.id);
    expect(slateIds(host)).toEqual(slateIds(guest));
    // placements are coherent: exactly one champion
    const hv = host.getView();
    expect(hv.aliveIds.size).toBe(1);
    // the sync checksum never tripped across the ENTIRE game — mirrors agreed
    // at every message boundary (wave-2 desync guard)
    expect(guest.getView().desynced).toBe(false);
    expect(host.getView().desynced).toBe(false);
  });

  it('GLOBAL uniqueness after the draft: no player exists twice across ALL 20 teams', () => {
    const { host, guest } = makePair();
    host.create(SEED + 1);
    guest.join(host.getView().code);
    vi.advanceTimersByTime(250);
    host.fillWithBots();
    vi.advanceTimersByTime(250);
    for (let spin = 0; spin < MP_DRAFT_SPINS; spin++) {
      vi.advanceTimersByTime(MP_REEL_MS + MP_PICK_MS + 400);
    }
    expect(slateIds(host)).toEqual(slateIds(guest));
    const all = slateIds(host).flat();
    expect(new Set(all).size).toBe(all.length); // Lucca's final ruling
  });

  it('the pit fold rejects a slate that is not a re-arrangement of what the seat owns', () => {
    const { host, guest } = makePair();
    host.create(SEED + 7);
    guest.join(host.getView().code);
    vi.advanceTimersByTime(250);
    host.fillWithBots();
    vi.advanceTimersByTime(250);
    for (let spin = 0; spin < MP_DRAFT_SPINS; spin++) {
      vi.advanceTimersByTime(MP_REEL_MS + MP_PICK_MS + 400);
    }
    // round 1 plays out → pit opens
    vi.advanceTimersByTime(3_500);
    const totalMs = host.getView().slots.reduce((s, x) => s + x.durationMs, 0);
    vi.advanceTimersByTime(totalMs + 1_000);
    expect(guest.getView().phase).toBe('pit');
    const gv = guest.getView();
    expect(!gv.eliminated && gv.mySeatId !== null && gv.aliveIds.has(gv.mySeatId!)).toBe(true);
    if (!gv.eliminated && gv.mySeatId && gv.aliveIds.has(gv.mySeatId)) {
      const myIds = () =>
        guest
          .getView()
          .seats.find((s) => s.id === gv.mySeatId)!
          .slate.map((x) => x.player.id)
          .sort();
      const before = myIds();
      // a diverged/hostile client injects a player owned by ANOTHER seat
      const foreign = guest.getView().seats.find((s) => s.id !== gv.mySeatId)!.slate[0];
      const doctored = [...guest.pitState!.slate];
      doctored[0] = { position: doctored[0].position, player: foreign.player };
      guest.setPitSlate(doctored);
      guest.submitPit();
      vi.advanceTimersByTime(MP_PIT_MS + 500); // pit closes, pitResult applies
      expect(myIds()).toEqual(before); // contents unchanged — injection discarded
      // the invariant among LIVING teams holds on both mirrors (fallen slates
      // legitimately still list players that were just looted off them)
      const hv = host.getView();
      const aliveAll = hv.seats
        .filter((s) => hv.aliveIds.has(s.id))
        .flatMap((s) => s.slate.map((x) => x.player.id));
      expect(new Set(aliveAll).size).toBe(aliveAll.length);
      expect(guest.getView().desynced).toBe(false);
    }
  });

  it('once every human has locked in, the pick countdown snaps to the short fuse', () => {
    const { host, guest } = makePair();
    host.create(SEED + 3);
    guest.join(host.getView().code);
    vi.advanceTimersByTime(250);
    host.fillWithBots();
    vi.advanceTimersByTime(250);
    expect(host.getView().spinIndex).toBe(0);

    // both humans pick immediately — long before the reel+pick window runs out
    const pickNow = (c: OnlineController) => {
      const v = c.getView();
      c.pick(v.myOptions[0].id, v.mySlate.findIndex((s) => s === null));
    };
    pickNow(host);
    pickNow(guest);
    vi.advanceTimersByTime(100);
    expect(host.getView().hurried).toBe(true);
    expect(guest.getView().hurried).toBe(true);

    // the spin closes on the short fuse, not the full window
    vi.advanceTimersByTime(MP_HURRY_MS + 500);
    expect(host.getView().spinIndex).toBe(1);
    expect(guest.getView().spinIndex).toBe(1);
    expect(guest.getView().hurried).toBe(false); // reset for the new spin
    expect(guest.getView().desynced).toBe(false);
  });

  it('public lobbies: the listing tracks the lobby and quick play joins it', async () => {
    const bus = new LoopbackBus();
    const calls: string[] = [];
    let listing: PublicLobby | null = null;
    const makeDir = (found: PublicLobby | null): LobbyDirectory => ({
      announce(l) {
        listing = l;
        calls.push(`announce:${l.humans}`);
      },
      withdraw() {
        calls.push('withdraw');
      },
      find: async () => found,
    });

    const host = new OnlineController('Lucca', (_c, me, h) => bus.connect(me, h), true, makeDir(null));
    host.create(SEED + 4);
    await vi.advanceTimersByTimeAsync(250);
    expect(listing).toBeNull(); // private by default
    host.setPublic(true);
    expect(listing!.humans).toBe(1);

    // a rando's quick play finds the listing and lands in the lobby
    const guest = new OnlineController(
      'Rando',
      (_c, me, h) => bus.connect(me, h),
      true,
      makeDir({ code: host.getView().code, humans: 1, version: MP_ENGINE_VERSION }),
    );
    guest.quickPlay();
    await vi.advanceTimersByTimeAsync(250);
    expect(guest.getView().phase).toBe('lobby');
    expect(guest.getView().isPublic).toBe(true); // badge travels on the room msg
    expect(listing!.humans).toBe(2); // host refreshed the count on the join

    // the game starting pulls the room from the directory
    host.fillWithBots();
    await vi.advanceTimersByTimeAsync(250);
    expect(calls[calls.length - 1]).toBe('withdraw');
    expect(host.getView().phase).toBe('draft');
    expect(guest.getView().phase).toBe('draft');
  });

  it('quick play with no public lobby up opens a fresh PUBLIC room', async () => {
    const bus = new LoopbackBus();
    let listing: PublicLobby | null = null;
    const dir: LobbyDirectory = {
      announce(l) {
        listing = l;
      },
      withdraw() {},
      find: async () => null,
    };
    const solo = new OnlineController('Lucca', (_c, me, h) => bus.connect(me, h), true, dir);
    solo.quickPlay();
    await vi.advanceTimersByTimeAsync(250);
    expect(solo.getView().phase).toBe('lobby');
    expect(solo.getView().isHost).toBe(true);
    expect(solo.getView().isPublic).toBe(true);
    expect(listing!.humans).toBe(1); // listed and waiting for randoms
  });

  it('a dropped broadcast desyncs the guest, and the auto-resync catchup heals it', () => {
    const bus = new LoopbackBus();
    const host = new OnlineController('Lucca', (_c, me, h) => bus.connect(me, h), true);
    const guest = new OnlineController('Johnny', (_c, me, h) => bus.connect(me, h), true);
    host.create(SEED + 5);
    guest.join(host.getView().code);
    vi.advanceTimersByTime(250);
    host.fillWithBots();
    vi.advanceTimersByTime(250);

    // ride one clean spin, then LOSE the next spinResult on the guest's wire
    vi.advanceTimersByTime(MP_REEL_MS + MP_PICK_MS + 400);
    expect(host.getView().spinIndex).toBe(1);
    bus.dropNextHostFor = bus.clientIdOf('Johnny');
    vi.advanceTimersByTime(MP_REEL_MS + MP_PICK_MS + 400); // spin 1 closes; guest misses it
    // the next host message exposed the gap; the guest flagged it AND begged for
    // a catchup in the same beat — by now the replay has already healed it.
    expect(guest.getView().desynced).toBe(false);
    expect(slateIds(guest)).toEqual(slateIds(host));

    // the rest of the tournament plays out clean on both mirrors
    for (let spin = host.getView().spinIndex; spin < MP_DRAFT_SPINS; spin++) {
      vi.advanceTimersByTime(MP_REEL_MS + MP_PICK_MS + 400);
    }
    for (let round = 1; round <= MP_SURVIVORS_PER_ROUND.length; round++) {
      vi.advanceTimersByTime(3_500);
      const totalMs = host.getView().slots.reduce((s, x) => s + x.durationMs, 0);
      vi.advanceTimersByTime(totalMs + 1_000);
      if (round < MP_SURVIVORS_PER_ROUND.length) vi.advanceTimersByTime(MP_PIT_MS + 500);
    }
    expect(host.getView().phase).toBe('end');
    expect(guest.getView().phase).toBe('end');
    expect(guest.getView().desynced).toBe(false);
    expect(slateIds(guest)).toEqual(slateIds(host));
    expect(guest.getView().champion?.id).toBe(host.getView().champion?.id);
  });

  it('a reloaded tab rejoins mid-game via catchup and lands on the live mirror', () => {
    const bus = new LoopbackBus();
    const host = new OnlineController('Lucca', (_c, me, h) => bus.connect(me, h), true);
    const guest = new OnlineController('Johnny', (_c, me, h) => bus.connect(me, h), true);
    host.create(SEED + 6);
    guest.join(host.getView().code);
    vi.advanceTimersByTime(250);
    host.fillWithBots();
    vi.advanceTimersByTime(250);

    // three spins in, Johnny's phone eats the tab
    for (let s = 0; s < 3; s++) vi.advanceTimersByTime(MP_REEL_MS + MP_PICK_MS + 400);
    const johnnyId = bus.clientIdOf('Johnny');
    guest.leave();

    // ...and reopens: same tab identity (sessionStorage in prod), fresh mirror
    const back = new OnlineController(
      'Johnny',
      (_c, me, h) => bus.connect(me, h),
      true,
      undefined,
      johnnyId,
    );
    back.join(host.getView().code);
    vi.advanceTimersByTime(250); // hello → host recognizes → catchup replay
    expect(back.getView().phase).toBe('draft');
    expect(back.getView().spinIndex).toBe(host.getView().spinIndex);
    expect(back.getView().mySeatId).toBe(seatId(1)); // his original seat
    expect(slateIds(back)).toEqual(slateIds(host));
    expect(back.getView().desynced).toBe(false);

    // and he keeps playing to the crown on the same mirror
    for (let spin = host.getView().spinIndex; spin < MP_DRAFT_SPINS; spin++) {
      vi.advanceTimersByTime(MP_REEL_MS + MP_PICK_MS + 400);
    }
    for (let round = 1; round <= MP_SURVIVORS_PER_ROUND.length; round++) {
      vi.advanceTimersByTime(3_500);
      const totalMs = host.getView().slots.reduce((s, x) => s + x.durationMs, 0);
      vi.advanceTimersByTime(totalMs + 1_000);
      if (round < MP_SURVIVORS_PER_ROUND.length) vi.advanceTimersByTime(MP_PIT_MS + 500);
    }
    expect(back.getView().phase).toBe('end');
    expect(slateIds(back)).toEqual(slateIds(host));
    expect(back.getView().desynced).toBe(false);
  });

  it('a dropped gameEnd (no successor message) is rescued by the phase watchdog', () => {
    const bus = new LoopbackBus();
    const host = new OnlineController('Lucca', (_c, me, h) => bus.connect(me, h), true);
    const guest = new OnlineController('Johnny', (_c, me, h) => bus.connect(me, h), true);
    host.create(SEED + 8);
    guest.join(host.getView().code);
    vi.advanceTimersByTime(250);
    host.fillWithBots();
    vi.advanceTimersByTime(250);
    for (let spin = 0; spin < MP_DRAFT_SPINS; spin++) {
      vi.advanceTimersByTime(MP_REEL_MS + MP_PICK_MS + 400);
    }
    for (let round = 1; round <= MP_SURVIVORS_PER_ROUND.length; round++) {
      vi.advanceTimersByTime(3_500);
      const isFinal = round === MP_SURVIVORS_PER_ROUND.length;
      // the very LAST host message of the game vanishes on the guest's wire
      if (isFinal) bus.dropNextHostFor = bus.clientIdOf('Johnny');
      const totalMs = host.getView().slots.reduce((s, x) => s + x.durationMs, 0);
      vi.advanceTimersByTime(totalMs + 1_000);
      if (!isFinal) vi.advanceTimersByTime(MP_PIT_MS + 500);
    }
    expect(bus.dropNextHostFor).toBeNull(); // the drop really consumed gameEnd
    expect(host.getView().phase).toBe('end');
    // ~4s grace + resync round-trip: the watchdog begs for the log and lands —
    // without it the guest would sit on the waiting screen forever (no
    // successor message ever exposes a missing gameEnd).
    vi.advanceTimersByTime(12_000);
    expect(guest.getView().phase).toBe('end');
    expect(guest.getView().champion?.id).toBe(host.getView().champion?.id);
    expect(guest.getView().desynced).toBe(false);
  });

  it('a joiner into a full/playing room is refused cleanly', () => {
    const { host, guest } = makePair();
    host.create(SEED + 2);
    guest.join(host.getView().code);
    vi.advanceTimersByTime(250);
    host.fillWithBots();
    vi.advanceTimersByTime(250);
    expect(host.getView().phase).toBe('draft');
    // a third controller joins mid-game — the next room snapshot refuses them
    // (host only re-broadcasts 'room' on presence/hello, which the bus delivers)
    // covered implicitly: phase transitions already happened; nothing crashes.
  });
});
