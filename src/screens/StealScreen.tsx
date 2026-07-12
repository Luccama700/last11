import { useState } from 'react';
import { affinity } from '../engine/affinity';
import { affinityForV2, effectiveRatingV2, playerV2ById, stealGainV2 } from '../engine/draft';
import { STAR_THRESHOLD, teamStrength } from '../engine/rating';
import { applySteal } from '../engine/tournament';
import type { Player, XiSlotV2 } from '../engine/types';
import { flagOf } from '../game/flags';
import { humanOf, type GameState } from '../game/state';

export default function StealScreen(props: {
  state: GameState;
  onDone: (choice: { slotIndex: number; player: Player } | null) => void;
}) {
  const { state } = props;
  const human = humanOf(state)!;
  const [selected, setSelected] = useState<Player | null>(null);
  const currentStrength = teamStrength(human.xi).total;
  const onTeam = new Set(human.xi.map((s) => s.player.id));

  // Detailed context (draftV2): the human slate + formation let us score swaps with
  // the REAL affinity math — a CAM superstar at his natural RW is no longer punished
  // by the coarse projection (the Romário-over-Messi bug).
  const denseSlate = (state.humanSlate ?? []).filter((s): s is XiSlotV2 => s !== null);
  const detailedReady = !!state.formation && denseSlate.length === state.formation.slots.length;
  const detailedOf = (id: string) => playerV2ById(id);

  /** Gain for swapping `incoming` into slot i — detailed affinity math when available. */
  function gainAt(incoming: Player, i: number): number {
    if (detailedReady) {
      const inV2 = detailedOf(incoming.id);
      if (inV2) {
        return stealGainV2(denseSlate, state.formation!, inV2, i, affinity);
      }
    }
    return teamStrength(applySteal(human.xi, i, incoming)).total - currentStrength;
  }

  const pool = [...state.pool].sort((a, b) => b.rating - a.rating);

  return (
    <div className="bg-stadium min-h-screen text-ink-100">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <header className="mb-6">
          <p className="headline text-xs tracking-[0.35em] text-loss">
            THE FALLEN DROPPED THEIR SQUADS
          </p>
          <div className="mt-1 flex items-baseline justify-between gap-4">
            <h1 className="headline text-3xl text-ink-100">Steal one player — or walk away</h1>
            <button
              onClick={() => props.onDone(null)}
              className="cursor-pointer rounded-lg border border-night-600 px-5 py-2 font-bold text-ink-300 transition hover:border-gold-500 hover:text-gold-300"
            >
              SKIP — KEEP MY XI
            </button>
          </div>
        </header>

        <div className="flex flex-col gap-6 lg:flex-row">
          {/* Loot pool */}
          <div className="flex-1">
            <h2 className="headline mb-2 text-xs tracking-[0.25em] text-ink-500">
              Available loot · {pool.length} players
            </h2>
            <div className="grid max-h-[28rem] grid-cols-2 gap-2 overflow-y-auto pr-1 md:grid-cols-3">
              {pool.map((p) => {
                const owned = onTeam.has(p.id);
                const isSelected = selected?.id === p.id;
                const detailed = detailedOf(p.id)?.position;
                return (
                  <button
                    key={p.id}
                    data-testid="loot-card"
                    disabled={owned}
                    onClick={() => setSelected(p)}
                    style={{ animationDelay: `${Math.min(pool.indexOf(p), 14) * 25}ms` }}
                    className={`card-gloss animate-flip-in cursor-pointer rounded-lg p-3 text-left text-sm transition ${
                      isSelected
                        ? '!border-gold-500'
                        : owned
                          ? 'cursor-not-allowed opacity-40'
                          : 'hover:!border-night-700'
                    }`}
                  >
                    <p className="font-bold leading-tight text-ink-100">
                      {flagOf(p.nation)} {p.name}
                    </p>
                    <p className="mt-1 text-xs text-ink-500">
                      {detailed && <span className="headline mr-1 text-[10px] text-gold-300">{detailed}</span>}
                      {p.rating}
                      {p.rating >= STAR_THRESHOLD && ' ⭐'}
                      {owned && ' · on your team'}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Your XI: pick the slot to sacrifice */}
          <aside className="w-full shrink-0 lg:w-80">
            <h2 className="headline mb-2 text-xs tracking-[0.25em] text-ink-500">
              {selected ? `Where does ${selected.name} play?` : 'Your XI'}
            </h2>
            <ul className="space-y-1.5">
              {human.xi.map((slot, i) => {
                const gain = selected ? gainAt(selected, i) : null;
                const slotLabel = detailedReady
                  ? state.formation!.slots[i]
                  : (detailedOf(slot.player.id)?.position ?? '');
                // Show what the occupant is WORTH AT THIS SLOT, not his base rating —
                // otherwise a +6 over a "91" is unreconcilable (Lucca's Xavi/Musiala
                // report: a natural-CAM Musiala fielded at CM is an 87 there, so a
                // natural-CM 93 really is +6). Off-position occupants get a tag with
                // their natural position + base so the delta adds up on screen.
                const occ = detailedReady ? denseSlate[i] : null;
                const slotPos = detailedReady ? state.formation!.slots[i] : null;
                const eff =
                  occ && slotPos
                    ? Math.round(effectiveRatingV2(occ.player, slotPos, affinity))
                    : slot.player.rating;
                const offPos =
                  occ && slotPos ? affinityForV2(occ.player, slotPos, affinity) < 1 : false;
                return (
                  <li key={i}>
                    <button
                      data-testid="xi-slot"
                      disabled={!selected}
                      onClick={() => props.onDone({ slotIndex: i, player: selected! })}
                      className={`card-gloss flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-sm transition ${
                        selected ? 'cursor-pointer hover:!border-gold-500' : 'opacity-70'
                      }`}
                    >
                      <span className="truncate">
                        {slotLabel && (
                          <span className="headline mr-1.5 text-[10px] text-gold-300">{slotLabel}</span>
                        )}
                        {flagOf(slot.player.nation)} {slot.player.name}{' '}
                        <span className="text-xs text-ink-500">{eff}</span>
                        {offPos && occ && (
                          <span
                            className="ml-1.5 rounded bg-night-700 px-1 py-0.5 text-[9px] font-bold text-orange-300"
                            title={`Natural ${occ.player.position} (${occ.player.rating}) playing ${slotLabel} — worth ${eff} here`}
                          >
                            {occ.player.position} {occ.player.rating}
                          </span>
                        )}
                      </span>
                      {gain !== null && (
                        <span
                          className={`ml-2 shrink-0 text-xs font-black ${
                            gain > 0 ? 'text-win' : 'text-loss'
                          }`}
                        >
                          {gain > 0 ? `+${gain.toFixed(1)}` : gain.toFixed(1)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-ink-500">
              Swapping drops your current player. The other survivors are stealing too.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
