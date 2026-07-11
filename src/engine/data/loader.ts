/**
 * Player database v2 loader (CONTRACT §2, §7; PLAN-database §2, §8).
 *
 * Reads the bundled `squads-v2.json`, VALIDATES it (throws on malformed data so a
 * bad squad can never reach the engine silently), and denormalizes each raw squad
 * into the in-memory `SquadEntry`/`PlayerV2` shape every consumer uses:
 *   - `pos`   → `position`
 *   - `altPos`→ `secondary`
 *   - nation/year stamped down onto every player (steal pool is self-describing)
 *
 * Purely additive: the legacy `./data.ts` path is untouched. Consumers reach v2
 * only behind `FEATURES.dataV2` (see `activeCoarseSquads`).
 */
import squadsJson from './squads-v2.json';
import {
  POSITIONS,
  detailedToCoarse,
  squadKey,
  type CoarsePosition,
  type PlayerV2,
  type Position,
  type RawSquadEntry,
  type SquadEntry,
  type SquadKey,
  type SquadsFileV2,
  type SquadRef,
} from './schema';
import { NATIONS as LEGACY_NATIONS, PLAYERS as LEGACY_PLAYERS } from './../data';

const POSITION_SET = new Set<string>(POSITIONS);
const RATING_MIN = 1;
const RATING_MAX = 99;
const SQUAD_MIN = 11; // a squad must at least be able to field an XI
const SQUAD_MAX = 30;

/** Thrown when the bundled data is structurally invalid. Fail loud, fail early. */
export class SquadDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SquadDataError';
  }
}

function assertPosition(value: unknown, where: string): asserts value is Position {
  if (typeof value !== 'string' || !POSITION_SET.has(value)) {
    throw new SquadDataError(`${where}: invalid position ${JSON.stringify(value)}`);
  }
}

/**
 * Validate + denormalize a raw v2 file. Throws `SquadDataError` on any violation:
 * bad version, empty/oversized squads, unknown positions, out-of-range ratings,
 * duplicate ids (globally), or duplicate (nation,year) keys.
 */
export function parseSquadsFile(file: SquadsFileV2): SquadEntry[] {
  if (file.version !== 2) {
    throw new SquadDataError(`expected version 2, got ${JSON.stringify(file.version)}`);
  }
  if (!Array.isArray(file.squads) || file.squads.length === 0) {
    throw new SquadDataError('squads must be a non-empty array');
  }

  const seenIds = new Set<string>();
  const seenKeys = new Set<SquadKey>();
  const squads: SquadEntry[] = [];

  for (const raw of file.squads as RawSquadEntry[]) {
    const where = `${raw.nation}-${raw.year}`;
    if (!raw.nation || typeof raw.year !== 'number') {
      throw new SquadDataError(`squad ${JSON.stringify(raw.name)}: missing nation/year`);
    }
    const key = squadKey(raw.nation, raw.year);
    if (seenKeys.has(key)) throw new SquadDataError(`duplicate squad key ${key}`);
    seenKeys.add(key);

    if (!Array.isArray(raw.players) || raw.players.length < SQUAD_MIN || raw.players.length > SQUAD_MAX) {
      throw new SquadDataError(`squad ${where}: player count ${raw.players?.length} out of [${SQUAD_MIN}, ${SQUAD_MAX}]`);
    }

    const players: PlayerV2[] = raw.players.map((p) => {
      if (!p.id) throw new SquadDataError(`squad ${where}: a player is missing id`);
      if (seenIds.has(p.id)) throw new SquadDataError(`duplicate player id ${p.id}`);
      seenIds.add(p.id);
      if (!p.id.startsWith(`${raw.nation.toLowerCase()}-${raw.year}-`)) {
        throw new SquadDataError(`player ${p.id}: id must be prefixed ${raw.nation.toLowerCase()}-${raw.year}-`);
      }
      assertPosition(p.pos, `player ${p.id}`);
      if (p.altPos) {
        if (!Array.isArray(p.altPos) || p.altPos.length > 2) {
          throw new SquadDataError(`player ${p.id}: altPos must be an array of ≤2`);
        }
        for (const a of p.altPos) assertPosition(a, `player ${p.id} altPos`);
      }
      if (typeof p.rating !== 'number' || p.rating < RATING_MIN || p.rating > RATING_MAX) {
        throw new SquadDataError(`player ${p.id}: rating ${p.rating} out of [${RATING_MIN}, ${RATING_MAX}]`);
      }
      return {
        id: p.id,
        name: p.name,
        nation: raw.nation,
        year: raw.year,
        position: p.pos,
        secondary: p.altPos,
        rating: p.rating,
        fullName: p.fullName,
        club: p.club,
        shirt: p.shirt,
      };
    });

    // A squad must be able to field a legal XI: at least one GK + 10 outfielders.
    const gkCount = players.filter((p) => p.position === 'GK').length;
    if (gkCount < 1) throw new SquadDataError(`squad ${where}: needs at least 1 GK`);

    squads.push({
      nation: raw.nation,
      name: raw.name,
      year: raw.year,
      players,
      result: raw.result,
      notes: raw.notes,
    });
  }

  return squads;
}

// ---- Loaded, validated, indexed at module init -------------------------------

const ALL_SQUADS: SquadEntry[] = parseSquadsFile(squadsJson as SquadsFileV2);
const BY_KEY = new Map<SquadKey, SquadEntry>(ALL_SQUADS.map((s) => [squadKey(s.nation, s.year), s]));

export const allSquadsV2 = (): readonly SquadEntry[] => ALL_SQUADS;

/** Every v2 player, flattened — the draft/steal source when dataV2 is ON. */
export const playersV2 = (): readonly PlayerV2[] => ALL_SQUADS.flatMap((s) => s.players);

/** All (nation, year) pairs available to roll. */
export const squadRefsV2 = (): readonly SquadRef[] =>
  ALL_SQUADS.map((s) => ({ nation: s.nation, year: s.year }));

/** Full roster for a rolled (nation, year). Throws if unknown — callers roll from
 *  `squadRefsV2()`, so a miss is a bug, not a user path. Feeds the steal pool. */
export function squadByRef(nation: string, year: number): SquadEntry {
  const squad = BY_KEY.get(squadKey(nation, year));
  if (!squad) throw new SquadDataError(`unknown squad ${squadKey(nation, year)}`);
  return squad;
}

// ---- Back-compat adapter (CONTRACT §7) ---------------------------------------

/** A projection of a v2 squad down to the legacy coarse shape the CURRENT engine
 *  consumes. Shape mirrors `nationSquad()` output so the Poisson engine can run on
 *  v2 data until engine v2 lands. */
export interface CoarsePlayer {
  id: string;
  name: string;
  nation: string;
  position: CoarsePosition;
  rating: number;
}

export function v2PlayerToCoarse(p: PlayerV2): CoarsePlayer {
  return { id: p.id, name: p.name, nation: p.nation, position: detailedToCoarse(p.position), rating: p.rating };
}

/**
 * The squads the game should draft from, as coarse players, respecting the flag.
 * - `dataV2` OFF → today's legacy 12×12 dataset, unchanged.
 * - `dataV2` ON  → the v2 dataset for `year` (default 2026) projected to coarse,
 *   so the current Poisson engine keeps working while the richer data is live.
 * This is the seam worker-7 wires into the game; it does not itself flip the flag.
 */
export function activeCoarseSquads(dataV2: boolean, year = 2026): CoarsePlayer[] {
  if (!dataV2) {
    return LEGACY_PLAYERS.map((p) => ({
      id: p.id, name: p.name, nation: p.nation, position: p.position as CoarsePosition, rating: p.rating,
    }));
  }
  return ALL_SQUADS.filter((s) => s.year === year).flatMap((s) => s.players.map(v2PlayerToCoarse));
}

/** Nations present in the v2 dataset for a given tournament year (default 2026). */
export function v2Nations(year = 2026): { code: string; name: string }[] {
  return ALL_SQUADS.filter((s) => s.year === year).map((s) => ({ code: s.nation, name: s.name }));
}

// Referenced only to keep the legacy import meaningful for the OFF path + parity tests.
export const legacyNationCount = () => LEGACY_NATIONS.length;
