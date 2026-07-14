import { useState } from 'react';
import { effectiveRatingV2 } from '../../engine/draft';
import { FORMATIONS } from '../../engine/types';
import type { AffinityFn, DraftMode, Formation, PlayingStyle, XiSlotV2 } from '../../engine/types';
import PitchBoard from './PitchBoard';
import TacticsRail from './TacticsRail';

/**
 * The between-round PIT STOP (Lucca 2026-07-11): swap players, change playing
 * style AND change formation, all on one board. A formation change re-slots the
 * current XI automatically (App runs `autoArrange` and follows with
 * `REARRANGE_XI`); swaps then fine-tune. Untimed in solo; multiplayer mounts this
 * same board under the shared 20s pit-stop clock.
 *
 * Pure controlled component — state lives in the reducer (`SET_TACTICS` +
 * `REARRANGE_XI`), not here.
 */
export default function BetweenMatchBoard(props: {
  formation: Formation;
  xi: readonly XiSlotV2[];
  mode: DraftMode;
  style: PlayingStyle;
  affinity: AffinityFn;
  onSwap: (a: number, b: number) => void;
  onStyleChange: (style: PlayingStyle) => void;
  onFormationChange?: (f: Formation) => void;
  onDone: () => void;
  /** MP pit stop: countdown banner above the board and a third column on the
   *  right (loot + standings). Solo passes neither. */
  banner?: React.ReactNode;
  rightAside?: React.ReactNode;
  doneLabel?: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);

  function tapSlot(i: number) {
    if (selected === null) {
      setSelected(i);
    } else if (selected === i) {
      setSelected(null);
    } else {
      props.onSwap(selected, i);
      setSelected(null);
    }
  }

  const strength = props.xi.reduce(
    (sum, s) => sum + effectiveRatingV2(s.player, s.position, props.affinity),
    0,
  );

  return (
    // lg: the board IS the viewport — the pitch takes the remaining height and
    // the side rails scroll internally if they must. No page scroll.
    <div className="bg-paper text-carbon min-h-screen lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      <div
        className={`mx-auto grid gap-5 px-4 py-4 lg:h-full ${
          props.rightAside
            ? 'max-w-7xl lg:grid-cols-[15rem_minmax(0,1fr)_19rem]'
            : 'max-w-5xl lg:grid-cols-[16rem_minmax(0,1fr)]'
        }`}
      >
        {/* On mobile the rail dissolves (`max-lg:contents`) so its blocks join
            the single column with explicit orders: pitch(1) → loot(2) → LOCK(3)
            → tactics(4) → shape(5) → standings(6). The essentials — countdown,
            pitch, loot, LOCK — all land on the first screen. */}
        <aside className="scrollbar-hide min-h-0 max-lg:contents lg:order-1 lg:space-y-4 lg:overflow-y-auto">
          <div className="max-lg:order-4">
            <TacticsRail
              formationName={props.formation.name}
              style={props.style}
              onStyleChange={props.onStyleChange}
              mode={props.mode}
              strength={strength}
              filled={props.xi.length}
              slotCount={props.formation.slots.length}
            />
          </div>

          {props.onFormationChange && (
            <div className="border border-hairline bg-white p-3.5 max-lg:order-5">
              <h2 className="condensed mb-2 text-[11px] tracking-[0.2em] text-carbon-600">
                Change shape
              </h2>
              <div className="grid grid-cols-2 gap-1">
                {FORMATIONS.map((f) => {
                  const active = f.id === props.formation.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => !active && props.onFormationChange!(f)}
                      className={`condensed cursor-pointer truncate px-1.5 py-1.5 text-[11px] transition max-lg:py-2.5 ${
                        active ? 'chrome-gloss text-white' : 'silver-gloss text-carbon'
                      }`}
                      title={f.name}
                    >
                      {f.name}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[10px] leading-snug text-carbon-600">
                A new shape re-slots your XI automatically — fine-tune with swaps.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={props.onDone}
            className="scarlet-gloss blade condensed w-full cursor-pointer px-6 py-3 text-lg max-lg:order-3"
          >
            {props.doneLabel ?? 'READY →'}
          </button>
        </aside>
        <main className="order-1 flex min-h-0 flex-col lg:order-2">
          {props.banner}
          <header className="mb-2 flex items-baseline justify-between">
            <h1 className="condensed text-xl font-bold text-carbon">Adjust your side</h1>
            <p className="text-xs font-semibold text-carbon-600">
              {selected === null
                ? 'tap a player, then another to swap'
                : 'tap a second player to swap · tap again to cancel'}
            </p>
          </header>
          <div className="flex min-h-0 flex-1 justify-center">
            {/* mobile: cap the pitch (48dvh) so loot + LOCK fit the first screen;
                lg: the pitch keeps sizing itself from the viewport height */}
            <div className="aspect-[3/4] h-[48dvh] max-w-full lg:aspect-auto lg:h-full">
              <PitchBoard
                formation={props.formation}
                slate={props.xi}
                mode={props.mode}
                selectedSlot={selected}
                onSlotClick={tapSlot}
              />
            </div>
          </div>
        </main>
        {props.rightAside && (
          <aside className="scrollbar-hide min-h-0 max-lg:contents lg:order-3 lg:space-y-4 lg:overflow-y-auto">
            {props.rightAside}
          </aside>
        )}
      </div>
    </div>
  );
}
