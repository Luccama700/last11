import { useState } from 'react';
import { effectiveRatingV2 } from '../../engine/draft';
import type { AffinityFn, DraftMode, Formation, PlayingStyle, XiSlotV2 } from '../../engine/types';
import PitchBoard from './PitchBoard';
import TacticsRail from './TacticsRail';

/**
 * Between-match re-arrange (DECISIONS): tap two slots to swap the players on them,
 * and change playing style. Formation changes only BETWEEN ROUNDS — pass
 * `onChangeFormation` only when that's allowed. Reuses the draft board components.
 *
 * Integration seam: mount this in the battle interstitial once the v2 battle runs
 * on `ManagerV2` (owned with match-sim/architect). It is a pure controlled
 * component — `onSwap` re-slots via the tested `swapSlots` primitive; state lives
 * in the reducer (`REARRANGE_XI`), not here.
 */
export default function BetweenMatchBoard(props: {
  formation: Formation;
  xi: readonly XiSlotV2[];
  mode: DraftMode;
  style: PlayingStyle;
  affinity: AffinityFn;
  onSwap: (a: number, b: number) => void;
  onStyleChange: (style: PlayingStyle) => void;
  onChangeFormation?: () => void;
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
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto grid max-w-5xl gap-5 px-4 py-6 lg:grid-cols-[16rem_1fr]">
        <aside className="order-2 lg:order-1">
          <TacticsRail
            formationName={props.formation.name}
            style={props.style}
            onStyleChange={props.onStyleChange}
            mode={props.mode}
            strength={strength}
            filled={props.xi.length}
            slotCount={props.formation.slots.length}
            onChangeFormation={props.onChangeFormation}
          />
          <button
            type="button"
            onClick={props.onDone}
            className="mt-4 w-full rounded-xl bg-emerald-500 px-6 py-3 text-lg font-black text-slate-950 transition hover:bg-emerald-400"
          >
            READY →
          </button>
        </aside>
        <main className="order-1 lg:order-2">
          <header className="mb-3 flex items-baseline justify-between">
            <h1 className="text-xl font-black tracking-tight">Adjust your side</h1>
            <p className="text-xs font-semibold text-slate-500">
              {selected === null ? 'tap a player, then another to swap' : 'tap a second player to swap · tap again to cancel'}
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
