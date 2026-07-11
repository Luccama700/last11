import { useState } from 'react';
import { FORMATIONS, type DraftMode, type Formation, type PlayingStyle } from '../../engine/types';
import FormationPreview from '../board/FormationPreview';

const STYLES: { id: PlayingStyle; label: string; hint: string }[] = [
  { id: 'defensive', label: 'Defensive', hint: 'Sit deep and soak pressure.' },
  { id: 'balanced', label: 'Balanced', hint: 'An even shape.' },
  { id: 'attacking', label: 'Attacking', hint: 'Push high for more shots.' },
];

const MODES: { id: DraftMode; label: string; hint: string }[] = [
  { id: 'classic', label: 'Classic', hint: 'Ratings shown.' },
  { id: 'memory', label: 'Memory', hint: 'Ratings hidden — trust your knowledge.' },
];

/**
 * Pre-draft setup: formation, mode and playing style before the free-pick draft.
 * Gold & Stadium Night theme; formations preview as clean SVG mini-pitches.
 */
export default function PreDraftSetup(props: {
  onStart: (formation: Formation, mode: DraftMode, style: PlayingStyle) => void;
}) {
  const [formation, setFormation] = useState<Formation>(FORMATIONS[0]);
  const [mode, setMode] = useState<DraftMode>('classic');
  const [style, setStyle] = useState<PlayingStyle>('balanced');

  return (
    <div className="bg-stadium min-h-screen text-ink-100">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <header className="text-center">
          <p className="headline text-xs tracking-[0.35em] text-gold-400">MATCHDAY PROGRAMME</p>
          <h1 className="headline mt-1 text-4xl">
            <span className="sr-only">SET UP YOUR SIDE</span>
            <span aria-hidden="true">
              <span className="text-ink-100">Set up</span> <span className="headline-gold">your side</span>
            </span>
          </h1>
          <p className="mt-2 text-sm text-ink-500">
            Pick a shape, pick a style — then survive 31 managers.
          </p>
        </header>

        <section className="mt-8">
          <h2 className="headline mb-3 text-xs tracking-[0.25em] text-ink-500">Formation</h2>
          <div className="grid grid-cols-4 gap-3 max-sm:grid-cols-2" data-tour="formation-picker">
            {FORMATIONS.map((f) => {
              const active = f.id === formation.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFormation(f)}
                  aria-pressed={active}
                  className={`card-gloss group cursor-pointer rounded-2xl p-2.5 text-center transition-all duration-200 ${
                    active
                      ? 'animate-gold-pulse !border-gold-500'
                      : 'hover:!border-night-700 hover:-translate-y-0.5'
                  }`}
                >
                  <div className="pointer-events-none mx-auto h-24 w-[4.3rem]">
                    <FormationPreview formation={f} active={active} />
                  </div>
                  <p className={`headline mt-2 text-sm ${active ? 'text-gold-300' : 'text-ink-100'}`}>
                    {f.name}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="headline mb-3 text-xs tracking-[0.25em] text-ink-500">Mode</h2>
            <div className="grid grid-cols-2 gap-2.5">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  aria-pressed={mode === m.id}
                  className={`card-gloss cursor-pointer rounded-xl px-3.5 py-3 text-left transition ${
                    mode === m.id ? '!border-gold-500' : 'hover:!border-night-700'
                  }`}
                >
                  <p className={`headline text-sm ${mode === m.id ? 'text-gold-300' : 'text-ink-100'}`}>
                    {m.label}
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-ink-500">{m.hint}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h2 className="headline mb-3 text-xs tracking-[0.25em] text-ink-500">Playing style</h2>
            <div className="grid grid-cols-3 gap-2.5">
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  title={s.hint}
                  onClick={() => setStyle(s.id)}
                  aria-pressed={style === s.id}
                  className={`card-gloss cursor-pointer rounded-xl px-2 py-3.5 text-center transition ${
                    style === s.id ? '!border-gold-500' : 'hover:!border-night-700'
                  }`}
                >
                  <p className={`headline text-xs ${style === s.id ? 'text-gold-300' : 'text-ink-100'}`}>
                    {s.label}
                  </p>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-ink-500">{STYLES.find((s) => s.id === style)?.hint}</p>
          </div>
        </section>

        <button
          type="button"
          onClick={() => props.onStart(formation, mode, style)}
          className="btn-gold headline mt-10 w-full cursor-pointer rounded-2xl px-6 py-4 text-xl"
        >
          START DRAFT — {formation.name} · {style} →
        </button>
      </div>
    </div>
  );
}
