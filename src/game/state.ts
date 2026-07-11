import { FORMATION } from '../engine/rating';
import { SURVIVORS_PER_ROUND, stealPool } from '../engine/tournament';
import type { Manager, RoundResult } from '../engine/tournament';
import type { Player, XI } from '../engine/types';
import type {
  DraftMode,
  Formation,
  MatchTimeline,
  RolledTeam,
  Tactics,
  Team,
  XiSlotV2,
} from '../engine/types';
import type { PlayerV2 } from '../engine/data/schema';

// v2 adds the 'setup' phase (formation/style before drafting) and the 'playback'
// battle view (on-screen match sim). ADDITIVE — the v1 flow never uses them, so all
// 54 tests stay green; the draft (bug-hunt) and sim (codex-ui) workers drive them
// behind their feature flags.
export type Screen = 'home' | 'setup' | 'draft' | 'battle' | 'steal' | 'end';
export type BattleView = 'intro' | 'playback' | 'results';

/** What a round of on-screen match playback shows (CONTRACT §6 / TICKSPEC). Owned
 *  by the sim workstream; the shape is frozen here so App can build it and the
 *  reducer can carry it. */
export interface Matchday {
  /** Full timelines for the human's watched matches (marquee pushed on tap). */
  featured: MatchTimeline[];
  featuredIndex: number;
  /** Lightweight goal stamps for every other match this round (the scoreboard rail). */
  rail: {
    matchId: string;
    homeId: string;
    awayId: string;
    goals: { minute: number; team: Team }[];
  }[];
}

export interface GameState {
  screen: Screen;
  seed: number;
  managers: Manager[];
  /** 0..10 while drafting; 11 = draft complete. (v1 slot-walk draft.) */
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

  // ---- v2 skeleton fields (optional; unused until the relevant flag is ON) ----
  /** Formation chosen in 'setup' (v2 free-pick draft). */
  formation?: Formation;
  /** Classic (ratings shown) vs Memory (ratings hidden). */
  mode?: DraftMode;
  /** Remaining re-spin tokens (v2 draft). */
  respinTokens?: number;
  /** The rolled (nation, year) awaiting a pick (v2 draft; replaces spunNation). */
  spunRoll?: RolledTeam | null;
  /** Fixed-length draft slate; null = open slot. Dense (no nulls) at kickoff. */
  humanSlate?: (XiSlotV2 | null)[];
  /** On-screen playback state for the current round (v2 sim). */
  matchday?: Matchday | null;
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
  // ---- v1 (current game; flags OFF) ----
  | { type: 'START'; seed: number; managers: Manager[] }
  | { type: 'SPIN'; nation: string }
  | { type: 'PICK'; player: Player }
  | { type: 'ENTER_BATTLE' }
  | { type: 'ROUND_PLAYED'; result: RoundResult }
  | { type: 'OPEN_STEAL' }
  | { type: 'STEALS_APPLIED'; xis: Record<string, XI> }
  | { type: 'FINISHED'; managers: Manager[]; rounds: RoundResult[] }
  | { type: 'SHOW_END' }
  | { type: 'RESET' }
  // ---- v2 skeleton (CONTRACT §6). Draft (bug-hunt) owns SET_*/RESPIN/ROLL/PLACE/
  //      REARRANGE_XI; sim (codex-ui) owns ENTER_PLAYBACK/NEXT_FEATURED/WATCH_MARQUEE/
  //      PLAYBACK_DONE. The v2 free-pick draft uses ROLL/PLACE (distinct from the legacy
  //      SPIN/PICK, which stay live so all 54 tests pass). Stub handlers below. ----
  | { type: 'SET_FORMATION'; formation: Formation }
  | { type: 'SET_MODE'; mode: DraftMode }
  | { type: 'SET_TACTICS'; managerId: string; tactics: Tactics }
  | { type: 'RESPIN' }
  | { type: 'ROLL'; roll: RolledTeam }
  | { type: 'PLACE'; player: PlayerV2; slotIndex: number }
  | { type: 'REARRANGE_XI'; managerId: string; xi: (XiSlotV2 | null)[] }
  | { type: 'ENTER_PLAYBACK'; matchday: Matchday }
  | { type: 'NEXT_FEATURED' }
  | { type: 'WATCH_MARQUEE'; timeline: MatchTimeline }
  | { type: 'PLAYBACK_DONE' };

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

    // ---- v2 skeleton stubs (CONTRACT §6). Kept minimal + side-effect-free; the
    //      draft/sim workers flesh these out behind their flags. None of these
    //      actions is dispatched on the v1 path, so the 54 tests are unaffected. ----

    case 'SET_FORMATION':
      // Choosing a formation (in setup) also arms the v2 draft: a fresh empty
      // slate sized to it and the starting re-spin tokens. Formation is locked
      // once drafting starts (Tier A), so this only fires from PreDraftSetup.
      return {
        ...state,
        formation: action.formation,
        humanSlate: new Array(action.formation.slots.length).fill(null),
        respinTokens: state.respinTokens ?? 3,
        spunRoll: null,
      };

    case 'SET_MODE':
      return { ...state, mode: action.mode };

    case 'SET_TACTICS':
      // Needs ManagerV2 (tactics on the manager) — wired when draftV2/engineV2 land.
      return state;

    case 'RESPIN':
      return { ...state, respinTokens: Math.max(0, (state.respinTokens ?? 0) - 1), spunRoll: null };

    case 'ROLL':
      return { ...state, spunRoll: action.roll };

    case 'PLACE': {
      // Fill the drafted slot on the slate; slot position comes from the formation.
      if (!state.humanSlate || !state.formation) return { ...state, spunRoll: null };
      const slate = [...state.humanSlate];
      slate[action.slotIndex] = { position: state.formation.slots[action.slotIndex], player: action.player };
      return { ...state, humanSlate: slate, spunRoll: null };
    }

    case 'REARRANGE_XI':
      // Between-match re-slot — needs ManagerV2; wired when draftV2 lands.
      return state;

    case 'ENTER_PLAYBACK':
      return { ...state, screen: 'battle', battleView: 'playback', matchday: action.matchday };

    case 'NEXT_FEATURED': {
      if (!state.matchday) return state;
      const next = state.matchday.featuredIndex + 1;
      if (next >= state.matchday.featured.length) return { ...state, battleView: 'results' };
      return { ...state, matchday: { ...state.matchday, featuredIndex: next } };
    }

    case 'WATCH_MARQUEE': {
      if (!state.matchday) return state;
      return {
        ...state,
        matchday: {
          ...state.matchday,
          featured: [...state.matchday.featured, action.timeline],
          featuredIndex: state.matchday.featured.length,
        },
      };
    }

    case 'PLAYBACK_DONE':
      return { ...state, battleView: 'results' };
  }
}

/** True once all SURVIVORS_PER_ROUND rounds are played (one champion left). */
export function tournamentOver(state: GameState): boolean {
  return state.roundIndex >= SURVIVORS_PER_ROUND.length || aliveOf(state).length <= 1;
}
