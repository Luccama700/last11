import { useState } from 'react';
import { FORMATIONS, type DraftMode, type Formation, type PlayingStyle } from '../../engine/types';
import PitchBoard from '../board/PitchBoard';

const STYLES: { id: PlayingStyle; label: string; hint: string }[] = [
  { id: 'defensive', label: 'Defensive', hint: 'Sit deep and soak pressure.' },
  { id: 'balanced', label: 'Balanced', hint: 'An even shape.' },
  { id: 'attacking', label: 'Attacking', hint: 'Push high for more shots.' },
];

/**
 * Pre-draft setup: choose formation, mode (Classic/Memory) and playing style
 * before the free-pick draft begins. The 8 formations preview as mini pitches.
 */
export default function PreDraftSetup(props: {
  onStart: (formation: Formation, mode: DraftMode, style: PlayingStyle) => void;
}) {
  const [formation, setFormation] = useState<Formation>(FORMATIONS[0]);
  const [mode, setMode] = useState<DraftMode>('classic');
  const [style, setStyle] = useState<PlayingStyle>('balanced');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="text-2xl font-black tracking-tight">
          Last<span className="text-emerald-400">11</span>
          <span className="ml-3 text-sm font-semibold text-slate-500">SET UP YOUR SIDE</span>
        </h1>

        <section className="mt-6">
          <h2 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Formation</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-tour="formation-picker">
            {FORMATIONS.map((f) => {
              const active = f.id === formation.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFormation(f)}
                  className={`rounded-2xl border p-2 text-center transition ${
                    active
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'border-slate-800 bg-slate-900 hover:border-slate-600'
                  }`}
                >
                  <div className="pointer-events-none mx-auto w-16">
                    <PitchBoard formation={f} slate={new Array(11).fill(null)} mode="classic" compact />
                  </div>
                  <p className="mt-1.5 text-sm font-black">{f.name}</p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Mode</h2>
            <div className="grid grid-cols-2 gap-2">
              {(['classic', 'memory'] as DraftMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-xl border px-3 py-3 text-left transition ${
                    mode === m ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-800 bg-slate-900 hover:border-slate-600'
                  }`}
                >
                  <p className="text-sm font-black">{m === 'classic' ? '👁 Classic' : '🧠 Memory'}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {m === 'classic' ? 'Ratings shown.' : 'Ratings hidden — trust your knowledge.'}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Playing style</h2>
            <div className="grid grid-cols-3 gap-2">
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  title={s.hint}
                  onClick={() => setStyle(s.id)}
                  className={`rounded-xl border px-2 py-3 text-center transition ${
                    style === s.id ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-800 bg-slate-900 hover:border-slate-600'
                  }`}
                >
                  <p className="text-xs font-black">{s.label}</p>
                </button>
              ))}
            </div>
          </div>
        </section>

        <button
          type="button"
          onClick={() => props.onStart(formation, mode, style)}
          className="mt-8 w-full rounded-2xl bg-emerald-500 px-6 py-4 text-xl font-black text-slate-950 shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400"
        >
          START DRAFT — {formation.name} · {style} →
        </button>
      </div>
    </div>
  );
}
