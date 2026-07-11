import { flagOf } from '../../game/flags';
import type { PlayerV2 } from '../../engine/data/schema';
import type { DraftMode, RolledTeam } from '../../engine/types';
import type { SlotFit } from '../../engine/draft';
import { PositionBadge } from '../board/position-ui';

/**
 * The revealed rolled (nation, year) squad. Every player is tappable; picking one
 * either auto-places (a lone natural open slot) or arms place-mode on the pitch.
 * `bestFitOf` supplies the natural/off-position hint. Ratings hide in Memory mode.
 */
export default function SquadCard(props: {
  roll: RolledTeam;
  squadName: string;
  players: readonly PlayerV2[];
  mode: DraftMode;
  bestFitOf: (player: PlayerV2) => SlotFit | undefined;
  onPick: (player: PlayerV2) => void;
  respinTokens: number;
  onRespin?: () => void;
}) {
  const memory = props.mode === 'memory';
  return (
    <div className="animate-pop">
      <div className="mb-3 flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-4 py-2.5">
        <p className="flex items-center gap-2 text-lg font-bold">
          <span className="text-2xl">{flagOf(props.roll.nation)}</span>
          {props.squadName}
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs font-black text-emerald-300">
            {props.roll.year}
          </span>
        </p>
        {props.onRespin && props.respinTokens > 0 && (
          <button
            type="button"
            onClick={props.onRespin}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 transition hover:border-emerald-500/60 hover:text-emerald-300"
          >
            🎡 re-spin ({props.respinTokens})
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {props.players.map((p) => {
          const fit = props.bestFitOf(p);
          const offPosition = fit ? !fit.natural : false;
          return (
            <button
              key={p.id}
              type="button"
              data-testid="squad-player"
              onClick={() => props.onPick(p)}
              className="group rounded-xl border border-slate-800 bg-slate-900 p-3 text-left transition hover:border-emerald-500/60 hover:bg-slate-800"
            >
              <div className="flex items-center justify-between">
                <PositionBadge position={p.position} />
                {!memory && (
                  <span className="text-xl font-black text-slate-200">{p.rating}</span>
                )}
              </div>
              <p className="mt-1.5 font-bold leading-tight text-slate-100 group-hover:text-emerald-300">
                {p.name}
              </p>
              {fit && (
                <p className="mt-0.5 text-[11px]">
                  {offPosition ? (
                    <span className="text-orange-400">
                      → {fit.position}
                      {!memory && ` (${fit.effective.toFixed(0)})`}
                    </span>
                  ) : (
                    <span className="text-emerald-400">→ {fit.position} natural</span>
                  )}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
