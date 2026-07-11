import { describe, expect, it } from 'vitest';
import { createRng } from './rng';
import { affinity, effectiveRating } from './affinity';
import { zonalStrength } from './rating';
import { moraleFromGoals } from './morale';
import { computeXg, matchSeed, matchVerdict, resolveMatch, type MatchSide } from './match';
import { simulateMatchTimeline } from './timeline';
import { formationById, type Tactics } from './types';
import type { PlayerV2, Position } from './data/schema';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const NATIONS = ['BRA', 'ARG', 'FRA', 'ENG', 'ESP', 'GER'];

function player(id: string, position: Position, rating: number, nation = 'BRA'): PlayerV2 {
  return { id, name: `${position}-${id}`, nation, year: 2026, position, rating };
}

/** Build an all-natural XI for a formation with a rating function per slot index. */
function makeXi(formationId: string, ratingAt: (i: number) => number, tag = 't'): MatchSide['xi'] {
  const f = formationById(formationId)!;
  return f.slots.map((pos, i) => ({
    position: pos,
    player: player(`${tag}-${i}`, pos, ratingAt(i), NATIONS[i % NATIONS.length]),
  }));
}

function side(id: string, xi: MatchSide['xi'], tactics: Partial<Tactics> = {}): MatchSide {
  return { id, xi, tactics: { formationId: '4-3-3', style: 'balanced', ...tactics } };
}

const flat = (r: number) => () => r;

// ── Strength → xG mapping (Lucca: +10 strength ≈ +0.75 xG; 3.4 total at parity) ──

describe('computeXg strength mapping', () => {
  it('parity ⇒ 1.7 per side (3.4 total)', () => {
    const home = side('h', makeXi('4-3-3', flat(80), 'h'));
    const away = side('a', makeXi('4-3-3', flat(80), 'a'));
    const xg = computeXg(home, away, zonalStrength(home.xi), zonalStrength(away.xi));
    expect(xg.home).toBeCloseTo(1.7, 5);
    expect(xg.away).toBeCloseTo(1.7, 5);
  });

  it('+10 across the board ⇒ +0.75 xG to the stronger side (no stars in play)', () => {
    // ratings 80 vs 70 keep both below the star threshold (90) for a clean read.
    const home = side('h', makeXi('4-3-3', flat(80), 'h'));
    const away = side('a', makeXi('4-3-3', flat(70), 'a'));
    const xg = computeXg(home, away, zonalStrength(home.xi), zonalStrength(away.xi));
    expect(xg.home).toBeCloseTo(2.45, 5); // 1.7 + 0.75
    expect(xg.away).toBeCloseTo(0.95, 5); // 1.7 - 0.75
  });
});

// ── Affinity matrix invariants (CONTRACT §1 + DECISIONS forgiving posture) ──────

describe('affinity matrix', () => {
  const ALL: Position[] = ['GK', 'RB', 'CB', 'LB', 'CDM', 'CM', 'CAM', 'RM', 'LM', 'LW', 'RW', 'ST'];
  it('diagonal 1.0 and every cell strictly > 0', () => {
    for (const a of ALL) {
      expect(affinity(a, a)).toBe(1);
      for (const b of ALL) expect(affinity(a, b)).toBeGreaterThan(0);
    }
  });
  it('same-zone moves ≥ .85, adjacent-zone ≥ .60 (spot checks)', () => {
    expect(affinity('CB', 'LB')).toBeGreaterThanOrEqual(0.85); // both DEF
    expect(affinity('CM', 'CDM')).toBeGreaterThanOrEqual(0.85); // both MID
    expect(affinity('LW', 'ST')).toBeGreaterThanOrEqual(0.85); // both ATT
    expect(affinity('CB', 'CM')).toBeGreaterThanOrEqual(0.6); // DEF↔MID
    expect(affinity('ST', 'CAM')).toBeGreaterThanOrEqual(0.6); // ATT↔MID
  });
  it('effectiveRating: natural = full, secondary = full, off = penalised', () => {
    const cb = player('x', 'CB', 88);
    expect(effectiveRating('CB', cb)).toBe(88);
    const cbSec: PlayerV2 = { ...cb, secondary: ['RB'] };
    expect(effectiveRating('RB', cbSec)).toBe(88);
    expect(effectiveRating('ST', cb)).toBeLessThan(88);
    expect(effectiveRating('ST', cb)).toBeGreaterThan(0);
  });
});

// ── Determinism + score/timeline agreement (TICKSPEC §5) ────────────────────────

describe('determinism & score/timeline agreement', () => {
  const home = side('h', makeXi('4-3-3', (i) => 78 + (i % 5), 'h'), { style: 'attacking' });
  const away = side('a', makeXi('4-4-2', (i) => 76 + (i % 4), 'a'), { style: 'defensive' });

  it('same seed ⇒ identical result', () => {
    const r1 = resolveMatch(home, away, 12345);
    const r2 = resolveMatch(home, away, 12345);
    expect(r1).toEqual(r2);
  });

  it('resolveMatch scoreline & winner === simulateMatchTimeline for the same seed', () => {
    for (const seed of [1, 2, 3, 42, 99, 100000]) {
      const r = resolveMatch(home, away, seed);
      const t = simulateMatchTimeline(home, away, seed);
      expect(t.finalScore).toEqual({ home: r.homeGoals, away: r.awayGoals });
      expect(t.shootout?.winner).toEqual(r.shootout?.winner);
    }
  });

  it('matchSeed is the canonical seam: table (resolveMatch) === watched (timeline)', () => {
    const S = 0xc0ffee;
    for (let round = 0; round < 6; round++) {
      for (let mi = 0; mi < 16; mi++) {
        const seed = matchSeed(S, round, mi);
        expect(matchSeed(S, round, mi)).toBe(seed); // deterministic
        const r = resolveMatch(home, away, seed);
        const t = simulateMatchTimeline(home, away, seed);
        expect(t.finalScore).toEqual({ home: r.homeGoals, away: r.awayGoals });
        expect(t.shootout?.winner).toEqual(r.shootout?.winner);
      }
    }
    // distinct coordinates ⇒ distinct seeds (no collisions across a round)
    const seeds = new Set<number>();
    for (let mi = 0; mi < 100; mi++) seeds.add(matchSeed(S, 2, mi));
    expect(seeds.size).toBe(100);
  });
});

// ── No draws exist — every level match resolves via shootout ─────────────────────

describe('shootouts & the ≤16 night-shift rule', () => {
  const home = side('h', makeXi('4-3-3', flat(80), 'h'));
  const away = side('a', makeXi('4-3-3', flat(80), 'a'));

  it('shootoutEnabled (default): a level match resolves on pens; matchVerdict = W2/L1', () => {
    let level = 0;
    for (let seed = 0; seed < 400; seed++) {
      const r = resolveMatch(home, away, seed);
      const v = matchVerdict(r);
      if (r.homeGoals === r.awayGoals) {
        level++;
        expect(r.shootout).toBeDefined();
        expect(r.shootout!.home).not.toBe(r.shootout!.away);
        expect(v.decidedBy).toBe('pens');
        expect(v.homePoints + v.awayPoints).toBe(3); // 2 + 1
      } else {
        expect(r.shootout).toBeUndefined();
        expect(v.decidedBy).toBe('regulation');
        expect(v.homePoints + v.awayPoints).toBe(3); // 3 + 0
      }
    }
    expect(level).toBeGreaterThan(0);
  });

  it('shootouts DISABLED (>16 alive): a level match stands as a DRAW (1 pt each)', () => {
    let drawSeed = -1;
    for (let seed = 0; seed < 400; seed++) {
      const r = resolveMatch(home, away, seed, true);
      if (r.homeGoals === r.awayGoals) {
        drawSeed = seed;
        break;
      }
    }
    expect(drawSeed).toBeGreaterThanOrEqual(0);

    const r = resolveMatch(home, away, drawSeed, false);
    expect(r.homeGoals).toBe(r.awayGoals); // identical regulation score (pens are post-goals)
    expect(r.shootout).toBeUndefined();
    const v = matchVerdict(r);
    expect(v).toEqual({ winner: null, decidedBy: 'draw', homePoints: 1, awayPoints: 1 });

    // Watched timeline must contain NO shootout/penalty events when disabled.
    const t = simulateMatchTimeline(home, away, drawSeed, false);
    expect(t.shootout).toBeUndefined();
    expect(t.events.some((e) => e.type.startsWith('shootout') || e.type.startsWith('penalty'))).toBe(
      false,
    );
    expect(t.finalScore).toEqual({ home: r.homeGoals, away: r.awayGoals });
  });

  it('matchVerdict classifies a regulation win as W3/L0', () => {
    const strong = side('s', makeXi('4-3-3', flat(90), 's'));
    const weak = side('w', makeXi('4-3-3', flat(60), 'w'));
    const r = resolveMatch(strong, weak, 1);
    const v = matchVerdict(r);
    if (r.homeGoals !== r.awayGoals) {
      expect(v.decidedBy).toBe('regulation');
      expect(Math.max(v.homePoints, v.awayPoints)).toBe(3);
      expect(Math.min(v.homePoints, v.awayPoints)).toBe(0);
    }
  });
});

// ── Timeline shape (CONTRACT §4 invariants) ─────────────────────────────────────

describe('timeline shape', () => {
  const home = side('h', makeXi('4-3-3', (i) => 82 + (i % 6), 'h'), { formationId: '4-3-3' });
  const away = side('a', makeXi('3-5-2', (i) => 74 + (i % 5), 'a'), { formationId: '3-5-2' });
  it('91 ticks in-range; goal events sum to finalScore; formation ids present', () => {
    const t = simulateMatchTimeline(home, away, 7);
    expect(t.ticks).toHaveLength(91);
    for (const tk of t.ticks) {
      expect(tk.ballPosition).toBeGreaterThanOrEqual(0);
      expect(tk.ballPosition).toBeLessThanOrEqual(1);
      expect(tk.ballLane).toBeGreaterThanOrEqual(0);
      expect(tk.ballLane).toBeLessThanOrEqual(1);
      expect(tk.momentum).toBeGreaterThanOrEqual(-1);
      expect(tk.momentum).toBeLessThanOrEqual(1);
    }
    const homeGoalEvents = t.events.filter((e) => e.type === 'goal' && e.team === 'home').length;
    expect(homeGoalEvents).toBe(t.finalScore.home);
    expect(t.homeFormationId).toBe('4-3-3');
    expect(t.awayFormationId).toBe('3-5-2');
    if (t.finalScore.home === t.finalScore.away) {
      expect(t.events.some((e) => e.type === 'shootout_end')).toBe(true);
    }
  });
});

// ── Morale caps (DECISIONS: +2 goal / +1 assist / cap +3 / no negatives) ────────

describe('morale', () => {
  it('caps at +3 and never goes negative', () => {
    const m = moraleFromGoals([
      { playerId: 'p1', assistPlayerId: 'p2' },
      { playerId: 'p1', assistPlayerId: 'p2' }, // p1: 4→cap 3 ; p2: 2
    ]);
    expect(m['p1']).toBe(3);
    expect(m['p2']).toBe(2);
    expect(Object.values(m).every((v) => v >= 0)).toBe(true);
  });
});

// ── Balance harness — the DECISIONS targets (reports + asserts loose bands) ──────

describe('balance vs DECISIONS targets', () => {
  it('~3.4 goals/match and a sane pre-shootout draw rate over random matchups', () => {
    const rng = createRng(0xba1a);
    const nrm = (mean: number, sd: number) => {
      const u = (rng.next() + rng.next() + rng.next()) / 3; // ~N(0.5, ...) approx
      return mean + (u - 0.5) * sd * 6;
    };
    const styles = ['defensive', 'balanced', 'attacking'] as const;
    const forms = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '5-3-2', '3-4-3', '4-5-1', '4-2-4'];
    const randSide = (id: string): MatchSide => {
      const formationId = forms[rng.int(forms.length)];
      const xi = makeXi(formationId, () => Math.max(60, Math.min(97, Math.round(nrm(80, 6)))), id);
      return { id, xi, tactics: { formationId, style: styles[rng.int(3)] } };
    };

    const N = 4000;
    let goals = 0;
    let level = 0;
    let strongerWins = 0;
    let decisive = 0;
    for (let i = 0; i < N; i++) {
      const h = randSide(`h${i}`);
      const a = randSide(`a${i}`);
      const r = resolveMatch(h, a, i * 2654435761);
      goals += r.homeGoals + r.awayGoals;
      const hs = zonalStrength(h.xi).overall;
      const as = zonalStrength(a.xi).overall;
      if (r.homeGoals === r.awayGoals) {
        level++;
      } else {
        decisive++;
        const homeWon = r.homeGoals > r.awayGoals;
        if ((homeWon && hs > as) || (!homeWon && as > hs)) strongerWins++;
      }
    }
    const goalsPerMatch = goals / N;
    const drawRate = level / N;
    const strongerWinRate = strongerWins / decisive;
    // eslint-disable-next-line no-console
    console.log(
      `BALANCE v2: goals/match=${goalsPerMatch.toFixed(3)} preShootoutDraw=${(drawRate * 100).toFixed(1)}% strongerWins=${(strongerWinRate * 100).toFixed(1)}%`,
    );
    // Tuned bands (observed 3.50 / 14.3% / 59.5%) — a real regression gate on
    // DECISIONS targets (3.4 goals, ~15% pre-shootout draws, 55-60% stronger-wins).
    expect(goalsPerMatch).toBeGreaterThan(3.25);
    expect(goalsPerMatch).toBeLessThan(3.7);
    expect(drawRate).toBeGreaterThan(0.1);
    expect(drawRate).toBeLessThan(0.19);
    expect(strongerWinRate).toBeGreaterThan(0.52);
    expect(strongerWinRate).toBeLessThan(0.66);
  });
});
