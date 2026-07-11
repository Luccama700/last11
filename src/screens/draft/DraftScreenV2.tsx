import { useEffect, useMemo, useState } from 'react';
import type { PlayerV2 } from '../../engine/data/schema';
import {
  draftOptionsV2,
  effectiveRatingV2,
  slotFitsForPlayer,
  type SlotFit,
} from '../../engine/draft';
import { squadByRef, v2Nations } from '../../engine/data/loader';
import type {
  AffinityFn,
  DraftMode,
  Formation,
  PlayingStyle,
  RolledTeam,
  XiSlotV2,
} from '../../engine/types';
import PitchBoard from '../board/PitchBoard';
import TacticsRail from '../board/TacticsRail';
import BoxScorePanel from '../board/BoxScorePanel';
import SquadCard from './SquadCard';
import SpinReveal from './SpinReveal';

function strengthOf(slate: readonly (XiSlotV2 | null)[], aff: AffinityFn): number {
  let total = 0;
  for (const s of slate) if (s) total += effectiveRatingV2(s.player, s.position, aff);
  return total;
}

/**
 * v2 free-pick draft. Spin lands a (nation, year); pick any squad player and place
 * him into any open slot on the pitch. A lone natural slot auto-places; otherwise
 * place-mode glows the compatible slots (off-position anywhere still allowed).
 */
export default function DraftScreenV2(props: {
  formation: Formation;
  mode: DraftMode;
  style: PlayingStyle;
  respinTokens: number;
  spunRoll: RolledTeam | null;
  humanSlate: (XiSlotV2 | null)[];
  animate: boolean;
  affinity: AffinityFn;
  onSpin: () => void;
  onRespin: () => void;
  onPlace: (player: PlayerV2, slotIndex: number) => void;
  onStyleChange: (style: PlayingStyle) => void;
  onEnterBattle: () => void;
}) {
  const { formation, humanSlate, affinity } = props;
  const slotCount = formation.slots.length;
  const filled = humanSlate.filter((s) => s !== null).length;
  const draftDone = filled === slotCount;

  const [settled, setSettled] = useState(false);
  const [pending, setPending] = useState<{ player: PlayerV2; glow: Set<number> } | null>(null);

  // A fresh roll (or a cleared one after placing) resets the reveal + place-mode.
  useEffect(() => {
    if (props.spunRoll === null) {
      setSettled(false);
      setPending(null);
    }
  }, [props.spunRoll]);

  const revealed = props.spunRoll !== null && (settled || !props.animate);
  const nations = useMemo(() => v2Nations(2026), []);
  const options = props.spunRoll ? draftOptionsV2(humanSlate, props.spunRoll) : [];
  const strength = strengthOf(humanSlate, affinity);

  const bestFitOf = (player: PlayerV2): SlotFit | undefined =>
    slotFitsForPlayer(humanSlate, formation, player, affinity)[0];

  function pickPlayer(player: PlayerV2) {
    const fits = slotFitsForPlayer(humanSlate, formation, player, affinity);
    if (fits.length === 0) return; // no open slot (shouldn't happen pre-complete)
    const natural = fits.filter((f) => f.natural);
    if (natural.length === 1) {
      props.onPlace(player, natural[0].slotIndex);
      return;
    }
    const glowSource = natural.length > 0 ? natural : fits;
    setPending({ player, glow: new Set(glowSource.map((f) => f.slotIndex)) });
  }

  const openSlotSet = useMemo(
    () => new Set(humanSlate.map((s, i) => (s === null ? i : -1)).filter((i) => i >= 0)),
    [humanSlate],
  );

  function placeAt(slotIndex: number) {
    if (!pending || humanSlate[slotIndex] !== null) return;
    props.onPlace(pending.player, slotIndex);
    setPending(null);
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* On desktop the whole draft fits ONE viewport: the grid is h-screen, the
          pitch flexes to the leftover height (aspect keeps it in proportion), and
          the squad card scrolls internally instead of growing the page. */}
      <div className="mx-auto grid max-w-6xl gap-5 px-4 py-4 lg:h-screen lg:grid-cols-[16rem_1fr_15rem]">
        {/* Left: tactics rail */}
        <aside className="order-2 lg:order-1 lg:min-h-0 lg:overflow-y-auto">
          <TacticsRail
            formationName={formation.name}
            style={props.style}
            onStyleChange={props.onStyleChange}
            mode={props.mode}
            respinTokens={props.respinTokens}
            strength={strength}
            filled={filled}
            slotCount={slotCount}
          />
        </aside>

        {/* Center: pitch + spin/squad flow */}
        <main className="order-1 lg:order-2 lg:flex lg:min-h-0 lg:flex-col">
          <header className="mb-3 flex shrink-0 items-baseline justify-between">
            <h1 className="text-xl font-black tracking-tight">
              Last<span className="text-emerald-400">11</span>
              <span className="ml-2 text-xs font-semibold text-slate-500">THE DRAFT</span>
            </h1>
            {pending && (
              <button
                type="button"
                onClick={() => setPending(null)}
                className="text-xs font-semibold text-amber-300 hover:text-amber-200"
              >
                placing {pending.player.name} — tap a slot · cancel
              </button>
            )}
          </header>

          <div className="lg:flex lg:min-h-0 lg:flex-1 lg:justify-center">
            <PitchBoard
              formation={formation}
              slate={humanSlate}
              mode={props.mode}
              glowSlots={pending?.glow ?? null}
              clickableSlots={pending ? openSlotSet : null}
              onSlotClick={pending ? placeAt : undefined}
            />
          </div>

          <div className="mt-3 lg:max-h-[44vh] lg:shrink-0 lg:overflow-y-auto">
            {draftDone ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-emerald-500/30 bg-slate-900 p-6 text-center">
                <p className="text-2xl font-black">Your XI is locked in 🔒</p>
                <button
                  type="button"
                  onClick={props.onEnterBattle}
                  className="rounded-xl bg-emerald-500 px-8 py-3.5 text-lg font-black text-slate-950 shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400"
                >
                  ENTER THE ARENA →
                </button>
              </div>
            ) : props.spunRoll !== null && !revealed ? (
              <SpinReveal
                target={props.spunRoll}
                nations={nations}
                animate={props.animate}
                onSettled={() => setSettled(true)}
              />
            ) : props.spunRoll !== null ? (
              <SquadCard
                roll={props.spunRoll}
                squadName={squadByRef(props.spunRoll.nation, props.spunRoll.year).name}
                players={options}
                mode={props.mode}
                bestFitOf={bestFitOf}
                onPick={pickPlayer}
                respinTokens={props.respinTokens}
                onRespin={props.respinTokens > 0 ? props.onRespin : undefined}
              />
            ) : (
              <div className="flex flex-col items-center gap-5 rounded-2xl border border-slate-800 bg-slate-900 p-8">
                <p className="text-center text-slate-400">
                  Spin the wheel — land a nation &amp; World Cup year, then pick any player into an open slot.
                </p>
                <button
                  type="button"
                  onClick={props.onSpin}
                  data-tour="spin-button"
                  className="rounded-full bg-emerald-500 px-12 py-5 text-2xl font-black text-slate-950 shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400"
                >
                  SPIN 🎡
                </button>
              </div>
            )}
          </div>
        </main>

        {/* Right: box score */}
        <aside className="order-3">
          <BoxScorePanel slate={humanSlate} />
        </aside>
      </div>
    </div>
  );
}
