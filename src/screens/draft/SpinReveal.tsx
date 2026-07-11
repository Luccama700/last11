import { useEffect, useState } from 'react';
import { flagOf } from '../../game/flags';
import type { RolledTeam } from '../../engine/types';

/**
 * Two-beat spin: the flag highlight laps the available nations with ease-out and
 * lands on the target, then the World Cup year snaps in. Extends the v1 SpinWheel
 * juice to the (nation, year) roll. `animate === false` settles immediately (tests).
 */
export default function SpinReveal(props: {
  target: RolledTeam;
  nations: readonly { code: string; name: string }[];
  animate: boolean;
  onSettled: () => void;
}) {
  const nations = props.nations;
  const [highlight, setHighlight] = useState(-1);
  const [showYear, setShowYear] = useState(false);

  useEffect(() => {
    if (!props.animate) {
      props.onSettled();
      return;
    }
    const targetIndex = Math.max(0, nations.findIndex((n) => n.code === props.target.nation));
    const steps = nations.length + targetIndex; // one full lap, then land
    let step = 0;
    let timer: number;
    const tick = () => {
      step++;
      setHighlight(step % nations.length);
      if (step >= steps) {
        timer = window.setTimeout(() => {
          setShowYear(true);
          timer = window.setTimeout(props.onSettled, 700);
        }, 300);
        return;
      }
      const t = step / steps;
      timer = window.setTimeout(tick, 45 + 220 * t * t);
    };
    timer = window.setTimeout(tick, 45);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.target.nation, props.target.year]);

  return (
    <div className="flex flex-col items-center gap-6 rounded-2xl border border-slate-800 bg-slate-900 p-8">
      <div className="grid grid-cols-6 gap-3 text-3xl">
        {nations.map((n, i) => (
          <span
            key={n.code}
            className={`rounded-lg p-1 transition-transform duration-75 ${
              i === highlight
                ? 'scale-125 bg-emerald-500/20 ring-2 ring-emerald-400'
                : 'opacity-50'
            }`}
          >
            {flagOf(n.code)}
          </span>
        ))}
      </div>
      {showYear ? (
        <p className="animate-pop text-2xl font-black text-slate-100">
          {flagOf(props.target.nation)} {props.target.nation}{' '}
          <span className="text-emerald-400">{props.target.year}</span>
        </p>
      ) : (
        <p className="animate-pulse font-bold text-slate-400">Spinning…</p>
      )}
    </div>
  );
}
