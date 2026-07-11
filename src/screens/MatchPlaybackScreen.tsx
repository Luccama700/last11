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
 * On-screen match playback (Gold & Stadium Night). Owns the ONLY stateful piece —
 * a single rAF clock — and renders every pixel from the pure `projectMatch`.
 * Penalty shootouts play as an OVERLAY ON THE PITCH (never below the fold),
 * kicks revealed one by one on the 6s beat from playback.ts. Lineup rails with
 * ratings flank the pitch on desktop.
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
  const managerOf = (id: string) => state.managers.find((m) => m.id === id);
  const nameOf = (id: string) => managerOf(id)?.name ?? id;
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

      <div className="grid gap-3 lg:grid-cols-[11.5rem_1fr_11.5rem]">
        <LineupRail
          title={nameOf(timeline.homeId)}
          xi={managerOf(timeline.homeId)?.xi ?? []}
          you={homeYou}
          side="home"
        />
        <Pitch timeline={timeline} pb={pb} elapsed={elapsed} homeYou={homeYou}>
          {pb.shootout && (
            <ShootoutOverlay
              pb={pb}
              homeName={nameOf(timeline.homeId)}
              awayName={nameOf(timeline.awayId)}
              homeYou={homeYou}
            />
          )}
        </Pitch>
        <LineupRail
          title={nameOf(timeline.awayId)}
          xi={managerOf(timeline.awayId)?.xi ?? []}
          you={!homeYou}
          side="away"
        />
      </div>

      <MomentumBar pb={pb} homeYou={homeYou} />

      <div className="grid items-start gap-3 sm:grid-cols-[1fr_auto]">
        <Ticker pb={pb} />
        <Controls
          speed={speed}
          setSpeed={setSpeed}
          onSkipMatch={skipMatch}
          onSkipAll={props.onSkipAll}
          isLast={isLast}
        />
      </div>

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
  const homeColor = props.homeYou ? 'text-win' : 'text-loss';
  const awayColor = props.homeYou ? 'text-loss' : 'text-win';
  const fmt = (id: string) => formationById(id)?.name ?? id;
  return (
    <div className="card-gloss grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl p-4">
      <div className="flex flex-col gap-0.5">
        {props.homeYou && <YouChip />}
        <span className={`headline text-sm ${homeColor}`}>{props.homeName}</span>
        <span className="text-[10px] text-ink-500">{fmt(props.timeline.homeFormationId)}</span>
      </div>
      <div className="text-center">
        <div className="headline flex items-center justify-center gap-2 text-4xl tabular-nums text-ink-100">
          <span>{pb.score.home}</span>
          <span className="text-night-600">–</span>
          <span>{pb.score.away}</span>
        </div>
        <div className="headline mt-0.5 text-[11px] text-gold-400">{pb.clockLabel}</div>
        <div className="text-[9px] uppercase tracking-widest text-ink-500">
          your match {props.matchNo}/{props.matchTotal}
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        {!props.homeYou && <YouChip />}
        <span className={`headline text-sm ${awayColor}`}>{props.awayName}</span>
        <span className="text-[10px] text-ink-500">{fmt(props.timeline.awayFormationId)}</span>
      </div>
    </div>
  );
}

function YouChip() {
  return (
    <span className="headline w-fit rounded bg-gold-400 px-1.5 py-0.5 text-[9px] text-night-950">
      YOU
    </span>
  );
}

/** Fielded XI with ratings — flanks the pitch (Lucca: "lineups on the sides"). */
function LineupRail(props: {
  title: string;
  xi: { player: { id: string; name: string; rating: number } }[];
  you: boolean;
  side: Team;
}) {
  if (props.xi.length === 0) return null;
  return (
    <aside className={`card-gloss hidden rounded-2xl p-2.5 lg:block ${props.side === 'away' ? 'text-right' : ''}`}>
      <h4 className={`headline mb-1.5 truncate text-[10px] tracking-[0.15em] ${props.you ? 'text-win' : 'text-loss'}`}>
        {props.title}
      </h4>
      <ul className="space-y-0.5">
        {props.xi.map((s) => (
          <li
            key={s.player.id}
            className={`flex items-baseline gap-1.5 text-[11px] leading-tight ${props.side === 'away' ? 'flex-row-reverse' : ''}`}
          >
            <span className="headline w-6 shrink-0 text-center text-[10px] text-gold-300">
              {s.player.rating}
            </span>
            <span className="truncate text-ink-300">{s.player.name}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function Pitch(props: {
  timeline: MatchTimeline;
  pb: PlaybackState;
  elapsed: number;
  homeYou: boolean;
  children?: React.ReactNode;
}) {
  const { timeline, pb, elapsed } = props;
  const homeDot = props.homeYou ? 'bg-emerald-400 border-emerald-800' : 'bg-rose-400 border-rose-800';
  const awayDot = props.homeYou ? 'bg-rose-400 border-rose-800' : 'bg-emerald-400 border-emerald-800';

  const homeAnchors = formationAnchors(timeline.homeFormationId);
  const awayAnchors = formationAnchors(timeline.awayFormationId);
  const homeDots = homeAnchors.map((a, i) => dotView('home', a, pb.ball, pb.possession, elapsed, i));
  const awayDots = awayAnchors.map((a, i) => dotView('away', a, pb.ball, pb.possession, elapsed, i + 40));

  return (
    <div
      className="relative w-full overflow-hidden rounded-xl border border-gold-600/25"
      style={{
        aspectRatio: '16 / 10',
        background: 'repeating-linear-gradient(90deg,#0a5c2e 0 8.33%,#0e7a3c 8.33% 16.66%)',
        boxShadow: 'inset 0 0 70px rgba(0,0,0,.55)',
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

      {/* goal celebration: gold flash + confetti burst */}
      {pb.celebrating && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Confetti />
          <span className="headline text-[11vw] text-gold-300 drop-shadow-[0_0_34px_rgba(232,196,104,.8)]">
            GOAL
          </span>
        </div>
      )}

      {/* shootout overlay mounts HERE — on the pitch, never below the fold */}
      {props.children}
    </div>
  );
}

const CONFETTI = Array.from({ length: 26 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: (i % 9) * 0.12,
  color: ['#e8c468', '#34d399', '#f3f5f9', '#f0554d'][i % 4],
}));

function Confetti() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {CONFETTI.map((c, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{ left: `${c.left}%`, background: c.color, animationDelay: `${c.delay}s` }}
        />
      ))}
    </div>
  );
}

function MomentumBar(props: { pb: PlaybackState; homeYou: boolean }) {
  const p = props.pb.momentum;
  const w = Math.abs(p) * 50;
  const homeColor = props.homeYou ? 'bg-emerald-400' : 'bg-rose-400';
  const awayColor = props.homeYou ? 'bg-rose-400' : 'bg-emerald-400';
  return (
    <div className="relative h-2.5 overflow-hidden rounded-md border border-night-600 bg-night-950">
      <div className="absolute inset-y-0 left-1/2 w-px bg-night-600" />
      <div className={`absolute inset-y-0 left-1/2 ${homeColor} opacity-40`} style={{ width: `${p > 0 ? w : 0}%` }} />
      <div className={`absolute inset-y-0 right-1/2 ${awayColor} opacity-40`} style={{ width: `${p < 0 ? w : 0}%` }} />
    </div>
  );
}

function Ticker(props: { pb: PlaybackState }) {
  const { ticker } = props.pb;
  return (
    <div className="card-gloss flex min-h-[42px] flex-col justify-center gap-0.5 rounded-lg px-3 py-2">
      {ticker.length === 0 ? (
        <p className="text-xs text-ink-500">…</p>
      ) : (
        ticker.map((e, i) => (
          <p key={i} className={`flex gap-2 text-xs ${i < ticker.length - 1 ? 'opacity-45' : ''}`}>
            <span className={`w-8 shrink-0 font-black ${e.type === 'goal' ? 'text-gold-400' : 'text-ink-500'}`}>{e.minute}'</span>
            <span className={e.type === 'goal' ? 'font-bold text-gold-300' : 'text-ink-300'}>{e.text}</span>
          </p>
        ))
      )}
    </div>
  );
}

/** The most exciting moment of the match — staged ON the pitch. One kick per 6s
 *  beat (playback.ts SHOOTOUT_KICK_MS): taker steps up, result pops, tally fills. */
function ShootoutOverlay(props: { pb: PlaybackState; homeName: string; awayName: string; homeYou: boolean }) {
  const so = props.pb.shootout!;
  const pip = (team: Team) => so.kicks.filter((k) => k.team === team);
  const dotFor = (scored: boolean) =>
    scored ? 'bg-gold-400 border-gold-300 animate-kick-pop' : 'bg-night-700 border-loss animate-kick-pop';
  const line =
    so.winner !== null
      ? `${so.winner === 'home' ? props.homeName : props.awayName} win it ${so.home}–${so.away}!`
      : so.stepping !== null
        ? `${so.stepping === 'home' ? props.homeName : props.awayName} steps up…`
        : so.lastResult === 'scored'
          ? 'SCORED!'
          : so.lastResult === 'missed'
            ? 'MISSED!'
            : '';
  const row = (team: Team, label: string, you: boolean) => (
    <div className="flex flex-col items-center gap-1.5">
      <span className={`headline text-[10px] tracking-wider ${you ? 'text-win' : 'text-loss'}`}>{label}</span>
      <div className="flex gap-1.5">
        {pip(team).map((k, i) => (
          <span key={i} className={`h-4 w-4 rounded-full border-2 ${dotFor(k.scored)}`} />
        ))}
        {pip(team).length === 0 && <span className="h-4 text-[10px] text-ink-500">—</span>}
      </div>
    </div>
  );
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-night-950/70 backdrop-blur-[2px]">
      <div className="card-gloss animate-gold-pulse mx-4 flex w-full max-w-md flex-col items-center gap-3 rounded-2xl !border-gold-500/60 p-5">
        <h4 className="headline text-xs tracking-[0.3em] text-gold-400">PENALTY SHOOTOUT</h4>
        <div className="headline flex items-center gap-6 text-4xl tabular-nums">
          <span className={props.homeYou ? 'text-win' : 'text-loss'}>{so.home}</span>
          <span className="text-night-600">–</span>
          <span className={props.homeYou ? 'text-loss' : 'text-win'}>{so.away}</span>
        </div>
        <div className="flex gap-10">
          {row('home', props.homeName, props.homeYou)}
          {row('away', props.awayName, !props.homeYou)}
        </div>
        <p
          className={`headline min-h-[24px] text-lg ${
            so.winner !== null
              ? 'text-gold-300'
              : so.lastResult === 'missed'
                ? 'text-loss'
                : so.lastResult === 'scored'
                  ? 'text-gold-300'
                  : 'text-ink-300'
          } ${so.lastResult !== null && so.winner === null ? 'animate-kick-pop' : ''}`}
        >
          {line}
        </p>
      </div>
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
    <div className="flex flex-wrap items-center justify-center gap-2">
      {[1, 2].map((s) => (
        <button
          key={s}
          onClick={() => props.setSpeed(s)}
          className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-bold transition ${
            props.speed === s ? 'btn-gold' : 'border border-night-600 bg-night-800 text-ink-300 hover:bg-night-700'
          }`}
        >
          {s}×
        </button>
      ))}
      <button
        onClick={props.onSkipMatch}
        className="cursor-pointer rounded-lg px-3 py-1.5 text-sm font-bold text-ink-500 transition hover:text-ink-100"
      >
        {props.isLast ? 'skip to table ▸▸' : 'skip match ▸'}
      </button>
      {!props.isLast && (
        <button
          onClick={props.onSkipAll}
          className="cursor-pointer rounded-lg px-3 py-1.5 text-sm font-bold text-ink-500 transition hover:text-ink-100"
        >
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
      <h3 className="headline mb-1.5 text-[10px] tracking-[0.18em] text-ink-500">Elsewhere this round</h3>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {props.md.rail.map((m) => (
          <div key={m.matchId} className="card-gloss flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[11px]">
            <span className="truncate text-ink-500">
              {short(props.nameOf(m.homeId))} <span className="text-night-600">v</span> {short(props.nameOf(m.awayId))}
            </span>
            <span className="ml-2 shrink-0 font-bold tabular-nums text-gold-400">{scoreAt(m.goals)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
