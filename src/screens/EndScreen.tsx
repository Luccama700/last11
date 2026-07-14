import { useState } from 'react';
import { playerV2ById } from '../engine/draft';
import { displayedSquadRating } from '../engine/squad-rating';
import type { MatchTimeline } from '../engine/types';
import { flagOf } from '../game/flags';
import { buildNameLookup, topAssists, topScorers, type StatLine } from '../game/player-stats';
import { readChampions } from '../game/champions';
import { aliveOf, humanOf, type GameState } from '../game/state';
import MatchPlaybackScreen from './MatchPlaybackScreen';
import { Crest } from './BattleScreen';
import { ChromeBar } from './ui/kit';

/** Gold trophy — the one screen where gold is the point. */
function TrophyGlyph(props: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={props.className ?? 'h-16 w-16'} aria-hidden>
      <path
        d="M12 6h24v4h8v6c0 6-5 10-10 10h-1a12 12 0 0 1-5 4v6h6l2 6H12l2-6h6v-6a12 12 0 0 1-5-4h-1C9 26 4 22 4 16v-6h8V6zm-4 8v2c0 3.5 2.6 6 6 6h.4A16 16 0 0 1 12 14H8zm32 0h-4a16 16 0 0 1-2.4 8h.4c3.4 0 6-2.5 6-6v-2z"
        fill="url(#tg)"
        stroke="#8a6a10"
        strokeWidth="1"
      />
      <defs>
        <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f4dfa4" />
          <stop offset="55%" stopColor="#d4a843" />
          <stop offset="100%" stopColor="#a16207" />
        </linearGradient>
      </defs>
    </svg>
  );
}

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
  // Same display metric as the draft rail / leaderboard / standings.
  const strength =
    state.humanSlate && state.humanSlate.some((s) => s !== null)
      ? displayedSquadRating(state.humanSlate)
      : displayedSquadRating(human);
  const names = new Map(state.managers.map((m) => [m.id, m.name]));

  // Watch the final as a normal playback: synthesize a one-match matchday.
  if (watchingFinal && finalTimeline) {
    const synthetic: GameState = {
      ...state,
      matchday: { featured: [finalTimeline], featuredIndex: 0, rail: [] },
    };
    const done = () => setWatchingFinal(false);
    return (
      <div className="min-h-dvh bg-arena text-carbon">
        <ChromeBar ribbon title="THE FINAL" />
        <div className="mx-auto max-w-4xl px-6 py-6">
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
    <div className="relative min-h-dvh bg-arena text-carbon">
      <ChromeBar ribbon title="FULL TIME" />
      {won && <ChampionConfetti />}
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-6 py-10 text-center">
        {won ? (
          <div
            className="chrome-gloss glint animate-fade-up relative w-full overflow-hidden rounded-2xl py-8"
            style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 14px), 0 100%)' }}
          >
            <div
              className="scarlet-gloss absolute inset-y-0 right-0 w-1/3"
              style={{ clipPath: 'polygon(40% 0, 100% 0, 100% 100%, 0 100%)' }}
            />
            <div className="relative flex flex-col items-center gap-2">
              <TrophyGlyph className="animate-gold-pulse animate-float h-16 w-16 rounded-full" />
              <p className="condensed text-xs tracking-[0.35em] text-gold-400">
                LAST MANAGER STANDING
              </p>
              <h1 className="condensed text-5xl font-bold">
                <span className="headline-gold">You outlasted all 31.</span>
              </h1>
            </div>
          </div>
        ) : (
          <>
            <p className="scarlet-gloss blade condensed px-5 py-1 text-xs tracking-[0.35em]">
              ELIMINATED
            </p>
            <h1 className="condensed text-5xl font-bold text-carbon">
              You finished <span className="text-scarlet">#{state.humanPlacement}</span> of 32
            </h1>
            {champion && (
              <p className="flex items-center gap-2 text-carbon-600">
                Champion: <Crest name={champion.name} id={champion.id} size="sm" />
                <span className="condensed font-bold text-carbon">{champion.name}</span>
              </p>
            )}
          </>
        )}

        <div className="animate-fade-up mt-1 grid w-full grid-cols-3 gap-3 text-center" style={{ animationDelay: '120ms' }}>
          <Stat label="Rounds survived" value={`${roundsSurvived}/6`} />
          <Stat label="Final strength" value={String(strength)} />
          <Stat label="Placement" value={`#${state.humanPlacement ?? '—'}`} />
        </div>

        {/* Tournament individual awards — Golden Boot & Playmaker podiums. */}
        <StatPodiums state={state} />

        {/* What happened after you fell — round-by-round recap to the crown. */}
        <TournamentRecap state={state} names={names} humanId={human.id} />

        {finalTimeline && (
          <button
            type="button"
            onClick={() => setWatchingFinal(true)}
            className="scarlet-gloss blade condensed w-full cursor-pointer px-6 py-3.5 text-lg"
          >
            ▶ WATCH THE FINAL
          </button>
        )}

        <div className="w-full glass overflow-hidden p-5 text-left">
          <h2 className="condensed mb-2 text-xs tracking-[0.25em] text-carbon-600">Your final XI</h2>
          <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
            {human.xi.map((s, i) => {
              const detailed = playerV2ById(s.player.id)?.position;
              return (
                <p key={i} className="row-band flex items-baseline gap-2 px-1 text-sm text-carbon">
                  {detailed && (
                    <span className="condensed w-9 shrink-0 text-[10px] font-bold text-carbon-600">{detailed}</span>
                  )}
                  <span className="truncate">
                    {flagOf(s.player.nation)} {s.player.name}
                  </span>
                  <span className="tabular ml-auto text-xs font-bold text-royal">{s.player.rating}</span>
                </p>
              );
            })}
          </div>
        </div>

        <HallOfChampions />

        <button
          onClick={props.onReset}
          className="scarlet-gloss blade condensed glint hover-lift mt-1 cursor-pointer px-12 py-4 text-xl"
        >
          PLAY AGAIN
        </button>
        <p className="condensed text-xs text-carbon-600">Last11 · last11.app</p>
      </div>
    </div>
  );
}

/** Golden Boot / Playmaker podiums — top three each, medal-tinted rows. */
function StatPodiums(props: { state: GameState }) {
  const stats = props.state.playerStats ?? {};
  const nameOf = buildNameLookup(props.state.managers);
  const boots = topScorers(stats, nameOf, 3);
  const makers = topAssists(stats, nameOf, 3);
  if (boots.length === 0 && makers.length === 0) return null;
  const MEDALS = ['text-gold-600', 'text-carbon-600', 'text-[#a4694a]'];
  const podium = (title: string, lines: StatLine[], value: (l: StatLine) => number, unit: string) => (
    <div className="flex-1 glass overflow-hidden p-4 text-left">
      <h3 className="condensed mb-2.5 text-[10px] tracking-[0.3em] text-gold-600">{title}</h3>
      {lines.length === 0 ? (
        <p className="text-xs text-carbon-600">Nobody troubled the scorers.</p>
      ) : (
        <ol>
          {lines.map((l, i) => (
            <li key={l.playerId} className="row-band flex items-baseline gap-2 px-1 py-0.5 text-sm">
              <span className={`condensed w-4 shrink-0 text-xs font-bold ${MEDALS[i] ?? 'text-carbon-600'}`}>
                {i + 1}
              </span>
              <span className="condensed truncate font-bold text-carbon">{l.name}</span>
              <span className={`condensed tabular ml-auto shrink-0 text-base font-bold ${MEDALS[i] ?? 'text-carbon'}`}>
                {value(l)}
              </span>
              <span className="shrink-0 text-[10px] text-carbon-600">{unit}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
  return (
    <div className="flex w-full flex-col gap-3 sm:flex-row">
      {podium('GOLDEN BOOT', boots, (l) => l.goals, 'goals')}
      {podium('PLAYMAKER', makers, (l) => l.assists, 'assists')}
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
    <div className="w-full glass overflow-hidden p-5 text-left">
      <h2 className="condensed mb-3 text-xs tracking-[0.25em] text-carbon-600">
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
                className={`condensed mt-0.5 w-14 shrink-0 text-[10px] font-bold tracking-wider ${
                  isFinal ? 'text-gold-600' : 'text-carbon-600'
                }`}
              >
                {isFinal ? 'FINAL' : `ROUND ${r.round}`}
              </span>
              <span className="text-carbon">
                {isFinal && winner ? (
                  <>
                    <span className="condensed font-bold text-gold-600">{names.get(winner.managerId)}</span>{' '}
                    beat {names.get(r.eliminatedIds[0])} to take the crown
                    <span className="text-carbon-600">
                      {' '}
                      ({winner.points} pts · GD {winner.gd > 0 ? `+${winner.gd}` : winner.gd})
                    </span>
                  </>
                ) : (
                  <>
                    {r.eliminatedIds.length} fell
                    {youFell && <span className="font-bold text-scarlet"> — including you</span>}
                    {!youWereIn && !isFinal && <span className="text-carbon-600"> (after your run)</span>}
                    <span className="text-carbon-600">
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

/** Every crowned champion across all runs on this machine — bot dynasties and
 *  your own reigns, newest first, tallied by name. */
function HallOfChampions() {
  const champions = readChampions();
  if (champions.length === 0) return null;
  const tally = new Map<string, { count: number; isHuman: boolean; last: string }>();
  for (const c of champions) {
    const t = tally.get(c.name) ?? { count: 0, isHuman: c.isHuman, last: c.date };
    t.count++;
    if (c.date > t.last) t.last = c.date;
    tally.set(c.name, t);
  }
  const rows = [...tally.entries()].sort(
    (a, b) => b[1].count - a[1].count || b[1].last.localeCompare(a[1].last),
  );
  return (
    <div className="w-full glass overflow-hidden p-5 text-left">
      <h2 className="condensed mb-2.5 text-xs tracking-[0.3em] text-gold-600">
        HALL OF CHAMPIONS
      </h2>
      <ul>
        {rows.slice(0, 8).map(([name, t], i) => (
          <li key={name} className="row-band flex items-center gap-2 px-1 py-0.5 text-sm">
            <span className="condensed w-4 shrink-0 text-xs text-carbon-600">{i + 1}</span>
            <Crest name={name} id={name} you={t.isHuman} size="sm" />
            <span className={`condensed truncate font-bold ${t.isHuman ? 'text-gold-600' : 'text-carbon'}`}>
              {name}
              {t.isHuman && ' (you)'}
            </span>
            <span className="condensed tabular ml-auto flex shrink-0 items-center gap-1 text-base font-bold text-gold-600">
              {t.count > 1 ? `${t.count}×` : ''}
              <TrophyGlyph className="h-4 w-4" />
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-carbon-600">
        {champions.length} tournament{champions.length === 1 ? '' : 's'} decided on this machine.
      </p>
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
    <div className="silver-gloss hover-lift rounded-2xl px-3 py-4">
      <p className="condensed tabular text-2xl font-bold text-carbon">{props.value}</p>
      <p className="condensed mt-1 text-xs uppercase tracking-wider text-carbon-600">{props.label}</p>
    </div>
  );
}
