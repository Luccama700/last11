import { describe, expect, it } from 'vitest';
import { initialState, reducer, type GameState } from './state';
import { effectiveRatingV2, playerV2ById, swapSlots } from '../engine/draft';
import { affinity } from '../engine/affinity';
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

describe('MOVE_PLACED — mid-draft move to an open slot', () => {
  function draftState(): GameState {
    const slate: (XiSlotV2 | null)[] = new Array(11).fill(null);
    slate[9] = { position: F433.slots[9], player: bra[0] };
    return { ...initialState, screen: 'draft', managers: [], formation: F433, humanSlate: slate };
  }
  it('moves the placed player and clears the source slot', () => {
    const next = reducer(draftState(), { type: 'MOVE_PLACED', from: 9, to: 2 });
    expect(next.humanSlate![9]).toBeNull();
    expect(next.humanSlate![2]!.player.id).toBe(bra[0].id);
    expect(next.humanSlate![2]!.position).toBe(F433.slots[2]);
  });
  it('no-ops on the v1 path (no humanSlate)', () => {
    const v1: GameState = { ...initialState, screen: 'draft' };
    expect(reducer(v1, { type: 'MOVE_PLACED', from: 0, to: 1 })).toBe(v1);
  });
});

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

  // Bug A2 regression: the coarse steal pool carries only GK/DF/MF/FW, so rebuilding
  // the stolen player from COARSE_TO_DETAILED flattened a winger (FW→ST). Dropped into
  // his NATURAL RW slot he was then rated at affinity(ST, RW) < 1 — a natural player
  // shown BELOW his base rating. The fix recovers his TRUE detailed record by id.
  it('recovers a stolen winger TRUE detailed position so his natural slot is zero-loss', () => {
    const raphinha = playerV2ById('bra-2026-raphinha')!; // RW, base 90
    expect(raphinha.position).toBe('RW');
    const rwSlot = F433.slots.indexOf('RW'); // 4-3-3 index 8
    const base = battleState();
    // Coarse steal pool player: only the coarse FW label survives the projection.
    const stolen: Player = {
      id: raphinha.id,
      name: raphinha.name,
      nation: raphinha.nation,
      position: detailedToCoarse(raphinha.position), // 'FW'
      rating: raphinha.rating,
    };
    expect(stolen.position).toBe('FW');
    const newXi: XI = coarseOf(slate).map((s, i) => (i === rwSlot ? { position: s.position, player: stolen } : s));
    const next = reducer(base, { type: 'STEALS_APPLIED', xis: { you: newXi } });

    const placed = next.humanSlate![rwSlot]!;
    expect(placed.player.id).toBe('bra-2026-raphinha');
    expect(placed.position).toBe('RW'); // the slot's formation position
    expect(placed.player.position).toBe('RW'); // TRUE natural recovered, not the flattened 'ST'
    // Natural in his own slot ⇒ full base rating, zero affinity loss (the visible bug).
    expect(effectiveRatingV2(placed.player, placed.position, affinity)).toBeCloseTo(90, 6);
  });

  // Suspect (2): the StealScreen renders human.xi[i] while gainAt reads humanSlate[i];
  // they MUST stay index-aligned through a steal AND a between-round move (REARRANGE_XI).
  it('keeps humanSlate index i aligned with coarse xi index i after a steal + a move', () => {
    const raphinha = playerV2ById('bra-2026-raphinha')!;
    const rwSlot = F433.slots.indexOf('RW');
    const stolen: Player = {
      id: raphinha.id,
      name: raphinha.name,
      nation: raphinha.nation,
      position: detailedToCoarse(raphinha.position),
      rating: raphinha.rating,
    };
    const afterSteal = reducer(battleState(), {
      type: 'STEALS_APPLIED',
      xis: { you: coarseOf(slate).map((s, i) => (i === rwSlot ? { position: s.position, player: stolen } : s)) },
    });
    // A between-round move: swap two fielded slots via the tested primitive.
    const dense = afterSteal.humanSlate!.filter((s): s is XiSlotV2 => s !== null);
    const afterMove = reducer(afterSteal, { type: 'REARRANGE_XI', managerId: 'you', xi: swapSlots(dense, 8, 10) });

    const hSlate = afterMove.humanSlate!;
    const hXi = afterMove.managers.find((m) => m.id === 'you')!.xi;
    expect(hXi).toHaveLength(hSlate.length);
    hSlate.forEach((s, i) => expect(s!.player.id).toBe(hXi[i].player.id));
    // And the stolen winger, now moved to the LW slot (index 10), is rated on his true
    // detailed position — never the flattened coarse representative.
    const moved = hSlate.findIndex((s) => s!.player.id === 'bra-2026-raphinha');
    expect(hXi[moved].player.id).toBe('bra-2026-raphinha');
  });
});
