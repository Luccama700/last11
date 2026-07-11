import { useEffect, useMemo, useState } from 'react';
import type { PlayerV2 } from '../../engine/data/schema';
import {
  draftOptionsV2,
  effectiveRatingV2,
  slotFitsForPlayer,
  sortByBoost,
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
  // Always ranked by the biggest boost to squad points (Lucca's rule).
  const ranked = useMemo(
    () => sortByBoost(options, humanSlate, formation, affinity),
    [options, humanSlate, formation, affinity],
  );
  const strength = strengthOf(humanSlate, affinity);

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
    <div className="bg-stadium min-h-screen text-ink-100">
      {/* One-viewport desktop layout (Lucca's Image-#4 direction): LEFT rail =
          tactics + the rolled squad card, CENTER = pitch with the big gold SPIN
          beneath it, RIGHT = box score. The rail scrolls internally; the pitch
          flexes to the leftover height so the page itself never scrolls. */}
      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-4 lg:h-screen lg:grid-cols-[21rem_1fr_15rem]">
        {/* Left: tactics rail + squad flow */}
        <aside className="order-2 space-y-4 lg:order-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
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
          {props.spunRoll !== null && revealed && !draftDone && (
            <SquadCard
              roll={props.spunRoll}
              squadName={squadByRef(props.spunRoll.nation, props.spunRoll.year).name}
              options={ranked}
              mode={props.mode}
              onPick={pickPlayer}
              respinTokens={props.respinTokens}
              onRespin={props.respinTokens > 0 ? props.onRespin : undefined}
            />
          )}
          {props.spunRoll === null && !draftDone && (
            <div className="card-gloss rounded-2xl p-4 text-center text-xs leading-relaxed text-ink-500">
              Spin to draw a national team and a World Cup — the squad lands here.
            </div>
          )}
        </aside>

        {/* Center: pitch + spin flow */}
        <main className="order-1 lg:order-2 lg:flex lg:min-h-0 lg:flex-col">
          <header className="mb-3 flex shrink-0 items-baseline justify-between">
            <h1 className="headline text-xl">
              <span className="text-ink-100">Last</span>
              <span className="headline-gold">11</span>
              <span className="ml-3 text-xs tracking-[0.3em] text-ink-500">THE DRAFT</span>
            </h1>
            {pending && (
              <button
                type="button"
                onClick={() => setPending(null)}
                className="cursor-pointer text-xs font-semibold text-gold-300 hover:text-gold-400"
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

          <div className="mt-3 shrink-0">
            {draftDone ? (
              <div className="card-gloss animate-gold-pulse flex flex-col items-center gap-3 rounded-2xl !border-gold-500/60 p-5 text-center">
                <p className="headline text-2xl text-ink-100">Your XI is locked in 🔒</p>
                <button
                  type="button"
                  onClick={props.onEnterBattle}
                  className="btn-gold headline cursor-pointer rounded-xl px-10 py-3.5 text-lg"
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
              <p className="py-2 text-center text-xs text-ink-500">
                Pick from the <span className="font-bold text-gold-300">squad card</span> — best
                boosts first{props.respinTokens > 0 ? ' · or re-spin' : ''}.
              </p>
            ) : (
              <div className="flex items-center justify-center gap-6 py-1">
                <button
                  type="button"
                  onClick={props.onSpin}
                  data-tour="spin-button"
                  className="btn-gold headline cursor-pointer rounded-full px-16 py-4 text-2xl"
                >
                  SPIN 🎡
                </button>
              </div>
            )}
          </div>
        </main>

        {/* Right: box score */}
        <aside className="order-3 lg:min-h-0 lg:overflow-y-auto">
          <BoxScorePanel slate={humanSlate} />
        </aside>
      </div>
    </div>
  );
}
