import { useEffect, useRef, useState } from 'react';
import { formationById, type MatchTimeline, type Team } from '../engine/types';
import { humanOf, type GameState, type Matchday } from '../game/state';
import {
  dotView,
  formationAnchors,
  matchEndMs,
  projectMatch,
  type PlaybackState,
} from '../game/playback';

/**
 * On-screen match playback (MATCH-SIM). Owns the ONLY stateful piece — a single
 * rAF clock — and renders every pixel from the pure `projectMatch(timeline,
 * elapsed)`. Swap the clock's start for a server timestamp and this becomes the
 * multiplayer view unchanged (CONTRACT §5).
 *
 * With `animate === false` (tests/headless) no clock runs: the terminal fires
 * synchronously, so playback is skipped exactly like the instant reveal.
 */
export default function MatchPlaybackScreen(props: {
  state: GameState;
  animate: boolean;
  onNextFeatured: () => void;
  onFinishRound: () => void;
  onSkipAll: () => void;
}) {
  const { state, animate } = props;
  const md = state.matchday!;
  const timeline = md.featured[md.featuredIndex];
  const isLast = md.featuredIndex >= md.featured.length - 1;

  // the terminal decision; the clock fires it EXACTLY once per match (guarded there)
  const finishMatch = () => (isLast ? props.onFinishRound() : props.onNextFeatured());

  const [speed, setSpeed] = useState(1);
  const [elapsed, skipMatch] = useMatchClock(timeline.matchId, matchEndMs(timeline), { speed, animate, onEnd: finishMatch });
  const pb = projectMatch(timeline, elapsed);

  const human = humanOf(state);
  const nameOf = (id: string) => state.managers.find((m) => m.id === id)?.name ?? id;
  const humanIsHome = human ? timeline.homeId === human.id : true;
  const homeYou = humanIsHome;

  return (
    <div className="space-y-3">
      <Scoreboard
        timeline={timeline}
        pb={pb}
        homeName={nameOf(timeline.homeId)}
        awayName={nameOf(timeline.awayId)}
        homeYou={homeYou}
        matchNo={md.featuredIndex + 1}
        matchTotal={md.featured.length}
      />

      <Pitch timeline={timeline} pb={pb} elapsed={elapsed} homeYou={homeYou} />

      <MomentumBar pb={pb} homeYou={homeYou} />

      <Ticker pb={pb} />

      {pb.shootout && <ShootoutOverlay pb={pb} homeName={nameOf(timeline.homeId)} awayName={nameOf(timeline.awayId)} homeYou={homeYou} />}

      <Controls
        speed={speed}
        setSpeed={setSpeed}
        onSkipMatch={skipMatch}
        onSkipAll={props.onSkipAll}
        isLast={isLast}
      />

      <Rail md={md} nameOf={nameOf} virtualMinute={pb.virtualMinute} humanId={human?.id} />
    </div>
  );
}

/**
 * Single rAF clock via delta-accumulation (robust to speed changes; solo-only
 * speed control is why we don't use the pure (now−start) MP form here — under
 * multiplayer the clock becomes `elapsed = now − serverStartTs` at 1×).
 * Returns `[elapsedMs, skip]`; fires `onEnd` EXACTLY once per match (guarded,
 * reset on a new `key`). `animate === false` ⇒ jump to the end synchronously.
 */
function useMatchClock(
  key: string,
  durationMs: number,
  opts: { speed: number; animate: boolean; onEnd: () => void },
): [number, () => void] {
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  const lastRef = useRef<number | null>(null);
  const rafRef = useRef(0);
  const endedRef = useRef(false);
  const speedRef = useRef(opts.speed);
  speedRef.current = opts.speed;
  const animateRef = useRef(opts.animate);
  animateRef.current = opts.animate;
  const onEndRef = useRef(opts.onEnd);
  onEndRef.current = opts.onEnd;

  const fire = () => {
    if (endedRef.current) return;
    endedRef.current = true;
    onEndRef.current();
  };
  const skip = () => {
    cancelAnimationFrame(rafRef.current);
    elapsedRef.current = durationMs;
    setElapsed(durationMs);
    fire();
  };
  const skipRef = useRef(skip);
  skipRef.current = skip;

  useEffect(() => {
    // reset for a new match (key = matchId)
    elapsedRef.current = 0;
    lastRef.current = null;
    endedRef.current = false;
    setElapsed(0);

    if (!animateRef.current) {
      setElapsed(durationMs);
      fire();
      return;
    }

    const tick = (now: number) => {
      if (lastRef.current === null) lastRef.current = now;
      const dt = now - lastRef.current;
      lastRef.current = now;
      elapsedRef.current = Math.min(durationMs, elapsedRef.current + dt * speedRef.current);
      setElapsed(elapsedRef.current);
      if (elapsedRef.current >= durationMs) {
        fire();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, durationMs]);

  return [elapsed, () => skipRef.current()];
}

// ---------------------------------------------------------------------------

function Scoreboard(props: {
  timeline: MatchTimeline;
  pb: PlaybackState;
  homeName: string;
  awayName: string;
  homeYou: boolean;
  matchNo: number;
  matchTotal: number;
}) {
  const { pb } = props;
  const homeColor = props.homeYou ? 'text-emerald-400' : 'text-rose-400';
  const awayColor = props.homeYou ? 'text-rose-400' : 'text-emerald-400';
  const fmt = (id: string) => formationById(id)?.name ?? id;
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex flex-col gap-0.5">
        {props.homeYou && <span className="w-fit rounded bg-emerald-500 px-1.5 py-0.5 text-[9px] font-black text-slate-950">YOU</span>}
        <span className={`text-sm font-black ${homeColor}`}>{props.homeName}</span>
        <span className="text-[10px] text-slate-500">{fmt(props.timeline.homeFormationId)}</span>
      </div>
      <div className="text-center">
        <div className="flex items-center justify-center gap-2 text-3xl font-black tabular-nums">
          <span>{pb.score.home}</span>
          <span className="text-slate-600">–</span>
          <span>{pb.score.away}</span>
        </div>
        <div className="mt-0.5 text-[11px] font-bold text-amber-400">{pb.clockLabel}</div>
        <div className="text-[9px] uppercase tracking-widest text-slate-600">
          your match {props.matchNo}/{props.matchTotal}
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        {!props.homeYou && <span className="w-fit rounded bg-emerald-500 px-1.5 py-0.5 text-[9px] font-black text-slate-950">YOU</span>}
        <span className={`text-sm font-black ${awayColor}`}>{props.awayName}</span>
        <span className="text-[10px] text-slate-500">{fmt(props.timeline.awayFormationId)}</span>
      </div>
    </div>
  );
}

function Pitch(props: { timeline: MatchTimeline; pb: PlaybackState; elapsed: number; homeYou: boolean }) {
  const { timeline, pb, elapsed } = props;
  const homeDot = props.homeYou ? 'bg-emerald-400 border-emerald-800' : 'bg-rose-400 border-rose-800';
  const awayDot = props.homeYou ? 'bg-rose-400 border-rose-800' : 'bg-emerald-400 border-emerald-800';

  const homeAnchors = formationAnchors(timeline.homeFormationId);
  const awayAnchors = formationAnchors(timeline.awayFormationId);
  const homeDots = homeAnchors.map((a, i) => dotView('home', a, pb.ball, pb.possession, elapsed, i));
  const awayDots = awayAnchors.map((a, i) => dotView('away', a, pb.ball, pb.possession, elapsed, i + 40));

  return (
    <div
      className="relative w-full overflow-hidden rounded-xl border border-emerald-950"
      style={{
        aspectRatio: '16 / 10',
        background: 'repeating-linear-gradient(90deg,#0b3d24 0 8.33%,#0e4a2c 8.33% 16.66%)',
        boxShadow: 'inset 0 0 60px rgba(0,0,0,.5)',
      }}
    >
      {/* pitch markings */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/25" />
        <div className="absolute left-1/2 top-1/2 aspect-square w-[20%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/25" />
        <div className="absolute left-0 top-[22%] h-[56%] w-[14%] border-2 border-l-0 border-white/25" />
        <div className="absolute right-0 top-[22%] h-[56%] w-[14%] border-2 border-r-0 border-white/25" />
      </div>

      {[...homeDots.map((d, i) => ({ d, cls: homeDot, key: `h${i}` })), ...awayDots.map((d, i) => ({ d, cls: awayDot, key: `a${i}` }))].map(
        ({ d, cls, key }) => (
          <div
            key={key}
            className={`absolute aspect-square w-[2.6%] -translate-x-1/2 -translate-y-1/2 rounded-full border ${cls} ${d.isGK ? 'ring-2 ring-amber-200' : ''}`}
            style={{ left: `${d.x * 100}%`, top: `${d.y * 100}%` }}
          />
        ),
      )}

      {/* ball */}
      <div
        className="absolute aspect-square w-[2.1%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,.7)]"
        style={{ left: `${pb.ball.x * 100}%`, top: `${pb.ball.y * 100}%` }}
      />

      {/* goal celebration flash */}
      {pb.celebrating && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-[12vw] font-black text-amber-300 drop-shadow-[0_0_30px_rgba(252,211,77,.7)]">GOAL</span>
        </div>
      )}
    </div>
  );
}

function MomentumBar(props: { pb: PlaybackState; homeYou: boolean }) {
  const p = props.pb.momentum;
  const w = Math.abs(p) * 50;
  const homeColor = props.homeYou ? 'bg-emerald-400' : 'bg-rose-400';
  const awayColor = props.homeYou ? 'bg-rose-400' : 'bg-emerald-400';
  return (
    <div className="relative h-2.5 overflow-hidden rounded-md border border-slate-800 bg-slate-950">
      <div className="absolute inset-y-0 left-1/2 w-px bg-slate-700" />
      <div className={`absolute inset-y-0 left-1/2 ${homeColor} opacity-40`} style={{ width: `${p > 0 ? w : 0}%` }} />
      <div className={`absolute inset-y-0 right-1/2 ${awayColor} opacity-40`} style={{ width: `${p < 0 ? w : 0}%` }} />
    </div>
  );
}

function Ticker(props: { pb: PlaybackState }) {
  const { ticker } = props.pb;
  return (
    <div className="flex min-h-[42px] flex-col justify-center gap-0.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
      {ticker.length === 0 ? (
        <p className="text-xs text-slate-600">…</p>
      ) : (
        ticker.map((e, i) => (
          <p key={i} className={`flex gap-2 text-xs ${i < ticker.length - 1 ? 'opacity-45' : ''}`}>
            <span className={`w-8 shrink-0 font-black ${e.type === 'goal' ? 'text-amber-400' : 'text-slate-500'}`}>{e.minute}'</span>
            <span className={e.type === 'goal' ? 'font-bold text-amber-300' : 'text-slate-300'}>{e.text}</span>
          </p>
        ))
      )}
    </div>
  );
}

function ShootoutOverlay(props: { pb: PlaybackState; homeName: string; awayName: string; homeYou: boolean }) {
  const so = props.pb.shootout!;
  const pip = (team: Team) => so.taken.filter((k) => k.team === team);
  const dotFor = (scored: boolean) => (scored ? 'bg-amber-400 border-amber-400' : 'bg-slate-700 border-slate-600');
  const line =
    so.winner !== null
      ? `${so.winner === 'home' ? props.homeName : props.awayName} win the shootout ${so.home}–${so.away}.`
      : so.stepping !== null
        ? `${so.stepping === 'home' ? props.homeName : props.awayName} steps up…`
        : so.lastResult === 'scored'
          ? 'Scored! ✓'
          : so.lastResult === 'missed'
            ? 'Missed ×'
            : '';
  const row = (team: Team, label: string, you: boolean) => (
    <div className="flex flex-col items-center gap-1">
      <span className={`text-[10px] uppercase tracking-wider ${you ? 'text-emerald-400' : 'text-rose-400'}`}>{label}</span>
      <div className="flex gap-1">
        {pip(team).map((k, i) => (
          <span key={i} className={`h-3.5 w-3.5 rounded-full border ${dotFor(k.scored)}`} />
        ))}
      </div>
    </div>
  );
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-amber-500/40 bg-slate-900 p-4">
      <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-amber-400">Penalty shootout</h4>
      <div className="flex items-center gap-6 text-2xl font-black tabular-nums">
        <span className={props.homeYou ? 'text-emerald-400' : 'text-rose-400'}>{so.home}</span>
        <span className="text-slate-600">–</span>
        <span className={props.homeYou ? 'text-rose-400' : 'text-emerald-400'}>{so.away}</span>
      </div>
      <div className="flex gap-8">
        {row('home', props.homeName, props.homeYou)}
        {row('away', props.awayName, !props.homeYou)}
      </div>
      <p className={`min-h-[20px] text-sm font-bold ${so.lastResult === 'missed' && so.winner === null ? 'text-rose-400' : 'text-amber-300'}`}>{line}</p>
    </div>
  );
}

function Controls(props: {
  speed: number;
  setSpeed: (n: number) => void;
  onSkipMatch: () => void;
  onSkipAll: () => void;
  isLast: boolean;
}) {
  return (
    <div className="flex justify-center gap-2">
      {[1, 2].map((s) => (
        <button
          key={s}
          onClick={() => props.setSpeed(s)}
          className={`rounded-lg border px-3 py-1.5 text-sm font-bold ${
            props.speed === s ? 'border-emerald-400 bg-emerald-500 text-slate-950' : 'border-slate-700 bg-slate-800 text-slate-100'
          }`}
        >
          {s}×
        </button>
      ))}
      <button onClick={props.onSkipMatch} className="rounded-lg px-3 py-1.5 text-sm font-bold text-slate-400 hover:text-slate-200">
        {props.isLast ? 'skip to table ▸▸' : 'skip match ▸'}
      </button>
      {!props.isLast && (
        <button onClick={props.onSkipAll} className="rounded-lg px-3 py-1.5 text-sm font-bold text-slate-500 hover:text-slate-300">
          skip all ▸▸
        </button>
      )}
    </div>
  );
}

function Rail(props: { md: Matchday; nameOf: (id: string) => string; virtualMinute: number; humanId?: string }) {
  const short = (name: string) => (name.length > 12 ? name.slice(0, 11) + '…' : name);
  const scoreAt = (goals: { minute: number; team: Team }[]) => {
    let h = 0;
    let a = 0;
    for (const g of goals) if (g.minute <= props.virtualMinute) g.team === 'home' ? h++ : a++;
    return `${h}–${a}`;
  };
  if (props.md.rail.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-slate-600">Elsewhere this round</h3>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {props.md.rail.map((m) => (
          <div key={m.matchId} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-[11px]">
            <span className="truncate text-slate-400">
              {short(props.nameOf(m.homeId))} <span className="text-slate-600">v</span> {short(props.nameOf(m.awayId))}
            </span>
            <span className="ml-2 shrink-0 font-bold tabular-nums text-amber-400">{scoreAt(m.goals)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
