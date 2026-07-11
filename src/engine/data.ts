import type { Player, Position } from './types';
import squadsJson from './data/squads.json';

export interface Nation {
  code: string;
  name: string;
}

interface RawPlayer {
  id: string;
  name: string;
  pos: string;
  rating: number;
}

const nations: Nation[] = [];
const players: Player[] = [];
const byNation = new Map<string, Player[]>();

for (const nation of squadsJson.nations) {
  nations.push({ code: nation.code, name: nation.name });
  const squad: Player[] = (nation.players as RawPlayer[]).map((p) => ({
    id: p.id,
    name: p.name,
    nation: nation.code,
    position: p.pos as Position,
    rating: p.rating,
  }));
  players.push(...squad);
  byNation.set(nation.code, squad);
}

export const NATIONS: readonly Nation[] = nations;
export const PLAYERS: readonly Player[] = players;

export function nationSquad(code: string): readonly Player[] {
  const squad = byNation.get(code);
  if (!squad) throw new Error(`Unknown nation: ${code}`);
  return squad;
}

export function nationName(code: string): string {
  const nation = nations.find((n) => n.code === code);
  return nation ? nation.name : code;
}
