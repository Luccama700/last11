import { flagOf } from '../../game/flags';
import type { RankedOption } from '../../engine/draft';
import type { DraftMode, RolledTeam } from '../../engine/types';
import { PositionBadge } from '../board/position-ui';

/**
 * The revealed rolled (nation, year) squad — lives in the LEFT rail of the draft
 * board. Options arrive pre-ranked by the points they add to the squad right now
 * (sortByBoost); the top option wears the gold "best boost" trim. Ratings and
 * boosts hide in Memory mode.
 */
export default function SquadCard(props: {
  roll: RolledTeam;
  squadName: string;
  options: readonly RankedOption[];
  mode: DraftMode;
  onPick: (player: RankedOption['player']) => void;
  respinTokens: number;
  onRespin?: () => void;
}) {
  const memory = props.mode === 'memory';
  return (
    <div className="animate-pop">
      <div className="card-gloss mb-2.5 flex items-center justify-between rounded-xl px-3.5 py-2.5">
        <p className="flex items-center gap-2 font-bold text-ink-100">
          <span className="text-xl">{flagOf(props.roll.nation)}</span>
          <span className="leading-tight">{props.squadName}</span>
          <span className="headline rounded bg-gold-400/15 px-1.5 py-0.5 text-xs text-gold-300">
            {props.roll.year}
          </span>
        </p>
        {props.onRespin && props.respinTokens > 0 && (
          <button
            type="button"
            onClick={props.onRespin}
            className="cursor-pointer rounded-lg border border-night-600 px-2.5 py-1.5 text-xs font-bold text-ink-300 transition hover:border-gold-500 hover:text-gold-300"
          >
            re-spin ({props.respinTokens})
          </button>
        )}
      </div>

      {/* keyed by roll so every fresh squad replays the staggered flip-in */}
      <div key={`${props.roll.nation}-${props.roll.year}`} className="grid grid-cols-2 gap-2">
        {props.options.map((o, rank) => {
          const p = o.player;
          const fit = o.bestSlot;
          const offPosition = fit ? !fit.natural : false;
          const best = rank === 0 && fit !== null;
          return (
            <button
              key={p.id}
              type="button"
              data-testid="squad-player"
              onClick={() => props.onPick(p)}
              style={{ animationDelay: `${Math.min(rank, 11) * 35}ms` }}
              className={`card-gloss animate-flip-in group cursor-pointer rounded-xl p-2.5 text-left transition hover:-translate-y-0.5 ${
                best ? '!border-gold-500/70' : 'hover:!border-night-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <PositionBadge position={p.position} />
                {!memory && (
                  <span className="headline text-lg text-ink-100">{p.rating}</span>
                )}
              </div>
              <p className="mt-1 truncate text-sm font-bold leading-tight text-ink-100 group-hover:text-gold-300">
                {p.name}
              </p>
              <p className="mt-0.5 flex items-center justify-between text-[11px]">
                {fit ? (
                  offPosition ? (
                    <span className="text-orange-400">→ {fit.position}</span>
                  ) : (
                    <span className="text-win">→ {fit.position} natural</span>
                  )
                ) : (
                  <span className="text-ink-500">no open slot</span>
                )}
                {!memory && fit && (
                  <span className={`font-black ${best ? 'text-gold-300' : 'text-ink-500'}`}>
                    +{o.boost.toFixed(1)}
                  </span>
                )}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
