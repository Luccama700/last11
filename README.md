# Last11 ⚽ — Football Draft Battle Royale

**Last manager standing wins.** 32 managers enter the lobby. Everyone drafts an
XI on the slot machine under pressure. Every round the bottom of the table is
cut — survive every elimination and you're the Last11.

Built at **United Hacks V7** (Sport theme track), July 2026.
Production: **last11.app** · testing builds deploy from the `preview` branch.

## The game

Spin-to-draft football sims (38-0, 7a0, 82-0) are having a moment — 10M+ visits
mid-World-Cup — but they're all single-player or small-room. **Last11 is the
battle royale**:

1. **Draft** — 11 spins on the slot machine. Each spin lands on a nation+year
   squad (Brazil '70, Spain '10, Germany '26…); you take one player for ANY
   slot of your chosen shape. All 12 detailed positions (GK→ST), 10 formations,
   free-position picks — a 94 striker at CM might still beat a mediocre CM,
   priced by the affinity matrix. You can never field the same person twice,
   even across year-snapshots.
2. **Survive** — every round each alive manager plays 3 matches. Points →
   goal difference. The bottom goes home: 32 → 24 → 16 → 8 → 4 → 2 → 1.
   From 16 alive there are **no draws** — level matches go to penalties, and
   pens carry full stakes (3 points or 0).
3. **The pit stop** — between rounds: swap players, change formation and
   playing style on the board, and **loot one player from the fallen** (the 31
   bots are stealing too).
4. **Watch it** — your matches play out on a 2D pitch: 22 individually-moving
   dots, momentum bar, escalating multi-goal celebrations, penalty shootouts
   staged kick by kick, and a watchable final on the end screen. Scorers earn
   **morale** (+2 goal / +1 assist, next match only) — chemistry is dead,
   hot streaks are real.

Everything is deterministic: one seed replays the identical tournament.

## Run it

```bash
npm install
npm run dev      # play at http://localhost:5173
npx vitest run   # 315 unit + integration + DOM tests
npm run build    # typecheck + production build
```

## How it works

- **`src/engine/`** — the whole game is pure, deterministic TypeScript driven
  by a seeded mulberry32 RNG. Ratings (hand-calibrated ladder, Pelé '70 = 97) →
  position-affinity effective ratings → zonal strengths → tactics-aware xG →
  Poisson goals → seeded shootouts. `runTournament(seed)` resolves a full
  32-manager battle royale headlessly.
  **→ The full math, constant by constant: [`docs/ENGINE-MATH.md`](docs/ENGINE-MATH.md)**
- **`src/game/`** — a pure React reducer state machine plus `playback.ts`: the
  watched match is `projectMatch(timeline, elapsedMs)`, a pure function — no
  per-frame simulation, which is also what makes multiplayer a refactor rather
  than a rewrite.
- **`src/screens/`** — setup, slot-machine draft board, the arena (standings
  popup, cut line), match playback, steal window, pit-stop board, end screen
  with Hall of Champions.
- **Data** — `src/engine/data/`: 47 squads / 857 players across 20 nations,
  historical World Cup sides and 2026 rosters, each with detailed positions,
  secondaries and a calibrated rating. No servers, no accounts.

## Docs

| Doc | What's in it |
|---|---|
| [`docs/ENGINE-MATH.md`](docs/ENGINE-MATH.md) | Every formula, engine → screen: affinity, morale, xG, Poisson, pens, steal math, and exactly which UI number reads which value |
| [`docs/redesign/DECISIONS.md`](docs/redesign/DECISIONS.md) | Lucca's design rulings (authoritative) |
| [`docs/redesign/RATINGS-LADDER.md`](docs/redesign/RATINGS-LADDER.md) | The rating calibration ladder |
| [`docs/multiplayer/MULTIPLAYER-PLAN.md`](docs/multiplayer/MULTIPLAYER-PLAN.md) | MP architecture: host-authoritative Supabase MVP, driver seam |
| [`docs/multiplayer/FORMAT-REPORT-v1.1.md`](docs/multiplayer/FORMAT-REPORT-v1.1.md) | The locked 20-manager online format + rulings |

## Multiplayer (SHIPPED — MVP)

Hit **PLAY ONLINE** on the home screen: 20-manager rooms with 5-letter codes,
fill-with-bots start, simultaneous slot-machine drafting (10-second picks,
disjoint per-spin team pools — no pick contention by construction, global
player uniqueness), lockstep viewing on a shared clock at 1.5×, a combined
20-second pit stop (loot + re-slot + tactics), spectators with a rooting-for
pick, trust-based tactics (commit-reveal is a planned later feature for ranked).

Host-authoritative over **Supabase Realtime** (broadcast + presence only — no
database): the wire carries seeds, picks and deadlines; every client derives
bots, pairings, scores and timelines deterministically from the room seed, and
a loopback test plays a full host+guest tournament asserting the two mirrors
never diverge. Config: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
(`.env.example`; set the same two in Vercel for deploys).

## Tests

The engine is kept honest by 315 tests: determinism (same seed ⇒ byte-identical
tournament), balance targets (3.4 goals/match, +10 strength ≈ +0.75 xG, ~15%
level after 90'), affinity invariants over the entire player DB (natural
position is always zero-cost), elimination bookkeeping, steal integrity,
playback projection (no-spoiler pens, monotone multi-goal clusters), and
DOM-level tests that click through entire games.

## Team

Lucca, Johnny & Wesley — United Hacks V7, July 10–12 2026.
