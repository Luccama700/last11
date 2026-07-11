import { useReducer, useRef } from 'react';
import { spinNation } from './engine/draft';
import { createRng, type Rng } from './engine/rng';
import {
  SURVIVORS_PER_ROUND,
  applySteal,
  createLobby,
  evaluateSteal,
  playRound,
  stealPool,
  type RoundResult,
} from './engine/tournament';
import type { Player, XI } from './engine/types';
import { aliveOf, humanOf, initialState, reducer, tournamentOver } from './game/state';
import BattleScreen from './screens/BattleScreen';
import DraftScreen from './screens/DraftScreen';
import EndScreen from './screens/EndScreen';
import HomeScreen from './screens/HomeScreen';
import StealScreen from './screens/StealScreen';

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const rngRef = useRef<Rng | null>(null);

  function handleStart() {
    const seed = (Math.random() * 0x7fffffff) | 0;
    const rng = createRng(seed);
    rngRef.current = rng;
    dispatch({ type: 'START', seed, managers: createLobby(rng, 'You') });
  }

  function handleSpin() {
    dispatch({ type: 'SPIN', nation: spinNation(rngRef.current!) });
  }

  function handlePick(player: Player) {
    dispatch({ type: 'PICK', player });
  }

  function handleEnterBattle() {
    dispatch({ type: 'ENTER_BATTLE' });
  }

  function handlePlayRound() {
    const result = playRound(
      aliveOf(state),
      SURVIVORS_PER_ROUND[state.roundIndex],
      state.roundIndex + 1,
      rngRef.current!,
    );
    dispatch({ type: 'ROUND_PLAYED', result });
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
      const result = playRound(alive, SURVIVORS_PER_ROUND[roundIndex], roundIndex + 1, rng);
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
    dispatch({ type: 'RESET' });
  }

  switch (state.screen) {
    case 'home':
      return <HomeScreen onStart={handleStart} />;
    case 'draft':
      return (
        <DraftScreen
          state={state}
          onSpin={handleSpin}
          onPick={handlePick}
          onEnterBattle={handleEnterBattle}
        />
      );
    case 'battle':
      return (
        <BattleScreen state={state} onPlayRound={handlePlayRound} onContinue={handleContinue} />
      );
    case 'steal':
      return <StealScreen state={state} onDone={handleStealDone} />;
    case 'end':
      return <EndScreen state={state} onReset={handleReset} />;
  }
}
