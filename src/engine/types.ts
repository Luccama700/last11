export type Position = 'GK' | 'DF' | 'MF' | 'FW';

export interface Player {
  id: string;
  name: string;
  nation: string; // 3-letter code, e.g. 'BRA'
  position: Position;
  rating: number; // ~70-95
}

export interface XiSlot {
  position: Position;
  player: Player;
}

/** A complete team is 11 slots (see FORMATION in rating.ts). */
export type XI = XiSlot[];
