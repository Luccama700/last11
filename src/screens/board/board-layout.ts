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

/** Depth band per position (y). Rows read GK → back → pivots → mids → AM → wide → ST. */
const BAND_Y: Record<Position, number> = {
  GK: 0.07,
  RB: 0.26, CB: 0.24, LB: 0.26,
  CDM: 0.4,
  CM: 0.55, RM: 0.55, LM: 0.55,
  CAM: 0.67,
  RW: 0.75, LW: 0.75,
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
 * Lay a formation's 11 ordered slots onto the pitch. Slots sharing a depth band
 * are spread across x from right (+1 lane) to left (-1 lane); ties keep formation
 * order. Deterministic and pure — same slots ⇒ same coords every call.
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
    const ordered = [...indices].sort((a, b) => {
      const dl = LANE[slots[b]] - LANE[slots[a]];
      return dl !== 0 ? dl : a - b;
    });
    const n = ordered.length;
    ordered.forEach((slotIndex, j) => {
      const x = n === 1 ? 0.5 : 0.85 - (0.7 * j) / (n - 1);
      const pos = slots[slotIndex];
      out[slotIndex] = { slotIndex, position: pos, x, y: BAND_Y[pos] };
    });
  }
  return out;
}
