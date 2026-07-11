import { useReducer, useRef, useState } from 'react';
import {
  draftBotSlateV2,
  pickBotFormation,
  pickBotStyle,
  spinNation,
  spinSquadV2,
  swapSlots,
} from './engine/draft';
import { affinity } from './engine/affinity';
import { detailedToCoarse } from './engine/data/schema';
import { createRng, type Rng } from './engine/rng';
import {
  BOT_NAMES,
  DEFAULT_TACTICS,
  LOBBY_SIZE,
  SURVIVORS_PER_ROUND,
  applySteal,
  createLobby,
  evaluateSteal,
  playRound,
  stealPool,
  toMatchSide,
  type Manager,
  type PlayRoundEngine,
  type RoundResult,
} from './engine/tournament';
import { simulateMatchTimeline } from './engine/timeline';
import type { MoraleMap } from './engine/morale';
import type { Player, XI } from './engine/types';
import type {
  DraftMode,
  Formation,
  PlayingStyle,
  RolledTeam,
  Tactics,
  XiSlotV2,
} from './engine/types';
import type { PlayerV2 } from './engine/data/schema';
import { FEATURES } from './game/features';
import { assignGoals, fabricateTimeline } from './game/fabricate-timeline';
import { aliveOf, humanOf, initialState, reducer, tournamentOver, type Matchday } from './game/state';
import BattleScreen from './screens/BattleScreen';
import DraftScreen from './screens/DraftScreen';
import DraftScreenV2 from './screens/draft/DraftScreenV2';
import PreDraftSetup from './screens/setup/PreDraftSetup';
import EndScreen from './screens/EndScreen';
import HomeScreen from './screens/HomeScreen';
import StealScreen from './screens/StealScreen';

/** Project a drafted v2 slate down to the coarse XI the current (v1) battle engine
 *  consumes — the Tier-A seam that lets the new free-pick draft feed the shipped BR
 *  until the tactics-aware engine v2 lands. */
function v2SlateToCoarseXi(slate: readonly XiSlotV2[]): XI {
  return slate.map((s) => ({
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

/** v2 lobby: human drafts via the UI; 31 bots draft under the SAME free-pick rules
 *  with varied seeded formations/styles, projected to coarse for the current engine. */
function createV2Lobby(
  rng: Rng,
  humanName: string,
): { managers: Manager[]; botTactics: Record<string, Tactics> } {
  const names = rng.shuffle(BOT_NAMES);
  const managers: Manager[] = [
    { id: 'you', name: humanName, isHuman: true, xi: [], alive: true },
  ];
  const botTactics: Record<string, Tactics> = {};
  for (let i = 0; i < LOBBY_SIZE - 1; i++) {
    const formation = pickBotFormation(rng);
    const botStyle = pickBotStyle(rng); // same rng draw order as before (determinism)
    const slate = draftBotSlateV2(rng, formation, affinity);
    const id = `bot-${i + 1}`;
    botTactics[id] = { formationId: formation.id, style: botStyle };
    managers.push({
      id,
      name: names[i],
      isHuman: false,
      xi: v2SlateToCoarseXi(slate),
      alive: true,
    });
  }
  return { managers, botTactics };
}

export default function App(props: { animate?: boolean }) {
  const animate = props.animate ?? true;
  const [state, dispatch] = useReducer(reducer, initialState);
  const rngRef = useRef<Rng | null>(null);
  const pendingResultRef = useRef<RoundResult | null>(null);
  const [style, setStyle] = useState<PlayingStyle>('balanced');
  // engineV2 plumbing: bot tactics fixed at lobby creation; match counter + morale
  // threaded round-to-round via RoundResult.engineNext (refs, never in the reducer).
  const botTacticsRef = useRef<Record<string, Tactics>>({});
  const engineCtxRef = useRef<{ matchIndex: number; moraleByManager: Record<string, MoraleMap> }>(
    { matchIndex: 0, moraleByManager: {} },
  );

  function handleStart() {
    const seed = (Math.random() * 0x7fffffff) | 0;
    const rng = createRng(seed);
    rngRef.current = rng;
    let managers: Manager[];
    if (FEATURES.draftV2) {
      const lobby = createV2Lobby(rng, 'You');
      managers = lobby.managers;
      botTacticsRef.current = lobby.botTactics;
    } else {
      managers = createLobby(rng, 'You');
      botTacticsRef.current = {};
    }
    engineCtxRef.current = { matchIndex: 0, moraleByManager: {} };
    dispatch({ type: 'START', seed, managers });
  }

  /** The tactics a manager takes into a match — human's live formation/style choice,
   *  bots' fixed draft-time assignment. Same fn feeds playRound AND the watched-
   *  timeline rebuild, so table score === played-out score. */
  function tacticsOf(m: Manager): Tactics {
    if (m.isHuman) return { formationId: state.formation?.id ?? DEFAULT_TACTICS.formationId, style };
    return botTacticsRef.current[m.id] ?? DEFAULT_TACTICS;
  }

  function engineCtx(): PlayRoundEngine | undefined {
    if (!FEATURES.engineV2) return undefined;
    return {
      tournamentSeed: state.seed,
      matchIndex: engineCtxRef.current.matchIndex,
      moraleByManager: engineCtxRef.current.moraleByManager,
      tacticsOf,
    };
  }

  // ---- v1 draft (flags OFF) ----
  function handleSpin() {
    dispatch({ type: 'SPIN', nation: spinNation(rngRef.current!) });
  }
  function handlePick(player: Player) {
    dispatch({ type: 'PICK', player });
  }

  // ---- v2 free-pick draft (draftV2 ON) ----
  function handleSetup(formation: Formation, mode: DraftMode, chosenStyle: PlayingStyle) {
    setStyle(chosenStyle);
    dispatch({ type: 'SET_FORMATION', formation });
    dispatch({ type: 'SET_MODE', mode });
  }
  function handleSpinV2() {
    dispatch({ type: 'ROLL', roll: spinSquadV2(rngRef.current!) as RolledTeam });
  }
  function handleRespinV2() {
    dispatch({ type: 'RESPIN' });
    dispatch({ type: 'ROLL', roll: spinSquadV2(rngRef.current!) as RolledTeam });
  }
  function handlePlaceV2(player: PlayerV2, slotIndex: number) {
    dispatch({ type: 'PLACE', player, slotIndex });
  }
  function handleEnterBattleV2() {
    const human = humanOf(state)!;
    const slate = (state.humanSlate ?? []).filter((s): s is XiSlotV2 => s !== null);
    // Reuse STEALS_APPLIED to merge the drafted human XI in and enter the battle.
    dispatch({ type: 'STEALS_APPLIED', xis: { [human.id]: v2SlateToCoarseXi(slate) } });
  }

  function handleEnterBattle() {
    dispatch({ type: 'ENTER_BATTLE' });
  }

  // ---- round-boundary lineup board (draftV2): re-slot the human's fielded XI ----
  // Swaps two fielded players (positions stay put) via the tested `swapSlots` primitive;
  // draft-page's REARRANGE_XI persists it to humanSlate + the coarse manager xi so the
  // next round's playRound sees the change. Style change goes through setStyle (tacticsOf).
  function handleBoardSwap(a: number, b: number) {
    const human = humanOf(state);
    const dense = (state.humanSlate ?? []).filter((s): s is XiSlotV2 => s !== null);
    if (!human || dense.length === 0) return;
    dispatch({ type: 'REARRANGE_XI', managerId: human.id, xi: swapSlots(dense, a, b) });
  }

  // ---- battle playback (simV2 ON) ----
  // Tier-A bridge: timelines are FABRICATED from the v1 scoreline so playback is
  // demoable on the shipped engine. SWAP SEAM: once the v2 tournament drives rounds
  // (resolveMatchOutcome + per-match seeds + v2 sides), replace `fabricateTimeline`
  // with `simulateMatchTimeline(homeSide, awaySide, matchSeed)` — its finalScore/
  // shootout.winner already agree with the engine result (game-engine verified), so
  // the played-out score will match the table exactly. Same `MatchTimeline` shape ⇒
  // MatchPlaybackScreen/projectMatch need no change.
  function buildMatchday(result: RoundResult): Matchday {
    const human = humanOf(state)!;
    const nameOf = (id: string) => state.managers.find((m) => m.id === id)?.name ?? id;
    const round = state.roundIndex + 1;
    const isMine = (m: { homeId: string; awayId: string }) =>
      m.homeId === human.id || m.awayId === human.id;

    // engineV2: rebuild the REAL timeline for watched matches from the stamped
    // (seed, morale) — same sides, same seed ⇒ byte-identical outcome to the table.
    // Rail goal minutes come straight off the engine's goal events.
    if (FEATURES.engineV2 && result.resultsV2) {
      const byId = new Map(state.managers.map((m) => [m.id, m]));
      const featured = result.resultsV2.filter(isMine).map((r, i) => {
        const home = byId.get(r.homeId)!;
        const away = byId.get(r.awayId)!;
        return simulateMatchTimeline(
          toMatchSide(home, tacticsOf(home), r.homeMorale),
          toMatchSide(away, tacticsOf(away), r.awayMorale),
          r.seed!,
          r.shootoutEnabled ?? true,
          `r${round}-f${i}`,
        );
      });
      const rail = result.resultsV2
        .filter((r) => !isMine(r))
        .map((r, i) => ({
          matchId: `r${round}-o${i}`,
          homeId: r.homeId,
          awayId: r.awayId,
          goals: r.goals.map((g) => ({ minute: g.minute, team: g.team })),
        }));
      return { featured, featuredIndex: 0, rail };
    }

    const featured = result.matches.filter(isMine).map((m, i) =>
      fabricateTimeline(
        { homeId: m.homeId, awayId: m.awayId, homeGoals: m.homeGoals, awayGoals: m.awayGoals },
        { round, matchIndex: i, homeName: nameOf(m.homeId), awayName: nameOf(m.awayId), homeFormationId: '4-3-3', awayFormationId: '4-3-3' },
      ),
    );
    const rail = result.matches
      .filter((m) => !isMine(m))
      .map((m, i) => ({
        matchId: `r${round}-o${i}`,
        homeId: m.homeId,
        awayId: m.awayId,
        goals: assignGoals(
          { homeId: m.homeId, awayId: m.awayId, homeGoals: m.homeGoals, awayGoals: m.awayGoals },
          { round, matchIndex: 100 + i },
        ),
      }));
    return { featured, featuredIndex: 0, rail };
  }

  function handlePlayRound() {
    const result = playRound(
      aliveOf(state),
      SURVIVORS_PER_ROUND[state.roundIndex],
      state.roundIndex + 1,
      rngRef.current!,
      engineCtx(),
    );
    if (result.engineNext) engineCtxRef.current = result.engineNext;
    // simV2 ON ⇒ watch your matches play out, THEN record + reveal the table. The
    // playback screen honours `animate=false` by finishing synchronously (headless
    // instant path), so tests still resolve to the same table. Flag OFF keeps the
    // shipped instant reveal untouched (all default-flag tests unaffected).
    if (FEATURES.simV2) {
      pendingResultRef.current = result;
      dispatch({ type: 'ENTER_PLAYBACK', matchday: buildMatchday(result) });
    } else {
      dispatch({ type: 'ROUND_PLAYED', result });
    }
  }

  function handleNextFeatured() {
    dispatch({ type: 'NEXT_FEATURED' });
  }

  /** Playback of your matches finished (or was skipped): record the round, reveal the table. */
  function handleFinishRound() {
    const result = pendingResultRef.current;
    pendingResultRef.current = null;
    if (result) dispatch({ type: 'ROUND_PLAYED', result });
  }

  /** After viewing round results: end, steal window, or next round. */
  function handleContinue() {
    const human = humanOf(state)!;
    if (tournamentOver(state)) {
      dispatch({ type: 'SHOW_END' });
    } else if (human.alive && state.pool.length > 0) {
      dispatch({ type: 'OPEN_STEAL' });
    } else if (human.alive) {
      dispatch({ type: 'STEALS_APPLIED', xis: {} });
    } else {
      handleFastForward();
    }
  }

  /** Human confirmed a steal (or skipped with null); bots then take their turn. */
  function handleStealDone(choice: { slotIndex: number; player: Player } | null) {
    const xis: Record<string, XI> = {};
    const human = humanOf(state)!;
    if (choice) xis[human.id] = applySteal(human.xi, choice.slotIndex, choice.player);
    for (const m of state.managers) {
      if (m.alive && !m.isHuman) {
        const steal = evaluateSteal(m.xi, state.pool);
        if (steal) xis[m.id] = applySteal(m.xi, steal.slotIndex, steal.player);
      }
    }
    dispatch({ type: 'STEALS_APPLIED', xis });
  }

  /** Human is out: silently resolve the rest of the tournament. */
  function handleFastForward() {
    const rng = rngRef.current!;
    const managers = state.managers.map((m) => ({ ...m }));
    const newRounds: RoundResult[] = [];
    let roundIndex = state.roundIndex;
    let alive = managers.filter((m) => m.alive);

    // pending steal window from the round just shown
    if (state.pool.length > 0 && alive.length > 1) {
      for (const m of alive) {
        if (m.isHuman) continue;
        const steal = evaluateSteal(m.xi, state.pool);
        if (steal) m.xi = applySteal(m.xi, steal.slotIndex, steal.player);
      }
    }

    while (alive.length > 1 && roundIndex < SURVIVORS_PER_ROUND.length) {
      const result = playRound(alive, SURVIVORS_PER_ROUND[roundIndex], roundIndex + 1, rng, engineCtx());
      if (result.engineNext) engineCtxRef.current = result.engineNext;
      newRounds.push(result);
      const eliminatedIds = new Set(result.eliminatedIds);
      const eliminated = alive.filter((m) => eliminatedIds.has(m.id));
      for (const m of eliminated) m.alive = false;
      alive = alive.filter((m) => m.alive);
      roundIndex++;
      if (alive.length > 1) {
        const pool = stealPool(eliminated);
        for (const m of alive) {
          const steal = evaluateSteal(m.xi, pool);
          if (steal) m.xi = applySteal(m.xi, steal.slotIndex, steal.player);
        }
      }
    }

    dispatch({ type: 'FINISHED', managers, rounds: newRounds });
  }

  function handleReset() {
    rngRef.current = null;
    setStyle('balanced');
    dispatch({ type: 'RESET' });
  }

  switch (state.screen) {
    case 'home':
      return <HomeScreen onStart={handleStart} />;
    case 'setup':
    case 'draft':
      if (FEATURES.draftV2) {
        if (!state.humanSlate || !state.formation) {
          return <PreDraftSetup onStart={handleSetup} />;
        }
        return (
          <DraftScreenV2
            formation={state.formation}
            mode={state.mode ?? 'classic'}
            style={style}
            respinTokens={state.respinTokens ?? 0}
            spunRoll={state.spunRoll ?? null}
            humanSlate={state.humanSlate}
            animate={animate}
            affinity={affinity}
            onSpin={handleSpinV2}
            onRespin={handleRespinV2}
            onPlace={handlePlaceV2}
            onMove={(from, to) => dispatch({ type: 'MOVE_PLACED', from, to })}
            onStyleChange={setStyle}
            onEnterBattle={handleEnterBattleV2}
          />
        );
      }
      return (
        <DraftScreen
          state={state}
          animate={animate}
          onSpin={handleSpin}
          onPick={handlePick}
          onEnterBattle={handleEnterBattle}
        />
      );
    case 'battle':
      return (
        <BattleScreen
          state={state}
          animate={animate}
          boardStyle={style}
          onPlayRound={handlePlayRound}
          onContinue={handleContinue}
          onNextFeatured={handleNextFeatured}
          onFinishRound={handleFinishRound}
          onSkipAll={handleFinishRound}
          onBoardSwap={handleBoardSwap}
          onBoardStyleChange={setStyle}
        />
      );
    case 'steal':
      return <StealScreen state={state} onDone={handleStealDone} />;
    case 'end':
      return <EndScreen state={state} onReset={handleReset} />;
  }
}
