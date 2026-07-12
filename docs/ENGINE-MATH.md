# Last11 — How the Math Works (engine → screen)

The complete chain from a player's rating in `squads-v2.json` to every number and
animation you see on screen. Written 2026-07-11 (post-playtest wave). Source of
truth for constants: `src/engine/params.ts`, `src/engine/types.ts`,
`src/engine/affinity.ts`. If this doc and the code disagree, the code wins — then
fix this doc.

The one-paragraph model: **every player has one base rating; position fit and
morale turn it into an effective rating; eleven effective ratings aggregate into
zonal strengths; zonal edges plus tactics set each side's expected goals (xG);
a seeded Poisson draw turns xG into a score; level matches go to seeded penalties
in late rounds; everything downstream — the watched match, the table, the steal
deltas — is a pure, deterministic view of those same numbers.** No hidden dice:
one seed replays the identical tournament to the byte.

---

## 1. Base ratings (the ladder)

Every player has a single integer rating on a 0–99 scale, hand-calibrated in
`docs/redesign/RATINGS-LADDER.md` against Lucca's anchors:

| Anchor | Rating |
|---|---|
| Pelé 1970 (the ceiling) | 97 |
| Maradona '86, Messi '14, Ronaldo (R9) '02 | 96 |
| Messi 2026 | 92 |
| "Very good starter" today | high 80s |
| Star threshold (⭐ + engine star bonus) | ≥ 90 |

The database (`src/engine/data/squads-v2.json`) currently holds **47 squads /
857 players across 20 nations**, spanning historical World Cup sides (Brazil '70,
Spain '10, Germany '14…) and 2026 rosters. Each player carries `pos` (one of the
12 detailed positions), optional `altPos` secondaries, and `rating`. The same
person can appear as multiple year-snapshots (Messi '14 vs Messi '26) but the
`personKey` rule guarantees you can never field two snapshots of one human.

## 2. Position affinity (off-position math)

`AFFINITY_MATRIX[natural][slot]` (`engine/affinity.ts`) answers: *how much of a
player's rating survives when fielded at `slot`?* It's a 12×12 matrix expanded
from a 9-family table (RB/LB→FB, RM/LM→WM, LW/RW→W keeps left/right symmetric).

Rules of the matrix:
- **Diagonal = 1.0** and any listed secondary position = 1.0 — natural is always
  a zero-cost placement (locked by `affinity-invariants.test.ts` over the whole DB).
- Same zone ≥ .85, adjacent zone ≥ .60, worst case (GK ↔ outfield) floors at
  ~.25 — deliberately forgiving so the free-pick draft never dead-ends.
- **Lucca's rating-point anchors** (calibrated at a 90-rated baseline, so the
  penalty scales with the player — `mult = (90 − penalty) / 90`):
  - LW↔LM, RW↔RM: −1 pt → ×.989 (both directions)
  - LM→LB, RM→RB: −3 pt → ×.967 (wing-adjacent moves are cheap)
  - CAM→CM: −4 pt → ×.956

**Effective rating** is the single source of truth for off-position value:

```
effectiveRatingV2(player, slot) =
  player.rating × (natural or secondary ? 1.0 : AFFINITY_MATRIX[player.position][slot])
```

Example (the Xavi/Musiala case): Musiala is a natural CAM rated 91. At a CM slot
he's worth 91 × .956 ≈ **87**. Xavi (natural CM, 93) is a full **93** there —
so stealing Xavi into that slot is genuinely +6, not the naive 93−91 = +2.

## 3. Morale (chemistry's replacement)

A transient per-player buff, never negative, never persisted (`engine/morale.ts`):
**scorer +2, assister +1, capped at +3 per player, applies to the next match set
only, then resets.** Within a round's three match sets, goals in set N buff set
N+1; the last set's goals carry into the next round's first set. Morale adds
directly onto effective rating inside the engine's zonal sums and shot weights —
a hot striker is briefly a better finisher, but the +3 cap and hard reset prevent
rich-get-richer death spirals.

## 4. Squad strength — the number you see vs the number the engine uses

Two deliberately different aggregates. **Don't confuse them.**

- **Displayed squad rating** (`engine/squad-rating.ts`) — the number on the draft
  rail, leaderboard, standings popup, and end screen: `Σ effectiveRatingV2(player,
  slot)` over the 11 fielded slots, rounded. A SUM (typical XI ≈ 900–1000), same
  metric for you and every bot, so every "Squad" number in the UI agrees.
- **Engine zonal strengths** (`engine/rating.ts` `zonalStrength`) — what matches
  are resolved with: each player's effective rating (+morale) is spread into
  GK / DEF / MID / ATT zones × Left/Center/Right lanes by position-specific
  weights, then AVERAGED per zone (a zone reads ~70–90, the player-rating scale).
  "+10 strength" in the balance targets means +10 on *this* scale.

## 5. From strengths to expected goals (xG)

`computeXg` (`engine/match.ts`) is pure — no randomness:

```
attackIndex  = .60·att.avg + .25·mid.avg + .15·overall
defenseIndex = .55·def.avg + .20·mid.avg + .25·gk

xg(side) = 1.7 + (my attackIndex − their defenseIndex) × 0.075
```

- **1.7 base per side** ⇒ 3.4 goals/match at parity (Lucca's target — spicier
  than real football, on purpose).
- **0.075 per rating point** ⇒ a +10 zonal edge ≈ **+0.75 xG** (the calibration
  ruling, verified by the balance harness).

Then tactics modify it:
- **Midfield overload**: ±0.06 xG per net central-midfield body (a 3-mid shape
  vs a 2-mid shape tilts chance volume — shape can beat marginally better
  players, never a huge talent gap).
- **Style**: `defensive ×0.90 / balanced ×1.0 / attacking ×1.12`, applied as the
  *product of both sides'* multipliers to BOTH xGs — attacking opens the game at
  both ends (the main upset generator).
- **Line height**: your high line multiplies the *opponent's* xG ×1.15 (counters);
  a deep block suppresses it ×0.90.
- **Stars**: +0.05 xG per ⭐ (rating ≥ 90) in the XI — finishing quality, additive.
- Clamped to [0.15, 5.0]. The high ceiling is the 38-0-style blowout fantasy.

## 6. From xG to a score

Goals are **independent Poisson draws** per side (Knuth sampler, seeded RNG).
One correction: an inverted Dixon-Coles trim — where the textbook DC correction
*adds* real football's excess dull draws, we do the opposite: a sampled 0-0 or
1-1 is converted to a one-goal win for the higher-xG side with probability
**0.55** (`LOW_DRAW_TRIM`), tuned so ~15% of matches are still level after 90'.

## 7. Who scored (attribution → morale → stats)

Each goal gets a random minute (1–90) and a scorer drawn by **shot weight** — a
position-and-rating weighted pick over the XI (attackers weighted heaviest,
morale included), then an assister the same way (18% of goals are solo). These
attributions are what feed morale (§3), the Golden Boot / Playmaker podiums, and
the match ticker.

## 8. Penalties (only when it matters)

- **Staging rule**: shootouts exist only in rounds starting with **≤16 alive**
  (`SHOOTOUT_ALIVE_MAX`). Bigger rounds keep classic draws (W3/D1/L0).
- **Conversion model**: each kick converts with
  `p = 0.75 + (taker − 75)×0.010 − (keeper − 75)×0.008`, clamped [0.30, 0.95].
  Takers go best-shot-weight first; 5 rounds, early-decision cutoff, then sudden
  death. Fully seeded — the same match always produces the same shootout.
- **Points (Lucca's ruling, "it's either 3 or 0")**: regulation win 3 / loss 0;
  **pens win 3 / pens loss 0**; classic draw (early rounds only) 1 each.
  `matchVerdict` is the single source of truth — nothing else compares goals.

## 9. Determinism (why replays and multiplayer are free)

- All randomness flows through one seeded **mulberry32** RNG.
- Every match's seed is canonical: `matchSeed(tournamentSeed, round, matchIndex)`
  — an integer hash. A match is *named* by its coordinates.
- `resolveMatchOutcome` is THE shared core: the headless table resolution and the
  watched timeline draw the **same RNG sequence**, so the score you watch is
  byte-identical to the table. Timeline cosmetics (ball wiggle) use a separate
  derived RNG that never perturbs outcome draws.

## 10. Steal math

`stealGainV2(slate, formation, incoming, slotIndex)` — one function used by the
steal screen, the candidate ranker, and bot auto-swaps:

```
gain = effectiveRatingV2(incoming, slotPos) − effectiveRatingV2(currentOccupant, slotPos)
```

Both players are priced *at the slot*. A natural incoming is credited full base;
an off-position occupant is priced at his reduced value (which is why replacing
him recovers his penalty — see the +6 example in §2).

---

# The display layer — where each number surfaces

Everything below is a **pure projection**: `projectMatch(timeline, elapsedMs)`
(`src/game/playback.ts`) maps (what happened, how far in are we) → one frame.
No screen ever calls the engine or rolls dice.

## Match playback (`MatchPlaybackScreen`)

| On screen | The math behind it |
|---|---|
| **Clock** | 90 virtual minutes mapped onto 45 s of wall clock (`MATCH_DURATION_MS`); minute = elapsed/45000×90. Multiplayer will run 30 s slots (mode parameter). |
| **Score digits** | Latest goal event whose minute-stamp ≤ current virtual minute — the engine's attributed goals (§7), nothing recomputed. Digits remount + bump on change. |
| **Ball** | Interpolated between per-minute engine ticks (`ballPosition` × `ballLane` — 5 bands × 3 lanes with ±0.06 jitter, cosmetic RNG). Snaps to centre during goal celebrations. |
| **22 dots** | Formation anchors per position, then the C1 "character" model: per-index phase/tempo/stride (pure hash), positional energy budget (GK 0.15 → ST 1.25), personal patrol orbit + micro-jitter, per-player ball-pull with a slow ebb, and **urgency** — the side losing the momentum reads faster/longer strides and its back line sinks toward goal. All `f(elapsed, index, …)`, MP-safe. |
| **Momentum bar** | The engine tick's `momentum` (−1…+1, home-positive), lerped between minutes — territory/pressure, biased by line height. |
| **GOAL shout** | Celebration *clusters*: chain-overlapping goal windows (2.6 s each) count up and never down — GOAL → 2× → 3×. Team-aware palettes: yours gold→lime→cyan→purple, enemy red→darker reds; confetti follows. Freshest goal's team decides mixed clusters. |
| **Shootout overlay** | The engine's pre-decided kick list (§8) revealed one per 6 s beat (wind-up at 58% of the beat). Mounted only after the 90' — the view is `null` through regulation so pens can't be spoiled. |
| **Lineup rails** | Names + BASE ratings (identity info, not slot-worth). |

## Standings & leaderboard (`BattleScreen`)

- **Pts / GF / GA / GD** — accumulated from `matchVerdict` per match (§8's 3/0
  table); sort order Pts → GD → GF → strength → id.
- **"Squad"** — `displayedSquadRating` (§4's SUM), the same number as the draft
  rail; the human's comes from the detailed slate, bots' from their projected XI.
- **Match chips** — W/L/D labels come from `decidedBy`, so a pens win shows as a
  win with a PENS tag, never as a draw.
- The **cut line** row pulses; movement arrows compare to the previous set.

## Steal screen (`StealScreen`)

- Loot cards: natural detailed position + **base** rating.
- XI rows: the occupant's **slot-worth** (`effectiveRatingV2` at his slot,
  rounded). Off-position occupants get an amber tag — e.g. `CAM 91` on a player
  showing 87 at CM — so every gain chip reconciles from visible numbers.
- Gain chips: `stealGainV2` (§10) to one decimal, green/red by sign.

## Draft board & pit stop (`DraftScreenV2`, `BetweenMatchBoard`)

- Rail **Strength** = the displayed SUM (§4), bumping on change.
- Picker sorting/boost chips = `effectiveRatingV2` at the target slot.
- The between-round **pit stop** re-slots via tap-swap, changes style, and
  changes formation — a new shape runs `autoArrange` (greedy best-effective-
  rating assignment of your same eleven into the new slots).
- Slot machine reels are seeded per roll — pure spectacle over a deterministic
  pick, and off-limits to gameplay math.

## End screen (`EndScreen`)

- **Final strength** = the displayed SUM. **Golden Boot / Playmaker** = the
  attribution stream (§7) accumulated per player across the tournament.
- **Watch the final** rebuilds the real timeline from the stamped
  `(seed, shootoutEnabled, morale)` — determinism (§9) means watching it later
  reproduces exactly what the table recorded.
- **Hall of Champions** — localStorage tally across runs on this machine.

---

## File map

| Concern | File |
|---|---|
| Tuning constants (xG, styles, shootout, trim) | `src/engine/params.ts` |
| Affinity matrix + anchors | `src/engine/affinity.ts` |
| Effective rating, steal gain, autoArrange | `src/engine/draft.ts` |
| Zonal strengths, shot weights, box score | `src/engine/rating.ts` |
| xG, Poisson, shootout, verdict, matchSeed | `src/engine/match.ts` |
| Morale | `src/engine/morale.ts` |
| Points, formations, shared constants | `src/engine/types.ts` |
| Rounds, cuts, steal pool, points table | `src/engine/tournament.ts` |
| Watched-match timeline (ticks/events) | `src/engine/timeline.ts` |
| Displayed squad rating | `src/engine/squad-rating.ts` |
| THE pure projection + dot model | `src/game/playback.ts` |
| Balance targets & harness | `src/engine/balance.report.ts` |

Balance targets the harness re-verifies after every engine change: 3.4 goals per
match, +10 edge ≈ +0.75 xG, ~15% level after 90' in shootout rounds, zero
unresolved draws there, stronger side wins ~55–60%.
