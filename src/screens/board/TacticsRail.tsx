import type { DraftMode, PlayingStyle } from '../../engine/types';

const STYLES: { id: PlayingStyle; label: string; hint: string }[] = [
  { id: 'defensive', label: 'Defensive', hint: 'sit deep, soak pressure' },
  { id: 'balanced', label: 'Balanced', hint: 'even shape' },
  { id: 'attacking', label: 'Attacking', hint: 'push high, more shots' },
];

/**
 * Top of the draft board's left rail: formation name, playing-style toggle, mode
 * + re-spin chips and a live strength readout. Also used by the between-match
 * re-arrange view (pass `onChangeFormation` only when it's allowed).
 */
export default function TacticsRail(props: {
  formationName: string;
  style: PlayingStyle;
  onStyleChange: (style: PlayingStyle) => void;
  mode: DraftMode;
  respinTokens?: number;
  strength: number;
  filled: number;
  slotCount: number;
  onChangeFormation?: () => void;
}) {
  return (
    <div className="card-gloss space-y-4 rounded-2xl p-4">
      <div>
        <div className="flex items-center justify-between">
          <h2 className="headline text-[11px] tracking-[0.25em] text-ink-500">Formation</h2>
          {props.onChangeFormation && (
            <button
              type="button"
              onClick={props.onChangeFormation}
              className="cursor-pointer rounded px-2 py-0.5 text-[11px] font-semibold text-gold-300 hover:bg-gold-400/10"
            >
              change
            </button>
          )}
        </div>
        <p className="headline mt-1 text-3xl text-ink-100">{props.formationName}</p>
      </div>

      <div>
        <h2 className="headline mb-1.5 text-[11px] tracking-[0.25em] text-ink-500">Style</h2>
        <div className="grid grid-cols-3 gap-1" data-tour="style-picker">
          {STYLES.map((s) => {
            const active = s.id === props.style;
            return (
              <button
                key={s.id}
                type="button"
                title={s.hint}
                aria-pressed={active}
                onClick={() => props.onStyleChange(s.id)}
                className={`cursor-pointer rounded-lg px-1.5 py-2 text-[11px] font-bold transition ${
                  active
                    ? 'btn-gold'
                    : 'bg-night-700 text-ink-300 hover:bg-night-600'
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px]">
        <span className="rounded bg-night-700 px-2 py-1 font-semibold text-ink-300">
          {props.mode === 'memory' ? 'Memory' : 'Classic'}
        </span>
        {props.respinTokens !== undefined && (
          <span className="rounded bg-night-700 px-2 py-1 font-semibold text-ink-300">
            {props.respinTokens} re-spins
          </span>
        )}
      </div>

      <div className="border-t border-night-600 pt-3">
        <p className="flex items-baseline justify-between text-sm">
          <span className="font-semibold text-ink-500">Strength</span>
          {/* key = value: remounts on change so the number bumps (juice pass) */}
          <span key={props.strength.toFixed(0)} className="headline animate-score-bump text-2xl text-gold-300">
            {props.strength.toFixed(0)}
          </span>
        </p>
        <p className="mt-1 flex justify-between text-[11px] text-ink-500">
          <span>Drafted</span>
          <span>
            {props.filled}/{props.slotCount}
          </span>
        </p>
      </div>
    </div>
  );
}
