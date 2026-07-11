import { describe, expect, it } from 'vitest';
import { displayedSquadRating } from './squad-rating';
import { effectiveRatingV2 } from './draft';
import { affinity } from './affinity';
import type { Manager } from './tournament';
import type { PlayerV2 } from './data/schema';
import type { Position } from './data/schema';
import type { XiSlotV2 } from './types';

// JOB 1: ONE squad-rating metric everywhere. Matches the draft board's
// Σ effectiveRatingV2 sum, on the DETAILED slate for the human and the coarse→detailed
// projection for bots, so the rail and the round table finally agree.

function pv2(id: string, position: Position, rating: number, secondary?: Position[]): PlayerV2 {
  return { id, name: id, nation: 'XXX', year: 2026, position, rating, secondary };
}
function slot(pos: Position, p: PlayerV2): XiSlotV2 {
  return { position: pos, player: p };
}

describe('displayedSquadRating', () => {
  it('sums effectiveRatingV2 over a detailed slate (= Σ ratings when everyone is in position)', () => {
    const slate: XiSlotV2[] = [
      slot('GK', pv2('gk', 'GK', 80)),
      slot('CB', pv2('cb', 'CB', 85)),
      slot('CM', pv2('cm', 'CM', 90)),
      slot('ST', pv2('st', 'ST', 88)),
    ];
    expect(displayedSquadRating(slate)).toBe(80 + 85 + 90 + 88);
  });

  it('honors the secondary-position exemption (Messi CAM/RW at an RW slot counts full)', () => {
    const messiAtRw: XiSlotV2[] = [slot('RW', pv2('messi', 'CAM', 96, ['RW']))];
    expect(displayedSquadRating(messiAtRw)).toBe(96); // not discounted by CAM→RW affinity
    // Manual cross-check against the board's exact metric.
    expect(displayedSquadRating(messiAtRw)).toBe(
      Math.round(effectiveRatingV2(messiAtRw[0].player, 'RW', affinity)),
    );
  });

  it('discounts a genuine off-position player (position not natural nor secondary)', () => {
    const stAtCb: XiSlotV2[] = [slot('CB', pv2('striker', 'ST', 90))];
    expect(displayedSquadRating(stAtCb)).toBeLessThan(90);
    expect(displayedSquadRating(stAtCb)).toBeGreaterThan(0); // affinity strictly > 0
  });

  it('skips open (null) slots', () => {
    const partial: (XiSlotV2 | null)[] = [slot('GK', pv2('gk', 'GK', 80)), null, null];
    expect(displayedSquadRating(partial)).toBe(80);
  });

  it('projects a bot Manager (coarse XI) through the SAME metric', () => {
    const bot: Manager = {
      id: 'bot-1',
      name: 'Bot',
      isHuman: false,
      alive: true,
      xi: [
        { position: 'GK', player: { id: 'g', name: 'g', nation: 'BRA', position: 'GK', rating: 82 } },
        { position: 'DF', player: { id: 'd', name: 'd', nation: 'BRA', position: 'DF', rating: 84 } },
        { position: 'FW', player: { id: 'f', name: 'f', nation: 'BRA', position: 'FW', rating: 86 } },
      ],
    };
    // Coarse→detailed keeps natural==slot ⇒ effectiveRatingV2 = rating ⇒ Σ ratings.
    expect(displayedSquadRating(bot)).toBe(82 + 84 + 86);
  });

  it('is deterministic', () => {
    const slate: XiSlotV2[] = [slot('GK', pv2('gk', 'GK', 80)), slot('ST', pv2('st', 'ST', 88))];
    expect(displayedSquadRating(slate)).toBe(displayedSquadRating(slate));
  });
});
