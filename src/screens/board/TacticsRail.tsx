import type { DraftMode, PlayingStyle } from '../../engine/types';

const STYLES: { id: PlayingStyle; label: string; hint: string }[] = [
  { id: 'defensive', label: 'Defensive', hint: 'sit deep, soak pressure' },
  { id: 'balanced', label: 'Balanced', hint: 'even shape' },
  { id: 'attacking', label: 'Attacking', hint: 'push high, more shots' },
];

/**
 * Left panel of the tactics board: formation name, playing-style toggle, mode
 * badge, re-spin tokens and a live strength readout. Used in the draft and in the
 * between-match re-arrange view (pass `onChangeFormation` only when it's allowed).
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
    <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-400">Formation</h2>
          {props.onChangeFormation && (
            <button
              type="button"
              onClick={props.onChangeFormation}
              className="rounded px-2 py-0.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/10"
            >
              change
            </button>
          )}
        </div>
        <p className="mt-1 text-2xl font-black tracking-tight text-slate-100">{props.formationName}</p>
      </div>

      <div>
        <h2 className="mb-1.5 text-xs font-black uppercase tracking-wider text-slate-400">Style</h2>
        <div className="grid grid-cols-3 gap-1" data-tour="style-picker">
          {STYLES.map((s) => {
            const active = s.id === props.style;
            return (
              <button
                key={s.id}
                type="button"
                title={s.hint}
                onClick={() => props.onStyleChange(s.id)}
                className={`rounded-lg px-1.5 py-2 text-[11px] font-bold transition ${
                  active
                    ? 'bg-emerald-500 text-slate-950'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px]">
        <span className="rounded bg-slate-800 px-2 py-1 font-semibold text-slate-300">
          {props.mode === 'memory' ? '🧠 Memory' : '👁 Classic'}
        </span>
        {props.respinTokens !== undefined && (
          <span className="rounded bg-slate-800 px-2 py-1 font-semibold text-slate-300">
            🎡 {props.respinTokens} re-spins
          </span>
        )}
      </div>

      <div className="border-t border-slate-800 pt-3">
        <p className="flex justify-between text-sm">
          <span className="font-semibold text-slate-400">Strength</span>
          <span className="font-black text-emerald-400">{props.strength.toFixed(0)}</span>
        </p>
        <p className="mt-1 flex justify-between text-[11px] text-slate-500">
          <span>Drafted</span>
          <span>
            {props.filled}/{props.slotCount}
          </span>
        </p>
      </div>
    </div>
  );
}
