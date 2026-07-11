// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import StealScreen from './StealScreen';
import { squadByRef } from '../engine/data/loader';
import { FORMATIONS } from '../engine/types';
import type { XiSlotV2 } from '../engine/types';
import { detailedToCoarse } from '../engine/data/schema';
import type { Manager } from '../engine/tournament';
import type { GameState } from '../game/state';

afterEach(cleanup);

// Real dataset players (not hand-built stubs) so `playerV2ById` resolves and the
// DETAILED affinity path renders (not the coarse teamStrength fallback) — that's the
// path where bug A2 (stale `.position` after MOVE_PLACED, draft-page's fix) would show.
const bra2002 = squadByRef('BRA', 2002).players;
const byName = (name: string) => bra2002.find((p) => p.name === name)!;
// Gabriel Magalhães (BRA 2026): natural CB, rating 89 — deliberately the SAME rating
// as Lúcio below, so a natural-CB-for-natural-CB swap is a genuine equal-rating case.
const gabriel = squadByRef('BRA', 2026).players.find((p) => p.id === 'bra-2026-gabriel')!;

const F433 = FORMATIONS.find((f) => f.id === '4-3-3')!;

// One real BRA2002 player per F433 slot, EVERY ONE at his natural detailed position.
const xiPlayers = [
  byName('Marcos'), // GK  88
  byName('Cafu'), // RB  91
  byName('Lúcio'), // CB  89 — natural-swap target, rating matches gabriel exactly
  byName('Roque Júnior'), // CB  84
  byName('Roberto Carlos'), // LB  91
  byName('Gilberto Silva'), // CDM 86
  byName('Ricardinho'), // CM  81
  byName('Kléberson'), // CM  83
  byName('Edílson'), // RW  82
  byName('Ronaldo'), // ST  96
  byName('Denílson'), // LW  83 — off-position swap target for gabriel (a CB)
];
xiPlayers.forEach((p, i) => {
  if (p.position !== F433.slots[i]) {
    throw new Error(`fixture bug: ${p.name} is ${p.position}, F433 slot ${i} wants ${F433.slots[i]}`);
  }
});

const humanSlate: XiSlotV2[] = F433.slots.map((slotPos, i) => ({ position: slotPos, player: xiPlayers[i] }));
const coarseXi = humanSlate.map((s) => ({
  position: detailedToCoarse(s.position),
  player: {
    id: s.player.id,
    name: s.player.name,
    nation: s.player.nation,
    position: detailedToCoarse(s.player.position),
    rating: s.player.rating,
  },
}));

const human: Manager = { id: 'human', name: 'You', isHuman: true, xi: coarseXi, alive: true };

function buildState(): GameState {
  return {
    screen: 'steal',
    seed: 1,
    managers: [human],
    draftSlotIndex: 11,
    spunNation: null,
    roundIndex: 1,
    rounds: [],
    battleView: 'intro',
    pool: [
      {
        id: gabriel.id,
        name: gabriel.name,
        nation: gabriel.nation,
        position: detailedToCoarse(gabriel.position),
        rating: gabriel.rating,
      },
    ],
    humanPlacement: null,
    formation: F433,
    humanSlate,
  };
}

function selectGabriel() {
  const card = screen.getAllByTestId('loot-card').find((el) => el.textContent?.includes(gabriel.name));
  fireEvent.click(card!);
}

describe('StealScreen — display layer (bug A2 regression: base rating vs affinity math)', () => {
  it('(a) every loot card and XI row shows the BASE rating, not an affinity-adjusted one', () => {
    render(<StealScreen state={buildState()} onDone={() => {}} />);
    const lootCard = screen.getAllByTestId('loot-card').find((el) => el.textContent?.includes(gabriel.name));
    expect(lootCard!.textContent).toContain(String(gabriel.rating));

    const xiRows = screen.getAllByTestId('xi-slot');
    expect(xiRows).toHaveLength(11);
    xiPlayers.forEach((p, i) => {
      expect(xiRows[i].textContent).toContain(p.name);
      expect(xiRows[i].textContent).toContain(String(p.rating));
    });
  });

  it('(b) natural-for-natural swap of EQUAL ratings shows a 0.0 gain chip (no false negative)', () => {
    render(<StealScreen state={buildState()} onDone={() => {}} />);
    selectGabriel();
    const xiRows = screen.getAllByTestId('xi-slot');
    // index 2 = Lúcio's CB slot: natural CB (89) in, natural CB (89) out -> 89-89 = 0.0
    expect(xiRows[2].textContent).toContain('0.0');
  });

  it('(b2) natural-for-natural swap of UNEQUAL ratings shows the exact base-minus-base delta', () => {
    render(<StealScreen state={buildState()} onDone={() => {}} />);
    selectGabriel();
    const xiRows = screen.getAllByTestId('xi-slot');
    // index 3 = Roque Júnior's CB slot: natural CB (89) in, natural CB (84) out -> +5.0
    expect(xiRows[3].textContent).toContain('+5.0');
  });

  it('(c) an off-position placement shows the affinity-REDUCED value, not the base delta', () => {
    render(<StealScreen state={buildState()} onDone={() => {}} />);
    selectGabriel();
    const xiRows = screen.getAllByTestId('xi-slot');
    // index 10 = Denílson's LW slot: gabriel is a CB (affinity(CB,LW) = .40), so his
    // effective rating there is 89*.40 = 35.6, vs Denílson's natural 83 -> -47.4.
    // A stale/wrong .position bug would instead show the naive base delta (+6.0).
    expect(xiRows[10].textContent).toContain('-47.4');
    expect(xiRows[10].textContent).not.toContain('+6.0');
  });
});
