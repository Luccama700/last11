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
    <div className="bg-stadium min-h-screen text-ink-100">
      <div className="mx-auto grid max-w-5xl gap-5 px-4 py-6 lg:grid-cols-[16rem_1fr]">
        <aside className="order-2 space-y-4 lg:order-1">
          <TacticsRail
            formationName={props.formation.name}
            style={props.style}
            onStyleChange={props.onStyleChange}
            mode={props.mode}
            strength={strength}
            filled={props.xi.length}
            slotCount={props.formation.slots.length}
          />

          {props.onFormationChange && (
            <div className="card-gloss rounded-2xl p-4">
              <h2 className="headline mb-2 text-[11px] tracking-[0.25em] text-ink-500">
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
                      className={`cursor-pointer truncate rounded-lg px-1.5 py-1.5 text-[11px] font-bold transition ${
                        active ? 'btn-gold' : 'bg-night-700 text-ink-300 hover:bg-night-600'
                      }`}
                      title={f.name}
                    >
                      {f.name}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[10px] leading-snug text-ink-500">
                A new shape re-slots your XI automatically — fine-tune with swaps.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={props.onDone}
            className="btn-gold headline w-full cursor-pointer rounded-xl px-6 py-3 text-lg"
          >
            READY →
          </button>
        </aside>
        <main className="order-1 lg:order-2">
          <header className="mb-3 flex items-baseline justify-between">
            <h1 className="headline text-xl text-ink-100">Adjust your side</h1>
            <p className="text-xs font-semibold text-ink-500">
              {selected === null
                ? 'tap a player, then another to swap'
                : 'tap a second player to swap · tap again to cancel'}
            </p>
          </header>
          <PitchBoard
            formation={props.formation}
            slate={props.xi}
            mode={props.mode}
            selectedSlot={selected}
            onSlotClick={tapSlot}
          />
        </main>
      </div>
    </div>
  );
}
