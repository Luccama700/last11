import { describe, expect, it } from 'vitest';
import { initialState, reducer, type GameState } from './state';
import { swapSlots } from '../engine/draft';
import { squadByRef } from '../engine/data/loader';
import { detailedToCoarse } from '../engine/data/schema';
import { formationById, type XiSlotV2 } from '../engine/types';
import type { Manager } from '../engine/tournament';
import type { Player, XI } from '../engine/types';

const F433 = formationById('4-3-3')!;
const bra = squadByRef('BRA', 2002).players;
const slate: XiSlotV2[] = bra.slice(0, 11).map((player, i) => ({ position: F433.slots[i], player }));

function coarseOf(s: readonly XiSlotV2[]): XI {
  return s.map((x) => ({
    position: detailedToCoarse(x.position),
    player: {
      id: x.player.id,
      name: x.player.name,
      nation: x.player.nation,
      position: detailedToCoarse(x.player.position),
      rating: x.player.rating,
    },
  }));
}

function battleState(): GameState {
  const human: Manager = { id: 'you', name: 'You', isHuman: true, xi: coarseOf(slate), alive: true };
  return {
    ...initialState,
    screen: 'battle',
    managers: [human],
    formation: F433,
    humanSlate: [...slate],
  };
}

describe('REARRANGE_XI — re-slot persists to humanSlate AND coarse manager.xi', () => {
  it('updates the detailed slate, keeping each slot position', () => {
    const swapped = swapSlots(slate, 1, 9);
    const next = reducer(battleState(), { type: 'REARRANGE_XI', managerId: 'you', xi: swapped });
    expect(next.humanSlate![1]!.player.id).toBe(slate[9].player.id);
    expect(next.humanSlate![9]!.player.id).toBe(slate[1].player.id);
    expect(next.humanSlate![1]!.position).toBe(F433.slots[1]);
  });
  it('projects the swap into the coarse Manager.xi the engine reads', () => {
    const swapped = swapSlots(slate, 1, 9);
    const next = reducer(battleState(), { type: 'REARRANGE_XI', managerId: 'you', xi: swapped });
    const hx = next.managers.find((m) => m.id === 'you')!.xi;
    expect(hx[1].player.id).toBe(slate[9].player.id);
    expect(hx[1].position).toBe(detailedToCoarse(F433.slots[1]));
    expect(hx).toHaveLength(11);
  });
});

describe('SET_TACTICS — between-round formation change, no slate reset', () => {
  it('swaps the formation but leaves the drafted slate intact', () => {
    const base = battleState();
    const next = reducer(base, {
      type: 'SET_TACTICS',
      managerId: 'you',
      tactics: { formationId: '3-5-2', style: 'attacking' },
    });
    expect(next.formation!.id).toBe('3-5-2');
    expect(next.humanSlate).toBe(base.humanSlate); // NOT reset (unlike SET_FORMATION)
  });
  it('ignores an unknown manager or bad formation id', () => {
    const base = battleState();
    expect(reducer(base, { type: 'SET_TACTICS', managerId: 'bot-1', tactics: { formationId: '3-5-2', style: 'balanced' } })).toBe(base);
    expect(reducer(base, { type: 'SET_TACTICS', managerId: 'you', tactics: { formationId: 'nope', style: 'balanced' } })).toBe(base);
  });
});

describe('STEALS_APPLIED — keeps humanSlate in sync with a human steal', () => {
  it('replaces only the stolen slot, projecting the coarse player to detailed', () => {
    const base = battleState();
    const stolen: Player = { id: 'arg-1986-maradona', name: 'Maradona', nation: 'ARG', position: 'MF', rating: 96 };
    const newXi: XI = coarseOf(slate).map((s, i) => (i === 3 ? { position: s.position, player: stolen } : s));
    const next = reducer(base, { type: 'STEALS_APPLIED', xis: { you: newXi } });
    expect(next.humanSlate![3]!.player.id).toBe('arg-1986-maradona');
    expect(next.humanSlate![3]!.position).toBe(F433.slots[3]); // detailed slot position preserved
    expect(next.humanSlate![0]!.player.id).toBe(slate[0].player.id); // untouched slot unchanged
    expect(next.managers[0].xi[3].player.id).toBe('arg-1986-maradona');
  });
  it('leaves humanSlate untouched on the v1 path (no humanSlate/formation)', () => {
    const v1: GameState = {
      ...initialState,
      screen: 'battle',
      managers: [{ id: 'you', name: 'You', isHuman: true, xi: [], alive: true }],
    };
    const next = reducer(v1, { type: 'STEALS_APPLIED', xis: {} });
    expect(next.humanSlate).toBeUndefined();
    expect(next.screen).toBe('battle');
  });
});
