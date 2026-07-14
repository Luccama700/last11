import { useEffect, useRef, useState } from 'react';
import { playerV2ById } from '../engine/draft';
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
  /** Multiplayer lockstep: the clock becomes `(now − startAt) × scale` — shared
   *  wall time, no speed buttons, no skips; the room advances everyone together. */
  lockstep?: { startAt: number; scale: number };
}) {
  const { state, animate } = props;
  const md = state.matchday!;
  const timeline = md.featured[md.featuredIndex];
  const isLast = md.featuredIndex >= md.featured.length - 1;

  // the terminal decision; the clock fires it EXACTLY once per match (guarded there)
  const finishMatch = () => (isLast ? props.onFinishRound() : props.onNextFeatured());

  const [speed, setSpeed] = useState(1);
  const [elapsed, skipMatch] = useMatchClock(timeline.matchId, matchEndMs(timeline), {
    speed,
    animate,
    onEnd: finishMatch,
    lockstep: props.lockstep,
  });
  const pb = projectMatch(timeline, elapsed);

  const human = humanOf(state);
  const managerOf = (id: string) => state.managers.find((m) => m.id === id);
  const nameOf = (id: string) => managerOf(id)?.name ?? id;
  const totalOf = (id: string) =>
    (managerOf(id)?.xi ?? []).reduce((sum, s) => sum + Math.round(s.player.rating), 0);
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
        homeTotal={totalOf(timeline.homeId)}
        awayTotal={totalOf(timeline.awayId)}
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
        {/* lockstep rooms have no speed/skip — the shared clock is the boss */}
        {!props.lockstep && (
          <Controls
            speed={speed}
            setSpeed={setSpeed}
            onSkipMatch={skipMatch}
            onSkipAll={props.onSkipAll}
            isLast={isLast}
          />
        )}
      </div>

      <Rail md={md} nameOf={nameOf} virtualMinute={pb.virtualMinute} humanId={human?.id} />

      {/* mobile: the side rails are hidden, so both lineups stack down here
          beneath the live-scores strip (Lucca) */}
      <div className="grid grid-cols-2 gap-3 lg:hidden">
        <LineupRail
          title={nameOf(timeline.homeId)}
          xi={managerOf(timeline.homeId)?.xi ?? []}
          you={homeYou}
          side="home"
          variant="stack"
        />
        <LineupRail
          title={nameOf(timeline.awayId)}
          xi={managerOf(timeline.awayId)?.xi ?? []}
          you={!homeYou}
          side="away"
          variant="stack"
        />
      </div>
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
  opts: {
    speed: number;
    animate: boolean;
    onEnd: () => void;
    lockstep?: { startAt: number; scale: number };
  },
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
  const lockstepRef = useRef(opts.lockstep);
  lockstepRef.current = opts.lockstep;

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
      const ls = lockstepRef.current;
      if (ls) {
        // MP: pure wall-clock — every client computes the identical elapsed
        elapsedRef.current = Math.min(durationMs, Math.max(0, (Date.now() - ls.startAt) * ls.scale));
      } else {
        if (lastRef.current === null) lastRef.current = now;
        const dt = now - lastRef.current;
        lastRef.current = now;
        elapsedRef.current = Math.min(durationMs, elapsedRef.current + dt * speedRef.current);
      }
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
  /** Sum of each XI's ratings — the same "strength" number the draft shows. */
  homeTotal?: number;
  awayTotal?: number;
}) {
  const { pb } = props;
  const fmt = (id: string) => formationById(id)?.name ?? id;
  return (
    <div className="chrome-gloss grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-2.5 text-white">
      <div className="flex flex-col items-start gap-0.5">
        {props.homeYou && <YouChip />}
        <span className="condensed text-base leading-tight">{props.homeName}</span>
        <span className="condensed flex items-center gap-1.5 text-[10px] text-white/60">
          {fmt(props.timeline.homeFormationId)}
          {props.homeTotal ? (
            <span className="silver-gloss tabular rounded-full px-2 text-[10px] text-carbon">
              {props.homeTotal}
            </span>
          ) : null}
        </span>
      </div>
      <div className="text-center">
        <div className="condensed tabular flex items-center justify-center gap-2 text-4xl font-bold">
          {/* key = value: digits remount on change and bump (juice pass) */}
          <span key={`h${pb.score.home}`} className="animate-score-bump">
            {pb.score.home}
          </span>
          <span className="text-white/35">–</span>
          <span key={`a${pb.score.away}`} className="animate-score-bump">
            {pb.score.away}
          </span>
        </div>
        <div className="scarlet-gloss condensed tabular mx-auto mt-0.5 w-fit rounded-full px-3 text-[11px]">
          {pb.clockLabel}
        </div>
        <div className="condensed mt-0.5 text-[9px] tracking-widest text-white/55">
          your match {props.matchNo}/{props.matchTotal}
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        {!props.homeYou && <YouChip />}
        <span className="condensed text-base leading-tight">{props.awayName}</span>
        <span className="condensed flex items-center gap-1.5 text-[10px] text-white/60">
          {props.awayTotal ? (
            <span className="silver-gloss tabular rounded-full px-2 text-[10px] text-carbon">
              {props.awayTotal}
            </span>
          ) : null}
          {fmt(props.timeline.awayFormationId)}
        </span>
      </div>
    </div>
  );
}

function YouChip() {
  return (
    <span className="scarlet-gloss condensed w-fit rounded-full px-2 py-0.5 text-[9px]">
      YOU
    </span>
  );
}

/** Fielded XI with ratings — flanks the pitch on desktop (Lucca: "lineups on
 *  the sides"); the 'stack' variant renders in the mobile lineups section. */
function LineupRail(props: {
  title: string;
  xi: { player: { id: string; name: string; rating: number } }[];
  you: boolean;
  side: Team;
  variant?: 'side' | 'stack';
}) {
  if (props.xi.length === 0) return null;
  const visibility = props.variant === 'stack' ? '' : 'hidden lg:block';
  return (
    <aside className={`glass overflow-hidden p-2.5 ${visibility} ${props.side === 'away' ? 'text-right' : ''}`}>
      <h4 className={`condensed mb-1.5 flex items-center gap-1.5 truncate text-[11px] tracking-[0.12em] text-carbon ${props.side === 'away' ? 'flex-row-reverse' : ''}`}>
        {props.you && <YouChip />}
        {props.title}
      </h4>
      <ul>
        {props.xi.map((s) => (
          <li
            key={s.player.id}
            className={`row-band flex items-baseline gap-1.5 px-1 text-[11px] leading-snug ${props.side === 'away' ? 'flex-row-reverse' : ''}`}
          >
            <span className="tabular condensed w-6 shrink-0 text-center text-[10px] font-bold text-royal">
              {s.player.rating}
            </span>
            <span className="truncate text-carbon">{s.player.name}</span>
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
  const homeDots = homeAnchors.map((a, i) =>
    dotView('home', a, pb.ball, pb.possession, elapsed, i, pb.momentum),
  );
  const awayDots = awayAnchors.map((a, i) =>
    dotView('away', a, pb.ball, pb.possession, elapsed, i + 40, pb.momentum),
  );

  return (
    <div
      className="@container relative w-full overflow-hidden rounded-sm border border-hairline"
      style={{
        aspectRatio: '16 / 10',
        background: 'repeating-linear-gradient(90deg,#46a136 0 8.33%,#4fae3d 8.33% 16.66%)',
        boxShadow: 'inset 0 0 60px rgba(0,0,0,.28)',
      }}
    >
      {/* pitch markings */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/45" />
        <div className="absolute left-1/2 top-1/2 aspect-square w-[20%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/45" />
        <div className="absolute left-0 top-[22%] h-[56%] w-[14%] border-2 border-l-0 border-white/45" />
        <div className="absolute right-0 top-[22%] h-[56%] w-[14%] border-2 border-r-0 border-white/45" />
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

      {/* goal celebration: shout + confetti, keyed by minute + stack count so the
          pop and confetti REPLAY when a second goal lands inside the first one's
          window. Team-aware (Lucca): YOUR goals climb a trophy palette
          (gold → lime → cyan → purple), the enemy's descend into darker reds.
          Freshest goal's team decides the read on a (rare) mixed cluster. */}
      {pb.celebrating && (
        <div
          key={`${pb.celebrating.minute}-${pb.celebratingCount}`}
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          {(() => {
            const mine = pb.celebrating.team
              ? (pb.celebrating.team === 'home') === props.homeYou
              : true;
            return (
              <>
                <Confetti enemy={!mine} />
                <GoalShout count={pb.celebratingCount || 1} mine={mine} />
              </>
            );
          })()}
        </div>
      )}

      {/* match-phase banner sweeping across the pitch (juice pass). A pens match
          never shows FULL-TIME — it goes 90' straight into PENS (and pb.shootout is
          null until then, so keying off it would flash the banner at the boundary) */}
      <PhaseBanner minute={pb.virtualMinute} shootout={!!timeline.shootout} />

      {/* shootout overlay mounts HERE — on the pitch, never below the fold */}
      {props.children}
    </div>
  );
}

/** KICK-OFF / HALF-TIME / FULL-TIME sweep — pure from the virtual minute; keyed
 *  by phase so each banner plays exactly once per phase. */
function PhaseBanner(props: { minute: number; shootout: boolean }) {
  const phase =
    props.minute <= 2
      ? 'KICK-OFF'
      : props.minute >= 45 && props.minute < 47
        ? 'HALF-TIME'
        : props.minute >= 90 && !props.shootout
          ? 'FULL-TIME'
          : null;
  if (!phase) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 overflow-hidden">
      <div
        key={phase}
        className="animate-banner-sweep chrome-gloss blade mx-auto w-fit px-10 py-2"
      >
        <span className="condensed text-2xl tracking-[0.3em] text-white">{phase}</span>
      </div>
    </div>
  );
}

/** GOAL / 2x GOAL / 3x GOAL / 4x GOAL — team-aware escalation (Lucca's spec).
 *  YOURS: 1x gold, 2x lime, 3x cyan, 4x+ purple — a trophy ladder.
 *  ENEMY: 1x red, then darker and darker reds — the deeper the hole, the darker.
 *  Sized in container units (cqw of the PITCH, not the viewport) so the shout
 *  always fits inside the pitch whatever the layout around it does. */
const SHOUT_MINE = [
  'text-gold-300 drop-shadow-[0_0_34px_rgba(232,196,104,.8)]', // 1x gold
  'text-lime-400 drop-shadow-[0_0_36px_rgba(163,230,53,.85)]', // 2x lime
  'text-cyan-400 drop-shadow-[0_0_38px_rgba(34,211,238,.85)]', // 3x cyan
  'text-purple-400 drop-shadow-[0_0_40px_rgba(192,132,252,.9)]', // 4x+ purple
];
const SHOUT_ENEMY = [
  'text-red-500 drop-shadow-[0_0_34px_rgba(239,68,68,.8)]', // 1x red
  'text-red-600 drop-shadow-[0_0_36px_rgba(220,38,38,.85)]', // 2x darker
  'text-red-700 drop-shadow-[0_0_38px_rgba(185,28,28,.9)]', // 3x darker still
  'text-red-800 drop-shadow-[0_0_44px_rgba(153,27,27,.95)]', // 4x+ the abyss
];
function GoalShout(props: { count: number; mine: boolean }) {
  const n = Math.max(1, props.count);
  const heat = (props.mine ? SHOUT_MINE : SHOUT_ENEMY)[Math.min(n, 4) - 1];
  // "GOAL" gets the big treatment; "2x GOAL" is nearly twice as wide, so it steps
  // down — the kick-pop overshoot (×1.18) still stays inside the pitch either way.
  const size = n > 1 ? 'text-[11cqw]' : 'text-[16cqw]';
  return (
    <span
      className={`condensed animate-kick-pop bg-black/40 px-[4cqw] font-bold leading-none whitespace-nowrap ${size} ${heat}`}
      style={{ clipPath: 'polygon(3cqw 0, 100% 0, calc(100% - 3cqw) 100%, 0 100%)' }}
    >
      {n > 1 ? `${n}x GOAL` : 'GOAL'}
    </span>
  );
}

// Festive palette for your goals; embers-and-ash reds when the enemy scores.
const CONFETTI_MINE = ['#e8c468', '#34d399', '#f3f5f9', '#a3e635'];
const CONFETTI_ENEMY = ['#ef4444', '#b91c1c', '#7f1d1d', '#3b0d0d'];
const CONFETTI = Array.from({ length: 26 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: (i % 9) * 0.12,
  hue: i % 4,
}));

function Confetti(props: { enemy?: boolean }) {
  const palette = props.enemy ? CONFETTI_ENEMY : CONFETTI_MINE;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {CONFETTI.map((c, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{ left: `${c.left}%`, background: palette[c.hue], animationDelay: `${c.delay}s` }}
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
    <div className="relative h-2.5 overflow-hidden rounded-sm border border-hairline bg-band">
      <div className="absolute inset-y-0 left-1/2 w-px bg-hairline" />
      <div
        className={`absolute inset-y-0 left-1/2 ${homeColor} opacity-40 transition-[width] duration-500 ease-out`}
        style={{ width: `${p > 0 ? w : 0}%` }}
      />
      <div
        className={`absolute inset-y-0 right-1/2 ${awayColor} opacity-40 transition-[width] duration-500 ease-out`}
        style={{ width: `${p < 0 ? w : 0}%` }}
      />
    </div>
  );
}

function Ticker(props: { pb: PlaybackState }) {
  const { ticker } = props.pb;
  return (
    <div className="flex min-h-[42px] flex-col justify-center gap-0.5 glass overflow-hidden px-3 py-2">
      {ticker.length === 0 ? (
        <p className="text-xs text-carbon-600">…</p>
      ) : (
        ticker.map((e, i) => (
          <p
            key={`${e.minute}-${e.text}`}
            className={`flex gap-2 text-xs ${i < ticker.length - 1 ? 'opacity-50' : 'animate-row-in'}`}
          >
            <span className={`tabular w-8 shrink-0 font-bold ${e.type === 'goal' ? 'text-scarlet' : 'text-carbon-600'}`}>{e.minute}'</span>
            <span className={e.type === 'goal' ? 'font-bold text-scarlet' : 'text-carbon'}>{e.text}</span>
          </p>
        ))
      )}
    </div>
  );
}

/** The most exciting moment of the match — staged ON the pitch. One kick per 6s
 *  beat (playback.ts SHOOTOUT_KICK_MS): the TAKER's name steps up (Lucca's
 *  playtest note: the player, not the manager), result pops, tally fills. */
function ShootoutOverlay(props: { pb: PlaybackState; homeName: string; awayName: string; homeYou: boolean }) {
  const so = props.pb.shootout!;
  const pip = (team: Team) => so.kicks.filter((k) => k.team === team);
  const dotFor = (scored: boolean) =>
    scored ? 'bg-def border-[#2e7527] animate-kick-pop' : 'bg-scarlet border-[#a91824] animate-kick-pop';
  const takerName = (id?: string) => (id ? (playerV2ById(id)?.name ?? 'The taker') : 'The taker');
  const lastKick = so.kicks.length > 0 ? so.kicks[so.kicks.length - 1] : null;
  const line =
    so.winner !== null
      ? `${so.winner === 'home' ? props.homeName : props.awayName} win it ${so.home}–${so.away}!`
      : so.pendingKicker !== null
        ? `${takerName(so.pendingKicker.playerId)} steps up…`
        : so.lastResult === 'scored'
          ? `${takerName(lastKick?.playerId)} SCORES!`
          : so.lastResult === 'missed'
            ? `${takerName(lastKick?.playerId)} MISSES!`
            : '';
  const row = (team: Team, label: string, you: boolean) => (
    <div className="flex flex-col items-center gap-1.5">
      <span className={`condensed text-[10px] tracking-wider ${you ? 'text-royal' : 'text-carbon-600'}`}>{label}</span>
      <div className="flex gap-1.5">
        {pip(team).map((k, i) => (
          <span key={i} className={`h-4 w-4 rounded-full border-2 ${dotFor(k.scored)}`} />
        ))}
        {pip(team).length === 0 && <span className="h-4 text-[10px] text-carbon-600">—</span>}
      </div>
    </div>
  );
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
      <div className="paper-pane animate-pop mx-4 flex w-full max-w-md flex-col items-center gap-3 border border-hairline p-5 shadow-2xl">
        <h4 className="scarlet-gloss condensed w-fit rounded-full px-4 py-0.5 text-xs tracking-[0.3em]">
          PENALTY SHOOTOUT
        </h4>
        <div className="condensed tabular flex items-center gap-6 text-4xl font-bold text-carbon">
          <span>{so.home}</span>
          <span className="text-hairline">–</span>
          <span>{so.away}</span>
        </div>
        <div className="flex gap-10">
          {row('home', props.homeName, props.homeYou)}
          {row('away', props.awayName, !props.homeYou)}
        </div>
        <p
          className={`condensed min-h-[24px] text-lg ${
            so.winner !== null
              ? 'text-royal'
              : so.lastResult === 'missed'
                ? 'text-scarlet'
                : so.lastResult === 'scored'
                  ? 'text-[#2e7527]'
                  : 'text-carbon-600'
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
          className={`condensed blade cursor-pointer px-3.5 py-1.5 text-sm transition ${
            props.speed === s ? 'chrome-gloss text-white' : 'silver-gloss text-carbon'
          }`}
        >
          {s}×
        </button>
      ))}
      <button
        onClick={props.onSkipMatch}
        className="condensed silver-gloss blade cursor-pointer px-3.5 py-1.5 text-sm text-carbon"
      >
        {props.isLast ? 'skip to table ▸▸' : 'skip match ▸'}
      </button>
      {!props.isLast && (
        <button
          onClick={props.onSkipAll}
          className="condensed silver-gloss blade cursor-pointer px-3.5 py-1.5 text-sm text-carbon"
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
  // Only THIS match set's games (Lucca): watching your 1st match shows everyone
  // else's 1st match, and so on. Untagged entries (legacy fabricated rails)
  // keep the old show-everything behavior. Clamped: on-demand extra watches
  // (featuredIndex past the human's 3) show the final set's rail.
  const currentSet = Math.min(props.md.featuredIndex, 2);
  const rail = props.md.rail.filter((m) => m.set === undefined || m.set === currentSet);
  if (rail.length === 0) return null;
  return (
    <div>
      <h3 className="condensed mb-1.5 text-[10px] tracking-[0.18em] text-carbon-600">Elsewhere this round</h3>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {rail.map((m) => (
          <div key={m.matchId} className="plate-dark flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[11px] text-white">
            <span className="condensed truncate text-white/75">
              {short(props.nameOf(m.homeId))} <span className="text-white/40">v</span> {short(props.nameOf(m.awayId))}
            </span>
            <span className="tabular condensed ml-2 shrink-0 font-bold">{scoreAt(m.goals)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
