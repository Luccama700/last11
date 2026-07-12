import { describe, expect, it } from 'vitest';
import {
  MP_DRAFT_SPINS,
  MP_LOBBY_SIZE,
  MP_SURVIVORS_PER_ROUND,
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
  shuffledSquadOrder,
  squadHasPickLeft,
  type MpSeat,
} from './mp';
import { createRng } from './rng';
import { squadRefsV2 } from './data/loader';
import { personKey } from './draft';
import { matchVerdict } from './match';

const SEED = 20260711;

describe('room codes', () => {
  it('are 5 chars from the unambiguous alphabet, deterministic per rng', () => {
    const a = makeRoomCode(createRng(1));
    const b = makeRoomCode(createRng(1));
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
  });
});

describe('squad assignment (stride rotation)', () => {
  const order = shuffledSquadOrder(SEED);

  it('one canonical order per room seed, covering every squad', () => {
    expect(shuffledSquadOrder(SEED)).toEqual(order);
    expect(order.length).toBe(squadRefsV2().length);
    expect(order.length).toBeGreaterThanOrEqual(MP_LOBBY_SIZE);
  });

  it('every spin hands 20 seats 20 DISTINCT squads', () => {
    for (let spin = 0; spin < MP_DRAFT_SPINS; spin++) {
      const assigned = assignSquadsForSpin(order, spin, MP_LOBBY_SIZE);
      expect(assigned).toHaveLength(MP_LOBBY_SIZE);
      const keys = new Set(assigned.map((r) => `${r.nation}-${r.year}`));
      expect(keys.size).toBe(MP_LOBBY_SIZE);
    }
  });

  it('no seat ever sees the same squad twice across the 11-spin draft (47 coprime 20)', () => {
    for (let seat = 0; seat < MP_LOBBY_SIZE; seat++) {
      const seen = new Set<string>();
      for (let spin = 0; spin < MP_DRAFT_SPINS; spin++) {
        const r = assignSquadsForSpin(order, spin, MP_LOBBY_SIZE)[seat];
        seen.add(`${r.nation}-${r.year}`);
      }
      expect(seen.size).toBe(MP_DRAFT_SPINS);
    }
  });

  it('drained squads drop out via the eligibility filter', () => {
    const drained = new Set([`${order[0].nation}-${order[0].year}`]);
    const assigned = assignSquadsForSpin(order, 0, MP_LOBBY_SIZE, (ref) => !drained.has(`${ref.nation}-${ref.year}`));
    expect(assigned.some((r) => drained.has(`${r.nation}-${r.year}`))).toBe(false);
  });
});

describe('global uniqueness + auto-pick', () => {
  const order = shuffledSquadOrder(SEED);
  const { formation } = defaultSeatTactics();

  it('mpDraftOptions excludes globally drafted players', () => {
    const roll = order[0];
    const empty: (null)[] = new Array(11).fill(null);
    const all = mpDraftOptions(empty, roll, new Set());
    expect(all.length).toBeGreaterThan(0);
    const banned = new Set([all[0].id]);
    const filtered = mpDraftOptions(empty, roll, banned);
    expect(filtered.some((p) => p.id === all[0].id)).toBe(false);
    expect(filtered.length).toBe(all.length - 1);
  });

  it('auto-pick fills the best open slot and respects the drafted set', () => {
    const slate: (null)[] = new Array(11).fill(null);
    const pick = autoPickForSlate(slate, formation, order[0], new Set());
    expect(pick).not.toBeNull();
    // banning that player yields a different one
    const pick2 = autoPickForSlate(slate, formation, order[0], new Set([pick!.player.id]));
    expect(pick2?.player.id).not.toBe(pick!.player.id);
  });

  it('squadHasPickLeft flips false only when every player is drafted', () => {
    const roll = order[0];
    expect(squadHasPickLeft(roll, new Set())).toBe(true);
    const empty: (null)[] = new Array(11).fill(null);
    const everyId = new Set(mpDraftOptions(empty, roll, new Set()).map((p) => p.id));
    expect(squadHasPickLeft(roll, everyId)).toBe(false);
  });
});

function makeBotRoom(seed = SEED): { seats: MpSeat[]; drafted: Set<string> } {
  const drafted = new Set<string>();
  const seats = draftBotSeats(seed, Array.from({ length: MP_LOBBY_SIZE }, (_, i) => i), drafted);
  return { seats, drafted };
}

describe('bot seats', () => {
  it('drafts 20 full XIs deterministically with GLOBAL uniqueness and the person rule', () => {
    const { seats } = makeBotRoom();
    const again = makeBotRoom();
    expect(seats.map((s) => s.slate.map((x) => x.player.id))).toEqual(
      again.seats.map((s) => s.slate.map((x) => x.player.id)),
    );
    // Lucca's final ruling: every player is unique across ALL seats — bots
    // consume the shared pool, so nobody can ever appear on two teams.
    const ids = new Set<string>();
    for (const s of seats) {
      expect(s.slate).toHaveLength(11);
      const persons = new Set<string>();
      for (const slot of s.slate) {
        expect(ids.has(slot.player.id)).toBe(false); // nobody drafted twice ANYWHERE
        ids.add(slot.player.id);
        const pk = personKey(slot.player.id);
        expect(persons.has(pk)).toBe(false); // person rule within an XI
        persons.add(pk);
      }
    }
    expect(ids.size).toBe(MP_LOBBY_SIZE * 11);
  });
});

describe('resolveMpRound — the lockstep core', () => {
  const { seats } = makeBotRoom();

  it('is byte-identical across independent computations (host ≡ client)', () => {
    const input = {
      roomSeed: SEED,
      round: 1,
      aliveSeats: seats,
      matchIndexStart: 0,
      moraleByManager: {},
    };
    const a = resolveMpRound(input);
    const b = resolveMpRound(input);
    expect(a).toEqual(b);
  });

  it('cuts to the MP ladder and points follow the staged-pens rule', () => {
    const r1 = resolveMpRound({
      roomSeed: SEED,
      round: 1,
      aliveSeats: seats,
      matchIndexStart: 0,
      moraleByManager: {},
    });
    // round 1: 20 alive → cut to 16; >16 alive means genuine draws are allowed
    expect(r1.table).toHaveLength(20);
    expect(r1.eliminatedIds).toHaveLength(20 - MP_SURVIVORS_PER_ROUND[0]);
    for (const m of r1.resultsV2!) {
      if (m.homeGoals === m.awayGoals) expect(m.shootout).toBeUndefined();
    }

    // round 2: 16 alive → shootouts ON, no unresolved draws
    const alive2 = seats.filter((s) => !r1.eliminatedIds.includes(s.id));
    const r2 = resolveMpRound({
      roomSeed: SEED,
      round: 2,
      aliveSeats: alive2,
      matchIndexStart: r1.engineNext!.matchIndex,
      moraleByManager: nextMorale(r1, alive2),
    });
    expect(alive2).toHaveLength(16);
    for (const m of r2.resultsV2!) {
      const v = matchVerdict(m);
      expect(v.decidedBy === 'draw').toBe(false);
      if (m.homeGoals === m.awayGoals) expect(m.shootout).toBeDefined();
    }
  });

  it('a full 5-round MP tournament reaches exactly one champion', () => {
    let alive = makeBotRoom().seats;
    let matchIndex = 0;
    let morale: Record<string, Record<string, number>> = {};
    for (let round = 1; round <= MP_SURVIVORS_PER_ROUND.length; round++) {
      const r = resolveMpRound({
        roomSeed: SEED + 7,
        round,
        aliveSeats: alive,
        matchIndexStart: matchIndex,
        moraleByManager: morale,
      });
      matchIndex = r.engineNext!.matchIndex;
      alive = alive.filter((s) => !r.eliminatedIds.includes(s.id));
      morale = nextMorale(r, alive);
      expect(alive).toHaveLength(MP_SURVIVORS_PER_ROUND[round - 1]);
    }
    expect(alive).toHaveLength(1);
  });
});

describe('lockstep slots + matchday rebuild', () => {
  const { seats } = makeBotRoom();
  const result = resolveMpRound({
    roomSeed: SEED,
    round: 1,
    aliveSeats: seats,
    matchIndexStart: 0,
    moraleByManager: {},
  });

  it('three slots, each long enough for the longest match of its set at 1.5×', () => {
    const slots = roundSlots(result);
    expect(slots).toHaveLength(3);
    expect(slots[0].offsetMs).toBe(0);
    expect(slots[1].offsetMs).toBe(slots[0].durationMs);
    for (const s of slots) expect(s.durationMs).toBeGreaterThanOrEqual(45000 / 1.5);
  });

  it("a seat's matchday has 3 featured matches whose scores MATCH the table results", () => {
    const md = buildMpMatchday(result, seats, seatId(0));
    expect(md.featured).toHaveLength(3);
    const mine = result.resultsV2!.filter((r) => r.homeId === seatId(0) || r.awayId === seatId(0));
    md.featured.forEach((t, i) => {
      expect(t.finalScore.home).toBe(mine[i].homeGoals);
      expect(t.finalScore.away).toBe(mine[i].awayGoals);
    });
    // rail covers every match the viewer is NOT in
    expect(md.rail.length).toBe(result.resultsV2!.length - 3);
  });

  it('a spectator (eliminated seat id) gets an all-rail view of a later round', () => {
    const alive2 = seats.filter((s) => !result.eliminatedIds.includes(s.id));
    const r2 = resolveMpRound({
      roomSeed: SEED,
      round: 2,
      aliveSeats: alive2,
      matchIndexStart: result.engineNext!.matchIndex,
      moraleByManager: {},
    });
    const fallen = result.eliminatedIds[0];
    const md = buildMpMatchday(r2, alive2, fallen);
    expect(md.featured).toHaveLength(0);
    expect(md.rail.length).toBe(r2.resultsV2!.length);
  });
});
