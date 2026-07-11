import { describe, expect, it } from 'vitest';
import { FLAGS, flagOf } from './flags';
import { allSquadsV2 } from '../engine/data/loader';
import { NATIONS } from '../engine/data';

/** The fallback `flagOf` returns for an unmapped code — the white flag. */
const WHITE_FLAG = '🏳️';

/** Union of every nation code that can reach `flagOf` from the squad DB. */
function nationCodesInDb(): string[] {
  const codes = new Set<string>();
  for (const squad of allSquadsV2()) codes.add(squad.nation); // dataV2 path
  for (const nation of NATIONS) codes.add(nation.code); // legacy OFF path
  return [...codes].sort();
}

describe('flags', () => {
  it('resolves every nation code in the squad DB to a non-default emoji', () => {
    const unmapped = nationCodesInDb().filter(
      (code) => flagOf(code) === WHITE_FLAG,
    );
    expect(unmapped, `these codes fall back to the white flag: ${unmapped.join(', ')}`).toEqual([]);
  });

  it('has a mapping entry for every DB nation code (not just a shared fallback)', () => {
    for (const code of nationCodesInDb()) {
      expect(FLAGS, `missing FLAGS entry for ${code}`).toHaveProperty(code);
    }
  });

  it('flagOf falls back to the white flag for a genuinely unknown code', () => {
    expect(flagOf('ZZZ')).toBe(WHITE_FLAG);
  });
});
