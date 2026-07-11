// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAMPIONS_KEY, readChampions, recordChampion, type Champion } from './champions';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals(); // restore real localStorage before touching it
  localStorage.clear();
});

describe('champions: read/record persistence', () => {
  it('reads an empty hall before anything is recorded', () => {
    expect(readChampions()).toEqual([]);
  });

  it('records a champion and persists it under last11.champions.v1', () => {
    const list = recordChampion({ name: 'You', isHuman: true, placementOfHuman: 1, date: '2026-07-11T00:00:00.000Z' });
    expect(list).toHaveLength(1);
    expect(readChampions()).toEqual<Champion[]>([
      { name: 'You', isHuman: true, placementOfHuman: 1, date: '2026-07-11T00:00:00.000Z' },
    ]);
    // written under the exact contract key
    expect(localStorage.getItem(CHAMPIONS_KEY)).toContain('You');
  });

  it('appends across games, oldest first', () => {
    recordChampion({ name: 'You', isHuman: true, placementOfHuman: 1, date: '2026-07-11T00:00:00.000Z' });
    recordChampion({ name: 'Bot Vidic', isHuman: false, placementOfHuman: 7, date: '2026-07-12T00:00:00.000Z' });
    const all = readChampions();
    expect(all.map((c) => c.name)).toEqual(['You', 'Bot Vidic']);
    expect(all[1]).toMatchObject({ isHuman: false, placementOfHuman: 7 });
  });

  it('stamps an ISO date when none is supplied', () => {
    const [c] = recordChampion({ name: 'You', isHuman: true, placementOfHuman: 1 });
    expect(c.date).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(Number.isNaN(Date.parse(c.date))).toBe(false);
  });

  it('preserves a null human placement (champion recorded with no resolved rank)', () => {
    const [c] = recordChampion({ name: 'Bot Kaka', isHuman: false, placementOfHuman: null });
    expect(c.placementOfHuman).toBeNull();
  });

  it('degrades to [] on corrupt stored JSON instead of throwing', () => {
    localStorage.setItem(CHAMPIONS_KEY, '{not valid json');
    expect(readChampions()).toEqual([]);
  });

  it('drops malformed entries from a tampered array', () => {
    localStorage.setItem(CHAMPIONS_KEY, JSON.stringify([{ nope: 1 }, { name: 'You', isHuman: true, date: 'x', placementOfHuman: 1 }]));
    expect(readChampions().map((c) => c.name)).toEqual(['You']);
  });
});

describe('champions: storage-guarded (jsdom/SSR/denied)', () => {
  it('a failing setItem (quota/denied) does not throw and still returns the list', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    const list = recordChampion({ name: 'You', isHuman: true, placementOfHuman: 1 });
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('You');
  });

  it('missing localStorage (SSR) reads [] and records without throwing', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readChampions()).toEqual([]);
    expect(() => recordChampion({ name: 'You', isHuman: true, placementOfHuman: 1 })).not.toThrow();
    expect(recordChampion({ name: 'You', isHuman: true, placementOfHuman: 1 })).toHaveLength(1);
  });
});
