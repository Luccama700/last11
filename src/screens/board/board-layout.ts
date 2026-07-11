// Pure pitch geometry for the tactics board. Depends only on the frozen CONTRACT
// shapes (Position §1, Formation.slots §3) — no reducer/flag coupling.

import type { Position } from '../../engine/data/schema';

/** Normalized pitch coords. x: 0 = left touchline, 1 = right. y: 0 = own goal
 *  line (GK), 1 = opponent goal line. Rendered attacking upward on screen. */
export interface SlotXY {
  slotIndex: number;
  position: Position;
  x: number;
  y: number;
}

/** Depth band per position (y). Rows read GK → back → pivots → mids → AM → wide → ST.
 *  The whole back line shares ONE band — RB/CB/LB must lay out as a single row of
 *  four/five, not two overlapping rows (the 4-2-3-1 stacking bug). */
const BAND_Y: Record<Position, number> = {
  GK: 0.07,
  RB: 0.25, CB: 0.25, LB: 0.25,
  CDM: 0.4,
  CM: 0.55, RM: 0.55, LM: 0.55,
  CAM: 0.67,
  RW: 0.78, LW: 0.78,
  ST: 0.9,
};

/** Lane semantics: right (+1), centre (0), left (-1). Drives L/R placement so an
 *  RW is always on the right regardless of the formation's slot ordering. */
const LANE: Record<Position, number> = {
  GK: 0,
  RB: 1, CB: 0, LB: -1,
  CDM: 0,
  CM: 0, RM: 1, LM: -1,
  CAM: 0,
  RW: 1, LW: -1,
  ST: 0,
};

const bandKey = (pos: Position): number => Math.round(BAND_Y[pos] * 100);

/**
 * Lay a formation's 11 ordered slots onto the pitch, lane-aware: wide positions
 * (±1 lane) hug their touchline; centre-lane duplicates (two CBs, a double pivot,
 * three CMs) spread symmetrically around the middle instead of drifting under the
 * wide slots. Deterministic and pure — same slots ⇒ same coords every call.
 */
export function layoutFormation(slots: readonly Position[]): SlotXY[] {
  const bands = new Map<number, number[]>();
  slots.forEach((pos, i) => {
    const k = bandKey(pos);
    const arr = bands.get(k) ?? bands.set(k, []).get(k)!;
    arr.push(i);
  });

  const out: SlotXY[] = new Array(slots.length);
  for (const indices of bands.values()) {
    const wideR = indices.filter((i) => LANE[slots[i]] === 1);
    const wideL = indices.filter((i) => LANE[slots[i]] === -1);
    const centre = indices.filter((i) => LANE[slots[i]] === 0);

    // Touchline huggers. Same-lane duplicates (rare) nudge inward slightly.
    wideR.forEach((slotIndex, j) => {
      out[slotIndex] = { slotIndex, position: slots[slotIndex], x: 0.86 - j * 0.08, y: BAND_Y[slots[slotIndex]] };
    });
    wideL.forEach((slotIndex, j) => {
      out[slotIndex] = { slotIndex, position: slots[slotIndex], x: 0.14 + j * 0.08, y: BAND_Y[slots[slotIndex]] };
    });

    // Centre-lane row: symmetric around 0.5 — pivot pair .39/.61, trio .28/.5/.72.
    const k = centre.length;
    const step = k > 1 ? Math.min(0.22, 0.6 / (k - 1)) : 0;
    centre.forEach((slotIndex, j) => {
      const x = 0.5 + (j - (k - 1) / 2) * step;
      out[slotIndex] = { slotIndex, position: slots[slotIndex], x, y: BAND_Y[slots[slotIndex]] };
    });
  }
  return out;
}
