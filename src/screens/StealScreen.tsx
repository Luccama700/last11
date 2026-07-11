import { useState } from 'react';
import { STAR_THRESHOLD, teamStrength } from '../engine/rating';
import { applySteal } from '../engine/tournament';
import type { Player } from '../engine/types';
import { flagOf } from '../game/flags';
import { humanOf, type GameState } from '../game/state';

export default function StealScreen(props: {
  state: GameState;
  onDone: (choice: { slotIndex: number; player: Player } | null) => void;
}) {
  const { state } = props;
  const human = humanOf(state)!;
  const [selected, setSelected] = useState<Player | null>(null);
  const currentStrength = teamStrength(human.xi).total;
  const onTeam = new Set(human.xi.map((s) => s.player.id));

  const pool = [...state.pool].sort((a, b) => b.rating - a.rating);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <header className="mb-6">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-rose-400">
            The fallen dropped their squads
          </p>
          <div className="mt-1 flex items-baseline justify-between">
            <h1 className="text-3xl font-black">Steal one player — or walk away</h1>
            <button
              onClick={() => props.onDone(null)}
              className="rounded-lg bg-slate-800 px-5 py-2 font-bold text-slate-300 transition hover:bg-slate-700"
            >
              SKIP — KEEP MY XI
            </button>
          </div>
        </header>

        <div className="flex flex-col gap-6 lg:flex-row">
          {/* Loot pool */}
          <div className="flex-1">
            <h2 className="mb-2 text-sm font-black uppercase tracking-wider text-slate-400">
              Available loot · {pool.length} players
            </h2>
            <div className="grid max-h-[28rem] grid-cols-2 gap-2 overflow-y-auto pr-1 md:grid-cols-3">
              {pool.map((p) => {
                const owned = onTeam.has(p.id);
                const isSelected = selected?.id === p.id;
                return (
                  <button
                    key={p.id}
                    disabled={owned}
                    onClick={() => setSelected(p)}
                    className={`rounded-lg border p-3 text-left text-sm transition ${
                      isSelected
                        ? 'border-emerald-400 bg-emerald-500/10'
                        : owned
                          ? 'cursor-not-allowed border-slate-800 bg-slate-900 opacity-40'
                          : 'border-slate-800 bg-slate-900 hover:border-slate-600'
                    }`}
                  >
                    <p className="font-bold leading-tight">
                      {flagOf(p.nation)} {p.name}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {p.position} · {p.rating}
                      {p.rating >= STAR_THRESHOLD && ' ⭐'}
                      {owned && ' · on your team'}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Your XI: pick the slot to sacrifice */}
          <aside className="w-full shrink-0 lg:w-80">
            <h2 className="mb-2 text-sm font-black uppercase tracking-wider text-slate-400">
              {selected ? `Where does ${selected.name} play?` : 'Your XI'}
            </h2>
            <ul className="space-y-1.5">
              {human.xi.map((slot, i) => {
                const gain = selected
                  ? teamStrength(applySteal(human.xi, i, selected)).total - currentStrength
                  : null;
                return (
                  <li key={i}>
                    <button
                      disabled={!selected}
                      onClick={() => props.onDone({ slotIndex: i, player: selected! })}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-1.5 text-left text-sm transition ${
                        selected
                          ? 'border-slate-700 bg-slate-900 hover:border-emerald-400'
                          : 'border-transparent bg-slate-900/50'
                      }`}
                    >
                      <span className="truncate">
                        <span className="mr-1 text-xs font-bold text-slate-500">
                          {slot.position}
                        </span>
                        {flagOf(slot.player.nation)} {slot.player.name}{' '}
                        <span className="text-xs text-slate-500">{slot.player.rating}</span>
                      </span>
                      {gain !== null && (
                        <span
                          className={`ml-2 shrink-0 text-xs font-black ${
                            gain > 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {gain > 0 ? `+${gain.toFixed(1)}` : gain.toFixed(1)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-slate-500">
              Swapping drops your current player. The other survivors are stealing too.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
