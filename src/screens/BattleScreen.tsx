import { useState } from 'react';
import { affinity } from '../engine/affinity';
import { teamStrength } from '../engine/rating';
import { SURVIVORS_PER_ROUND } from '../engine/tournament';
import type { PlayingStyle, XiSlotV2 } from '../engine/types';
import { aliveOf, humanOf, type GameState } from '../game/state';
import BetweenMatchBoard from './board/BetweenMatchBoard';
import MatchPlaybackScreen from './MatchPlaybackScreen';

export default function BattleScreen(props: {
  state: GameState;
  animate: boolean;
  boardStyle: PlayingStyle;
  onPlayRound: () => void;
  onContinue: () => void;
  onNextFeatured: () => void;
  onFinishRound: () => void;
  onSkipAll: () => void;
  onBoardSwap: (a: number, b: number) => void;
  onBoardStyleChange: (s: PlayingStyle) => void;
}) {
  const { state } = props;
  const human = humanOf(state)!;
  const alive = aliveOf(state);
  const [boardOpen, setBoardOpen] = useState(false);

  // Round-boundary lineup board (DECISIONS: re-slot + style between rounds). Rounds are
  // ATOMIC (all 3 sets resolve in one playRound), so a re-slot only affects the NEXT
  // round — hence the round intro, not the playback flow: keeps table === played score.
  const denseSlate = (state.humanSlate ?? []).filter((s): s is XiSlotV2 => s !== null);
  const canAdjust = !!state.formation && denseSlate.length === state.formation.slots.length;

  if (state.battleView === 'intro' && boardOpen && canAdjust) {
    return (
      <BetweenMatchBoard
        formation={state.formation!}
        xi={denseSlate}
        mode={state.mode ?? 'classic'}
        style={props.boardStyle}
        affinity={affinity}
        onSwap={props.onBoardSwap}
        onStyleChange={props.onBoardStyleChange}
        onDone={() => setBoardOpen(false)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <header className="mb-6 flex items-baseline justify-between">
          <h1 className="text-2xl font-black tracking-tight">
            Last<span className="text-emerald-400">11</span>
            <span className="ml-3 text-sm font-semibold text-slate-500">THE ARENA</span>
          </h1>
          <p className="text-sm font-semibold text-slate-400">{alive.length} managers alive</p>
        </header>

        {state.battleView === 'intro' ? (
          <RoundIntro
            state={state}
            onPlayRound={props.onPlayRound}
            onAdjust={canAdjust ? () => setBoardOpen(true) : undefined}
          />
        ) : state.battleView === 'playback' ? (
          <MatchPlaybackScreen
            state={state}
            animate={props.animate}
            onNextFeatured={props.onNextFeatured}
            onFinishRound={props.onFinishRound}
            onSkipAll={props.onSkipAll}
          />
        ) : (
          <RoundResults state={state} onContinue={props.onContinue} humanAlive={human.alive} />
        )}
      </div>
    </div>
  );
}

const TRASH_TALK = [
  'My XI has more chemistry than a Nobel lab.',
  "I've seen better defending in a charity match.",
  'The wheel loves me. The table will too.',
  "I didn't come here to make friends. I came to make GD.",
  'Your striker plays like he is still in the parking lot.',
  'Hope you saved a spot on your bench for regret.',
  'Six rounds? I only need my back four.',
  "Somebody's going home. I've already booked your cab.",
  'You call that a midfield? I call it a welcome mat.',
  'My goalkeeper could captain your whole squad.',
];

function RoundIntro(props: { state: GameState; onPlayRound: () => void; onAdjust?: () => void }) {
  const { state } = props;
  const alive = aliveOf(state);
  const human = humanOf(state)!;
  const target = SURVIVORS_PER_ROUND[state.roundIndex];
  const cut = alive.length - target;
  const isFinal = target === 1;
  const bots = alive.filter((m) => !m.isHuman);
  const talker = bots[(state.roundIndex * 7) % Math.max(1, bots.length)];
  const line = TRASH_TALK[(state.roundIndex * 5 + alive.length) % TRASH_TALK.length];

  // your live rank among the alive, by strength
  const strengths = alive
    .map((m) => ({ id: m.id, total: teamStrength(m.xi).total }))
    .sort((a, b) => b.total - a.total);
  const yourRank = strengths.findIndex((s) => s.id === human.id) + 1;
  const yourStrength = strengths.find((s) => s.id === human.id)!.total;

  return (
    <div className="flex flex-col items-center gap-6 rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.3em] text-rose-400">
        {isFinal ? 'The final' : `Round ${state.roundIndex + 1}`}
      </p>
      <h2 className="text-4xl font-black">
        {isFinal
          ? 'Head to head. Last manager standing.'
          : `${cut} manager${cut === 1 ? '' : 's'} will fall`}
      </h2>
      <p className="max-w-md text-slate-400">
        Everyone plays 3 matches. {isFinal ? 'Best record takes the crown.' : `The bottom ${cut} of the table go home.`}
      </p>
      <p className="text-sm text-slate-500">
        Your squad: <span className="font-bold text-emerald-400">{yourStrength.toFixed(1)}</span>{' '}
        strength · ranked <span className="font-bold text-slate-200">#{yourRank}</span> of{' '}
        {alive.length}
      </p>
      <button
        onClick={props.onPlayRound}
        className="rounded-xl bg-emerald-500 px-10 py-4 text-xl font-black text-slate-950 shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400"
      >
        PLAY ROUND {state.roundIndex + 1} ▶
      </button>
      {props.onAdjust && (
        <button
          onClick={props.onAdjust}
          className="text-sm font-bold text-slate-400 underline-offset-4 transition hover:text-slate-200 hover:underline"
        >
          ⚙ adjust lineup &amp; style
        </button>
      )}
      {talker && (
        <p className="mt-2 max-w-md rounded-xl bg-slate-950 px-4 py-2 text-sm italic text-slate-400">
          💬 <span className="font-bold not-italic text-slate-300">{talker.name}:</span> “{line}”
        </p>
      )}
    </div>
  );
}

function RoundResults(props: { state: GameState; onContinue: () => void; humanAlive: boolean }) {
  const { state } = props;
  const result = state.rounds[state.rounds.length - 1];
  const names = new Map(state.managers.map((m) => [m.id, m.name]));
  const target = SURVIVORS_PER_ROUND[result.round - 1];
  const humanId = humanOf(state)!.id;
  const eliminated = new Set(result.eliminatedIds);

  const yourMatches = result.matches.filter(
    (m) => m.homeId === humanId || m.awayId === humanId,
  );

  return (
    <div className="space-y-6">
      {yourMatches.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h3 className="mb-3 text-sm font-black uppercase tracking-wider text-slate-400">
            Your matches
          </h3>
          <div className="grid gap-2 md:grid-cols-3">
            {yourMatches.map((m, i) => {
              const youHome = m.homeId === humanId;
              const you = youHome ? m.homeGoals : m.awayGoals;
              const them = youHome ? m.awayGoals : m.homeGoals;
              const oppName = names.get(youHome ? m.awayId : m.homeId)!;
              const tone =
                you > them ? 'text-emerald-400' : you < them ? 'text-rose-400' : 'text-slate-300';
              return (
                <p key={i} className="rounded-lg bg-slate-950 px-3 py-2 text-sm">
                  <span className={`font-black ${tone}`}>
                    {you}–{them}
                  </span>{' '}
                  <span className="text-slate-400">vs {oppName}</span>
                </p>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="mb-3 text-sm font-black uppercase tracking-wider text-slate-400">
          Round {result.round} table · bottom {result.eliminatedIds.length} eliminated
        </h3>
        <div className="max-h-96 overflow-y-auto pr-1">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1 pr-2">#</th>
                <th className="py-1 pr-2">Manager</th>
                <th className="py-1 pr-2 text-right">Pts</th>
                <th className="py-1 pr-2 text-right">GD</th>
                <th className="py-1 text-right">GF</th>
              </tr>
            </thead>
            <tbody>
              {result.table.map((row, i) => {
                const isYou = row.managerId === humanId;
                const isOut = eliminated.has(row.managerId);
                return (
                  <tr
                    key={row.managerId}
                    style={{ animationDelay: `${i * 30}ms` }}
                    className={`animate-row-in ${i === target ? 'border-t-2 border-rose-500/60' : 'border-t border-slate-800'} ${
                      isYou ? 'bg-emerald-500/10 font-bold' : ''
                    } ${isOut ? 'text-rose-400/70 line-through decoration-rose-500/40' : ''}`}
                  >
                    <td className="py-1 pr-2 text-slate-500">{i + 1}</td>
                    <td className="py-1 pr-2">
                      {names.get(row.managerId)}
                      {isYou && ' (you)'}
                    </td>
                    <td className="py-1 pr-2 text-right">{row.points}</td>
                    <td className="py-1 pr-2 text-right">
                      {row.gd > 0 ? `+${row.gd}` : row.gd}
                    </td>
                    <td className="py-1 text-right">{row.gf}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-center">
        <button
          onClick={props.onContinue}
          className={`rounded-xl px-10 py-4 text-xl font-black shadow-lg transition ${
            props.humanAlive
              ? 'bg-emerald-500 text-slate-950 shadow-emerald-500/25 hover:bg-emerald-400'
              : 'bg-rose-500 text-slate-950 shadow-rose-500/25 hover:bg-rose-400'
          }`}
        >
          {props.humanAlive ? 'CONTINUE →' : 'SEE HOW IT ENDS'}
        </button>
      </div>
    </div>
  );
}
