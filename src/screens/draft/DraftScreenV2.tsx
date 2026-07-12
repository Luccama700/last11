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
  /** Mid-draft re-slot: move an already-placed player to an open slot. */
  onMove: (from: number, to: number) => void;
  onStyleChange: (style: PlayingStyle) => void;
  onEnterBattle: () => void;
}) {
  const { formation, humanSlate, affinity } = props;
  const slotCount = formation.slots.length;
  const filled = humanSlate.filter((s) => s !== null).length;
  const draftDone = filled === slotCount;

  const [settled, setSettled] = useState(false);
  const [pending, setPending] = useState<{ player: PlayerV2; glow: Set<number> } | null>(null);
  // Last landed roll + a spin nonce: the machine stays mounted (static layout,
  // shows the previous result between spins), and the nonce remounts the reels so
  // EVERY roll re-animates — including a re-spin that lands the same (nation, year)
  // (RESPIN+ROLL batch into one render; the roll object's identity is the signal).
  const [lastRoll, setLastRoll] = useState<RolledTeam | null>(null);
  const [spinNonce, setSpinNonce] = useState(0);
  useEffect(() => {
    setSettled(false);
    setPending(null);
    if (props.spunRoll !== null) {
      setLastRoll(props.spunRoll);
      setSpinNonce((n) => n + 1);
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
  const filledSlotSet = useMemo(
    () => new Set(humanSlate.map((s, i) => (s !== null ? i : -1)).filter((i) => i >= 0)),
    [humanSlate],
  );

  // Mid-draft move-mode: tap a placed player → open slots glow → tap one to move
  // him ("in case I find a better player for a position" — Lucca). Mutually
  // exclusive with pick-place mode.
  const [moveFrom, setMoveFrom] = useState<number | null>(null);
  useEffect(() => {
    setMoveFrom(null);
  }, [props.spunRoll, pending]);

  function placeAt(slotIndex: number) {
    if (!pending || humanSlate[slotIndex] !== null) return;
    props.onPlace(pending.player, slotIndex);
    setPending(null);
  }

  function boardTap(slotIndex: number) {
    if (pending) {
      placeAt(slotIndex);
      return;
    }
    if (moveFrom === null) {
      if (humanSlate[slotIndex] !== null) setMoveFrom(slotIndex);
      return;
    }
    if (slotIndex === moveFrom) {
      setMoveFrom(null);
      return;
    }
    if (humanSlate[slotIndex] === null) {
      props.onMove(moveFrom, slotIndex);
      setMoveFrom(null);
    }
  }

  const boardClickable = useMemo(() => {
    if (pending) return openSlotSet;
    if (moveFrom !== null) return new Set([...openSlotSet, moveFrom]);
    return filledSlotSet; // any placed player is tappable to start a move
  }, [pending, moveFrom, openSlotSet, filledSlotSet]);

  return (
    <div className="bg-stadium min-h-screen text-ink-100">
      {/* One-viewport desktop layout (Lucca's Image-#4 direction): LEFT rail =
          tactics + the rolled squad card, CENTER = pitch with the big gold SPIN
          beneath it, RIGHT = the slot machine (while drawing) over the box score.
          The machine lives in the RIGHT RAIL so the pitch column NEVER reflows
          mid-draft (Lucca's rule); rails scroll internally. */}
      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-4 lg:h-screen lg:grid-cols-[21rem_1fr_17rem]">
        {/* Left: tactics rail + squad flow. On mobile the rail dissolves
            (`max-lg:contents`) and its blocks join the single column with
            explicit orders: pitch+SPIN(1) → squad card(2) → the draw(3) →
            tactics(4) → box score(5) — the pick list sits right under the fold
            instead of a full pitch-height away. */}
        <aside className="scrollbar-hide max-lg:contents lg:order-1 lg:min-h-0 lg:space-y-4 lg:overflow-y-auto lg:pr-1">
          <div className="max-lg:order-4">
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
          </div>
          {/* Squad panel is ALWAYS mounted (static layout): content swaps inside
              one stable card instead of panels popping in and out. */}
          {!draftDone && (
            <div className="max-lg:order-2">
              {props.spunRoll !== null && revealed ? (
                <SquadCard
                  roll={props.spunRoll}
                  squadName={squadByRef(props.spunRoll.nation, props.spunRoll.year).name}
                  options={ranked}
                  mode={props.mode}
                  onPick={pickPlayer}
                  respinTokens={props.respinTokens}
                  onRespin={props.respinTokens > 0 ? props.onRespin : undefined}
                />
              ) : (
                <div className="card-gloss flex min-h-[9rem] items-center justify-center rounded-2xl p-4 text-center text-xs leading-relaxed text-ink-500">
                  {props.spunRoll !== null
                    ? 'Drawing…'
                    : 'Spin to draw a national team and a World Cup — the squad lands here.'}
                </div>
              )}
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
            {pending ? (
              <button
                type="button"
                onClick={() => setPending(null)}
                className="cursor-pointer text-xs font-semibold text-gold-300 hover:text-gold-400"
              >
                placing {pending.player.name} — tap a slot · cancel
              </button>
            ) : moveFrom !== null ? (
              <button
                type="button"
                onClick={() => setMoveFrom(null)}
                className="cursor-pointer text-xs font-semibold text-gold-300 hover:text-gold-400"
              >
                moving {humanSlate[moveFrom]?.player.name} — tap an open slot · cancel
              </button>
            ) : null}
          </header>

          <div className="lg:flex lg:min-h-0 lg:flex-1 lg:justify-center">
            {/* mobile: cap the pitch (48dvh) so SPIN + the squad card stay near
                the fold; lg: the pitch keeps sizing itself from the viewport */}
            <div className="mx-auto aspect-[3/4] h-[48dvh] max-w-full lg:mx-0 lg:aspect-auto lg:h-full">
              <PitchBoard
                formation={formation}
                slate={humanSlate}
                mode={props.mode}
                glowSlots={pending ? pending.glow : moveFrom !== null ? openSlotSet : null}
                clickableSlots={boardClickable}
                selectedSlot={moveFrom}
                onSlotClick={boardTap}
              />
            </div>
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
            ) : (
              // Stable-height action row: the button NEVER unmounts mid-draft, so
              // the pitch above keeps its exact size through spin → pick → repeat.
              <div className="flex items-center justify-center gap-4 py-1">
                <button
                  type="button"
                  onClick={props.onSpin}
                  disabled={props.spunRoll !== null}
                  data-tour="spin-button"
                  className={`headline rounded-full px-16 py-4 text-2xl transition ${
                    props.spunRoll === null
                      ? 'btn-gold cursor-pointer'
                      : 'cursor-default border border-night-600 bg-night-800 text-ink-500 opacity-60'
                  }`}
                >
                  SPIN 🎡
                </button>
                {props.spunRoll !== null && revealed && (
                  <p className="max-w-[14rem] text-xs text-ink-500">
                    Pick from the <span className="font-bold text-gold-300">squad card</span> —
                    best boosts first{props.respinTokens > 0 ? ' · or re-spin' : ''}.
                  </p>
                )}
              </div>
            )}
          </div>
        </main>

        {/* Right: THE DRAW machine (always mounted — spins live, then holds the
            last result) over the box score. Dissolves into the mobile column
            like the left rail. */}
        <aside className="scrollbar-hide max-lg:contents lg:order-3 lg:min-h-0 lg:space-y-4 lg:overflow-y-auto">
          <div className="max-lg:order-3">
            {lastRoll !== null || props.spunRoll !== null ? (
              <SpinReveal
                key={spinNonce}
                target={props.spunRoll ?? lastRoll!}
                nations={nations}
                animate={props.animate}
                onSettled={() => setSettled(true)}
                active={props.spunRoll !== null && !revealed}
              />
            ) : (
              <div className="card-gloss flex min-h-[12rem] flex-col items-center justify-center gap-2 rounded-2xl !border-gold-600/40 p-3.5">
                <p className="headline text-[10px] tracking-[0.4em] text-gold-400">THE DRAW</p>
                <p className="text-center text-xs text-ink-500">Hit SPIN to fire the reels.</p>
              </div>
            )}
          </div>
          <div className="max-lg:order-5">
            <BoxScorePanel slate={humanSlate} />
          </div>
        </aside>
      </div>
    </div>
  );
}
