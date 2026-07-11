# PLAN — Match Engine v2 (owner: hackathon-builder)

Phase R research + plan. **No `src/` changes.** This is the engine rebuild Lucca
calls "the bulk of the work." It ends in a **decision questionnaire (16 questions)**
— he wants to co-design the numbers, so nothing below is final until he rules.

Current baseline: `match.ts` = Poisson on a scalar strength diff (`BASE_XG 1.35`,
`STRENGTH_TO_XG 0.012`); `rating.ts` = flat rating sum + same-nation chem pairs +
star bonus, over a fixed 4-position 4-3-3. Tactics do not exist yet.

---

## 1. Findings (with sources)

### 1a. Real-football statistical targets the sim should hit

| Metric | Real-world value | Source |
|---|---|---|
| Goals/game, recent World Cups | 2.64 (2018), 2.67 (2014); 2.99 in the 2026 group stage (highest since 1958) | [Statista][s1], [Northeastern][s2] |
| Goals/game, WC long-run 2002–2018 | ~2.48 | [footballhistory.org][s3] |
| Draw rate, top-5 European leagues | ~24–26% (roughly a quarter) | [FootyStats][s4] |
| Draw rate, WC group stage | lower, ~16–20% (2018 = 16%) | [footballhistory.org][s3] |
| Most common scorelines (top-5 leagues, since 2011/12) | 1-1 (11.7%), 1-0 (9.5%), 2-1 (8.7%), 2-0 (7.6%), 0-0 (7.2%) | [FootyStats][s4], [StatsUltra][s5] |
| Favourite wins outright (PL) | ~55–58%; so favourite fails to win ~42% | [Goal.com][s6] |
| Favourite wins (WC, last 5 tournaments) | 55% overall, 57% group stage | [OLBG][s7] |

**Read-through for our targets:** aim **~2.7 goals/game** and a **~22–25% draw
rate** in a *balanced* matchup, with a clearly stronger team winning **~55–60%**
(not 90%). Upsets must stay a "regular occurrence" — that is what makes a battle
royale watchable. WC squads skew slightly higher-scoring / lower-draw than club
football, which matches our nation-vs-nation framing.

### 1b. How the genre presents engine outcomes

- **7a0**: nation + WC-year roll, **8 formations** (4-4-2, 4-3-3, 3-5-2, 4-2-3-1…),
  **3 styles** (attack / balanced / defense), Classic vs From-Memory. The sim
  "weighs your attack, your defence and how well each player fits their role,"
  returns a scoreline plus an **ATTACK / DEFENCE / OVERALL box score**, and rewards
  "a strong spine." Group stage → knockouts, penalties break draws. [7a0.app][s8],
  [seteazero.wiki][s9]
- **38-0**: markets a **deterministic engine — "every result is earned, never
  random."** Live 90-minute match over two halves, **one tactical swap before
  kickoff and one at halftime.** [38-0-game.com][s10], [HITC][s11]

**Design implication:** players expect (1) a legible box score that *explains* the
result (our "deserved" story), and (2) tactical decisions at kickoff and halftime
that visibly move the outcome. Both are cheap to honour and are strong
technical-complexity + presentation beats for judging.

### 1c. Modelling literature

- **Poisson underrates low-score draws.** Independent Poisson systematically
  under-predicts 0-0 and 1-1. **Dixon–Coles (1997)** adds a correlation factor ρ
  that reweights exactly {0-0, 1-0, 0-1, 1-1}; negative ρ pushes mass toward 0-0
  and 1-1. Cheap, well-understood, ~1–3% log-likelihood gain. [StatsUltra][s12],
  [dashee87][s13], [penaltyblog][s14]
- **Zonal Markov / Expected-Threat models.** Discretise the pitch into zones;
  model play as a Markov chain over (team-in-possession, zone) with an absorbing
  GOAL state; transition probabilities come from zonal matchups; each zone carries
  a scoring-potential value. This is the standard analytics substrate (xT). It
  *naturally emits a per-minute ball location* — exactly the momentum meter the
  sim-UI workstream needs. [StatsBomb][s15], [xT explainer][s16]
- **Formation matchups are real and directional.** A 3-in-central-midfield shape
  (3-5-2, 4-3-3) creates a **3-v-2 overload** on a 4-4-2's two central mids that
  "dictates tempo and possession"; a back-3 is vulnerable in wide areas to genuine
  width (wingers + overlapping full/wing-backs). [SoccerTutor][s17],
  [Wikipedia: Formation][s18]

---

## 2. Candidate architectures (compared)

| # | Architecture | Emits momentum meter? | Tactics-native? | "Deserved" feel | Cost/risk | Verdict |
|---|---|---|---|---|---|---|
| a | **Upgraded Poisson/xG** — current model + a tactic-modifier layer on each team's xG, Dixon-Coles low-score fix, fabricated timeline | No (must synthesise) | Modifiers bolted on, opaque | Medium — it's a scoreline oracle, not a story | **Low** | **Tier A** |
| b | **Zonal possession Markov chain** — state = (possessor, zone), transitions from zonal-strength matchups, shots sampled in attack zone, absorbing GOAL | **Yes, for free** — the chain *is* the ball track | **Yes** — tactics are transition-prob multipliers | **High** — every goal traces a build-up | Medium — needs calibration | **Tier B (recommended target)** |
| c | Full event/agent sim (FM-style, 22 agents, off-ball movement) | Yes | Yes | Highest | **High** — weeks of work, hard to keep deterministic & fast, overkill for a card game | Rejected |

**Why (c) is rejected:** the fidelity is invisible at our presentation altitude (a
horizontal momentum bar + event ticker), it threatens the fast headless path
(48 matches/round), and it multiplies determinism surface area for near-zero
judge-visible gain. Note it explicitly in the plan so the choice is on record.

**Recommendation:** **(b) is the real engine; (a) is the hackathon shim.** Ship
(a) this weekend to make tactics matter *and* feed the sim UI a timeline; build (b)
after. Critically, **(a) and (b) share the same zonal-strength front-end and the
same tactic-modifier table** — so Tier A is not throwaway; only the back-end
(closed-form Poisson vs. simulated chain) is swapped, behind the same interface.

---

## 3. Model spec

### 3.1 Zonal strength front-end (shared by Tier A and Tier B)

Replaces the scalar `teamStrength().total` fed to the match sim. From the 12-slot
XI + formation + tactics we compute a **zonal strength vector**, not one number:

```
ZoneStrength = { gk, defL, defC, defR, midL, midC, midR, attL, attC, attR }
```

Each player contributes `effectiveRating(slot, player)` (via the position-affinity
matrix, §3.2) into the zones their **formation role** covers, with per-role
weights. Examples (defaults, tunable):

- **CB** → defC 1.0. **RB** → defR 0.8, midR 0.3 (overlap). **LB** symmetric.
- **CDM** → defC 0.4, midC 0.9. **CM** → midC 1.0. **CAM** → midC 0.7, attC 0.5.
- **RM** → midR 0.9, attR 0.4. **RW** → attR 0.9, midR 0.3. **LM/LW** symmetric.
- **ST** → attC 1.0. **GK** → gk 1.0.

Collapse to the four **box-score aggregates 7a0-style** (`GK / DEF / MID / ATT`)
for display, but keep the L/C/R split internally so **width vs. a narrow back-3**
and **central overload** fall out of the matchup math instead of being special-cased.

- **Chemistry** (keep): same-(nation,year) pairs raise a **cohesion multiplier**
  (default 1.00–1.08) applied to MID and ATT zones — cohesion helps building, not
  goalkeeping. Reframes today's flat chem-pair bonus without deleting it.
- **Star power** (keep): players ≥ star threshold add a **shot-quality bonus** in
  the attack zone (clutch finishing), not a flat team bonus — makes stars matter
  where they'd matter, and keeps the "strong spine" heuristic honest.

**ASSUMPTION for worker-7 / CONTRACT.md:** the engine consumes `PlayerV2`
(detailed `Position`, per-tournament `rating`), a `Formation` (name + ordered
12-slot position list), and a `Tactics` object (§3.3). It emits `ZoneStrength` and,
on demand, a `MatchTimeline` (§4). The **position-affinity matrix shape** is
worker-7's; the **values** (§3.2) are mine.

### 3.2 Position-affinity matrix (proposed default values)

Replaces the flat `OFF_POSITION_MULT = 0.75`. `affinity[slot][natural]` ∈ [0,1];
`effectiveRating = rating × affinity[slot][player.position]`. Defaults (natural
slot = 1.0; symmetric L/R assumed):

| Slot ↓ / plays → | GK | CB | FB | CDM | CM | CAM | WM | W | ST |
|---|---|---|---|---|---|---|---|---|---|
| GK | 1.0 | .35 | .30 | .25 | .20 | .20 | .20 | .20 | .20 |
| CB | .30 | 1.0 | .80 | .80 | .55 | .40 | .40 | .35 | .35 |
| FB (RB/LB) | .25 | .75 | 1.0 | .65 | .55 | .45 | .75 | .65 | .40 |
| CDM | .25 | .70 | .60 | 1.0 | .90 | .70 | .55 | .40 | .35 |
| CM | .20 | .55 | .55 | .88 | 1.0 | .88 | .70 | .55 | .50 |
| CAM | .20 | .35 | .45 | .65 | .88 | 1.0 | .75 | .75 | .78 |
| WM (RM/LM) | .20 | .40 | .78 | .55 | .70 | .78 | 1.0 | .90 | .60 |
| W (RW/LW) | .20 | .30 | .55 | .35 | .55 | .78 | .90 | 1.0 | .80 |
| ST | .20 | .35 | .35 | .35 | .55 | .80 | .60 | .80 | 1.0 |

Same-flank moves (RB↔RM↔RW) score higher than cross-flank; a striker dropping to
CAM (.80) is cheaper than a CB pushed to ST (.35). **Decision Q3** sets how harsh
off-position should be overall (this table is a starting posture).

### 3.3 Tactics levers (what actually moves the result)

| Lever | Values | Engine effect (default magnitude) |
|---|---|---|
| **Formation** | 8 schemes (4-4-2, 4-3-3, 3-5-2, 4-2-3-1, 3-4-3, 5-3-2, 4-2-2-2, 4-5-1) | Sets which 12 slots exist and the zone-weight map → drives central-overload & width matchups |
| **Style** | defensive / balanced / attacking | Shifts the attack↔defense weighting of your own zones ±10%, and your xG variance (attacking = more xG **both ways**) |
| **Pressing** | low / medium / high | High press raises opponent turnover prob in their build-up zones but concedes higher-quality counters (space in behind) |
| **Line height** | deep / medium / high | High line pushes your average ball position up (territory) but multiplies opponent counter shot-quality; deep invites pressure, protects the box |
| **Tempo/directness** | possession / balanced / direct | Possession = more transitions, lower per-chance quality; direct = fewer, higher-quality chances (counter-attacking) |
| **Man-mark a star** *(Tier B)* | pick 1 opposing player | Caps that player's zone contribution (~−40%) but −5% to your own MID cohesion (a man drawn out of shape) |

**Style shifts risk both ways** (attacking raises xG **for and against**) — that is
the lever that generates upsets, and it maps directly onto 7a0's attack/balanced/
defense. Formation + Style are the **kickoff + halftime** decisions (38-0's model);
pressing/line/tempo are the "more tactics" Lucca asked for.

### 3.4 Matchup math (how strengths → chances)

For each team, per zone: `edge_zone = ownStrength_zone − oppMirrorStrength_zone`,
modulated by tactic multipliers. Two ways this cashes out, one per tier:

- **Tier A (closed-form):** collapse zone edges into two expected-goals values
  `xGhome`, `xGaway` (attack edge vs. opponent defense edge, plus midfield-control
  term shifting possession share), then sample goals from **bivariate Poisson with
  the Dixon–Coles low-score correction** (fixes the draw rate — §1c). Timeline is
  *synthesised* from the xG split (§4.3).
- **Tier B (simulated):** run the zonal Markov chain minute-by-minute; goals are an
  emergent absorbing state. The final score is whatever the chain produced — a
  genuinely "deserved" result, and the timeline is the real ball track.

### 3.5 Parameter list (proposed defaults — all live in one tunable `params.ts`)

```
BALANCED_XG_BASE      = 1.35   // xG for each side in a dead-even matchup → ~2.7 g/g
STRENGTH_TO_XG        = tuned so a 10-pt zonal edge ≈ +0.55 xG   (Decision Q1)
DIXON_COLES_RHO       = -0.05  // low-score draw correction         (Decision Q6)
STYLE_ATT_XG_MULT     = 1.12   // attacking: own & conceded xG up
STYLE_DEF_XG_MULT     = 0.90   // defensive: own & conceded xG down
PRESS_TURNOVER_GAIN   = 0.08   // high press: +opp turnover in build-up
PRESS_COUNTER_PENALTY = 0.10   // ...but +opp counter shot-quality
LINEHIGH_TERRITORY    = 0.12   // high line: +avg ball position
LINEHIGH_COUNTER_MULT = 1.15   // ...×opp counter quality
CHEM_COHESION_MAX     = 1.08   // full-chem MID/ATT multiplier
STAR_SHOTQUALITY      = 0.06   // per star, attack-zone conversion bump
FORMATION_OVERLOAD_K  = 0.06   // xG swing per net central-mid body   (Decision Q4)
```

Every constant is a tuning knob, not a magic number — the balance harness (§6)
sweeps them against §1a targets.

---

## 4. Timeline event schema (coordinate with worker-7 + codex-ui)

The engine's watched-match output. **This is the producer side of the contract the
sim UI (codex-ui) consumes** — worker-7 owns the final shape in `CONTRACT.md`; the
below is my stated assumption.

```ts
interface MatchTimeline {
  seed: number;
  homeId: string; awayId: string;
  durationVirtualMin: number;          // 90 (virtual clock; UI maps to wall-clock)
  finalScore: { home: number; away: number };
  frames: MinuteFrame[];               // one per virtual minute (0..90)
  events: MatchEvent[];                // discrete, minute-stamped
  boxScore: {                          // the 7a0-style "deserved" panel
    home: ZoneBox; away: ZoneBox;      // { gk, def, mid, att, overall }
    xg: { home: number; away: number };
  };
}

interface MinuteFrame {
  minute: number;                      // 0..90
  ballPos: number;                     // -1 = home goal line … +1 = away goal line
  possession: 'home' | 'away';
  momentum: number;                    // -1..+1, smoothed pressure for the meter
}

type MatchEventType =
  | 'kickoff' | 'chance' | 'shot' | 'save' | 'goal'
  | 'halftime' | 'fulltime' | 'card';  // card = Tier B

interface MatchEvent {
  minute: number;
  type: MatchEventType;
  team: 'home' | 'away';
  playerId?: string;                   // scorer / keeper / carded
  caption: string;                     // ticker text ("Counter! Saved low to his left")
  scoreAfter?: { home: number; away: number };
}
```

**`ballPos` convention** (flag for sim UI): a single signed field-position drives
the horizontal bar; `momentum` is a separate smoothed pressure signal if they want
a SofaScore-style momentum graph too. **Decision Q11** confirms whether they want
one signal or two.

### 4.1 Determinism & multiplayer-readiness (worker-7 memo territory)

`simulateTimeline(homeXI, awayXI, homeTactics, awayTactics, seed)` is a **pure
function** — no `Date`/`Math.random`, all randomness through the seeded `rng`.
Playback stays `pure(timeline, elapsed)` in the sim UI. So a future server hands
every client the same `(timeline)` (or `(seed, tactics)` to replay) + a start
timestamp, and all screens stay in lockstep. Nothing here blocks multiplayer.

### 4.2 Fast headless path (battle-royale pacing)

A round = 3 matches × 32 managers ≈ **48 matches/round headless**. Solution: **one
generator, two emitters.**

- `simulateScore(...)` and `simulateTimeline(...)` call the **same core loop with
  the same rng draw sequence**; the score path passes a no-op emitter that only
  tallies goals (no frame/event allocation). **Guarantee: identical seed ⇒
  identical scoreline on both paths** (a determinism test locks this).
- The table computes all 48 scores via `simulateScore`; **full timelines are
  generated lazily, only for the match(es) actually watched.** "Lazy" = we don't
  *store* 48 timelines, not that watched results differ from the table. This
  resolves the brief's speed-vs-timeline tension without a second engine.

### 4.3 Tier A timeline synthesis (so the sim UI is unblocked *now*)

Tier A has no real chain, but the sim UI still needs frames. Deterministically
distribute the Poisson goals across minutes, and drive `ballPos`/`momentum` from a
seeded random walk **biased by the live xG ratio** (stronger/attacking side spends
more time in the opponent's third). It's cosmetic but consistent, deterministic,
and reads correctly at a glance — and it's replaced 1-for-1 by the real chain in
Tier B behind the same `MatchTimeline` interface.

---

## 5. Tier A vs Tier B split

### Tier A — shippable by Saturday night (small, safe, demo-visible)
- 12-position zonal strength front-end + position-affinity matrix (§3.1–3.2),
  behind the existing strength interface.
- Tactics that matter: **Formation + Style + one extra lever** (recommend
  **Line height** — most legible on a pitch view), wired into a closed-form xG.
- **Dixon–Coles low-score correction** so the draw rate lands ~24%.
- `MatchTimeline` emitted (synthesised frames, §4.3) so codex-ui has real data.
- Box score panel (GK/DEF/MID/ATT/OVERALL + xG) — the "deserved" story.
- Balance harness (§6) proving §1a targets; determinism + fast-path tests.
- **Migration:** engine v2 behind a flag / adapter so `main`'s 54 tests stay green
  (coordinate with worker-7's sequencing); today's 4-position data keeps working
  via an affinity-matrix fallback until player-DB v2 lands.

### Tier B — post-hackathon (the full vision, done right)
- Real **zonal Markov possession chain** as the single source of truth (timeline is
  the simulation, not synthesised).
- Full lever set: pressing, tempo/directness, man-mark-a-star, halftime re-tactic.
- Formation-matchup matrix (central overload, width vs. back-3) as first-class terms.
- Cards, momentum swings, stamina/substitutions, penalty shootouts for knockout draws.
- Full calibration sweep + regression fixtures on scoreline distribution.

---

## 6. Test / balance plan hooks

- **Determinism:** same `(XIs, tactics, seed)` ⇒ identical `MatchTimeline`;
  `simulateScore` ≡ `simulateTimeline().finalScore` on the same seed.
- **Monotonicity:** strictly stronger XI wins ≥ X% over N seeds (X = Decision Q2);
  every tactic lever moves win-prob in the expected direction (attacking raises both
  teams' xG; high press raises turnovers won *and* counters conceded).
- **Balance harness** (`npm run balance`, headless, ~10k matches): reports
  goals/game, draw rate, scoreline histogram, favourite-win-rate by strength gap —
  **gated against §1a targets** (2.6–2.9 g/g, 22–27% draws). This *is* the
  technical-complexity evidence; hand to qa-balance (test-hardening) as the harness
  they extend.
- **Fixtures:** golden `MatchTimeline` snapshots for a few seeds so UI + engine
  can't silently drift.

---

## 7. Dependencies on other workstreams

- **worker-7 (CONTRACT.md):** owns final `Position`(12), affinity-matrix *shape*,
  `Formation`, `Tactics`, `PlayerV2`, `MatchTimeline`. I've stated assumptions
  above; reconcile there. Engine is the **producer** of `ZoneStrength` + `MatchTimeline`.
- **codex-ui (sim):** **consumer** of `MatchTimeline`. Agree `ballPos`/`momentum`
  signal count (Q11) and virtual-minute → wall-clock mapping (they own duration).
- **worker-6 (player DB):** supplies `PlayerV2` ratings on a **consistent scale**
  (the Gabriel-85-vs-Messi-90 problem). Engine calibration (§3.5) assumes ratings
  are comparable across nations/years; if the rating scale changes, re-run the
  balance sweep.
- **bug-hunt (draft):** `pickValue` in the draft must read from the **same**
  affinity matrix + zonal weights, or bots will draft against a different model
  than the engine rewards. Single source of truth for §3.1–3.2.

---

## 8. Decision questionnaire for Lucca (16 questions)

Answer inline; each has my recommended default in **bold**. These set the *feel* of
the whole game.

**Result determinants**
1. **How much should a 10-point team-strength (zonal) gap be worth?** Rec: **+0.55
   xG to the stronger side** (≈ 60% win / 22% draw / 18% loss in that matchup). Bigger = more
   deterministic/"deserved"; smaller = more chaos. Your number: ____
2. **Floor on upsets: minimum win-% a clearly weaker team should keep in a lopsided
   matchup?** Rec: **~12–15%** (never 0 — a shock has to be possible). ____
3. **How punishing should off-position play be?** Rec: keep the §3.2 matrix
   (same-flank ~0.8, cross-role ~0.4). Harsher (spine matters more) / softer? ____
4. **Should a *bad tactical matchup* ever beat *better players*?** Rec: **yes, but
   bounded** — tactics can swing ~one tier (a great 3-5-2 beats a slightly better
   4-4-2), never overturn a huge talent gap. Agree the cap? ____

**Scoring shape**
5. **Target goals/game?** Rec: **2.7** (WC-flavoured; §1a). Higher = more spectacle,
   lower = more tension. ____
6. **Target draw rate?** Rec: **~24%** via Dixon–Coles ρ = −0.05. Want fewer draws
   (more decisive BR cuts) — say ~18%? ____
7. **Max realistic blowout?** Rec: cap sampled goals so 7-8+ is rare-but-possible
   (the "38-0"/"7a0" fantasy). Hard cap or soft tail? ____
8. **Penalty shootouts** to break a dead-level knockout tie, or just tiebreak on the
   box score / xG? Rec: **shootout in Tier B** (drama), box-score tiebreak in Tier A. ____

**Tactics**
9. **Which extra lever ships in Tier A** (beyond Formation + Style)? Rec: **Line
   height** (most visible on the pitch meter). Or Pressing? Tempo? ____
10. **Halftime re-tactic (38-0 style):** allow one tactic change at halftime in the
    watched match? Rec: **yes, Tier A if cheap** — great interactivity beat. ____
11. **Momentum meter: one signal or two?** Rec: **one `ballPos`** for the bar in
    Tier A; add a separate smoothed `momentum` in Tier B. (Confirms sim-UI contract.) ____
12. **Man-marking a star** — worth building at all, or cut? Rec: **Tier B only.** ____

**Ratings & chemistry**
13. **Keep chemistry?** Rec: **yes**, reframed as a MID/ATT cohesion multiplier
    (max +8%) instead of a flat pair bonus. Keep / cut / change magnitude? ____
14. **Keep star power?** Rec: **yes**, as an attack-zone shot-quality bonus (not a
    flat team bonus). Agree the relocation? ____
15. **Star threshold + how big a difference stars make?** Current ≥88 = star. With
    the DB rescale (Messi 90+), what's a "star" and how much should one swing a
    match? ____

**Scope**
16. **Ship Tier A (closed-form Poisson + synthesised timeline) for the demo, real
    Markov chain post-hackathon?** Rec: **yes** — same interface, honest split, keeps
    `main` green for Sunday. Or push for the real chain this weekend (higher risk)? ____

---

[s1]: https://www.statista.com/statistics/269031/goals-scored-per-game-at-the-fifa-world-cup-since-1930/
[s2]: https://news.northeastern.edu/2026/06/28/world-cup-group-stage-standings/
[s3]: https://www.footballhistory.org/world-cup/statistics.html
[s4]: https://footystats.org/stats/common-score
[s5]: https://statsultra.com/the-most-common-scores-in-the-premier-league/
[s6]: https://www.goal.com/en-gb/news/how-often-do-premier-league-favourites-win-match-betting-odds-versus-results-reality/1lmxcehug0l5312h12tznb4mj9
[s7]: https://www.olbg.com/blogs/football-world-cup-favourite-statistics
[s8]: https://7a0.app/
[s9]: https://seteazero.wiki/
[s10]: https://38-0-game.com/
[s11]: https://www.hitc.com/footballs-wordle-how-to-play-the-viral-soccer-game-that-is-all-over-social-media/
[s12]: https://statsultra.com/dixon-coles-model/
[s13]: https://dashee87.github.io/football/python/predicting-football-results-with-statistical-modelling-dixon-coles-and-time-weighting/
[s14]: https://pena.lt/y/2021/06/24/predicting-football-results-using-python-and-dixon-and-coles/
[s15]: https://blogarchive.statsbomb.com/articles/soccer/attacking-contributions-markov-models-for-football/
[s16]: https://medium.com/after-the-full-time-whistle/explaining-expected-threat-xt-in-football-analytics-using-markov-models-its-history-part-i-20d4d31e2ea9
[s17]: https://www.soccertutor.com/blogs/inside-football-coaching/3-5-2-vs-4-3-3
[s18]: https://en.wikipedia.org/wiki/Formation_(association_football)
