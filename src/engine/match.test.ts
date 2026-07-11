import { describe, expect, it } from 'vitest';
import { poisson, simulateMatch } from './match';
import { createRng } from './rng';

describe('poisson', () => {
  it('returns non-negative integers with a mean near lambda', () => {
    const rng = createRng(3);
    let sum = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) {
      const x = poisson(1.5, rng);
      expect(Number.isInteger(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      sum += x;
    }
    expect(sum / n).toBeGreaterThan(1.3);
    expect(sum / n).toBeLessThan(1.7);
  });
});

describe('simulateMatch', () => {
  it('is deterministic per seed', () => {
    const a = simulateMatch(900, 880, createRng(9));
    const b = simulateMatch(900, 880, createRng(9));
    expect(a).toEqual(b);
  });

  it('stronger teams win clearly more often', () => {
    const rng = createRng(11);
    let strongWins = 0;
    let weakWins = 0;
    for (let i = 0; i < 500; i++) {
      const { goalsA, goalsB } = simulateMatch(940, 860, rng);
      if (goalsA > goalsB) strongWins++;
      else if (goalsB > goalsA) weakWins++;
    }
    expect(strongWins).toBeGreaterThan(weakWins * 1.5);
  });

  it('equal teams have no systematic side bias', () => {
    const rng = createRng(13);
    let winsA = 0;
    let winsB = 0;
    for (let i = 0; i < 2000; i++) {
      const { goalsA, goalsB } = simulateMatch(900, 900, rng);
      if (goalsA > goalsB) winsA++;
      else if (goalsB > goalsA) winsB++;
    }
    expect(Math.abs(winsA - winsB)).toBeLessThan(150);
  });
});
