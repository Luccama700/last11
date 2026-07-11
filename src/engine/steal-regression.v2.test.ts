import { describe, expect, it } from 'vitest';
import { affinityForV2, pickValueV2, placeholderAffinity, slotFitsForPlayer } from './draft';
import { evaluateStealV2 } from './steal-v2';
import { AFFINITY_MATRIX, affinity } from './affinity';
import { FORMATIONS, formationById } from './types';
import type { PlayerV2 } from './data/schema';
import type { XiSlotV2 } from './types';

/**
 * Steal-math regression, per Main's night-shift brief (2026-07-11): "a
 * natural/secondary-position superstar (Messi CAM w/ RW altPos) must not be
 * out-ranked by a vastly worse-affinity swap."
 *
 * UPDATE (same night, `7a9760e`): `evaluateStealV2` (steal-v2.ts) landed —
 * its own doc comment confirms this WAS a real, reported bug: v1's coarse
 * `evaluateSteal` (tournament.ts) evaluated Messi on his COARSE-projected
 * position, producing "absurd swings (Romário +26 over Messi)". The tests
 * below were originally written against just the shared value-comparison
 * primitives (no dedicated steal-eval existed yet); now extended to verify
 * `evaluateStealV2` end to end too, on the actual detailed slate.
 *
 * The concrete bug this guards: a player's SECONDARY position must be
 * treated as fully natural (affinity 1.0), not silently fall through to the
 * general affinity function. If that exemption is ever skipped, a genuine
 * superstar's secondary-slot value collapses toward his primary->secondary
 * zone affinity (a real but non-obvious discount — CAM->W family is .85, not
 * "vastly" bad on its face) and a merely decent NATURAL fit at that slot can
 * numerically beat him. That is exactly "a worse-affinity swap out-ranking a
 * superstar" — the affinity involved doesn't even have to look dramatically
 * bad to cause a real ranking inversion once the discount compounds.
 */

const MESSI: PlayerV2 = {
  id: 'arg-2022-messi',
  name: 'Messi',
  nation: 'ARG',
  year: 2022,
  position: 'CAM',
  secondary: ['RW'],
  rating: 96, // DECISIONS/RATINGS-LADDER.md anchor: Messi 2022 = 96
};

/** A natural (not secondary) RW, good but not superstar-tier — the player a
 *  secondary-position-exemption bug would incorrectly let win the RW slot. */
const NATURAL_WINGER: PlayerV2 = {
  id: 'fictional-natural-rw',
  name: 'Romário', // fixture name per Main's brief; role here is a natural RW, not his real-life position
  nation: 'BRA',
  year: 2026,
  position: 'RW',
  rating: 86, // below STAR_THRESHOLD_V2 (88): no star nudge, deliberately a clean comparison
};

describe('steal-math regression: superstar secondary-position exemption (Messi CAM/RW)', () => {
  it('affinityForV2: Messi is FULLY natural (1.0) at both his primary CAM and secondary RW', () => {
    expect(affinityForV2(MESSI, 'CAM', placeholderAffinity)).toBe(1);
    expect(affinityForV2(MESSI, 'RW', placeholderAffinity)).toBe(1);
    // Also against the REAL wired-in engine matrix, not just the placeholder.
    expect(affinityForV2(MESSI, 'CAM', affinity)).toBe(1);
    expect(affinityForV2(MESSI, 'RW', affinity)).toBe(1);
  });

  it('pickValueV2: Messi at his secondary RW slot beats a decent natural winger who is NOT a superstar', () => {
    const messiAtRw = pickValueV2(MESSI, 'RW', affinity);
    const wingerAtRw = pickValueV2(NATURAL_WINGER, 'RW', affinity);
    expect(messiAtRw).toBeGreaterThan(wingerAtRw);
    // Concretely: 96 (full, secondary-exempt) + 3 (star, rating>=88) = 99.
    expect(messiAtRw).toBe(99);
  });

  it('REGRESSION GUARD: if the secondary exemption were skipped (buggy fallthrough to the raw affinity fn), Messi at RW would LOSE to the natural winger — proving the exemption is load-bearing, not redundant', () => {
    // Simulate the bug directly: what pickValueV2 would compute if it forgot
    // to check `player.secondary?.includes(slot)` and fell through to the
    // general affinity function using only the primary position.
    const buggyMessiAtRwEffective = MESSI.rating * affinity(MESSI.position, 'RW');
    const buggyMessiAtRwValue = buggyMessiAtRwEffective + (MESSI.rating >= 88 ? 3 : 0);
    const wingerAtRw = pickValueV2(NATURAL_WINGER, 'RW', affinity);

    // This is the exact failure mode Main's brief describes: under the bug,
    // the "vastly worse" candidate (a merely-decent natural winger, nowhere
    // near Messi's caliber) would outrank the superstar.
    expect(buggyMessiAtRwValue).toBeLessThan(wingerAtRw);

    // ...and confirm the REAL (correct, committed) pickValueV2 does not
    // exhibit this — it must sit strictly above the buggy computation and
    // above the winger.
    const realMessiAtRw = pickValueV2(MESSI, 'RW', affinity);
    expect(realMessiAtRw).toBeGreaterThan(buggyMessiAtRwValue);
    expect(realMessiAtRw).toBeGreaterThan(wingerAtRw);
  });

  it('slotFitsForPlayer: Messi ranks his secondary RW slot as a natural (affinity 1) fit, not a discounted one', () => {
    const formation = FORMATIONS.find((f) => f.id === '4-3-3')!; // includes an RW slot
    const fits = slotFitsForPlayer([null, null, null, null, null, null, null, null, null, null, null], formation, MESSI, affinity);
    const rwFit = fits.find((f) => f.position === 'RW');
    expect(rwFit).toBeDefined();
    expect(rwFit!.natural).toBe(true);
    expect(rwFit!.affinity).toBe(1);
    expect(rwFit!.effective).toBe(96);
  });

  it('sanity: the real engine AFFINITY_MATRIX would NOT itself rescue a buggy fallthrough — CAM natural at W-family slots is .85, not 1.0, so the exemption genuinely matters', () => {
    // If this ever became 1.0 in the matrix (i.e. CAM and W were merged into
    // one family), the bug this test guards against would stop being able
    // to manifest through this exact path — worth re-deriving the fixture
    // if the matrix's family groupings ever change.
    expect(AFFINITY_MATRIX.CAM.RW).toBeLessThan(1);
    expect(AFFINITY_MATRIX.CAM.RW).toBeGreaterThan(0.5); // "forgiving", not vastly bad on its face
  });
});

/** A striker, natural fit only at ST — no CAM/RW secondary. Used as the
 *  "vastly worse fit for THIS steal opportunity" comparison player: he's a
 *  genuine, highly-rated player (this isn't a strawman), just not a fit for
 *  the open upgrade the way Messi is. */
const ROMARIO: PlayerV2 = {
  id: 'bra-1994-romario',
  name: 'Romário',
  nation: 'BRA',
  year: 1994,
  position: 'ST',
  rating: 90,
};

function weakOccupant(id: string, position: PlayerV2['position'], rating: number): XiSlotV2 {
  return { position, player: { id, name: id, nation: 'JPN', year: 2026, position, rating } };
}

describe('evaluateStealV2 end-to-end: Messi must win the steal ranking over Romário', () => {
  it('ranks Messi (secondary RW) above Romário (natural ST elsewhere) when the open upgrade is at RW', () => {
    const formation = formationById('4-3-3')!; // GK,RB,CB,CB,LB,CDM,CM,CM,RW,ST,LW
    const slate: XiSlotV2[] = formation.slots.map((pos, i) => weakOccupant(`slot-${i}`, pos, pos === 'RW' ? 65 : 80));

    const result = evaluateStealV2(slate, [MESSI, ROMARIO]);
    expect(result).not.toBeNull();
    expect(result!.player.id).toBe(MESSI.id);
    expect(result!.bestPosition).toBe('RW');
    // Messi natural-exempt at RW (96) vs the weak occupant there (65) = +31.
    expect(result!.gain).toBeCloseTo(31, 5);

    // Confirm this ISN'T just "Messi happens to be in the pool" — Romário's
    // own best gain (at his natural ST, 90 vs the 80 occupant = +10, or a
    // worse cross-position gain elsewhere) is strictly smaller, so ranking
    // by gain correctly puts Messi first regardless of pool order.
    const messiOnly = evaluateStealV2(slate, [MESSI]);
    const romarioOnly = evaluateStealV2(slate, [ROMARIO]);
    expect(messiOnly!.gain).toBeGreaterThan(romarioOnly!.gain);
  });

  it('reversed pool order gives the identical winner — not an artifact of iteration order', () => {
    const formation = formationById('4-3-3')!;
    const slate: XiSlotV2[] = formation.slots.map((pos, i) => weakOccupant(`slot-${i}`, pos, pos === 'RW' ? 65 : 80));
    const a = evaluateStealV2(slate, [MESSI, ROMARIO]);
    const b = evaluateStealV2(slate, [ROMARIO, MESSI]);
    expect(a!.player.id).toBe(MESSI.id);
    expect(b!.player.id).toBe(MESSI.id);
    expect(a!.gain).toBe(b!.gain);
  });
});
