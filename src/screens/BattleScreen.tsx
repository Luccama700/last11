import { useState } from 'react';
import { affinity } from '../engine/affinity';
import { displayedSquadRating } from '../engine/squad-rating';
import { SURVIVORS_PER_ROUND, type Manager, type MatchResult } from '../engine/tournament';
import type { PlayingStyle, XiSlotV2 } from '../engine/types';
import { buildNameLookup, topAssists, topScorers } from '../game/player-stats';
import { aliveOf, humanOf, type GameState } from '../game/state';
import BetweenMatchBoard from './board/BetweenMatchBoard';
import MatchPlaybackScreen from './MatchPlaybackScreen';

export default function BattleScreen(props: {
  state: GameState;
  animate: boolean;
  boardStyle: PlayingStyle;
  onPlayRound: () => void;
  onContinue: () => void;
  onNextFeatured: () => void;
  onFinishRound: () => void;
  onSkipAll: () => void;
  onBoardSwap: (a: number, b: number) => void;
  onBoardStyleChange: (s: PlayingStyle) => void;
}) {
  const { state } = props;
  const human = humanOf(state)!;
  const alive = aliveOf(state);
  const [boardOpen, setBoardOpen] = useState(false);
  const [standingsOpen, setStandingsOpen] = useState(false);

  // Round-boundary lineup board (DECISIONS: re-slot + style between rounds). Rounds are
  // ATOMIC (all 3 sets resolve in one playRound), so a re-slot only affects the NEXT
  // round — hence the round intro, not the playback flow: keeps table === played score.
  const denseSlate = (state.humanSlate ?? []).filter((s): s is XiSlotV2 => s !== null);
  const canAdjust = !!state.formation && denseSlate.length === state.formation.slots.length;

  if (state.battleView === 'intro' && boardOpen && canAdjust) {
    return (
      <BetweenMatchBoard
        formation={state.formation!}
        xi={denseSlate}
        mode={state.mode ?? 'classic'}
        style={props.boardStyle}
        affinity={affinity}
        onSwap={props.onBoardSwap}
        onStyleChange={props.onBoardStyleChange}
        onDone={() => setBoardOpen(false)}
      />
    );
  }

  return (
    <div className="bg-stadium min-h-screen text-ink-100">
      <div className="mx-auto max-w-4xl px-6 py-6">
        <header className="mb-5 flex items-baseline justify-between">
          <h1 className="headline text-xl">
            <span className="text-ink-100">Last</span>
            <span className="headline-gold">11</span>
            <span className="ml-3 text-xs tracking-[0.3em] text-ink-500">THE ARENA</span>
          </h1>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setStandingsOpen((v) => !v)}
              aria-pressed={standingsOpen}
              className={`cursor-pointer rounded-lg px-3 py-1 text-xs font-bold transition ${
                standingsOpen ? 'btn-gold' : 'border border-night-600 text-ink-300 hover:border-gold-500'
              }`}
            >
              STANDINGS
            </button>
            <p className="text-sm font-semibold text-ink-500">{alive.length} alive</p>
          </div>
        </header>

        {state.battleView === 'intro' ? (
          <RoundIntro
            state={state}
            onPlayRound={props.onPlayRound}
            onAdjust={canAdjust ? () => setBoardOpen(true) : undefined}
          />
        ) : state.battleView === 'playback' ? (
          <MatchPlaybackScreen
            state={state}
            animate={props.animate}
            onNextFeatured={props.onNextFeatured}
            onFinishRound={props.onFinishRound}
            onSkipAll={props.onSkipAll}
          />
        ) : (
          <RoundResults state={state} onContinue={props.onContinue} humanAlive={human.alive} />
        )}
      </div>

      {/* Standings is a POPUP over the battle view — the playback underneath keeps
          its clock and never unmounts (opening it mid-match no longer resets). */}
      {standingsOpen && <Standings state={state} onClose={() => setStandingsOpen(false)} />}
    </div>
  );
}

// ── shared bits ──────────────────────────────────────────────────────────────

/** Generic auto-crest: initials on a deterministic hue. Zero copyright risk. */
export function Crest(props: { name: string; id: string; you?: boolean; size?: 'sm' | 'md' }) {
  let h = 0;
  for (let i = 0; i < props.id.length; i++) h = (h * 31 + props.id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const initials = props.name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const sz = props.size === 'sm' ? 'h-5 w-5 text-[8px]' : 'h-7 w-7 text-[10px]';
  return (
    <span
      aria-hidden="true"
      className={`headline inline-flex shrink-0 items-center justify-center rounded-full border ${sz} ${
        props.you ? 'border-gold-400' : 'border-white/20'
      }`}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 45% 32%), hsl(${(hue + 40) % 360} 45% 22%))`, color: '#f3f5f9' }}
    >
      {initials}
    </span>
  );
}

const TRASH_TALK = [
  'My XI has more chemistry than a Nobel lab.',
  "I've seen better defending in a charity match.",
  'The wheel loves me. The table will too.',
  "I didn't come here to make friends. I came to make GD.",
  'Your striker plays like he is still in the parking lot.',
  'Hope you saved a spot on your bench for regret.',
  'Six rounds? I only need my back four.',
  "Somebody's going home. I've already booked your cab.",
  'You call that a midfield? I call it a welcome mat.',
  'My goalkeeper could captain your whole squad.',
];

function RoundIntro(props: { state: GameState; onPlayRound: () => void; onAdjust?: () => void }) {
  const { state } = props;
  const alive = aliveOf(state);
  const human = humanOf(state)!;
  const target = SURVIVORS_PER_ROUND[state.roundIndex];
  const cut = alive.length - target;
  const isFinal = target === 1;
  const pensOn = alive.length <= 16;
  const bots = alive.filter((m) => !m.isHuman);
  const talker = bots[(state.roundIndex * 7) % Math.max(1, bots.length)];
  const line = TRASH_TALK[(state.roundIndex * 5 + alive.length) % TRASH_TALK.length];

  // your live rank among the alive — ONE metric everywhere (squad-rating.ts):
  // the human's detailed slate, bots via their Manager projection.
  const ratingOf = (m: Manager) =>
    m.isHuman && state.humanSlate ? displayedSquadRating(state.humanSlate) : displayedSquadRating(m);
  const strengths = alive
    .map((m) => ({ id: m.id, total: ratingOf(m) }))
    .sort((a, b) => b.total - a.total);
  const yourRank = strengths.findIndex((s) => s.id === human.id) + 1;
  const yourStrength = strengths.find((s) => s.id === human.id)!.total;

  return (
    <div className="card-gloss flex flex-col items-center gap-5 rounded-2xl p-10 text-center">
      <p className="headline text-xs tracking-[0.35em] text-loss">
        {isFinal ? 'THE FINAL' : `ROUND ${state.roundIndex + 1}`}
      </p>
      <h2 className="headline text-4xl text-ink-100">
        {isFinal
          ? 'Head to head. Last manager standing.'
          : `${cut} manager${cut === 1 ? '' : 's'} will fall`}
      </h2>
      <p className="max-w-md text-ink-500">
        Everyone plays 3 matches.{' '}
        {isFinal ? 'Best record takes the crown.' : `The bottom ${cut} of the table go home.`}{' '}
        {pensOn ? (
          <span className="font-bold text-gold-300">No draws — level matches go to penalties.</span>
        ) : (
          <span>Draws stand in the group stage.</span>
        )}
      </p>
      <p className="text-sm text-ink-500">
        Your squad: <span className="headline text-gold-300">{yourStrength.toFixed(0)}</span>{' '}
        · ranked <span className="font-bold text-ink-100">#{yourRank}</span> of {alive.length}
      </p>
      <button onClick={props.onPlayRound} className="btn-gold headline cursor-pointer rounded-xl px-12 py-4 text-xl">
        PLAY ROUND {state.roundIndex + 1} ▶
      </button>
      {props.onAdjust && (
        <button
          onClick={props.onAdjust}
          className="cursor-pointer text-sm font-bold text-ink-500 underline-offset-4 transition hover:text-gold-300 hover:underline"
        >
          ⚙ adjust lineup &amp; style
        </button>
      )}
      {talker && (
        <p className="mt-1 max-w-md rounded-xl bg-night-950/80 px-4 py-2 text-sm italic text-ink-500">
          💬 <span className="font-bold not-italic text-ink-300">{talker.name}:</span> “{line}”
        </p>
      )}
    </div>
  );
}

/** Result chip for one of your matches — labels shootouts, never fakes a draw. */
function matchChip(m: MatchResult, humanId: string, names: Map<string, string>) {
  const youHome = m.homeId === humanId;
  const you = youHome ? m.homeGoals : m.awayGoals;
  const them = youHome ? m.awayGoals : m.homeGoals;
  const oppName = names.get(youHome ? m.awayId : m.homeId)!;
  const youSide = youHome ? 'home' : 'away';
  const pens = m.decidedBy === 'pens';
  const won = m.winner != null ? m.winner === youSide : you > them;
  const drew = m.winner === null || (m.winner === undefined && you === them);
  const tone = drew ? 'text-draw' : won ? 'text-win' : 'text-loss';
  const label = pens ? (won ? ' won on pens' : ' lost on pens') : '';
  return { you, them, oppName, tone, label, pens };
}

function RoundResults(props: { state: GameState; onContinue: () => void; humanAlive: boolean }) {
  const { state } = props;
  const result = state.rounds[state.rounds.length - 1];
  const prev = state.rounds.length > 1 ? state.rounds[state.rounds.length - 2] : null;
  const prevRank = new Map((prev?.table ?? []).map((r, i) => [r.managerId, i]));
  const names = new Map(state.managers.map((m) => [m.id, m.name]));
  const target = SURVIVORS_PER_ROUND[result.round - 1];
  const humanId = humanOf(state)!.id;
  const eliminated = new Set(result.eliminatedIds);

  const yourMatches = result.matches.filter(
    (m) => m.homeId === humanId || m.awayId === humanId,
  );

  // One display metric for the Squad column (row.strength is the engine's internal
  // number and disagreed with the draft rail for the human — Lucca's bug report).
  const byId = new Map(state.managers.map((m) => [m.id, m]));
  const ratingOf = (id: string) => {
    const m = byId.get(id);
    if (!m) return 0;
    return m.isHuman && state.humanSlate ? displayedSquadRating(state.humanSlate) : displayedSquadRating(m);
  };

  // Tournament race so far — small, pretty, top of the table (full list on the end screen).
  const nameOf = buildNameLookup(state.managers);
  const boot = topScorers(state.playerStats ?? {}, nameOf, 1)[0];
  const playmaker = topAssists(state.playerStats ?? {}, nameOf, 1)[0];

  return (
    <div className="space-y-5">
      {yourMatches.length > 0 && (
        <div className="card-gloss rounded-2xl p-5">
          <h3 className="headline mb-3 text-xs tracking-[0.25em] text-ink-500">Your matches</h3>
          <div className="grid gap-2 md:grid-cols-3">
            {yourMatches.map((m, i) => {
              const c = matchChip(m, humanId, names);
              return (
                <p key={i} className="rounded-lg bg-night-950/80 px-3 py-2 text-sm">
                  <span className={`headline ${c.tone}`}>
                    {c.you}–{c.them}
                  </span>
                  {c.label && <span className={`text-[10px] font-bold ${c.tone}`}>{c.label}</span>}{' '}
                  <span className="text-ink-500">vs {c.oppName}</span>
                </p>
              );
            })}
          </div>
        </div>
      )}

      {(boot || playmaker) && (
        <div className="flex flex-wrap gap-2">
          {boot && (
            <span className="card-gloss flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs">
              <span className="headline text-[9px] tracking-[0.2em] text-gold-400">GOLDEN BOOT</span>
              <span className="font-bold text-ink-100">{boot.name}</span>
              <span className="headline text-gold-300">{boot.goals}</span>
            </span>
          )}
          {playmaker && (
            <span className="card-gloss flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs">
              <span className="headline text-[9px] tracking-[0.2em] text-ink-500">PLAYMAKER</span>
              <span className="font-bold text-ink-100">{playmaker.name}</span>
              <span className="headline text-gold-300">{playmaker.assists}</span>
            </span>
          )}
        </div>
      )}

      <div className="card-gloss rounded-2xl p-5">
        <h3 className="headline mb-3 text-xs tracking-[0.25em] text-ink-500">
          Round {result.round} table · bottom {result.eliminatedIds.length} eliminated
        </h3>
        <div className="max-h-96 overflow-y-auto pr-1">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-ink-500">
              <tr>
                <th className="py-1 pr-2">#</th>
                <th className="py-1 pr-2" />
                <th className="py-1 pr-2">Manager</th>
                <th className="py-1 pr-2 text-right">Squad</th>
                <th className="py-1 pr-2 text-right">Pts</th>
                <th className="py-1 pr-2 text-right">GD</th>
                <th className="py-1 text-right">GF</th>
              </tr>
            </thead>
            <tbody>
              {result.table.map((row, i) => {
                const isYou = row.managerId === humanId;
                const isOut = eliminated.has(row.managerId);
                const was = prevRank.get(row.managerId);
                const moved = was === undefined ? 0 : was - i;
                return (
                  <tr
                    key={row.managerId}
                    style={{ animationDelay: `${i * 30}ms` }}
                    className={`animate-row-in ${i === target ? 'animate-cutline-pulse border-t-2 border-loss/60' : 'border-t border-night-700'} ${
                      isYou ? 'bg-gold-400/10 font-bold' : ''
                    } ${isOut ? 'text-loss/70 line-through decoration-loss/40' : ''}`}
                  >
                    <td className="py-1.5 pr-2 tabular-nums text-ink-500">
                      {i + 1}
                      {moved !== 0 && (
                        <span className={`ml-1 text-[9px] ${moved > 0 ? 'text-win' : 'text-loss'}`}>
                          {moved > 0 ? `▲${moved}` : `▼${-moved}`}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2">
                      <Crest name={names.get(row.managerId) ?? '?'} id={row.managerId} you={isYou} size="sm" />
                    </td>
                    <td className="py-1.5 pr-2">
                      {names.get(row.managerId)}
                      {isYou && ' (you)'}
                    </td>
                    <td className="headline py-1.5 pr-2 text-right text-xs text-gold-300">
                      {ratingOf(row.managerId)}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{row.points}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {row.gd > 0 ? `+${row.gd}` : row.gd}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{row.gf}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-center">
        <button
          onClick={props.onContinue}
          className={`headline cursor-pointer rounded-xl px-10 py-4 text-xl transition ${
            props.humanAlive
              ? 'btn-gold'
              : 'bg-loss text-night-950 shadow-lg shadow-loss/25 hover:brightness-110'
          }`}
        >
          {props.humanAlive ? 'CONTINUE →' : 'SEE HOW IT ENDS'}
        </button>
      </div>
    </div>
  );
}

/** Persistent standings — open any time from the arena header. Alive managers by
 *  squad rating, with cumulative tournament points from every round so far. */
function Standings(props: { state: GameState; onClose: () => void }) {
  const { state } = props;
  const humanId = humanOf(state)!.id;
  const cumulative = new Map<string, number>();
  for (const r of state.rounds)
    for (const row of r.table) cumulative.set(row.managerId, (cumulative.get(row.managerId) ?? 0) + row.points);

  const rows = state.managers
    .map((m: Manager) => ({
      m,
      strength:
        m.isHuman && state.humanSlate
          ? displayedSquadRating(state.humanSlate)
          : m.xi.length > 0
            ? displayedSquadRating(m)
            : 0,
      pts: cumulative.get(m.id) ?? 0,
    }))
    .sort((a, b) => Number(b.m.alive) - Number(a.m.alive) || b.strength - a.strength);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-night-950/70 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Standings"
      onClick={props.onClose}
    >
      <div
        className="card-gloss animate-pop w-full max-w-2xl rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="headline text-xs tracking-[0.25em] text-ink-500">
            Standings · every squad in the lobby
          </h3>
          <button
            type="button"
            onClick={props.onClose}
            className="cursor-pointer rounded px-2 py-0.5 text-sm font-bold text-ink-500 hover:text-gold-300"
            aria-label="Close standings"
          >
            ✕ close
          </button>
        </div>
        <div className="scrollbar-hide max-h-[70vh] overflow-y-auto pr-1">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-ink-500">
            <tr>
              <th className="py-1 pr-2">#</th>
              <th className="py-1 pr-2" />
              <th className="py-1 pr-2">Manager</th>
              <th className="py-1 pr-2 text-right">Squad rating</th>
              <th className="py-1 text-right">Total pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ m, strength, pts }, i) => (
              <tr
                key={m.id}
                className={`border-t border-night-700 ${m.id === humanId ? 'bg-gold-400/10 font-bold' : ''} ${
                  !m.alive ? 'text-loss/60 line-through decoration-loss/30' : ''
                }`}
              >
                <td className="py-1.5 pr-2 tabular-nums text-ink-500">{i + 1}</td>
                <td className="py-1.5 pr-2">
                  <Crest name={m.name} id={m.id} you={m.id === humanId} size="sm" />
                </td>
                <td className="py-1.5 pr-2">
                  {m.name}
                  {m.id === humanId && ' (you)'}
                  {!m.alive && <span className="ml-1.5 text-[9px] no-underline">OUT</span>}
                </td>
                <td className="headline py-1.5 pr-2 text-right text-xs text-gold-300">
                  {strength > 0 ? strength : '—'}
                </td>
                <td className="py-1.5 text-right tabular-nums">{pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
