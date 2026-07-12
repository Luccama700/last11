import { useEffect, useMemo, useRef, useState } from 'react';
import { affinity } from '../../engine/affinity';
import { autoArrange, sortByBoost, stealGainV2, swapSlots } from '../../engine/draft';
import {
  MP_DRAFT_SPINS,
  MP_SURVIVORS_PER_ROUND,
  MP_TIME_SCALE,
  contentEndMs,
} from '../../engine/mp';
import type { MpSeat } from '../../engine/mp';
import type { Manager } from '../../engine/tournament';
import { FORMATIONS, MATCH_DURATION_MS, formationById } from '../../engine/types';
import type { MatchTimeline, PlayingStyle, XiSlotV2 } from '../../engine/types';
import type { PlayerV2 } from '../../engine/data/schema';
import { v2Nations } from '../../engine/data/loader';
import { flagOf } from '../../game/flags';
import { recordChampion } from '../../game/champions';
import { accrueStats } from '../../game/player-stats';
import { displayedSquadRating } from '../../engine/squad-rating';
import type { GameState } from '../../game/state';
import { useOnlineRoom } from '../../game/online/useOnlineRoom';
import type { OnlineView, OnlineController } from '../../game/online/controller';
import BetweenMatchBoard from '../board/BetweenMatchBoard';
import PitchBoard from '../board/PitchBoard';
import SpinReveal from '../draft/SpinReveal';
import MatchPlaybackScreen from '../MatchPlaybackScreen';
import EndScreen from '../EndScreen';

/**
 * BATTLE ROYALE ONLINE — the multiplayer shell (Main's design; FORMAT-REPORT
 * §6b). Entry → lobby (setup while you wait) → simultaneous slot-machine draft
 * (10s picks) → lockstep rounds at 1.5× → 20s combined pit stops → the crown.
 */
export default function OnlineApp(props: { onExit: () => void }) {
  const [name, setName] = useState(() => localStorage.getItem('last11.mp.name') ?? '');
  const [entered, setEntered] = useState(false);
  if (!entered) {
    return (
      <EntryScreen
        name={name}
        setName={(n) => {
          setName(n);
          localStorage.setItem('last11.mp.name', n);
        }}
        onReady={() => setEntered(true)}
        onExit={props.onExit}
      />
    );
  }
  return <OnlineRoom name={name || 'Manager'} onExit={props.onExit} />;
}

function OnlineRoom(props: { name: string; onExit: () => void }) {
  const { view, ctl } = useOnlineRoom(props.name);
  useEffect(() => () => ctl.leave(), [ctl]);

  // A desync is loud, never silent — and self-healing: the controller already
  // asked the host to replay the game (a dropped broadcast is the usual cause).
  const desyncBanner = view.desynced ? (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-loss/90 px-4 py-1.5 text-center">
      <span className="headline text-xs tracking-[0.2em] text-white">
        SYNC LOST — resyncing with the room…
      </span>
      <button
        type="button"
        onClick={() => ctl.requestResync()}
        className="headline cursor-pointer rounded border border-white/60 px-2 py-0.5 text-[10px] tracking-[0.2em] text-white hover:bg-white/10"
      >
        REJOIN NOW
      </button>
    </div>
  ) : null;

  return (
    <>
      {desyncBanner}
      <OnlinePhaseView view={view} ctl={ctl} onExit={props.onExit} />
    </>
  );
}

function OnlinePhaseView(props: { view: OnlineView; ctl: OnlineController; onExit: () => void }) {
  const { view, ctl } = props;
  switch (view.phase) {
    case 'idle':
    case 'connecting':
    case 'error':
      return <RoomGate view={view} ctl={ctl} onExit={props.onExit} />;
    case 'lobby':
      return <LobbyScreen view={view} ctl={ctl} onExit={props.onExit} />;
    case 'draft':
      return <OnlineDraft view={view} ctl={ctl} />;
    case 'watching':
      return <OnlineWatch view={view} ctl={ctl} />;
    case 'pit':
      return <OnlinePit view={view} ctl={ctl} />;
    case 'end':
      return <OnlineEnd view={view} onExit={props.onExit} />;
  }
}

// ── Entry ─────────────────────────────────────────────────────────────────────

function EntryScreen(props: {
  name: string;
  setName: (n: string) => void;
  onReady: () => void;
  onExit: () => void;
}) {
  return (
    <div className="bg-stadium flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-ink-100">
      <p className="headline text-xs tracking-[0.35em] text-gold-400">BATTLE ROYALE ONLINE</p>
      <h1 className="headline text-5xl">
        <span className="text-ink-100">Last</span>
        <span className="headline-shine">11</span>
        <span className="ml-3 text-2xl text-ink-500">·</span>
        <span className="ml-3 text-2xl text-gold-300">20 managers</span>
      </h1>
      <div className="card-gloss w-full max-w-sm rounded-2xl p-5">
        <label className="headline mb-1.5 block text-[10px] tracking-[0.25em] text-ink-500">
          YOUR MANAGER NAME
        </label>
        <input
          value={props.name}
          onChange={(e) => props.setName(e.target.value.slice(0, 18))}
          placeholder="e.g. Pep Talkiola"
          className="w-full rounded-lg border border-night-600 bg-night-900 px-3 py-2.5 text-ink-100 outline-none focus:border-gold-500"
        />
        <button
          type="button"
          disabled={props.name.trim().length === 0}
          onClick={props.onReady}
          className="btn-gold headline mt-4 w-full cursor-pointer rounded-xl px-6 py-3 text-lg disabled:opacity-40"
        >
          READY →
        </button>
      </div>
      <button onClick={props.onExit} className="cursor-pointer text-xs text-ink-500 hover:text-ink-300">
        ← back to solo
      </button>
    </div>
  );
}

function RoomGate(props: { view: OnlineView; ctl: OnlineController; onExit: () => void }) {
  const { view, ctl } = props;
  const [code, setCode] = useState('');
  return (
    <div className="bg-stadium flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-ink-100">
      <p className="headline text-xs tracking-[0.35em] text-gold-400">BATTLE ROYALE ONLINE</p>
      {view.phase === 'connecting' ? (
        <p className="headline animate-gold-pulse rounded-xl px-6 py-3 text-xl text-gold-300">
          {view.code ? `Connecting to ${view.code}…` : 'Finding a public lobby…'}
        </p>
      ) : (
        <>
          {view.error && (
            <p className="rounded-lg border border-loss/50 bg-loss/10 px-4 py-2 text-sm text-loss">
              {view.error}
            </p>
          )}
          <button
            type="button"
            onClick={() => ctl.quickPlay()}
            className="btn-gold headline w-full max-w-lg cursor-pointer rounded-2xl px-6 py-4 text-xl"
          >
            QUICK PLAY →
            <span className="mt-0.5 block text-[11px] font-semibold normal-case tracking-normal opacity-80">
              drop into a public lobby — or open one if none are up
            </span>
          </button>
          <div className="grid w-full max-w-lg gap-4 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => ctl.create()}
              className="card-gloss cursor-pointer rounded-2xl p-6 text-left transition hover:!border-gold-500"
            >
              <p className="headline text-lg text-gold-300">CREATE A ROOM</p>
              <p className="mt-1 text-xs text-ink-500">
                You host. Share the 5-letter code — the game starts at 20 managers, or fill
                the rest with bots.
              </p>
            </button>
            <div className="card-gloss rounded-2xl p-6">
              <p className="headline text-lg text-ink-100">JOIN A ROOM</p>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 5))}
                placeholder="CODE"
                className="mt-2 w-full rounded-lg border border-night-600 bg-night-900 px-3 py-2 text-center font-mono text-xl tracking-[0.4em] text-gold-300 outline-none focus:border-gold-500"
              />
              <button
                type="button"
                disabled={code.length !== 5}
                onClick={() => ctl.join(code)}
                className="btn-gold headline mt-3 w-full cursor-pointer rounded-lg px-4 py-2 disabled:opacity-40"
              >
                JOIN →
              </button>
            </div>
          </div>
        </>
      )}
      <button onClick={props.onExit} className="cursor-pointer text-xs text-ink-500 hover:text-ink-300">
        ← back to solo
      </button>
    </div>
  );
}

// ── Lobby (setup while you wait) ──────────────────────────────────────────────

const STYLES: PlayingStyle[] = ['defensive', 'balanced', 'attacking'];

function LobbyScreen(props: { view: OnlineView; ctl: OnlineController; onExit: () => void }) {
  const { view, ctl } = props;
  return (
    <div className="bg-stadium min-h-screen text-ink-100">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="text-center">
          <p className="headline text-xs tracking-[0.35em] text-gold-400">ROOM CODE</p>
          <p className="headline mt-1 font-mono text-6xl tracking-[0.3em] text-gold-300">{view.code}</p>
          <p className="mt-2 text-sm text-ink-500">
            {view.present.length}/{view.lobbySize} managers · empty seats become bots at kickoff
          </p>
          {view.isHost ? (
            <button
              type="button"
              onClick={() => ctl.setPublic(!view.isPublic)}
              className={`mt-3 cursor-pointer rounded-full px-4 py-1.5 text-xs font-bold transition ${
                view.isPublic
                  ? 'btn-gold'
                  : 'border border-night-600 text-ink-300 hover:border-gold-500'
              }`}
            >
              {view.isPublic ? '● PUBLIC — randoms can quick-play in' : '○ PRIVATE — make it public'}
            </button>
          ) : view.isPublic ? (
            <p className="headline mt-3 text-[10px] tracking-[0.25em] text-gold-400">
              PUBLIC LOBBY — open to quick play
            </p>
          ) : null}
        </header>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {view.present.map((p, i) => (
            <span
              key={i}
              className={`rounded-full px-3 py-1 text-sm font-bold ${
                p.you ? 'btn-gold' : 'border border-night-600 bg-night-800 text-ink-300'
              }`}
            >
              {p.name}
              {p.you && ' (you)'}
            </span>
          ))}
        </div>

        {/* set your shape while you wait — travels with the start message */}
        <section className="card-gloss mt-8 rounded-2xl p-5">
          <h2 className="headline mb-3 text-xs tracking-[0.25em] text-ink-500">
            Your shape & style (set it before kickoff)
          </h2>
          <div className="grid grid-cols-5 gap-2 max-sm:grid-cols-2">
            {FORMATIONS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={f.id === view.formation.id}
                onClick={() => ctl.setSetup(f.id, view.style)}
                className={`cursor-pointer truncate rounded-lg px-1.5 py-2 text-[11px] font-bold transition max-lg:py-2.5 ${
                  f.id === view.formation.id ? 'btn-gold' : 'bg-night-700 text-ink-300 hover:bg-night-600'
                }`}
              >
                {f.name}
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {STYLES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={s === view.style}
                onClick={() => ctl.setSetup(view.formation.id, s)}
                className={`cursor-pointer rounded-lg px-2 py-2 text-xs font-bold capitalize transition max-lg:py-2.5 ${
                  s === view.style ? 'btn-gold' : 'bg-night-700 text-ink-300 hover:bg-night-600'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </section>

        {view.isHost ? (
          <button
            type="button"
            onClick={() => ctl.fillWithBots()}
            className="btn-gold headline mt-6 w-full cursor-pointer rounded-2xl px-6 py-4 text-xl"
          >
            FILL WITH BOTS & BEGIN →
          </button>
        ) : (
          <p className="mt-6 text-center text-sm text-ink-500">
            Waiting for the host to start…
          </p>
        )}
        <button
          onClick={props.onExit}
          className="mx-auto mt-4 block cursor-pointer text-xs text-ink-500 hover:text-ink-300"
        >
          ← leave room
        </button>
      </div>
    </div>
  );
}

// ── Simultaneous draft ────────────────────────────────────────────────────────

function Countdown(props: { deadline: number | null; label: string; hurried?: boolean }) {
  const remaining = props.deadline ? Math.max(0, props.deadline - Date.now()) : 0;
  const secs = Math.ceil(remaining / 1000);
  return (
    <div className="card-gloss flex items-center justify-between rounded-xl px-4 py-2">
      <span
        className={`headline text-[10px] tracking-[0.25em] ${props.hurried ? 'text-gold-300' : 'text-ink-500'}`}
      >
        {props.hurried ? 'ALL LOCKED IN' : props.label}
      </span>
      <span
        className={`headline text-2xl tabular-nums ${secs <= 5 ? 'animate-gold-pulse text-loss' : 'text-gold-300'}`}
      >
        {secs}
        {/* lowercase, small and dim — a full-size S reads as a 5 (playtest) */}
        <span className="ml-0.5 text-xs font-normal text-ink-500">s</span>
      </span>
    </div>
  );
}

function OnlineDraft(props: { view: OnlineView; ctl: OnlineController }) {
  const { view, ctl } = props;
  const nations = useMemo(() => v2Nations(2026), []);
  const [selPlayer, setSelPlayer] = useState<PlayerV2 | null>(null);
  const [moveFrom, setMoveFrom] = useState<number | null>(null);
  const locked = view.myPick !== null;

  // reset the selection each spin
  const spinRef = useRef(view.spinIndex);
  if (spinRef.current !== view.spinIndex) {
    spinRef.current = view.spinIndex;
    if (selPlayer) setSelPlayer(null);
    if (moveFrom !== null) setMoveFrom(null);
  }

  // Solo's draft brain, same in MP: options ranked by the points they add RIGHT
  // NOW (best open-slot fit), the top pick wearing the gold trim.
  const ranked = useMemo(
    () => sortByBoost(view.myOptions, view.mySlate, view.formation, affinity),
    [view.myOptions, view.mySlate, view.formation],
  );

  const open = new Set(
    view.mySlate.map((s, i) => (s === null ? i : -1)).filter((i) => i >= 0),
  );
  const clickable = new Set<number>();
  if (!locked) {
    if (selPlayer || moveFrom !== null) for (const i of open) clickable.add(i);
    view.mySlate.forEach((s, i) => {
      if (s !== null) clickable.add(i); // select for a move
    });
  }

  function tapSlot(i: number) {
    if (locked) return;
    const slotOpen = view.mySlate[i] === null;
    if (selPlayer && slotOpen) {
      ctl.pick(selPlayer.id, i);
      setSelPlayer(null);
      return;
    }
    if (moveFrom !== null && slotOpen) {
      ctl.applyLocalMove(moveFrom, i);
      setMoveFrom(null);
      return;
    }
    if (!slotOpen) {
      setMoveFrom(moveFrom === i ? null : i);
      setSelPlayer(null);
    }
  }

  const strength = view.mySlate.reduce(
    (sum, s) => sum + (s ? Math.round(s.player.rating) : 0),
    0,
  );

  return (
    // The page IS the viewport at every size — the pitch sizes from the
    // remaining height (mobile: a 42dvh cap) and the options list scrolls
    // internally. Nothing on this screen scrolls the page (Lucca: everything
    // fits one page). Mobile keeps the countdown pinned above the pitch.
    <div className="bg-stadium h-dvh min-h-0 overflow-hidden text-ink-100">
      <div className="mx-auto grid h-full max-w-6xl grid-rows-[auto_minmax(0,1fr)] gap-3 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:grid-cols-[minmax(0,1fr)_21rem] lg:grid-rows-none lg:gap-4 lg:py-4">
        <main className="flex min-h-0 flex-col">
          <header className="mb-2 flex items-baseline justify-between">
            <h1 className="headline text-xl">
              <span className="text-ink-100">Draft</span>{' '}
              <span className="headline-gold">spin {Math.max(1, view.spinIndex + 1)}/{MP_DRAFT_SPINS}</span>
            </h1>
            <p className="text-xs font-semibold text-ink-500">
              {locked
                ? 'locked in — waiting for the room'
                : selPlayer
                  ? 'tap a slot to place'
                  : moveFrom !== null
                    ? 'tap an open slot to move him'
                    : 'pick from your squad →'}
            </p>
          </header>
          {/* mobile: the pick clock must be visible while picking — the aside
              copy of it lives below the pitch fold, so it hides on small tiers */}
          <div className="mb-2 lg:hidden">
            <Countdown deadline={view.spinDeadline} label="PICK CLOSES" hurried={view.hurried} />
          </div>
          <div className="flex min-h-0 flex-1 justify-center">
            <div className="aspect-[3/4] h-[42dvh] max-w-full lg:aspect-auto lg:h-full">
              <PitchBoard
                formation={view.formation}
                slate={view.mySlate}
                mode="classic"
                glowSlots={selPlayer || moveFrom !== null ? open : null}
                clickableSlots={clickable}
                selectedSlot={moveFrom}
                onSlotClick={tapSlot}
              />
            </div>
          </div>
          <p className="mt-1.5 text-right text-xs text-ink-500">
            Squad strength <span className="headline text-base text-gold-300">{strength}</span>
          </p>
        </main>

        {/* mobile: the whole rail scrolls (reel first, options peeking under it);
            lg: the rail is fixed and only the options list scrolls */}
        <aside className="scrollbar-hide flex min-h-0 flex-col gap-3 max-lg:overflow-y-auto">
          {view.myRoll && (
            <div className="shrink-0">
              <SpinReveal
                key={view.spinIndex}
                target={view.myRoll}
                nations={nations}
                animate={true}
                onSettled={() => ctl.reelSettled()}
              />
            </div>
          )}
          <div className="shrink-0 max-lg:hidden">
            <Countdown deadline={view.spinDeadline} label="PICK CLOSES" hurried={view.hurried} />
          </div>
          <div className="card-gloss scrollbar-hide min-h-0 space-y-1 overflow-y-auto rounded-xl p-2 max-lg:shrink-0 lg:max-h-none lg:flex-1">
            {ranked.map((o, rank) => {
              const p = o.player;
              const sel = selPlayer?.id === p.id;
              const picked = view.myPick?.playerId === p.id;
              const fit = o.bestSlot;
              const best = rank === 0 && fit !== null;
              return (
                <button
                  key={p.id}
                  type="button"
                  data-testid="mp-option"
                  disabled={locked}
                  onClick={() => {
                    setSelPlayer(sel ? null : p);
                    setMoveFrom(null);
                  }}
                  className={`w-full cursor-pointer rounded-lg border px-2.5 py-1.5 text-left text-sm transition max-lg:py-2.5 ${
                    picked
                      ? 'btn-gold border-transparent'
                      : sel
                        ? 'border-gold-500 bg-night-800'
                        : best
                          ? 'border-gold-600/50 hover:bg-night-800'
                          : 'border-transparent hover:bg-night-800'
                  } ${locked && !picked ? 'opacity-40' : ''}`}
                >
                  <span className="flex w-full items-baseline gap-2">
                    <span className="headline w-9 shrink-0 text-[10px] text-gold-300">
                      {p.position}
                    </span>
                    <span className="truncate font-bold text-ink-100">
                      {flagOf(p.nation)} {p.name}
                    </span>
                    {(p.secondary?.length ?? 0) > 0 && (
                      <span className="shrink-0 text-[10px] text-ink-500">
                        also {p.secondary!.join(' · ')}
                      </span>
                    )}
                    <span className="headline ml-auto shrink-0 text-base text-gold-300">
                      {p.rating}
                    </span>
                  </span>
                  <span className="mt-0.5 flex w-full items-baseline justify-between text-[11px]">
                    {fit ? (
                      fit.natural ? (
                        <span className="text-win">→ {fit.position} natural</span>
                      ) : (
                        <span className="text-orange-400">→ {fit.position}</span>
                      )
                    ) : (
                      <span className="text-ink-500">no open slot</span>
                    )}
                    {fit && (
                      <span className={`font-black ${best ? 'text-gold-300' : 'text-ink-500'}`}>
                        +{o.boost.toFixed(1)}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            {ranked.length === 0 && (
              <p className="px-2 py-3 text-xs text-ink-500">Reels rolling…</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

// ── Lockstep viewing ──────────────────────────────────────────────────────────

/** Minimal GameState synthesis so the solo screens render MP data unchanged. */
function synthState(view: OnlineView, managers: Manager[]): GameState {
  // The live-scores rail shows ONLY the current slot's matches — while you play
  // your first match you see everyone else's first match, and so on (Lucca).
  const currentSet = view.slots[Math.min(view.featuredIndex, view.slots.length - 1)]?.set ?? 0;
  return {
    screen: 'battle',
    seed: 0,
    managers,
    draftSlotIndex: 11,
    spunNation: null,
    roundIndex: view.round - 1,
    rounds: view.rounds,
    battleView: 'playback',
    pool: [],
    humanPlacement: view.placement,
    matchday: view.matchday
      ? {
          featured: view.matchday.featured,
          featuredIndex: view.featuredIndex,
          rail: view.matchday.rail.filter((r) => r.set === currentSet),
        }
      : null,
  };
}

function myManagers(view: OnlineView): Manager[] {
  return view.managers.map((m) => ({ ...m, isHuman: m.id === view.mySeatId }));
}

function OnlineWatch(props: { view: OnlineView; ctl: OnlineController }) {
  const { view } = props;
  const managers = useMemo(() => myManagers(view), [view.managers, view.mySeatId]); // eslint-disable-line react-hooks/exhaustive-deps
  const spectating = (view.matchday?.featured.length ?? 0) === 0;
  const slot = view.slots[Math.min(view.featuredIndex, view.slots.length - 1)];
  const preKick = view.startAt !== null && Date.now() < view.startAt;

  if (spectating) return <SpectatorView view={props.view} ctl={props.ctl} />;

  // My match can end before the slot does (the slot runs as long as the set's
  // LONGEST match — usually one that went to pens). Once mine is over, switch
  // to the waiting room: full-time score + the other matches ticking live.
  const slotStart = (view.startAt ?? 0) + (slot?.offsetMs ?? 0);
  const mine = view.matchday?.featured[Math.min(view.featuredIndex, (view.matchday?.featured.length ?? 1) - 1)];
  const contentElapsed = (Date.now() - slotStart) * MP_TIME_SCALE;
  const waiting =
    !preKick && !!mine && contentElapsed > contentEndMs(mine) + 3_500; // a beat to see FT

  return (
    <div className="bg-stadium min-h-screen text-ink-100">
      <div className="mx-auto max-w-6xl px-4 py-5">
        <header className="mb-3 flex items-baseline justify-between">
          <h1 className="headline text-lg">
            <span className="text-ink-100">Round</span>{' '}
            <span className="headline-gold">{view.round}</span>
            <span className="ml-3 text-xs tracking-[0.25em] text-ink-500">
              LOCKSTEP · MATCH {Math.min(view.featuredIndex + 1, 3)}/3
            </span>
          </h1>
          <span className="text-xs text-ink-500">everyone watches together · no skips</span>
        </header>
        {preKick ? (
          <p className="headline animate-gold-pulse mx-auto w-fit rounded-xl px-8 py-16 text-3xl text-gold-300">
            KICK-OFF…
          </p>
        ) : waiting ? (
          <WaitingRoom view={view} mine={mine!} slot={slot} contentElapsed={contentElapsed} />
        ) : (
          <MatchPlaybackScreen
            state={synthState(view, managers)}
            animate={true}
            onNextFeatured={() => {}}
            onFinishRound={() => {}}
            onSkipAll={() => {}}
            lockstep={{
              startAt: (view.startAt ?? 0) + (slot?.offsetMs ?? 0),
              scale: MP_TIME_SCALE,
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Full time on YOUR pitch, but the slot is still running — show the score you
 *  finished on and every other match of this set ticking live, pens included. */
function WaitingRoom(props: {
  view: OnlineView;
  mine: MatchTimeline;
  slot: { set: number; offsetMs: number; durationMs: number } | undefined;
  contentElapsed: number;
}) {
  const { view, mine, contentElapsed } = props;
  const nameOf = (id: string) => view.seats.find((s) => s.id === id)?.name ?? id;
  const virtualMinute = Math.min(90, (contentElapsed / MATCH_DURATION_MS) * 90);
  const others = (view.matchday?.rail ?? []).filter((r) => r.set === (props.slot?.set ?? 0));
  const slotEndsAt = (view.startAt ?? 0) + (props.slot ? props.slot.offsetMs + props.slot.durationMs : 0);
  const myPens = mine.shootout;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="card-gloss rounded-2xl p-6 text-center">
        <p className="headline text-[10px] tracking-[0.35em] text-ink-500">FULL TIME</p>
        <p className="headline mt-2 text-3xl text-ink-100">
          {nameOf(mine.homeId)}{' '}
          <span className="headline-gold">
            {mine.finalScore.home}–{mine.finalScore.away}
          </span>{' '}
          {nameOf(mine.awayId)}
        </p>
        {myPens && (
          <p className="mt-1 text-sm font-bold text-gold-300">
            {myPens.home}–{myPens.away} on pens · {nameOf(myPens.winner === 'home' ? mine.homeId : mine.awayId)} through
          </p>
        )}
        <p className="headline animate-gold-pulse mt-4 text-xs tracking-[0.25em] text-gold-400">
          WAITING FOR THE OTHER MATCHES TO FINISH…
        </p>
      </div>

      {others.length > 0 && (
        <div className="card-gloss mt-4 rounded-2xl p-4">
          <h3 className="headline mb-2 text-[10px] tracking-[0.3em] text-ink-500">
            STILL PLAYING · MATCH {(props.slot?.set ?? 0) + 1} EVERYWHERE
          </h3>
          <div className="space-y-1">
            {others.map((m) => {
              let h = 0;
              let a = 0;
              for (const g of m.goals) if (g.minute <= virtualMinute) g.team === 'home' ? h++ : a++;
              const kicksIn = (m.pens ?? []).filter((k) => k.atMs <= contentElapsed);
              const inPens = (m.pens?.length ?? 0) > 0 && contentElapsed >= MATCH_DURATION_MS;
              const pensDone = inPens && kicksIn.length === (m.pens?.length ?? 0);
              const ph = kicksIn.filter((k) => k.team === 'home' && k.scored).length;
              const pa = kicksIn.filter((k) => k.team === 'away' && k.scored).length;
              const over = !inPens && virtualMinute >= 90 && !m.pens;
              return (
                <div
                  key={m.matchId}
                  className="flex items-baseline justify-between rounded-lg bg-night-800/60 px-3 py-1.5 text-sm"
                >
                  <span className="truncate text-ink-300">
                    {nameOf(m.homeId)} <span className="text-night-600">v</span> {nameOf(m.awayId)}
                  </span>
                  <span className="ml-3 flex shrink-0 items-baseline gap-2 tabular-nums">
                    <span className="font-bold text-gold-400">
                      {h}–{a}
                    </span>
                    {inPens && (
                      <span
                        className={`headline text-[10px] tracking-[0.15em] ${
                          pensDone ? 'text-ink-500' : 'animate-gold-pulse text-loss'
                        }`}
                      >
                        PENS {ph}–{pa}
                      </span>
                    )}
                    {(over || pensDone) && <span className="text-[10px] text-ink-500">FT</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-4">
        <Countdown
          deadline={slotEndsAt}
          label={(props.slot?.set ?? 0) >= 2 ? 'ROUND RESULTS IN' : 'YOUR NEXT MATCH IN'}
        />
      </div>
    </div>
  );
}

// ── Standings + spectators ────────────────────────────────────────────────────

function MpStandings(props: { view: OnlineView; compact?: boolean }) {
  const { view } = props;
  const result = view.rounds[view.rounds.length - 1];
  if (!result) return null;
  const nameOf = (id: string) => view.seats.find((s) => s.id === id)?.name ?? id;
  const target = MP_SURVIVORS_PER_ROUND[result.round - 1];
  return (
    <div className="card-gloss rounded-2xl p-4">
      <h3 className="headline mb-2 text-[10px] tracking-[0.3em] text-gold-400">
        ROUND {result.round} TABLE · top {target} survive
      </h3>
      <ol className="space-y-0.5">
        {result.table.slice(0, props.compact ? 12 : undefined).map((row, i) => {
          const you = row.managerId === view.mySeatId;
          const cut = i === target - 1;
          return (
            <li
              key={row.managerId}
              className={`flex items-baseline gap-2 rounded px-1.5 py-0.5 text-xs ${
                you ? 'bg-gold-400/10 font-bold text-gold-300' : 'text-ink-300'
              } ${cut ? 'animate-cutline-pulse border-b border-loss/60' : ''}`}
            >
              <span className="headline w-5 shrink-0 text-[10px] text-ink-500">{i + 1}</span>
              <span className="truncate">{nameOf(row.managerId)}</span>
              <span className="ml-auto shrink-0 tabular-nums">
                {row.points} pts · {row.gd > 0 ? `+${row.gd}` : row.gd}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SpectatorView(props: { view: OnlineView; ctl: OnlineController }) {
  const { view, ctl } = props;
  const aliveSeats = view.seats.filter((s) => view.aliveIds.has(s.id));
  return (
    <div className="bg-stadium min-h-screen text-ink-100">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <header className="mb-4 text-center">
          <p className="headline text-xs tracking-[0.35em] text-loss">ELIMINATED — SPECTATING</p>
          <h1 className="headline mt-1 text-2xl text-ink-100">
            Round <span className="headline-gold">{view.round}</span> is playing out…
          </h1>
        </header>
        <MpStandings view={view} />
        <div className="card-gloss mt-4 rounded-2xl p-4">
          <h3 className="headline mb-2 text-[10px] tracking-[0.3em] text-gold-400">ROOTING FOR</h3>
          <div className="flex flex-wrap gap-1.5">
            {aliveSeats.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => ctl.rootFor(s.id)}
                className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-bold transition ${
                  view.myRoot === s.id ? 'btn-gold' : 'border border-night-600 text-ink-300 hover:border-gold-500'
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-ink-500">
            Pick a survivor to back — it shows on the end screen.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── The 20-second pit stop ────────────────────────────────────────────────────

function OnlinePit(props: { view: OnlineView; ctl: OnlineController }) {
  const { view, ctl } = props;
  const alive = view.mySeatId !== null && view.aliveIds.has(view.mySeatId);
  if (!alive) return <SpectatorPit view={view} ctl={ctl} />;

  const pit = ctl.pitState!;
  const formation = formationById(pit.tactics.formationId)!;
  const stealTargets = view.stealPool.slice(0, 18);

  function bestSlotFor(p: PlayerV2): { slotIndex: number; gain: number } {
    let best = { slotIndex: 0, gain: -Infinity };
    for (let i = 0; i < pit.slate.length; i++) {
      const gain = stealGainV2(pit.slate, formation, p, i, affinity);
      if (gain > best.gain) best = { slotIndex: i, gain };
    }
    return best;
  }

  const lootRail = (
    <div className="card-gloss rounded-2xl p-3">
      <h3 className="headline mb-1.5 text-[10px] tracking-[0.3em] text-loss">
        LOOT THE FALLEN · pick one
      </h3>
      <div className="scrollbar-hide max-h-48 space-y-1 overflow-y-auto lg:max-h-[38vh]">
        {stealTargets.map((p) => {
          const chosen = view.myStealChoice?.playerId === p.id;
          const best = bestSlotFor(p);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() =>
                ctl.setSteal(chosen ? null : { playerId: p.id, slotIndex: best.slotIndex })
              }
              className={`flex w-full cursor-pointer items-baseline gap-1.5 rounded-lg px-2 py-1 text-left text-xs transition max-lg:py-2 ${
                chosen ? 'btn-gold' : 'hover:bg-night-800'
              }`}
            >
              <span className="headline w-8 shrink-0 text-[9px] text-gold-300">{p.position}</span>
              <span className="truncate font-bold">{flagOf(p.nation)} {p.name}</span>
              <span className="ml-auto shrink-0 tabular-nums">
                {p.rating}
                <span className={best.gain > 0 ? 'text-win' : 'text-loss'}>
                  {' '}
                  {best.gain > 0 ? `+${best.gain.toFixed(1)}` : best.gain.toFixed(1)}
                </span>
              </span>
            </button>
          );
        })}
        {stealTargets.length === 0 && <p className="px-2 py-2 text-xs text-ink-500">No loot this round.</p>}
      </div>
    </div>
  );

  return (
    <BetweenMatchBoard
      formation={formation}
      xi={pit.slate}
      mode="classic"
      style={pit.tactics.style}
      affinity={affinity}
      onSwap={(a, b) => ctl.setPitSlate(swapSlots(pit.slate, a, b))}
      onStyleChange={(s) => ctl.setPitTactics({ ...pit.tactics, style: s })}
      onFormationChange={(f) => {
        ctl.setPitTactics({ formationId: f.id, style: pit.tactics.style });
        ctl.setPitSlate(autoArrange(pit.slate.map((x) => x.player), f, affinity));
      }}
      onDone={() => ctl.submitPit()}
      doneLabel={view.pitReady ? 'LOCKED ✓' : 'LOCK IT IN →'}
      banner={
        <div className="mb-3 space-y-2">
          <Countdown deadline={view.pitDeadline} label="PIT STOP — STEAL · RE-SLOT · TACTICS" hurried={view.hurried} />
        </div>
      }
      rightAside={
        // Ordered blocks, not one wrapper: on mobile the board flattens its rails
        // (`max-lg:contents`), so loot slots in right after the pitch (order-2)
        // while the standings drop below the LOCK/tactics stack (order-6).
        <>
          <div className="max-lg:order-2">{lootRail}</div>
          <div className="max-lg:order-6">
            <MpStandings view={view} compact />
          </div>
        </>
      }
    />
  );
}

function SpectatorPit(props: { view: OnlineView; ctl: OnlineController }) {
  const { view, ctl } = props;
  return (
    <div className="bg-stadium min-h-screen text-ink-100">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <header className="mb-4 text-center">
          <p className="headline text-xs tracking-[0.35em] text-loss">
            {view.placement ? `YOU FINISHED #${view.placement}` : 'ELIMINATED'}
          </p>
          <h1 className="headline mt-1 text-2xl">The survivors are in the pits…</h1>
        </header>
        <Countdown deadline={view.pitDeadline} label="NEXT ROUND IN" hurried={view.hurried} />
        <div className="mt-4">
          <MpStandings view={view} />
        </div>
        <SpectatorRoots view={view} ctl={ctl} />
      </div>
    </div>
  );
}

function SpectatorRoots(props: { view: OnlineView; ctl: OnlineController }) {
  const { view, ctl } = props;
  const result = view.rounds[view.rounds.length - 1];
  const aliveSeats = view.seats.filter(
    (s) => view.aliveIds.has(s.id) && !(result?.eliminatedIds ?? []).includes(s.id),
  );
  return (
    <div className="card-gloss mt-4 rounded-2xl p-4">
      <h3 className="headline mb-2 text-[10px] tracking-[0.3em] text-gold-400">ROOTING FOR</h3>
      <div className="flex flex-wrap gap-1.5">
        {aliveSeats.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => ctl.rootFor(s.id)}
            className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-bold transition ${
              view.myRoot === s.id ? 'btn-gold' : 'border border-night-600 text-ink-300 hover:border-gold-500'
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── The end ───────────────────────────────────────────────────────────────────

function OnlineEnd(props: { view: OnlineView; onExit: () => void }) {
  const { view } = props;
  const recorded = useRef(false);
  useEffect(() => {
    if (!recorded.current && view.champion) {
      recorded.current = true;
      recordChampion({
        name: view.champion.name,
        isHuman: view.champion.id === view.mySeatId,
        placementOfHuman: view.placement,
      });
    }
  }, [view.champion, view.mySeatId, view.placement]);

  const managers = useMemo(() => {
    return view.managers.map((m) => ({
      ...m,
      isHuman: m.id === view.mySeatId,
      alive: m.id === view.champion?.id,
    }));
  }, [view.managers, view.mySeatId, view.champion]);

  const state: GameState = {
    screen: 'end',
    seed: 0,
    managers,
    draftSlotIndex: 11,
    spunNation: null,
    roundIndex: view.rounds.length,
    rounds: view.rounds,
    battleView: 'results',
    pool: [],
    humanPlacement: view.placement,
    champion: managers.find((m) => m.id === view.champion?.id),
    playerStats: accrueStats({}, view.rounds),
    humanSlate: (view.seats.find((s) => s.id === view.mySeatId)?.slate ?? null) as
      | XiSlotV2[]
      | null as never,
  };

  const rootEntries = Object.entries(view.roots);
  const nameOf = (id: string) => view.seats.find((s) => s.id === id)?.name ?? id;

  return (
    <div>
      {rootEntries.length > 0 && (
        <div className="bg-night-950 px-6 pt-6 text-center">
          <p className="text-xs text-ink-500">
            🫶{' '}
            {rootEntries
              .map(([who, forWhom]) => `${nameOf(who)} rooted for ${nameOf(forWhom)}`)
              .join(' · ')}
          </p>
        </div>
      )}
      <EndScreen state={state} onReset={props.onExit} animate={true} />
    </div>
  );
}

/** Squad strength shown in the lobby/draft — same metric as everywhere else. */
export function mpSquadRating(seat: MpSeat): number {
  return displayedSquadRating(seat.slate);
}
