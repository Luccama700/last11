import { describe, expect, it } from 'vitest';
import { FORMATION } from '../engine/rating';
import { createRng } from '../engine/rng';
import { createLobby, playRound, SURVIVORS_PER_ROUND } from '../engine/tournament';
import { nationSquad } from '../engine/data';
import { draftOptions, spinNation } from '../engine/draft';
import {
  aliveOf,
  humanOf,
  initialState,
  reducer,
  tournamentOver,
  type GameState,
  type Matchday,
} from './state';

/** Minimal matchday for reducer tests — ENTER_PLAYBACK only stores it and
 *  NEXT_FEATURED only reads `featured.length`/`featuredIndex`, so the timelines
 *  themselves are never touched here. */
function fakeMatchday(featuredCount: number, index = 0): Matchday {
  return {
    featured: Array.from({ length: featuredCount }, () => ({})) as unknown as Matchday['featured'],
    featuredIndex: index,
    rail: [],
  };
}

function startedState(seed = 42): { state: GameState; rng: ReturnType<typeof createRng> } {
  const rng = createRng(seed);
  const managers = createLobby(rng, 'You');
  const state = reducer(initialState, { type: 'START', seed, managers });
  return { state, rng };
}

function draftAll(state: GameState, rng: ReturnType<typeof createRng>): GameState {
  let s = state;
  while (s.draftSlotIndex < FORMATION.length) {
    const nation = spinNation(rng);
    s = reducer(s, { type: 'SPIN', nation });
    const options = draftOptions(humanOf(s)!.xi, nation);
    s = reducer(s, { type: 'PICK', player: options[0] });
  }
  return s;
}

describe('game reducer: draft flow', () => {
  it('START enters draft with a fresh 32-lobby', () => {
    const { state } = startedState();
    expect(state.screen).toBe('draft');
    expect(state.managers.length).toBe(32);
    expect(humanOf(state)!.xi.length).toBe(0);
  });

  it('SPIN then PICK fills slots in FORMATION order', () => {
    const { state, rng } = startedState();
    const nation = spinNation(rng);
    let s = reducer(state, { type: 'SPIN', nation });
    expect(s.spunNation).toBe(nation);
    const player = nationSquad(nation)[0];
    s = reducer(s, { type: 'PICK', player });
    const xi = humanOf(s)!.xi;
    expect(xi.length).toBe(1);
    expect(xi[0].position).toBe(FORMATION[0]);
    expect(s.spunNation).toBeNull();
    expect(s.draftSlotIndex).toBe(1);
  });

  it('a full draft yields a complete human XI', () => {
    const { state, rng } = startedState();
    const s = draftAll(state, rng);
    expect(s.draftSlotIndex).toBe(11);
    expect(humanOf(s)!.xi.map((x) => x.position)).toEqual([...FORMATION]);
  });
});

describe('game reducer: battle flow', () => {
  it('ROUND_PLAYED applies cuts, builds the pool, sets placement when human falls', () => {
    const { state, rng } = startedState(7);
    let s = draftAll(state, rng);
    s = reducer(s, { type: 'ENTER_BATTLE' });

    const result = playRound(aliveOf(s), SURVIVORS_PER_ROUND[0], 1, rng);
    s = reducer(s, { type: 'ROUND_PLAYED', result });

    expect(s.roundIndex).toBe(1);
    expect(aliveOf(s).length).toBe(SURVIVORS_PER_ROUND[0]);
    expect(s.battleView).toBe('results');
    expect(s.pool.length).toBeGreaterThan(0);

    const human = humanOf(s)!;
    if (human.alive) {
      expect(s.humanPlacement).toBeNull();
    } else {
      const rank = result.table.findIndex((r) => r.managerId === human.id) + 1;
      expect(s.humanPlacement).toBe(rank);
      expect(rank).toBeGreaterThan(SURVIVORS_PER_ROUND[0]);
    }
  });

  it('a champion gets placement 1', () => {
    const { state, rng } = startedState(11);
    let s = draftAll(state, rng);
    s = reducer(s, { type: 'ENTER_BATTLE' });
    // play all rounds regardless of human survival
    for (let i = 0; i < SURVIVORS_PER_ROUND.length && aliveOf(s).length > 1; i++) {
      const result = playRound(aliveOf(s), SURVIVORS_PER_ROUND[i], i + 1, rng);
      s = reducer(s, { type: 'ROUND_PLAYED', result });
    }
    expect(aliveOf(s).length).toBe(1);
    expect(tournamentOver(s)).toBe(true);
    const human = humanOf(s)!;
    if (human.alive) expect(s.humanPlacement).toBe(1);
    else expect(s.humanPlacement).toBeGreaterThan(1);
  });

  // Regression (night batch 2): with simV2 ON the round is WATCHED before it is
  // recorded. Recording used to hinge on the screen calling onFinishRound at the
  // exact right moment; skipping could reach the results view without the round
  // ever reaching `rounds`, so the standings silently stalled. Recording is now a
  // state invariant: ENTER_PLAYBACK stashes the result and any playback→results
  // transition folds it in exactly once.
  describe('simV2 playback records the watched round on every exit', () => {
    function toPlayback(seed: number, featured = 3) {
      const { state, rng } = startedState(seed);
      let s = draftAll(state, rng);
      s = reducer(s, { type: 'ENTER_BATTLE' });
      const result = playRound(aliveOf(s), SURVIVORS_PER_ROUND[0], 1, rng);
      s = reducer(s, { type: 'ENTER_PLAYBACK', matchday: fakeMatchday(featured), result });
      return { s, result };
    }

    it('stashes the round on ENTER_PLAYBACK but does not record it while watching', () => {
      const { s, result } = toPlayback(7);
      expect(s.battleView).toBe('playback');
      expect(s.rounds).toHaveLength(0);
      expect(s.pendingRound?.round).toBe(result.round);
    });

    it('PLAYBACK_DONE (finish / skip / skip-all) folds the round into rounds', () => {
      const { s: watching, result } = toPlayback(7);
      const s = reducer(watching, { type: 'PLAYBACK_DONE' });
      expect(s.rounds).toHaveLength(1);
      expect(s.rounds[0].round).toBe(result.round);
      expect(s.roundIndex).toBe(1);
      expect(s.battleView).toBe('results');
      expect(s.pendingRound).toBeNull();
      expect(aliveOf(s).length).toBe(SURVIVORS_PER_ROUND[0]);
    });

    it('overshooting the last featured match (NEXT_FEATURED) also records the round', () => {
      const { s: watching, result } = toPlayback(5, 1); // single featured match
      const s = reducer(watching, { type: 'NEXT_FEATURED' });
      expect(s.rounds).toHaveLength(1);
      expect(s.rounds[0].round).toBe(result.round);
      expect(s.battleView).toBe('results');
    });

    it('recording is idempotent — a repeat PLAYBACK_DONE / ROUND_PLAYED cannot double-count', () => {
      const { s: watching, result } = toPlayback(9);
      let s = reducer(watching, { type: 'PLAYBACK_DONE' });
      s = reducer(s, { type: 'PLAYBACK_DONE' }); // pendingRound already cleared
      s = reducer(s, { type: 'ROUND_PLAYED', result }); // same round via the v1 driver
      expect(s.rounds).toHaveLength(1);
      expect(s.roundIndex).toBe(1);
    });
  });

  it('STEALS_APPLIED swaps XIs and returns to the next round intro', () => {
    const { state, rng } = startedState(3);
    let s = draftAll(state, rng);
    s = reducer(s, { type: 'ENTER_BATTLE' });
    const result = playRound(aliveOf(s), SURVIVORS_PER_ROUND[0], 1, rng);
    s = reducer(s, { type: 'ROUND_PLAYED', result });
    s = reducer(s, { type: 'OPEN_STEAL' });
    expect(s.screen).toBe('steal');

    const someBot = aliveOf(s).find((m) => !m.isHuman)!;
    const newXi = [...someBot.xi];
    s = reducer(s, { type: 'STEALS_APPLIED', xis: { [someBot.id]: newXi } });
    expect(s.screen).toBe('battle');
    expect(s.battleView).toBe('intro');
    expect(s.pool.length).toBe(0);
  });
});
