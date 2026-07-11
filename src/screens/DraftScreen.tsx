import { NATIONS, nationName } from '../engine/data';
import { draftOptions, pickValue } from '../engine/draft';
import {
  FORMATION,
  STAR_THRESHOLD,
  effectiveRating,
  teamStrength,
} from '../engine/rating';
import type { Player, Position } from '../engine/types';
import { flagOf } from '../game/flags';
import { humanOf, type GameState } from '../game/state';

const POSITION_STYLES: Record<Position, string> = {
  GK: 'bg-amber-500/20 text-amber-300',
  DF: 'bg-sky-500/20 text-sky-300',
  MF: 'bg-emerald-500/20 text-emerald-300',
  FW: 'bg-rose-500/20 text-rose-300',
};

function PositionBadge(props: { position: Position }) {
  return (
    <span
      className={`inline-block w-9 rounded px-1.5 py-0.5 text-center text-xs font-bold ${POSITION_STYLES[props.position]}`}
    >
      {props.position}
    </span>
  );
}

export default function DraftScreen(props: {
  state: GameState;
  onSpin: () => void;
  onPick: (player: Player) => void;
  onEnterBattle: () => void;
}) {
  const { state } = props;
  const human = humanOf(state)!;
  const draftDone = state.draftSlotIndex >= FORMATION.length;
  const currentSlot = draftDone ? null : FORMATION[state.draftSlotIndex];
  const options = state.spunNation ? draftOptions(human.xi, state.spunNation) : null;
  const strength = teamStrength(human.xi);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8 lg:flex-row">
        {/* Main draft area */}
        <div className="flex-1">
          <header className="mb-6 flex items-baseline justify-between">
            <h1 className="text-2xl font-black tracking-tight">
              Last<span className="text-emerald-400">11</span>
              <span className="ml-3 text-sm font-semibold text-slate-500">THE DRAFT</span>
            </h1>
            {!draftDone && currentSlot && (
              <p className="text-sm font-semibold text-slate-400">
                Pick {state.draftSlotIndex + 1}/11 · drafting a{' '}
                <PositionBadge position={currentSlot} />
              </p>
            )}
          </header>

          {draftDone ? (
            <div className="flex flex-col items-center gap-6 rounded-2xl border border-emerald-500/30 bg-slate-900 p-10 text-center">
              <p className="text-3xl font-black">Your XI is locked in 🔒</p>
              <p className="text-slate-400">
                Team strength{' '}
                <span className="font-bold text-emerald-400">{strength.total.toFixed(1)}</span> —
                now survive {state.managers.length - 1} other managers.
              </p>
              <button
                onClick={props.onEnterBattle}
                className="rounded-xl bg-emerald-500 px-10 py-4 text-xl font-black text-slate-950 shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400"
              >
                ENTER THE ARENA →
              </button>
            </div>
          ) : options === null ? (
            <div className="flex flex-col items-center gap-8 rounded-2xl border border-slate-800 bg-slate-900 p-10">
              <div className="grid grid-cols-6 gap-3 text-4xl">
                {NATIONS.map((n) => (
                  <span key={n.code} title={n.name} className="opacity-80">
                    {flagOf(n.code)}
                  </span>
                ))}
              </div>
              <p className="text-slate-400">
                Spin the wheel — wherever it lands, that nation supplies your{' '}
                <span className="font-bold text-slate-200">{currentSlot}</span>.
              </p>
              <button
                onClick={props.onSpin}
                className="rounded-full bg-emerald-500 px-12 py-5 text-2xl font-black text-slate-950 shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400"
              >
                SPIN 🎡
              </button>
            </div>
          ) : (
            <div>
              <div className="mb-4 flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-5 py-3">
                <span className="text-3xl">{flagOf(state.spunNation!)}</span>
                <p className="text-lg font-bold">
                  {nationName(state.spunNation!)}
                  <span className="ml-2 text-sm font-medium text-slate-500">
                    pick one for your {currentSlot} slot
                  </span>
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {options.map((p) => {
                  const eff = effectiveRating(currentSlot!, p);
                  const offPosition = p.position !== currentSlot;
                  const chem = human.xi.filter((s) => s.player.nation === p.nation).length;
                  return (
                    <button
                      key={p.id}
                      onClick={() => props.onPick(p)}
                      title={`Pick value ${pickValue(human.xi, currentSlot!, p).toFixed(1)}`}
                      className="group rounded-xl border border-slate-800 bg-slate-900 p-4 text-left transition hover:border-emerald-500/60 hover:bg-slate-800"
                    >
                      <div className="flex items-center justify-between">
                        <PositionBadge position={p.position} />
                        <span className="text-2xl font-black text-slate-200">
                          {p.rating}
                          {p.rating >= STAR_THRESHOLD && ' ⭐'}
                        </span>
                      </div>
                      <p className="mt-2 font-bold leading-tight group-hover:text-emerald-300">
                        {p.name}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {offPosition ? (
                          <span className="text-orange-400">
                            plays {eff.toFixed(1)} at {currentSlot}
                          </span>
                        ) : (
                          <span>natural {currentSlot}</span>
                        )}
                        {chem > 0 && (
                          <span className="ml-2 text-emerald-400">+{chem} chem 🔗</span>
                        )}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar: your XI + lobby */}
        <aside className="w-full shrink-0 lg:w-72">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="mb-3 text-sm font-black uppercase tracking-wider text-slate-400">
              Your XI
            </h2>
            <ul className="space-y-1.5">
              {FORMATION.map((pos, i) => {
                const slot = human.xi[i];
                const active = i === state.draftSlotIndex;
                return (
                  <li
                    key={i}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1 text-sm ${
                      active ? 'bg-emerald-500/10 ring-1 ring-emerald-500/40' : ''
                    }`}
                  >
                    <PositionBadge position={pos} />
                    {slot ? (
                      <span className="truncate">
                        {flagOf(slot.player.nation)} {slot.player.name}
                        <span className="ml-1 text-xs text-slate-500">{slot.player.rating}</span>
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 space-y-1 border-t border-slate-800 pt-3 text-xs text-slate-400">
              <p className="flex justify-between">
                <span>Base</span> <span>{strength.base.toFixed(1)}</span>
              </p>
              <p className="flex justify-between">
                <span>Chemistry 🔗</span> <span>{strength.chemistry.toFixed(1)}</span>
              </p>
              <p className="flex justify-between">
                <span>Stars ⭐</span> <span>{strength.star.toFixed(1)}</span>
              </p>
              <p className="flex justify-between text-sm font-black text-emerald-400">
                <span>Strength</span> <span>{strength.total.toFixed(1)}</span>
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="mb-2 text-sm font-black uppercase tracking-wider text-slate-400">
              The lobby · {state.managers.length} managers
            </h2>
            <p className="text-xs leading-relaxed text-slate-500">
              {state.managers
                .filter((m) => !m.isHuman)
                .slice(0, 8)
                .map((m) => m.name)
                .join(' · ')}{' '}
              — and {state.managers.length - 9} more are drafting their squads right now.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
