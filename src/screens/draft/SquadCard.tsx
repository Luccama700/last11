import { flagOf } from '../../game/flags';
import type { RankedOption } from '../../engine/draft';
import type { DraftMode, RolledTeam } from '../../engine/types';
import { RosterRow } from '../ui/kit';

/**
 * The revealed rolled (nation, year) squad — the FIFA transfer-search list.
 * Options arrive pre-ranked by the points they add to the squad right now
 * (sortByBoost); the top option wears the gold "best boost" trim, the +points
 * column is the royal-blue value. Ratings and boosts hide in Memory mode.
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
    <div className="animate-pop border border-hairline bg-white">
      {/* header plaque: flag + squad + year ribbon (+ re-spin) */}
      <div className="silver-gloss flex items-center justify-between px-3 py-2">
        <p className="flex min-w-0 items-center gap-2">
          <span className="text-xl">{flagOf(props.roll.nation)}</span>
          <span className="condensed truncate text-[15px] font-bold text-carbon">
            {props.squadName}
          </span>
          <span className="scarlet-gloss blade condensed tabular px-2 py-0.5 text-xs">
            {props.roll.year}
          </span>
        </p>
        {props.onRespin && props.respinTokens > 0 && (
          <button
            type="button"
            onClick={props.onRespin}
            className="condensed tabular silver-gloss blade cursor-pointer px-2.5 py-1 text-xs text-royal"
          >
            re-spin ({props.respinTokens})
          </button>
        )}
      </div>
      {/* sort header, transfer-search style */}
      <div className="flex items-center justify-between bg-chrome-700 px-3 py-1">
        <span className="condensed text-[10px] tracking-wider text-white/85">
          Player details <span className="text-scarlet">▼ best boost</span>
        </span>
        {!memory && (
          <span className="condensed text-[10px] tracking-wider text-white/85">+Points</span>
        )}
      </div>

      {/* keyed by roll so every fresh squad replays the staggered row entrance */}
      <div
        key={`${props.roll.nation}-${props.roll.year}`}
        className="scrollbar-hide max-h-[38dvh] overflow-y-auto lg:max-h-none"
      >
        {props.options.map((o, rank) => {
          const p = o.player;
          const fit = o.bestSlot;
          const offPosition = fit ? !fit.natural : false;
          const best = rank === 0 && fit !== null;
          return (
            <div
              key={p.id}
              className="animate-row-in"
              style={{ animationDelay: `${Math.min(rank, 11) * 30}ms` }}
            >
              <RosterRow
                testid="squad-player"
                pos={p.position}
                number={memory ? undefined : p.rating}
                name={p.name}
                stats={[
                  <span key="pos">{p.position}</span>,
                  ...(memory ? [] : [<span key="ovr">OVR {p.rating}</span>]),
                  fit ? (
                    offPosition ? (
                      <span key="fit" className="text-[#a05a00]">→ {fit.position}</span>
                    ) : (
                      <span key="fit" className="text-[#2e7527]">→ {fit.position} natural</span>
                    )
                  ) : (
                    <span key="fit">no open slot</span>
                  ),
                ]}
                value={!memory && fit ? `+${o.boost.toFixed(1)}` : undefined}
                gold={best}
                dimmed={fit === null}
                onClick={() => props.onPick(p)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
