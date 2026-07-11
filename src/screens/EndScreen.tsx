import { useState } from 'react';
import { playerV2ById } from '../engine/draft';
import { teamStrength } from '../engine/rating';
import type { MatchTimeline } from '../engine/types';
import { flagOf } from '../game/flags';
import { aliveOf, humanOf, type GameState } from '../game/state';
import MatchPlaybackScreen from './MatchPlaybackScreen';
import { Crest } from './BattleScreen';

/** Optional post-elimination extras (architect's night-shift lane); the screen
 *  degrades gracefully until they land in GameState. */
type EndExtras = { finalTimeline?: MatchTimeline | null };

export default function EndScreen(props: { state: GameState; onReset: () => void; animate?: boolean }) {
  const { state } = props;
  const human = humanOf(state)!;
  const champion = aliveOf(state)[0];
  const won = state.humanPlacement === 1;
  const finalTimeline = (state as GameState & EndExtras).finalTimeline ?? null;
  const [watchingFinal, setWatchingFinal] = useState(false);
  const roundsSurvived = state.rounds.filter(
    (r) =>
      r.table.some((row) => row.managerId === human.id) &&
      !r.eliminatedIds.includes(human.id),
  ).length;
  const strength = teamStrength(human.xi);
  const names = new Map(state.managers.map((m) => [m.id, m.name]));

  // Watch the final as a normal playback: synthesize a one-match matchday.
  if (watchingFinal && finalTimeline) {
    const synthetic: GameState = {
      ...state,
      matchday: { featured: [finalTimeline], featuredIndex: 0, rail: [] },
    };
    const done = () => setWatchingFinal(false);
    return (
      <div className="bg-stadium min-h-screen text-ink-100">
        <div className="mx-auto max-w-4xl px-6 py-6">
          <h1 className="headline mb-4 text-center text-sm tracking-[0.3em] text-gold-400">
            THE FINAL
          </h1>
          <MatchPlaybackScreen
            state={synthetic}
            animate={props.animate ?? true}
            onNextFeatured={done}
            onFinishRound={done}
            onSkipAll={done}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-stadium relative min-h-screen text-ink-100">
      {won && <ChampionConfetti />}
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-6 py-12 text-center">
        {won ? (
          <>
            <p className="animate-gold-pulse rounded-full p-4 text-6xl">🏆</p>
            <p className="headline text-xs tracking-[0.35em] text-gold-400">
              LAST MANAGER STANDING
            </p>
            <h1 className="headline text-5xl">
              <span className="headline-gold">You outlasted all 31.</span>
            </h1>
          </>
        ) : (
          <>
            <p className="text-6xl">💀</p>
            <p className="headline text-xs tracking-[0.35em] text-loss">ELIMINATED</p>
            <h1 className="headline text-5xl">
              You finished <span className="text-loss">#{state.humanPlacement}</span> of 32
            </h1>
            {champion && (
              <p className="flex items-center gap-2 text-ink-500">
                Champion: <Crest name={champion.name} id={champion.id} size="sm" />
                <span className="font-bold text-gold-300">{champion.name}</span>
              </p>
            )}
          </>
        )}

        <div className="mt-1 grid w-full grid-cols-3 gap-3 text-center">
          <Stat label="Rounds survived" value={`${roundsSurvived}/6`} />
          <Stat label="Final strength" value={strength.total.toFixed(1)} />
          <Stat label="Placement" value={`#${state.humanPlacement ?? '—'}`} />
        </div>

        {/* What happened after you fell — round-by-round recap to the crown. */}
        <TournamentRecap state={state} names={names} humanId={human.id} />

        {finalTimeline && (
          <button
            type="button"
            onClick={() => setWatchingFinal(true)}
            className="btn-gold headline w-full cursor-pointer rounded-2xl px-6 py-3.5 text-lg"
          >
            ▶ WATCH THE FINAL
          </button>
        )}

        <div className="card-gloss w-full rounded-2xl p-5 text-left">
          <h2 className="headline mb-2 text-xs tracking-[0.25em] text-ink-500">Your final XI</h2>
          <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            {human.xi.map((s, i) => {
              const detailed = playerV2ById(s.player.id)?.position;
              return (
                <p key={i} className="flex items-baseline gap-2 text-sm text-ink-300">
                  {detailed && (
                    <span className="headline w-9 shrink-0 text-[10px] text-gold-300">{detailed}</span>
                  )}
                  <span className="truncate">
                    {flagOf(s.player.nation)} {s.player.name}
                  </span>
                  <span className="ml-auto text-xs text-ink-500">{s.player.rating}</span>
                </p>
              );
            })}
          </div>
        </div>

        <button
          onClick={props.onReset}
          className="btn-gold headline mt-1 cursor-pointer rounded-xl px-12 py-4 text-xl"
        >
          PLAY AGAIN
        </button>
        <p className="text-xs text-ink-500">Last11 · 11a0.com</p>
      </div>
    </div>
  );
}

/** Round-by-round story: cut counts, notable falls, and the final's scoreline. */
function TournamentRecap(props: {
  state: GameState;
  names: Map<string, string>;
  humanId: string;
}) {
  const { state, names } = props;
  if (state.rounds.length === 0) return null;
  return (
    <div className="card-gloss w-full rounded-2xl p-5 text-left">
      <h2 className="headline mb-3 text-xs tracking-[0.25em] text-ink-500">
        How the tournament ended
      </h2>
      <ol className="space-y-2">
        {state.rounds.map((r) => {
          const youWereIn = r.table.some((row) => row.managerId === props.humanId);
          const youFell = r.eliminatedIds.includes(props.humanId);
          const isFinal = r.eliminatedIds.length === 1 && r.table.length === 2;
          const winner = isFinal
            ? r.table.find((row) => !r.eliminatedIds.includes(row.managerId))
            : null;
          return (
            <li key={r.round} className="flex items-start gap-3 text-sm">
              <span
                className={`headline mt-0.5 w-14 shrink-0 text-[10px] tracking-wider ${
                  isFinal ? 'text-gold-400' : 'text-ink-500'
                }`}
              >
                {isFinal ? 'FINAL' : `ROUND ${r.round}`}
              </span>
              <span className="text-ink-300">
                {isFinal && winner ? (
                  <>
                    <span className="font-bold text-gold-300">{names.get(winner.managerId)}</span>{' '}
                    beat {names.get(r.eliminatedIds[0])} to take the crown
                    <span className="text-ink-500">
                      {' '}
                      ({winner.points} pts · GD {winner.gd > 0 ? `+${winner.gd}` : winner.gd})
                    </span>
                  </>
                ) : (
                  <>
                    {r.eliminatedIds.length} fell
                    {youFell && <span className="font-bold text-loss"> — including you</span>}
                    {!youWereIn && !isFinal && <span className="text-ink-500"> (after your run)</span>}
                    <span className="text-ink-500">
                      {' '}
                      · out: {r.eliminatedIds.slice(0, 3).map((id) => names.get(id)).join(', ')}
                      {r.eliminatedIds.length > 3 ? '…' : ''}
                    </span>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const CONFETTI = Array.from({ length: 40 }, (_, i) => ({
  left: (i * 29) % 100,
  delay: (i % 12) * 0.22,
  color: ['#e8c468', '#f4dfa4', '#34d399', '#f3f5f9'][i % 4],
}));

function ChampionConfetti() {
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

function Stat(props: { label: string; value: string }) {
  return (
    <div className="card-gloss rounded-xl px-3 py-4">
      <p className="headline text-2xl text-ink-100">{props.value}</p>
      <p className="mt-1 text-xs uppercase tracking-wider text-ink-500">{props.label}</p>
    </div>
  );
}
