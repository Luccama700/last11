# Last11 ⚽ — Football Draft Battle Royale

**Last manager standing wins.** 32 managers enter the lobby. Everyone spins the
wheel to draft an XI under pressure. Every round the weakest teams are cut —
survive all six eliminations and you're the Last11.

Built solo-from-scratch at **United Hacks V7** (Sport theme track), July 2026.
Domain: **11a0.com**.

## The idea

Spin-to-draft football sims (38-0, 7a0, 82-0) are having a moment — 10M+ visits
mid-World-Cup — but every one of them is single-player or small-room.
**Nobody has built the battle royale.** Last11 is that game:

1. **Draft** — 11 spins. The wheel lands on a nation; you take one of its
   players for the current slot of your 4-3-3. Off-position picks are allowed
   (a 94-rated striker at 75% might still beat a mediocre midfielder), stacking
   one nation builds chemistry, stars add punch.
2. **Survive** — each round every manager plays 3 matches. Points, then goal
   difference. The bottom of the table goes home: 32 → 24 → 16 → 8 → 4 → 2 → 1.
3. **Loot the fallen** — between rounds you may steal one player from an
   eliminated squad. The 31 bots are doing the same, so the field tightens
   every round.

## Run it

```bash
npm install
npm run dev      # play at http://localhost:5173
npm test         # 53 unit + integration tests
npm run build    # typecheck + production build
```

## How it works

- **`src/engine/`** — the whole game is pure, deterministic TypeScript.
  A seeded mulberry32 RNG drives every spin, pairing and goal; the same seed
  replays the identical tournament. Team strength = position-fit-adjusted
  ratings + same-nation chemistry pairs + star bonuses. Matches are Poisson
  goal draws whose expected goals scale with the strength differential.
  `runTournament(seed)` resolves a full 32-manager battle royale headlessly —
  that's what the end-to-end tests exercise.
- **`src/game/`** — a pure React reducer state machine. The RNG lives outside
  React and is consumed only in event handlers, so StrictMode replays can't
  corrupt a run.
- **`src/screens/`** — draft wheel, arena (elimination table with the cut
  line), steal window, endgame.
- **Data** — a hand-assembled bundle of 12 World Cup 2026 nations × 12 players.
  No servers, no accounts: everything runs in your browser.

## Tests

The sim engine is the technical core and it's kept honest: determinism
(same seed ⇒ byte-identical tournament log), elimination bookkeeping (nobody
plays after they're cut, exactly one champion), steal integrity (a steal never
duplicates a player or corrupts a formation), strength bias (better teams win
more), plus DOM-level tests that click through an entire game.

## Team

Lucca, Johnny & Wesley — United Hacks V7, July 10–12 2026.
