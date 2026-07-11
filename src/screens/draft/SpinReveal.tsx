import { useEffect, useMemo, useRef, useState } from 'react';
import { squadRefsV2 } from '../../engine/data/loader';
import { flagOf } from '../../game/flags';
import type { RolledTeam } from '../../engine/types';

const ROW_H = 56; // px per reel row; 3 rows visible, centre row is the payline
const NATION_LAND_MS = 1500;
const YEAR_LAND_MS = 2450; // year reel keeps running after the nation locks — anticipation
const SETTLE_MS = 3150; // banner beat, then hand back to the board

/**
 * THE DRAW as a slot machine: two vertical reels behind a gold payline — the
 * NATION reel locks first, the YEAR reel holds the suspense and locks late.
 * Motion-blurred while fast, mechanical overshoot on the stop, lamp rails that
 * blink while spinning and go solid gold on lock. Purely cosmetic and
 * deterministic per roll; `animate === false` settles immediately (tests).
 */
export default function SpinReveal(props: {
  target: RolledTeam;
  nations: readonly { code: string; name: string }[];
  animate: boolean;
  onSettled: () => void;
  /** false = static display of an already-landed draw (machine stays mounted
   *  between spins — no reels, no timers, no onSettled). Default true. */
  active?: boolean;
}) {
  const active = props.active ?? true;
  const [nationLocked, setNationLocked] = useState(!active);
  const [yearLocked, setYearLocked] = useState(!active);

  // Deterministic per-roll variety: rotate the reel order by a hash of the roll.
  const seed = useMemo(() => {
    const s = `${props.target.nation}-${props.target.year}`;
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }, [props.target.nation, props.target.year]);

  // Both reels put the target two rows from the END: the payline lands with
  // visible symbols still below it, so where it stops isn't telegraphed by the
  // column simply running out (Lucca's note).
  const nationSeq = useMemo(() => {
    const pool = props.nations.length > 0 ? props.nations.map((n) => n.code) : [props.target.nation];
    const rotated = pool.map((_, i) => pool[(i + seed) % pool.length]);
    const after = [rotated[0] ?? props.target.nation, rotated[1 % rotated.length] ?? props.target.nation];
    return {
      items: [...rotated, ...rotated, ...rotated.slice(0, Math.max(2, rotated.length >> 1)), props.target.nation, ...after],
      targetIndex: rotated.length * 2 + Math.max(2, rotated.length >> 1),
    };
  }, [props.nations, props.target.nation, seed]);

  const yearSeq = useMemo(() => {
    const years = [...new Set(squadRefsV2().map((r) => r.year))].sort((a, b) => a - b);
    const pool = years.length > 1 ? years : [props.target.year];
    const rotated = pool.map((_, i) => pool[(i + seed) % pool.length]);
    const laps = Math.max(3, Math.ceil(24 / pool.length));
    const seq: number[] = [];
    for (let l = 0; l < laps; l++) seq.push(...rotated);
    const targetIndex = seq.length;
    seq.push(props.target.year, rotated[0] ?? props.target.year, rotated[1 % rotated.length] ?? props.target.year);
    return { items: seq, targetIndex };
  }, [props.target.year, seed]);

  useEffect(() => {
    if (!active) return; // static display — nothing to run
    if (!props.animate) {
      props.onSettled();
      return;
    }
    const t1 = window.setTimeout(() => setNationLocked(true), NATION_LAND_MS);
    const t2 = window.setTimeout(() => setYearLocked(true), YEAR_LAND_MS);
    const t3 = window.setTimeout(props.onSettled, SETTLE_MS);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, props.target.nation, props.target.year]);

  const bothLocked = nationLocked && yearLocked;

  return (
    // Rail-sized machine: fills the right rail (~17rem) without ever touching the
    // pitch column's layout. Compact reels, same drama.
    <div
      className={`card-gloss relative flex w-full flex-col items-center gap-2.5 rounded-2xl !border-gold-600/60 p-3.5 ${
        bothLocked ? 'animate-gold-pulse' : ''
      }`}
    >
      <p className="headline text-[10px] tracking-[0.4em] text-gold-400">THE DRAW</p>

      <div className="flex items-stretch gap-2">
        <LampRail locked={bothLocked} />
        <Reel
          items={nationSeq.items.map((code) => (
            <span className="flex items-center gap-1.5">
              <span className="text-2xl">{flagOf(code)}</span>
              <span className="headline text-base text-ink-100">{code}</span>
            </span>
          ))}
          targetIndex={nationSeq.targetIndex}
          landMs={active ? NATION_LAND_MS : 0}
          locked={nationLocked}
          wide
        />
        <Reel
          items={yearSeq.items.map((y) => (
            <span className="headline text-xl tabular-nums text-ink-100">{y}</span>
          ))}
          targetIndex={yearSeq.targetIndex}
          landMs={active ? YEAR_LAND_MS : 0}
          locked={yearLocked}
        />
        <LampRail locked={bothLocked} />
      </div>

      {bothLocked ? (
        <p className="animate-kick-pop headline text-lg text-ink-100">
          {flagOf(props.target.nation)} {props.target.nation}{' '}
          <span className="headline-gold">{props.target.year}</span>
        </p>
      ) : (
        <p className="animate-pulse text-xs font-bold tracking-widest text-ink-500">
          {nationLocked ? 'WHICH YEAR…' : 'SPINNING…'}
        </p>
      )}
    </div>
  );
}

/** One vertical reel: a translating column behind a 3-row window with a gold
 *  payline. Blurred while fast; overshoot easing sells the mechanical stop. */
function Reel(props: {
  items: React.ReactNode[];
  /** Index of the item that must land on the payline (rows exist after it). */
  targetIndex: number;
  landMs: number;
  locked: boolean;
  wide?: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);

  // Item i's on-screen top = i·ROW_H + offset + ROW_H, and the payline row starts
  // at ROW_H ⇒ offset = -targetIndex·ROW_H centres the target on the payline —
  // with look-ahead rows still visible beneath it.
  const finalOffset = -props.targetIndex * ROW_H;

  useEffect(() => {
    setOffset(0);
    setSpinning(true);
    // next frame so the transition animates from 0
    const raf = requestAnimationFrame(() => setOffset(finalOffset));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalOffset]);

  useEffect(() => {
    if (props.locked) setSpinning(false);
  }, [props.locked]);

  return (
    <div
      ref={frameRef}
      className={`relative overflow-hidden rounded-xl border bg-night-950 ${
        props.locked ? 'border-gold-400 animate-slot-shake' : 'border-night-600'
      } ${props.wide ? 'w-[6.6rem]' : 'w-[4.4rem]'}`}
      style={{ height: ROW_H * 3 }}
    >
      {/* the moving column */}
      <div
        className={spinning && !props.locked ? 'reel-blur' : ''}
        style={{
          transform: `translateY(${offset + ROW_H}px)`,
          transition: `transform ${props.landMs}ms cubic-bezier(0.12, 0.82, 0.22, 1.04)`,
        }}
      >
        {props.items.map((it, i) => (
          <div key={i} className="flex items-center justify-center" style={{ height: ROW_H }}>
            {it}
          </div>
        ))}
      </div>

      {/* window shading + payline */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-night-950 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-night-950 to-transparent" />
        <div
          className={`absolute inset-x-1 top-1/2 -translate-y-1/2 rounded-lg border ${
            props.locked ? 'border-gold-400/90' : 'border-gold-600/30'
          }`}
          style={{ height: ROW_H - 6 }}
        />
        {props.locked && (
          <div
            className="payline-flash absolute inset-x-1 top-1/2 -translate-y-1/2 rounded-lg bg-gold-300/25"
            style={{ height: ROW_H - 6 }}
          />
        )}
      </div>
    </div>
  );
}

function LampRail(props: { locked: boolean }) {
  return (
    <div className="flex flex-col justify-between py-1">
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full bg-gold-400 ${props.locked ? 'lamp-locked' : 'lamp'}`}
          style={{ animationDelay: `${i * 90}ms` }}
        />
      ))}
    </div>
  );
}
