import { useState } from 'react';
import { FORMATIONS, type DraftMode, type Formation, type PlayingStyle } from '../../engine/types';
import FormationPreview from '../board/FormationPreview';
import { ChromeBar, TickerBar } from '../ui/kit';

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
    <div className="flex min-h-dvh flex-col bg-arena text-carbon">
      <ChromeBar ribbon title="MATCHDAY PROGRAMME" />
      <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-5 sm:px-6">
        <header className="text-center">
          <h1 className="condensed mt-1 text-3xl font-bold">
            <span className="sr-only">SET UP YOUR SIDE</span>
            <span aria-hidden="true">
              Set up <span className="text-scarlet">your side</span>
            </span>
          </h1>
          <p className="mt-1.5 text-sm text-carbon-600">
            Pick a shape, pick a style — then survive 31 managers.
          </p>
        </header>

        {/* 5×2 so all ten shapes AND the confirm button share one screen (Lucca) */}
        <section className="mt-5">
          <h2 className="condensed mb-2 text-xs tracking-[0.25em] text-carbon-600">Formation</h2>
          <div className="grid grid-cols-5 gap-2.5 max-sm:grid-cols-2" data-tour="formation-picker">
            {FORMATIONS.map((f, fi) => {
              const active = f.id === formation.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFormation(f)}
                  aria-pressed={active}
                  style={{ animationDelay: `${fi * 45}ms` }}
                  className={`group animate-fade-up hover-lift cursor-pointer rounded-xl border p-2 text-center ${
                    active ? 'row-selected border-royal' : 'silver-gloss border-transparent'
                  }`}
                >
                  <div className="pointer-events-none mx-auto h-20 w-[3.8rem]">
                    <FormationPreview formation={f} active={active} />
                  </div>
                  <p
                    className={`condensed mt-1.5 truncate text-xs ${active ? 'text-royal' : 'text-carbon'}`}
                    title={f.name}
                  >
                    {f.name}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-5 grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="condensed mb-3 text-xs tracking-[0.25em] text-carbon-600">Mode</h2>
            <div className="grid grid-cols-2 gap-2.5">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  aria-pressed={mode === m.id}
                  className={`cursor-pointer border px-3.5 py-3 text-left transition ${
                    mode === m.id ? 'row-selected border-royal' : 'silver-gloss border-hairline'
                  }`}
                >
                  <p className={`condensed text-sm font-bold ${mode === m.id ? 'text-royal' : 'text-carbon'}`}>
                    {m.label}
                  </p>
                  <p className={`mt-1 text-[11px] leading-snug ${mode === m.id ? 'text-carbon-600' : 'text-carbon-600'}`}>{m.hint}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h2 className="condensed mb-3 text-xs tracking-[0.25em] text-carbon-600">Playing style</h2>
            <div className="grid grid-cols-3 gap-2.5">
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  title={s.hint}
                  onClick={() => setStyle(s.id)}
                  aria-pressed={style === s.id}
                  className={`cursor-pointer border px-2 py-3.5 text-center transition ${
                    style === s.id ? 'row-selected border-royal' : 'silver-gloss border-hairline'
                  }`}
                >
                  <p className={`condensed text-xs font-bold ${style === s.id ? 'text-royal' : 'text-carbon'}`}>
                    {s.label}
                  </p>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-carbon-600">{STYLES.find((s) => s.id === style)?.hint}</p>
          </div>
        </section>

        <button
          type="button"
          onClick={() => props.onStart(formation, mode, style)}
          className="scarlet-gloss blade condensed glint hover-lift mt-6 w-full cursor-pointer px-6 py-4 text-xl"
        >
          START DRAFT — {formation.name} · {style} →
        </button>
      </div>
      <TickerBar>Pick a shape and a style, then start your draft.</TickerBar>
    </div>
  );
}
