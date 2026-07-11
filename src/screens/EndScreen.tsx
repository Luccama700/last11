import { teamStrength } from '../engine/rating';
import type { Position } from '../engine/types';
import { flagOf } from '../game/flags';
import { aliveOf, humanOf, type GameState } from '../game/state';

const POSITION_ORDER: Position[] = ['GK', 'DF', 'MF', 'FW'];

export default function EndScreen(props: { state: GameState; onReset: () => void }) {
  const { state } = props;
  const human = humanOf(state)!;
  const champion = aliveOf(state)[0];
  const won = state.humanPlacement === 1;
  const roundsSurvived = state.rounds.filter((r) =>
    r.table.some((row) => row.managerId === human.id),
  ).length;
  const strength = teamStrength(human.xi);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-6 py-16 text-center">
        {won ? (
          <>
            <p className="text-6xl">🏆</p>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-emerald-400">
              Last manager standing
            </p>
            <h1 className="text-5xl font-black">You outlasted all 31.</h1>
          </>
        ) : (
          <>
            <p className="text-6xl">💀</p>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-rose-400">
              Eliminated
            </p>
            <h1 className="text-5xl font-black">
              You finished <span className="text-rose-400">#{state.humanPlacement}</span> of 32
            </h1>
            {champion && (
              <p className="text-slate-400">
                Last manager standing: <span className="font-bold text-slate-200">{champion.name}</span>
              </p>
            )}
          </>
        )}

        <div className="mt-2 grid w-full grid-cols-3 gap-3 text-center">
          <Stat label="Rounds survived" value={`${roundsSurvived}/6`} />
          <Stat label="Final strength" value={strength.total.toFixed(1)} />
          <Stat label="Placement" value={`#${state.humanPlacement ?? '—'}`} />
        </div>

        <div className="w-full rounded-2xl border border-slate-800 bg-slate-900 p-5 text-left">
          <h2 className="mb-2 text-sm font-black uppercase tracking-wider text-slate-400">
            Your final XI
          </h2>
          <p className="text-sm leading-relaxed text-slate-300">
            {POSITION_ORDER.map((pos) =>
              human.xi
                .filter((s) => s.position === pos)
                .map((s) => `${flagOf(s.player.nation)} ${s.player.name}`)
                .join(' · '),
            )
              .filter(Boolean)
              .join('  |  ')}
          </p>
        </div>

        <button
          onClick={props.onReset}
          className="mt-2 rounded-xl bg-emerald-500 px-10 py-4 text-xl font-black text-slate-950 shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400"
        >
          PLAY AGAIN
        </button>
        <p className="text-xs text-slate-600">Last11 · 11a0.com</p>
      </div>
    </div>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-4">
      <p className="text-2xl font-black text-slate-100">{props.value}</p>
      <p className="mt-1 text-xs uppercase tracking-wider text-slate-500">{props.label}</p>
    </div>
  );
}
