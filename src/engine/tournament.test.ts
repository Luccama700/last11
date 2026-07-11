import { describe, expect, it } from 'vitest';
import { FORMATION, teamStrength } from './rating';
import { createRng } from './rng';
import {
  BOT_NAMES,
  LOBBY_SIZE,
  MATCHES_PER_ROUND,
  SURVIVORS_PER_ROUND,
  applySteal,
  createBotLobby,
  createLobby,
  evaluateSteal,
  playRound,
  runTournament,
  stealPool,
} from './tournament';
import type { Player, XI } from './types';

describe('lobby creation', () => {
  it('createLobby: 1 human with empty XI + 31 drafted bots', () => {
    const lobby = createLobby(createRng(1), 'Lucca');
    expect(lobby.length).toBe(LOBBY_SIZE);
    expect(lobby[0].isHuman).toBe(true);
    expect(lobby[0].xi.length).toBe(0);
    const bots = lobby.slice(1);
    expect(bots.every((b) => !b.isHuman && b.xi.length === 11)).toBe(true);
    expect(new Set(lobby.map((m) => m.id)).size).toBe(LOBBY_SIZE);
    expect(new Set(bots.map((b) => b.name)).size).toBe(31); // distinct names
  });

  it('createBotLobby: 32 drafted bots, enough names for everyone', () => {
    expect(BOT_NAMES.length).toBeGreaterThanOrEqual(LOBBY_SIZE);
    const lobby = createBotLobby(createRng(2));
    expect(lobby.length).toBe(LOBBY_SIZE);
    expect(lobby.every((m) => m.xi.length === 11 && m.alive)).toBe(true);
  });
});

describe('playRound', () => {
  it('produces the right match count and a fully-ranked table', () => {
    const rng = createRng(3);
    const lobby = createBotLobby(rng);
    const result = playRound(lobby, 24, 1, rng);
    expect(result.matches.length).toBe((LOBBY_SIZE * MATCHES_PER_ROUND) / 2);
    expect(result.table.length).toBe(LOBBY_SIZE);
    expect(result.eliminatedIds.length).toBe(LOBBY_SIZE - 24);
    // table is sorted best-first by points then gd
    for (let i = 1; i < result.table.length; i++) {
      const prev = result.table[i - 1];
      const cur = result.table[i];
      expect(
        prev.points > cur.points ||
          (prev.points === cur.points && prev.gd >= cur.gd),
      ).toBe(true);
    }
    // eliminated ids are exactly the bottom of the table
    expect(result.eliminatedIds).toEqual(
      result.table.slice(24).map((r) => r.managerId),
    );
  });

  it('rejects an odd lobby', () => {
    const rng = createRng(4);
    const lobby = createBotLobby(rng).slice(0, 5);
    expect(() => playRound(lobby, 4, 1, rng)).toThrow(/Odd/);
  });
});

describe('steals', () => {
  const makePlayer = (id: string, rating: number, nation = `N-${id}`): Player => ({
    id,
    name: id,
    nation,
    position: 'MF',
    rating,
  });
  const makeXi = (rating: number): XI =>
    FORMATION.map((position, i) => ({
      position,
      player: { ...makePlayer(`own-${i}`, rating), position },
    }));

  it('finds an improving swap when the pool has an upgrade', () => {
    const xi = makeXi(75);
    const star = { ...makePlayer('loot-star', 92), position: 'MF' as const };
    const steal = evaluateSteal(xi, [star, makePlayer('loot-weak', 60)]);
    expect(steal).not.toBeNull();
    expect(steal!.player.id).toBe('loot-star');
    expect(steal!.gain).toBeGreaterThan(0);
    // applying it actually raises strength by exactly the reported gain
    const before = teamStrength(xi).total;
    const after = teamStrength(applySteal(xi, steal!.slotIndex, steal!.player)).total;
    expect(after - before).toBeCloseTo(steal!.gain, 10);
  });

  it('returns null when the pool has nothing better', () => {
    const xi = makeXi(90);
    expect(evaluateSteal(xi, [makePlayer('loot-meh', 70)])).toBeNull();
  });

  it('never suggests a player already on the team', () => {
    const xi = makeXi(75);
    const dupe = xi[5].player; // already on the team
    expect(evaluateSteal(xi, [dupe])).toBeNull();
  });

  it('stealPool dedupes by player id across eliminated teams', () => {
    const xi = makeXi(80);
    const a = { id: 'a', name: 'A', isHuman: false, xi, alive: false };
    const b = { id: 'b', name: 'B', isHuman: false, xi, alive: false };
    expect(stealPool([a, b]).length).toBe(11);
  });
});

describe('runTournament (end-to-end battle royale)', () => {
  it('is fully deterministic: same seed => identical log', () => {
    const a = runTournament(123);
    const b = runTournament(123);
    expect(a.log.winnerId).toBe(b.log.winnerId);
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
  });

  it('different seeds diverge', () => {
    expect(JSON.stringify(runTournament(1).log)).not.toBe(
      JSON.stringify(runTournament(2).log),
    );
  });

  it('runs 32 -> 24 -> 16 -> 8 -> 4 -> 2 -> 1 with a single champion', () => {
    const { managers, log } = runTournament(99);
    expect(log.rounds.length).toBe(SURVIVORS_PER_ROUND.length);

    let expectedAlive = LOBBY_SIZE;
    for (let i = 0; i < log.rounds.length; i++) {
      const round = log.rounds[i];
      expect(round.table.length).toBe(expectedAlive);
      expect(round.matches.length).toBe((expectedAlive * MATCHES_PER_ROUND) / 2);
      expect(round.eliminatedIds.length).toBe(expectedAlive - SURVIVORS_PER_ROUND[i]);
      expectedAlive = SURVIVORS_PER_ROUND[i];
    }

    const alive = managers.filter((m) => m.alive);
    expect(alive.length).toBe(1);
    expect(alive[0].id).toBe(log.winnerId);
  });

  it('eliminated managers never play again', () => {
    const { log } = runTournament(7);
    const out = new Set<string>();
    for (const round of log.rounds) {
      for (const match of round.matches) {
        expect(out.has(match.homeId)).toBe(false);
        expect(out.has(match.awayId)).toBe(false);
      }
      for (const id of round.eliminatedIds) out.add(id);
    }
    expect(out.size).toBe(LOBBY_SIZE - 1);
  });

  it('every manager ends with a valid XI (steals preserve shape)', () => {
    const { managers } = runTournament(55);
    for (const m of managers) {
      expect(m.xi.map((s) => s.position)).toEqual([...FORMATION]);
      expect(new Set(m.xi.map((s) => s.player.id)).size).toBe(11);
    }
  });

  it('strength matters: winners tend to come from the top half', () => {
    let aboveMedian = 0;
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    for (const seed of seeds) {
      const { managers, log } = runTournament(seed);
      const strengths = managers
        .map((m) => teamStrength(m.xi).total)
        .sort((x, y) => x - y);
      const median = strengths[Math.floor(strengths.length / 2)];
      const winner = managers.find((m) => m.id === log.winnerId)!;
      if (teamStrength(winner.xi).total >= median) aboveMedian++;
    }
    expect(aboveMedian).toBeGreaterThanOrEqual(6);
  });
});
