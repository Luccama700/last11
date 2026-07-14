import { Fragment, useState } from 'react';
import { affinity } from '../engine/affinity';
import { displayedSquadRating } from '../engine/squad-rating';
import { SURVIVORS_PER_ROUND, type Manager, type MatchResult } from '../engine/tournament';
import type { Formation, PlayingStyle, XiSlotV2 } from '../engine/types';
import { buildNameLookup, topAssists, topScorers } from '../game/player-stats';
import { aliveOf, humanOf, type GameState } from '../game/state';
import BetweenMatchBoard from './board/BetweenMatchBoard';
import MatchPlaybackScreen from './MatchPlaybackScreen';
import { ChromeBar, HexWatermark, Plaque } from './ui/kit';

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
  onBoardFormationChange: (f: Formation) => void;
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
        onFormationChange={props.onBoardFormationChange}
        onDone={() => setBoardOpen(false)}
      />
    );
  }

  return (
    <div className="min-h-dvh bg-arena text-carbon">
      <ChromeBar
        ribbon
        title="THE ARENA"
        left={
          <button
            type="button"
            onClick={() => setStandingsOpen((v) => !v)}
            aria-pressed={standingsOpen}
            className={`condensed blade cursor-pointer px-3 py-1 text-xs ${
              standingsOpen ? 'silver-pressed silver-gloss' : 'silver-gloss'
            }`}
          >
            STANDINGS
          </button>
        }
        right={<Plaque>{alive.length} alive</Plaque>}
      />
      <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6">

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
      className={`condensed inline-flex shrink-0 items-center justify-center rounded-full border ${sz} ${
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
    <div className="animate-fade-up relative flex flex-col items-center gap-5 glass overflow-hidden p-8 text-center sm:p-10">
      <HexWatermark />
      <p className="scarlet-gloss blade condensed relative px-4 py-0.5 text-xs tracking-[0.35em]">
        {isFinal ? 'THE FINAL' : `ROUND ${state.roundIndex + 1}`}
      </p>
      <h2 className="condensed relative text-4xl font-bold text-carbon">
        {isFinal
          ? 'Head to head. Last manager standing.'
          : `${cut} manager${cut === 1 ? '' : 's'} will fall`}
      </h2>
      <p className="relative max-w-md text-carbon-600">
        Everyone plays 3 matches.{' '}
        {isFinal ? 'Best record takes the crown.' : `The bottom ${cut} of the table go home.`}{' '}
        {pensOn ? (
          <span className="font-bold text-scarlet">No draws — level matches go to penalties.</span>
        ) : (
          <span>Draws stand in the group stage.</span>
        )}
      </p>
      <p className="relative text-sm text-carbon-600">
        Your squad: <span className="condensed tabular font-bold text-royal">{yourStrength.toFixed(0)}</span>{' '}
        · ranked <span className="font-bold text-carbon">#{yourRank}</span> of {alive.length}
      </p>
      <button
        onClick={props.onPlayRound}
        className="scarlet-gloss blade condensed glint hover-lift relative cursor-pointer px-12 py-4 text-xl"
      >
        PLAY ROUND {state.roundIndex + 1} ▶
      </button>
      {props.onAdjust && (
        <button
          onClick={props.onAdjust}
          className="condensed relative cursor-pointer text-sm text-royal underline-offset-4 hover:underline"
        >
          adjust lineup &amp; style
        </button>
      )}
      {talker && (
        <p className="silver-gloss relative mt-1 max-w-md px-4 py-2 text-sm italic text-carbon-600">
          <span className="condensed font-bold not-italic text-carbon">{talker.name}:</span> “{line}”
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
  const tone = drew ? 'text-carbon-600' : won ? 'text-[#2e7527]' : 'text-scarlet';
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
        <div className="animate-fade-up glass overflow-hidden p-4">
          <h3 className="condensed mb-3 text-xs tracking-[0.25em] text-carbon-600">Your matches</h3>
          <div className="grid gap-2 md:grid-cols-3">
            {yourMatches.map((m, i) => {
              const c = matchChip(m, humanId, names);
              return (
                <p key={i} className="silver-gloss px-3 py-2 text-sm">
                  <span className={`condensed tabular font-bold ${c.tone}`}>
                    {c.you}–{c.them}
                  </span>
                  {c.label && <span className={`text-[10px] font-bold ${c.tone}`}>{c.label}</span>}{' '}
                  <span className="text-carbon-600">vs {c.oppName}</span>
                </p>
              );
            })}
          </div>
        </div>
      )}

      {(boot || playmaker) && (
        <div className="flex flex-wrap gap-2">
          {boot && (
            <span className="silver-gloss blade flex items-center gap-2 px-3.5 py-1.5 text-xs">
              <span className="condensed text-[9px] tracking-[0.2em] text-gold-600">GOLDEN BOOT</span>
              <span className="condensed font-bold text-carbon">{boot.name}</span>
              <span className="condensed tabular font-bold text-royal">{boot.goals}</span>
            </span>
          )}
          {playmaker && (
            <span className="silver-gloss blade flex items-center gap-2 px-3.5 py-1.5 text-xs">
              <span className="condensed text-[9px] tracking-[0.2em] text-carbon-600">PLAYMAKER</span>
              <span className="condensed font-bold text-carbon">{playmaker.name}</span>
              <span className="condensed tabular font-bold text-royal">{playmaker.assists}</span>
            </span>
          )}
        </div>
      )}

      <div className="animate-fade-up glass overflow-hidden p-4" style={{ animationDelay: '140ms' }}>
        <h3 className="condensed mb-3 text-xs tracking-[0.25em] text-carbon-600">
          Round {result.round} table · bottom {result.eliminatedIds.length} eliminated
        </h3>
        <div className="max-h-96 overflow-y-auto pr-1">
          <table className="w-full text-sm">
            <thead className="condensed bg-chrome-700 text-left text-xs uppercase text-white/85">
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
                  <Fragment key={row.managerId}>
                    {i === target && (
                      <tr className="animate-cutline-pulse border-t-2 border-scarlet">
                        <td colSpan={7} className="scarlet-gloss condensed px-2 py-0.5 text-center text-[10px] tracking-[0.4em]">
                          THE DROP
                        </td>
                      </tr>
                    )}
                    <tr
                      style={{ animationDelay: `${i * 30}ms` }}
                      className={`animate-row-in row-band border-t border-hairline ${
                        isYou ? 'row-selected font-bold' : ''
                      } ${isOut ? 'text-scarlet/80 line-through decoration-scarlet/40' : ''}`}
                    >
                      <td className="py-1.5 pr-2 tabular-nums text-carbon-600">
                        {i + 1}
                        {moved !== 0 && (
                          <span className={`ml-1 text-[9px] ${moved > 0 ? 'text-[#2e7527]' : 'text-scarlet'}`}>
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
                      <td className="condensed tabular py-1.5 pr-2 text-right text-xs font-bold text-royal">
                        {ratingOf(row.managerId)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{row.points}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {row.gd > 0 ? `+${row.gd}` : row.gd}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{row.gf}</td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-center">
        <button
          onClick={props.onContinue}
          className={`condensed blade cursor-pointer px-10 py-4 text-xl transition ${
            props.humanAlive ? 'scarlet-gloss' : 'chrome-gloss text-white'
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Standings"
      onClick={props.onClose}
    >
      <div
        className="paper-pane animate-pop w-full max-w-2xl border border-hairline p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="condensed text-xs tracking-[0.25em] text-carbon-600">
            Standings · every squad in the lobby
          </h3>
          <button
            type="button"
            onClick={props.onClose}
            className="condensed cursor-pointer px-2 py-0.5 text-sm text-carbon-600 hover:text-scarlet"
            aria-label="Close standings"
          >
            ✕ close
          </button>
        </div>
        <div className="scrollbar-hide max-h-[70vh] overflow-y-auto pr-1">
        <table className="w-full text-sm">
          <thead className="condensed bg-chrome-700 text-left text-xs uppercase text-white/85">
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
                className={`row-band border-t border-hairline ${m.id === humanId ? 'row-selected font-bold' : ''} ${
                  !m.alive ? 'text-scarlet/70 line-through decoration-scarlet/30' : ''
                }`}
              >
                <td className="py-1.5 pr-2 tabular-nums text-carbon-600">{i + 1}</td>
                <td className="py-1.5 pr-2">
                  <Crest name={m.name} id={m.id} you={m.id === humanId} size="sm" />
                </td>
                <td className="py-1.5 pr-2">
                  {m.name}
                  {m.id === humanId && ' (you)'}
                  {!m.alive && <span className="ml-1.5 text-[9px] no-underline">OUT</span>}
                </td>
                <td className="condensed tabular py-1.5 pr-2 text-right text-xs font-bold text-royal">
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
