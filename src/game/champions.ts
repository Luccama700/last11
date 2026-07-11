// Hall of champions — a cross-game record persisted in localStorage. One entry is
// appended per FINISHED tournament (App records at the screen==='end' seam). Kept as
// a tiny pure-ish util so it can be unit-tested and so the reducer stays side-effect
// free: reading/writing storage is the ONLY impurity, and it is fully guarded — in
// jsdom/SSR (no `localStorage`) or a storage-denied browser (Safari private mode) the
// reads degrade to `[]` and the writes no-op instead of throwing.

/** One tournament's outcome. `placementOfHuman` is the human's finishing rank (1 =
 *  the human won); null when it was never resolved (shouldn't happen post-tournament,
 *  but the type stays honest). `isHuman` marks whether the CHAMPION was the human. */
export interface Champion {
  name: string;
  isHuman: boolean;
  date: string; // ISO-8601 timestamp of when the tournament finished
  placementOfHuman: number | null;
}

export const CHAMPIONS_KEY = 'last11.champions.v1';

/** The best-effort Storage handle, or null when storage is unavailable/blocked. */
function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    // Accessing `localStorage` itself can throw (sandboxed iframes, privacy modes).
    return null;
  }
}

function isChampion(v: unknown): v is Champion {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.name === 'string' &&
    typeof c.isHuman === 'boolean' &&
    typeof c.date === 'string' &&
    (c.placementOfHuman === null || typeof c.placementOfHuman === 'number')
  );
}

/** Every recorded champion, oldest first. Always returns an array — a missing key,
 *  unavailable storage, or corrupt JSON all degrade to `[]`. */
export function readChampions(): Champion[] {
  const store = safeStorage();
  if (!store) return [];
  try {
    const raw = store.getItem(CHAMPIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isChampion) : [];
  } catch {
    return [];
  }
}

/** Append one champion and persist. `date` defaults to now (override for tests).
 *  Returns the full updated list so callers needn't re-read. Never throws — a write
 *  that fails (quota, denied) still returns the list it would have stored. */
export function recordChampion(entry: {
  name: string;
  isHuman: boolean;
  placementOfHuman: number | null;
  date?: string;
}): Champion[] {
  const champion: Champion = {
    name: entry.name,
    isHuman: entry.isHuman,
    placementOfHuman: entry.placementOfHuman,
    date: entry.date ?? new Date().toISOString(),
  };
  const list = [...readChampions(), champion];
  const store = safeStorage();
  if (store) {
    try {
      store.setItem(CHAMPIONS_KEY, JSON.stringify(list));
    } catch {
      // Quota exceeded or write denied — the in-memory list is still returned.
    }
  }
  return list;
}
