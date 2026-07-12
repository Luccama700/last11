import { FORMATION } from '../engine/rating';
import { DEFAULT_TACTICS, SURVIVORS_PER_ROUND, stealPool, toMatchSide } from '../engine/tournament';
import type { Manager, RoundResult } from '../engine/tournament';
import { simulateMatchTimeline } from '../engine/timeline';
import { movePlaced, playerV2ById } from '../engine/draft';
import { formationById } from '../engine/types';
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
import { COARSE_TO_DETAILED, detailedToCoarse } from '../engine/data/schema';
import type { PlayerV2 } from '../engine/data/schema';
import { accrueStats, type PlayerStats } from './player-stats';

/** Project a detailed v2 slate to the coarse XI the (current) engine reads via
 *  toMatchSide — the same projection App uses at battle entry, kept here so a
 *  between-round re-slot updates what the engine sees. */
function slateToCoarseXi(slate: readonly (XiSlotV2 | null)[]): XI {
  const dense = slate.filter((s): s is XiSlotV2 => s !== null);
  return dense.map((s) => ({
    position: detailedToCoarse(s.position),
    player: {
      id: s.player.id,
      name: s.player.name,
      nation: s.player.nation,
      position: detailedToCoarse(s.player.position),
      rating: s.player.rating,
    },
  }));
}

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
    /** Match set (0..2) this game plays in — the rail shows only the set being
     *  watched (Lucca). Untagged = legacy show-everything behavior. */
    set?: number;
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
  /** The round result being WATCHED but not yet recorded (simV2). Stamped on
   *  ENTER_PLAYBACK; folded into `rounds` (idempotently, by round number) on the
   *  playback→results transition — via PLAYBACK_DONE (finish/skip/skip-all) or the
   *  NEXT_FEATURED overshoot. Makes round-recording a STATE invariant instead of an
   *  obligation on the screen to call onFinishRound at the exact right moment, which
   *  is what let a skipped round silently miss `rounds` (standings stalled). */
  pendingRound?: RoundResult | null;
  /** The winning manager, set at tournament end (both the human-wins and the
   *  fast-forward-after-elimination paths). Powers the EndScreen. */
  champion?: Manager;
  /** Full timeline of the tournament's FINAL match, rebuilt during fast-forward so
   *  an eliminated human can still watch the final (JOB 2). Deterministic — rebuilt
   *  from the final result's stamped seed + morale. Absent on the v1 path. */
  finalTimeline?: MatchTimeline;
  /** Cumulative per-player goals + assists across the whole tournament (incl.
   *  fast-forwarded rounds). Accrued on ROUND_PLAYED + FINISHED from resultsV2.goals.
   *  Powers Golden Boot / Playmaker (topScorers/topAssists). Empty on the v1 path. */
  playerStats?: PlayerStats;
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
  | { type: 'MOVE_PLACED'; from: number; to: number }
  | { type: 'REARRANGE_XI'; managerId: string; xi: (XiSlotV2 | null)[] }
  | { type: 'ENTER_PLAYBACK'; matchday: Matchday; result: RoundResult }
  | { type: 'NEXT_FEATURED' }
  | { type: 'WATCH_MARQUEE'; timeline: MatchTimeline }
  | { type: 'PLAYBACK_DONE' };

/** Fold a finished round into the state: apply cuts, build the steal pool, set the
 *  human's placement if they just fell (or won), accrue player stats, and reveal the
 *  results table. IDEMPOTENT by `result.round` — recording the same round twice (e.g.
 *  ROUND_PLAYED then a PLAYBACK_DONE safety net) is a no-op past the first, so the
 *  standings can never double-count. The single writer for `rounds` on the live path. */
function recordRound(state: GameState, result: RoundResult): GameState {
  const alreadyRecorded = state.rounds.some((r) => r.round === result.round);
  if (alreadyRecorded) {
    return { ...state, battleView: 'results', pendingRound: null };
  }
  const eliminatedIds = new Set(result.eliminatedIds);
  const eliminatedManagers = state.managers.filter((m) => eliminatedIds.has(m.id));
  const managers = state.managers.map((m) =>
    eliminatedIds.has(m.id) ? { ...m, alive: false } : m,
  );
  const human = managers.find((m) => m.isHuman);
  const aliveCount = managers.filter((m) => m.alive).length;
  let humanPlacement = state.humanPlacement;
  if (human && humanPlacement === null) {
    if (!human.alive) {
      humanPlacement = result.table.findIndex((r) => r.managerId === human.id) + 1;
    } else if (aliveCount === 1) {
      humanPlacement = 1;
    }
  }
  return {
    ...state,
    managers,
    rounds: [...state.rounds, result],
    roundIndex: state.roundIndex + 1,
    battleView: 'results',
    pool: stealPool(eliminatedManagers),
    humanPlacement,
    playerStats: accrueStats(state.playerStats ?? {}, [result]),
    pendingRound: null,
  };
}

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

    case 'ROUND_PLAYED':
      // v1 instant-reveal path (simV2 OFF) and the reducer-tests' direct driver.
      return recordRound(state, action.result);

    case 'OPEN_STEAL':
      return { ...state, screen: 'steal' };

    case 'STEALS_APPLIED': {
      const managers = state.managers.map((m) =>
        action.xis[m.id] ? { ...m, xi: action.xis[m.id] } : m,
      );
      // Keep the detailed humanSlate (what the round-intro re-arrange board renders)
      // in sync with a human steal: replace only the slot whose player changed,
      // projecting the stolen coarse player to that slot's detailed position; drafted
      // positions on unchanged slots are preserved. v1 path: no humanSlate ⇒ untouched.
      let humanSlate = state.humanSlate;
      const human = state.managers.find((m) => m.isHuman);
      const newHumanXi = human ? action.xis[human.id] : undefined;
      if (human && newHumanXi && state.humanSlate && state.formation) {
        const formation = state.formation;
        humanSlate = state.humanSlate.map((slot, i) => {
          const coarse = newHumanXi[i]?.player;
          if (!slot || !coarse || slot.player.id === coarse.id) return slot;
          // Recover the stolen player's TRUE detailed record by id — ids are stable
          // across the coarse projection (loader §2), so playerV2ById lifts him back
          // to his real natural position + secondaries. The coarse steal pool only
          // carries GK/DF/MF/FW, and rebuilding from COARSE_TO_DETAILED flattened a
          // stolen winger to ST (FW→ST); dropped into his natural LW/RW slot he then
          // rated at affinity(ST, LW) < 1 — a natural player shown BELOW his base
          // rating (bug A2). Fall back to the coarse projection only for a non-v2 id.
          const detailed = playerV2ById(coarse.id);
          const player: PlayerV2 = detailed ?? {
            id: coarse.id,
            name: coarse.name,
            nation: coarse.nation,
            year: 2026,
            position: COARSE_TO_DETAILED[coarse.position],
            rating: coarse.rating,
          };
          return { position: formation.slots[i], player };
        });
      }
      return { ...state, managers, humanSlate, screen: 'battle', battleView: 'intro', pool: [] };
    }

    case 'FINISHED': {
      // JOB 2: an eliminated human fast-forwards headlessly; keep the run watchable.
      // The per-round resultsV2 are already carried on action.rounds. Rebuild the
      // FINAL match's full timeline here (pure — the final result stamped its seed +
      // the morale both sides carried in), so EndScreen can play it back. Respects
      // the shootout rule via the stamped shootoutEnabled (final round is ≤16 alive).
      const champion = action.managers.find((m) => m.alive);
      const lastRound = action.rounds[action.rounds.length - 1];
      const finalMatch = lastRound?.resultsV2?.[lastRound.resultsV2.length - 1];
      let finalTimeline = state.finalTimeline;
      if (finalMatch && finalMatch.seed != null) {
        const home = action.managers.find((m) => m.id === finalMatch.homeId);
        const away = action.managers.find((m) => m.id === finalMatch.awayId);
        if (home && away) {
          finalTimeline = simulateMatchTimeline(
            toMatchSide(home, DEFAULT_TACTICS, finalMatch.homeMorale),
            toMatchSide(away, DEFAULT_TACTICS, finalMatch.awayMorale),
            finalMatch.seed,
            finalMatch.shootoutEnabled ?? true,
          );
        }
      }
      return {
        ...state,
        managers: action.managers,
        rounds: [...state.rounds, ...action.rounds],
        roundIndex: state.roundIndex + action.rounds.length,
        screen: 'end',
        champion,
        finalTimeline,
        // Accrue the fast-forwarded rounds' goals/assists (live rounds already folded
        // in via ROUND_PLAYED; each round appears in exactly one path → no double count).
        playerStats: accrueStats(state.playerStats ?? {}, action.rounds),
      };
    }

    case 'SHOW_END':
      // Human-wins path: the champion is whoever is still standing.
      return { ...state, screen: 'end', champion: state.managers.find((m) => m.alive) };

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

    case 'SET_TACTICS': {
      // Between-ROUND formation change for the human (DECISIONS: formation only
      // between rounds). Unlike SET_FORMATION this does NOT reset the slate — the
      // caller re-maps the existing XI (autoArrange) and follows with REARRANGE_XI.
      // Style stays in App useState (match-sim's tacticsOf reads it); nothing to do
      // here for it. Only the human's formation lives in reducer state.
      const human = state.managers.find((m) => m.isHuman);
      if (!human || human.id !== action.managerId) return state;
      const formation = formationById(action.tactics.formationId);
      return formation ? { ...state, formation } : state;
    }

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

    case 'MOVE_PLACED': {
      // Mid-draft: move an already-placed player to an OPEN slot (Lucca's "found a
      // better player for a position"). Pure engine helper enforces from-filled /
      // to-open; invalid moves are a no-op. Only touches the draft slate.
      if (!state.humanSlate || !state.formation) return state;
      return {
        ...state,
        humanSlate: movePlaced(state.humanSlate, state.formation, action.from, action.to),
      };
    }

    case 'REARRANGE_XI': {
      // Between-round re-slot (match-sim mounts BetweenMatchBoard on the round intro).
      // `xi` is the re-slotted DETAILED slate. Persist it as the human's lineup AND
      // project it to the coarse Manager.xi the engine reads via toMatchSide, so the
      // swap actually changes the next round's resolution. Guarded on v2 shape, so
      // the v1 flags-OFF path (no humanSlate) never hits this.
      const human = state.managers.find((m) => m.isHuman);
      const isHuman = human?.id === action.managerId;
      const managers = state.managers.map((m) =>
        m.id === action.managerId ? { ...m, xi: slateToCoarseXi(action.xi) } : m,
      );
      return { ...state, managers, humanSlate: isHuman ? action.xi : state.humanSlate };
    }

    case 'ENTER_PLAYBACK':
      // Carry the round result into state so that WHATEVER ends playback records it.
      return {
        ...state,
        screen: 'battle',
        battleView: 'playback',
        matchday: action.matchday,
        pendingRound: action.result,
      };

    case 'NEXT_FEATURED': {
      if (!state.matchday) return state;
      const next = state.matchday.featuredIndex + 1;
      // Overshooting the last featured match ends the round — record it, don't just
      // flip the view (that silently dropped the round → standings never updated).
      if (next >= state.matchday.featured.length) {
        return state.pendingRound
          ? recordRound(state, state.pendingRound)
          : { ...state, battleView: 'results' };
      }
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
      // Playback finished OR was skipped (skip / skip-all). Record the watched round
      // (idempotent) so its result reaches `rounds` and the standings update — the
      // fix for "standings sometimes doesn't update after skipping a match".
      return state.pendingRound
        ? recordRound(state, state.pendingRound)
        : { ...state, battleView: 'results' };
  }
}

/** True once all SURVIVORS_PER_ROUND rounds are played (one champion left). */
export function tournamentOver(state: GameState): boolean {
  return state.roundIndex >= SURVIVORS_PER_ROUND.length || aliveOf(state).length <= 1;
}
