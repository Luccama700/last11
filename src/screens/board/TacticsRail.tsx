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
 * FIFA 13 skin: white spec pane, silver segmented blades, values in royal blue.
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
    <div className="space-y-3 border border-hairline bg-white p-3.5">
      <div>
        <div className="flex items-center justify-between border-b border-hairline pb-1">
          <h2 className="condensed text-[11px] tracking-[0.2em] text-carbon-600">Formation</h2>
          {props.onChangeFormation && (
            <button
              type="button"
              onClick={props.onChangeFormation}
              className="condensed cursor-pointer px-2 py-0.5 text-[11px] font-bold text-royal hover:underline"
            >
              change
            </button>
          )}
        </div>
        <p className="condensed mt-1 text-3xl font-bold text-carbon">{props.formationName}</p>
      </div>

      <div>
        <h2 className="condensed mb-1.5 text-[11px] tracking-[0.2em] text-carbon-600">Style</h2>
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
                className={`condensed cursor-pointer px-1.5 py-2 text-[12px] transition max-lg:py-2.5 ${
                  active ? 'chrome-gloss text-white' : 'silver-gloss text-carbon'
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px]">
        <span className="silver-gloss blade condensed px-2.5 py-1 text-carbon">
          {props.mode === 'memory' ? 'Memory' : 'Classic'}
        </span>
        {props.respinTokens !== undefined && (
          <span className="silver-gloss blade condensed tabular px-2.5 py-1 text-carbon">
            {props.respinTokens} re-spins
          </span>
        )}
      </div>

      <div className="border-t border-hairline pt-2.5">
        <p className="flex items-baseline justify-between text-sm">
          <span className="condensed text-carbon-600">Strength</span>
          {/* key = value: remounts on change so the number bumps (juice pass) */}
          <span
            key={props.strength.toFixed(0)}
            className="condensed tabular animate-score-bump text-2xl font-bold text-royal"
          >
            {props.strength.toFixed(0)}
          </span>
        </p>
        <p className="tabular mt-1 flex justify-between text-[11px] text-carbon-600">
          <span>Drafted</span>
          <span>
            {props.filled}/{props.slotCount}
          </span>
        </p>
      </div>
    </div>
  );
}
