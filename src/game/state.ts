import { FORMATION } from '../engine/rating';
import { SURVIVORS_PER_ROUND, stealPool } from '../engine/tournament';
import type { Manager, RoundResult } from '../engine/tournament';
import type { Player, XI } from '../engine/types';

export type Screen = 'home' | 'draft' | 'battle' | 'steal' | 'end';
export type BattleView = 'intro' | 'results';

export interface GameState {
  screen: Screen;
  seed: number;
  managers: Manager[];
  /** 0..10 while drafting; 11 = draft complete. */
  draftSlotIndex: number;
  spunNation: string | null;
  /** Rounds completed so far. */
  roundIndex: number;
  rounds: RoundResult[];
  battleView: BattleView;
  /** Steal pool from the most recent eliminations. */
  pool: Player[];
  /** null while alive; 1 = champion. */
  humanPlacement: number | null;
}

export const initialState: GameState = {
  screen: 'home',
  seed: 0,
  managers: [],
  draftSlotIndex: 0,
  spunNation: null,
  roundIndex: 0,
  rounds: [],
  battleView: 'intro',
  pool: [],
  humanPlacement: null,
};

export type Action =
  | { type: 'START'; seed: number; managers: Manager[] }
  | { type: 'SPIN'; nation: string }
  | { type: 'PICK'; player: Player }
  | { type: 'ENTER_BATTLE' }
  | { type: 'ROUND_PLAYED'; result: RoundResult }
  | { type: 'OPEN_STEAL' }
  | { type: 'STEALS_APPLIED'; xis: Record<string, XI> }
  | { type: 'FINISHED'; managers: Manager[]; rounds: RoundResult[] }
  | { type: 'SHOW_END' }
  | { type: 'RESET' };

export function humanOf(state: GameState): Manager | undefined {
  return state.managers.find((m) => m.isHuman);
}

export function aliveOf(state: GameState): Manager[] {
  return state.managers.filter((m) => m.alive);
}

export function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'START':
      return {
        ...initialState,
        screen: 'draft',
        seed: action.seed,
        managers: action.managers,
      };

    case 'SPIN':
      return { ...state, spunNation: action.nation };

    case 'PICK': {
      const slot = FORMATION[state.draftSlotIndex];
      const managers = state.managers.map((m) =>
        m.isHuman ? { ...m, xi: [...m.xi, { position: slot, player: action.player }] } : m,
      );
      return {
        ...state,
        managers,
        spunNation: null,
        draftSlotIndex: state.draftSlotIndex + 1,
      };
    }

    case 'ENTER_BATTLE':
      return { ...state, screen: 'battle', battleView: 'intro' };

    case 'ROUND_PLAYED': {
      const eliminatedIds = new Set(action.result.eliminatedIds);
      const eliminatedManagers = state.managers.filter((m) => eliminatedIds.has(m.id));
      const managers = state.managers.map((m) =>
        eliminatedIds.has(m.id) ? { ...m, alive: false } : m,
      );
      const human = managers.find((m) => m.isHuman);
      const aliveCount = managers.filter((m) => m.alive).length;
      let humanPlacement = state.humanPlacement;
      if (human && humanPlacement === null) {
        if (!human.alive) {
          humanPlacement =
            action.result.table.findIndex((r) => r.managerId === human.id) + 1;
        } else if (aliveCount === 1) {
          humanPlacement = 1;
        }
      }
      return {
        ...state,
        managers,
        rounds: [...state.rounds, action.result],
        roundIndex: state.roundIndex + 1,
        battleView: 'results',
        pool: stealPool(eliminatedManagers),
        humanPlacement,
      };
    }

    case 'OPEN_STEAL':
      return { ...state, screen: 'steal' };

    case 'STEALS_APPLIED': {
      const managers = state.managers.map((m) =>
        action.xis[m.id] ? { ...m, xi: action.xis[m.id] } : m,
      );
      return { ...state, managers, screen: 'battle', battleView: 'intro', pool: [] };
    }

    case 'FINISHED':
      return {
        ...state,
        managers: action.managers,
        rounds: [...state.rounds, ...action.rounds],
        roundIndex: state.roundIndex + action.rounds.length,
        screen: 'end',
      };

    case 'SHOW_END':
      return { ...state, screen: 'end' };

    case 'RESET':
      return initialState;
  }
}

/** True once all SURVIVORS_PER_ROUND rounds are played (one champion left). */
export function tournamentOver(state: GameState): boolean {
  return state.roundIndex >= SURVIVORS_PER_ROUND.length || aliveOf(state).length <= 1;
}
