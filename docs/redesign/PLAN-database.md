# PLAN — Player Database v2 (owner: worker-6)

Research + plan only. No `src/` changes. Sample data: `docs/redesign/samples/brazil-2002.json`.

Structure: **Findings → Schema v2 → Ratings rubric → Coverage plan → Sample →
Steal-pool → Licensing → Tier A/B split → Open decisions → Dependencies.**

---

## 1. Findings

### 1.1 How 7a0 and 38-0 structure their data (verified, sourced)

**7a0 / Sete a Zero** (Brazilian World Cup spin-to-draft — the direct inspiration):
- **52 national teams · 250 historical squads (nation-year) · 5,729 players.** World
  Cups **only, 1950 → 2026**. No Euros, no clubs. (Verifies Lucca's "250+/5,700+"
  figure. A clone at 7a0.app scrapes lower numbers — ignore it.)
- **Squad size = 11.** 7a0 stores only a starting XI per nation-year, not a bench.
  You draft one player per position slot. **This is the key gap we exploit** (see §6).
- **Ratings: visible 0–100** (top ~99), shown in *Classic* mode. **Era basis is
  contested**: developer-adjacent coverage says each player is rated "on their
  performance during that specific tournament" (per-tournament snapshot — the
  strong signal); a fan SEO wiki asserts a single absolute cross-era tier list
  (Pelé 1970 = 99). We resolve this deliberately in §3.
- **Positions: 9 granular slots** (GOL/GK, LD/RB, ZAG/CB, LE/LB, CM, PD/right wing,
  PE/left wing, CA/striker) mapped by formation — more granular than our current 4.
- **Modes:** *Classic* (ratings shown) vs *Almanaque / "From Memory"* (ratings
  hidden — memory test). 8 formations. Sims 3 group + 4 knockout = "7-0" if unbeaten.
- Sources: seteazero.com/en, gkpb.com.br/192295/7a0, worldsoccertalk.com,
  omelete.com.br, 7a0.app/pt, seteazero.wiki.

**38-0** (deterministic *club-season* sim — the engine-philosophy inspiration):
- **250+ clubs · 8 leagues · 70,000+ player-seasons.** Club teams only, **1992–2026**.
  Keyed by **(club, season)**, not nation-year. Also an 11-slot XI draft.
- **Dual rating per player: a season rating AND a career-peak rating** — the user
  can draft by either framing. Worth stealing as an idea (§3.5, open decision Q9).
- **Multi-position eligibility** on every player (no single fixed slot). Deterministic
  engine, no RNG. Tactics: one swap pre-kickoff + one at half. Era filters
  (All-time / 2000s / 2010s / modern). **Text-only names, no crests/photos, explicit
  "unofficial & unaffiliated" disclaimer.**
- Sources: 380football.com, App Store id6777858624.

**Design contrasts that shaped this plan:**
1. Both competitors draft only an **11-man XI**. Our BR wants to *steal full squads*
   of eliminated managers — so we must store **16–23 per squad**, deeper than either
   competitor. Squad depth is a feature here, not incidental.
2. 7a0's rating is one snapshot per tournament-instance → validates our
   **per-(nation,year) rating** requirement (Messi 2014 ≠ Messi 2026).
3. 38-0's dual season/peak rating is a richer model — offered to Lucca, not assumed.
4. Both are more granular on positions than our current 4 → validates the 12-position move.

### 1.2 Current shape (what we migrate from)

`src/engine/data/squads.json`: 12 nations × 12 players, `pos` ∈ {GK,DF,MF,FW},
flat `rating` ~76–94, id = `bra-alisson`. Ratings compressed into an 18-pt band and
era-blind — exactly Lucca's complaint (Gabriel Magalhães 85 vs Messi 90). No year key.

---

## 2. Schema v2 (TypeScript types + JSON example)

**ASSUMPTION for worker-7 / CONTRACT.md** — I state the shapes below explicitly.
Worker-7 owns final reconciliation of `Position`/affinity; I own `PlayerV2` / `SquadEntry`.

```ts
// 12 detailed positions (replaces coarse 'GK'|'DF'|'MF'|'FW')
export type Position =
  | 'GK'
  | 'RB' | 'CB' | 'LB'                 // defense
  | 'CDM' | 'CM' | 'CAM'              // central midfield
  | 'RM'  | 'LM'                       // wide midfield
  | 'LW'  | 'RW'  | 'ST';             // attack

// Coarse zone kept ONLY as a rollup for back-compat + engine zonal sums.
export type Zone = 'GK' | 'DEF' | 'MID' | 'ATT';

export interface PlayerV2 {
  id: string;            // globally unique — `${nation}-${year}-${slug}`, e.g. 'bra-2002-ronaldo'
  name: string;          // display name, e.g. 'Ronaldo'
  pos: Position;         // primary detailed position (required)
  altPos?: Position[];   // 0–2 secondary positions this player genuinely plays (optional)
  rating: number;        // 1–99, this player AT this tournament (see §3)
  fullName?: string;     // flavor for player cards (Tier B)
  club?: string;         // club at the time (Tier B flavor)
  shirt?: number;        // squad number (Tier B flavor)
}

export interface SquadEntry {
  nation: string;        // 3-letter code, 'BRA'
  name: string;          // 'Brazil'
  year: number;          // 2002  → keyed by (nation, year)
  players: PlayerV2[];   // 16–23 (see §4 target)
  result?: string;       // 'Winners' | 'Runners-up' | ... (flavor)
  notes?: string;        // flavor
}

export interface SquadsFileV2 {
  version: 2;
  squads: SquadEntry[];  // flat list; index by (nation,year) at load
}
```

**ID scheme (answers brief's "propose the ID scheme"):**
`${nationLower}-${year}-${slug}` → `bra-2002-ronaldo`, `arg-1986-maradona`.
- Guarantees uniqueness across (nation, year) by construction.
- The same real player in two tournaments gets **two distinct IDs** (`bra-1998-ronaldo`
  vs `bra-2002-ronaldo`) — correct: they are different rating snapshots, and the
  existing "same player may appear on two managers' teams" rule already tolerates it.
- Slug = ASCII-folded last/common name, hand-disambiguated on collision
  (`bra-2002-ronaldo` vs `bra-2002-ronaldinho`).

**Secondary positions — recommendation: YES, lightweight.** `altPos` is OPTIONAL and
only set for genuinely versatile players (Edmílson CB/CDM, Rivaldo CAM/LW/ST). Semantics:
positions in `altPos` are treated as **natural (affinity 1.0)** for that player; every
other slot falls back to the global position-affinity matrix (worker-7/engine owns the
matrix values). This avoids assigning secondaries to all ~5,700 players while still
modelling real versatility, and it gives the new free-pick draft (bug-hunt's stream)
richer legal-slot options. *Alternative if Lucca prefers zero per-player position data:
drop `altPos` and rely solely on the affinity matrix — simpler data, less individual
nuance. → Open decision Q7.*

**DetailedPosition → Zone rollup** (used by the back-compat adapter and any zonal sum):

| Zone | Positions |
|---|---|
| GK  | GK |
| DEF | RB, CB, LB |
| MID | CDM, CM, CAM, RM, LM |
| ATT | LW, RW, ST |

---

## 3. Ratings rubric

### 3.1 The core decision: ABSOLUTE, cross-era, quality-not-athleticism

**Recommendation: one absolute 1–99 scale across all eras**, where a rating measures
*football quality / dominance in context* — NOT modern athleticism. Justification:

- **The engine mixes eras on one pitch.** A manager can field Brazil 1970 next to
  France 2026, and steal-pool players cross years freely. If ratings were era-relative,
  a 1970 "90" and a 2026 "90" would be treated as equal strength by the match engine
  when they are not comparable. **Cross-era play forces a single absolute scale.**
- **But absolute ≠ "old players are athletically worse, downgrade them."** We rate
  quality/dominance, so **prime Pelé sits at the ceiling (97).** This keeps legends
  legendary, matches genre convention (FIFA/7a0), and avoids the feel-bad of "your
  heroes are trash." It's a game; fun > sports science.
- **Per-tournament snapshot within that absolute scale.** The number is the player
  AT that tournament: Messi 2014 = 96, Messi 2026 = 92; Ronaldo 2002 = 96,
  Ronaldo 2006 ≈ 88. This directly satisfies the brief and mirrors 7a0.
  *(Exact anchor values are Lucca's, per §3.2/§3.3 and DECISIONS.md.)*

*(7a0's own basis is contested per §1.1; 38-0 offers both a season and a peak number.
Our snapshot rating IS effectively the "season" number; a career-peak field is an
optional add — Q9.)*

### 3.2 Fixing Lucca's compression complaint — RE-ANCHORED per DECISIONS.md

> **Superseded (2026-07-11).** My first draft read Lucca's complaint as "decompress
> downward" and put Magalhães at 83 on a 70–99 band. **Lucca corrected this:** the
> complaint was that Magalhães was rated TOO LOW — so the scale is **tighter at the top
> (97 ceiling, not 99), defender-friendly, and higher-floored.** Very good starters on
> top teams live in the **high 80s**, not the low 80s. This section + §3.3 are rebuilt
> around his five fixed points; the implemented data (`squads-v2.json`) uses these.

Five fixed anchors (binding):

| Anchor | Rating |
|---|---|
| **Pelé 1970** | **97** — the ceiling; nobody higher, ever |
| **Maradona 1986 · Messi 2014 · Ronaldo R9 2002** | **96** — inner-circle GOAT peak |
| **Messi 2026** | **92** — veteran snapshot (−4 from his 2014 self) |
| **Gabriel Magalhães 2026** | **89–90** — "an 89-90 kind of player"; very good starter |

The move vs my first draft: **raise the floor** (WC squad players sit ~78–90, not 74–88),
**lower the ceiling** (97 not 99, and only Pelé), and **do not punish defenders** — an
elite CB/GK lives in the high 80s / low 90s right alongside elite attackers. Prime vs
veteran still separates by year (Messi 2014 = 96, Messi 2026 = 92; R9 2002 = 96).

### 3.3 Anchor ladder (what each band MEANS) — rebuilt around the five points

| Band | Meaning | Example anchors (per-tournament) |
|---|---|---|
| **97** | The single greatest peak, ever. Unique — reserved for Pelé 1970. | Pelé 1970 |
| **96** | Inner-circle GOAT peak; one player carrying a title run. | Maradona 1986, Messi 2014, Ronaldo R9 2002 |
| **95** | All-time-great peak. | Zidane 1998, Cruyff 1974, Romário 1994 |
| **93–94** | Era-topping superstar / the best current player. | Mbappé 2026 (93), Rivaldo 2002 (93), Baggio 1994 (93) |
| **90–92** | World-class; the talisman of a top contender. | Messi 2026, Rodri/Yamal 2026 (92), Cafu 2002 & Roberto Carlos 2002 (91), Jairzinho 1970 (91), Bellingham/Kane 2026 (91), Vinícius 2026 (92) |
| **88–90** | **Very good international starter** (Lucca's Magalhães band). | Gabriel Magalhães 2026 (89), Marquinhos/Rúben Dias/van Dijk 2026 (89), Lúcio 2002 (89), Gérson/Tostão 1970 (89), Marcos 2002 (88) |
| **85–87** | Solid, dependable starter on a good national team. | Gilberto Silva 2002 (86), Edmílson 2002 (85), Valdano 1986 (87), Ruggeri 1986 (85) |
| **82–84** | Squad regular / weaker-nation starter. | Kléberson 2002 (83), Endrick 2026 (84), Batista 1986 (83) |
| **79–81** | Rotation / backup / minnow starter. | Kaká-2002 (81, a teen squad kid), Polga 2002 (80), Almirón 1986 (79) |
| **≤78** | Deep bench, 3rd-choice keeper, fringe depth. | Ado 1970 (78), Zelada 1986 (77) |

**15 named cross-era anchors** (the rubric's calibration spine, implemented in data):

| Player @ tournament | Rating | Why |
|---|---|---|
| Pelé 1970 | **97** | The ceiling. Reserved for him alone. |
| Maradona 1986 | **96** | Carried a nation single-handed — the tournament. |
| Ronaldo (R9) 2002 | **96** | 8 goals, Golden Boot, redemption — peak phenomenon. |
| Messi 2014 | **96** | Golden Ball, dragged a modest side to the final. *(not in v1 data)* |
| Zidane 1998 | 95 | Final MOTM, tournament-defining. *(not in v1 data)* |
| Rivaldo 2002 | 93 | Reigning-elite, carried Brazil through the group stage. |
| Mbappé 2026 | 93 | Era-topping output — the best current player. |
| Messi 2026 | **92** | Same man, veteran snapshot — −4 from his 2014 self. |
| Vinícius 2026 | 92 | Best player on the 2026 favourites. |
| Cafu 2002 | 91 | Best RB in the world at his peak (captain). |
| Jairzinho 1970 | 91 | Scored in every match of the tournament. |
| Gabriel Magalhães 2026 | **89** | **The calibration complaint, re-anchored — very good starter.** |
| Gérson 1970 | 89 | The midfield general of the greatest team ever. |
| Gilberto Silva 2002 | 86 | Reliable holding mid on champions = mid-80s. |
| Kaká 2002 | 81 | Snapshot principle — a teen squad kid, ≠ his 2007 peak. |

### 3.4 Rating principles (the rules a data author follows)

1. **Absolute, cross-era, quality-not-athleticism** (§3.1).
2. **Per-tournament snapshot** — rate the player that summer, not his career.
3. **Tight-top, high-floor band ~77–97** — most WC squad players 80–90; 91+ is the
   talisman of a top team; 96 is inner-circle GOAT; 97 is Pelé alone. (Lucca's
   correction: the OLD 70–99 draft over-punished good defenders — floor raised, ceiling
   lowered.)
4. **Within-position excellence.** An 88 GK and an 88 ST are each "world-class for
   their position." The raw number is position-fair; the ENGINE's zonal model (not the
   number) ensures GKs don't score. *(Note for hackathon-builder/worker-7.)*
5. **Resist anti-defender/keeper bias** (the core of Lucca's complaint). Elite CBs
   (Marquinhos, van Dijk, Rúben Dias, Magalhães) live 89–90; elite GKs (Courtois,
   Alisson) reach ~90. Do not cap defenders below attackers on principle.
6. **Role realism.** The team's talisman carries the highest number; depth pieces sit
   79–83 even on great teams (a champion's 20th man is still squad-level).

### 3.5 Optional: dual rating (from 38-0)

We *could* store `peakRating` alongside the snapshot `rating` and let a future mode draft
by peak. **Recommendation: NOT for v1** — it doubles the calibration work and the
snapshot already gives Lucca what he asked for. Flag as Tier B / Q9.

---

## 4. Coverage plan (which nation-years, priority order)

Target framing: **fun spread of eras** (so the rubric's legends actually appear) over
raw completeness. Squad size **16–18 standard** (deep enough for a meaningful steal
pool; the sample ships full 23 as a reference — see §5).

**Priority tiers (each row = one buildable batch, verify-as-you-go):**

| # | Batch | Squads | Why first |
|---|---|---|---|
| P0 | **2026 (migrate current 12 nations)** | 12 | Keeps the game working; re-rated + re-positioned to 12 slots, bumped to ~16. |
| P1 | **Marquee "hero" squads** — Brazil 2002, Brazil 1970, Argentina 1986 | 3 | The year-roll demo needs instantly-recognisable wow squads (3R, Pelé, Maradona). |
| P2 | **1998 France, 2014 Germany, 2010 Spain** | 3 | Winners with iconic identities; spread eras for the rubric. |
| P3 | **1974 Netherlands, 1994 Brazil, 2022 Argentina** | 3 | Cruyff, Romário, Messi's last dance. |
| P4 | **Fill contemporaries of hero years** (e.g. Germany/Italy 2006, France 2018) | ~6 | Gives each hero squad an era-mate to be drafted against. |

**v1 realistic target: ~20–24 squads across ~8 tournament years (~350–420 players).**
This is *far* below 7a0's 250/5,700 and that is deliberate: we need enough variety for the
year-roll to feel alive, not a complete archive. **Growth path:** batch toward
~40 squads (Tier B), then long-tail toward 7a0-scale post-hackathon, always
model-generated then web-verified per squad.

**Nation set:** keep the current 12 (BRA, ARG, FRA, ENG, ESP, GER, POR, NED, BEL, CRO,
MAR, JPN) as the 2026 spine; historical batches add whichever nations owned those years
(e.g. Italy for 1994/2006, West Germany for 1974) even if absent from 2026.

---

## 5. The sample squad — `samples/brazil-2002.json`

Brazil 2002 (Champions), full **23-man** roster in schema v2. Roster, shirt numbers, and
clubs **verified against Wikipedia** (2002 FIFA World Cup squads; Brazil at the 2002 FIFA
World Cup; Template:Brazil squad). Detailed 12-position codes are role-at-tournament
(Scolari's 3-5-2 / 3-4-1-2); ambiguous ones carry `altPos` (Edmílson CB/CDM, Rivaldo
CAM/LW/ST, Ronaldinho CAM/RW). Ratings are draft per-tournament snapshots on the §3 scale
— spanning **77 (Polga) → 97 (Ronaldo)**, demonstrating the decompressed band inside one
squad, and **Kaká 2002 = 78** demonstrating the snapshot principle (≠ his 2007 peak).

The sample ships full 23 as a **reference artifact**; production squads target 16–18 by
dropping the 3rd GK and deepest bench. Starting XI per the file: Marcos; Cafu, Lúcio,
Edmílson, Roque Júnior, Roberto Carlos; Gilberto Silva, Kléberson; Ronaldinho, Rivaldo;
Ronaldo.

---

## 6. Steal-pool expansion (data-shape implications)

Today the between-round steal pool = eliminated managers' fielded **XIs**. Brief wants it
to become the **full squads of eliminated managers' rolled teams**. Implications:

- In the new draft, each spin lands a **(nation, year)** squad; the manager keeps one
  player but "rolled" that whole squad. **Manager state must record the set of
  (nation,year) `SquadRef`s a manager rolled**, not just picked players. *(worker-7:
  `Manager.rolledSquads: {nation,year}[]`.)*
- On elimination, that manager contributes **every player in every squad they rolled**
  (up to ~11 squads × 16–23 ≈ 200 players) to the pool.
- **Pool build** = union of full rolled squads of everyone cut this round, **minus
  already-owned player ids**, **deduped by id**. Because ids are unique per (nation,year),
  the same real player from two years are two distinct, co-existing pool entries — fine.
- **Flag: pool size + perf.** A late round could dump thousands of entries. Recommend the
  pool be (a) scoped to *this round's* eliminations (not cumulative), (b) deduped by id,
  and (c) surfaced in the UI ranked by `pickValue` with search/filter — worker-7 + bug-hunt
  own the UI cap. Data layer just needs `squadByRef(nation, year)` to return the full list.
- This is *why our squads are 16–23 and 7a0's are 11* — the steal pool is the payoff for
  the extra depth.

---

## 7. Licensing (one paragraph)

Real footballers' names/likenesses are not freely licensed — image rights sit with
players/FIFPro/clubs, and EA/FIFA pay heavily for them. Both 7a0 and 38-0 operate in the
tolerated grey zone: **names-only text, no crests, no photos**, with an "unofficial &
unaffiliated" disclaimer (38-0 states this explicitly). For a non-commercial hackathon
demo the risk is low. PLAN.md already flags "real player licensing (post-hackathon
question)." **Recommendation:** ship names-only text ratings (as now) + a one-line
disclaimer; treat real-data licensing as a **pre-commercial gate** — if Last11 ever goes
public/commercial, either license, switch to altered/generated names, or stay strictly
names-only-text with zero logos/photos.

---

## 8. Tier A (Sat night) vs Tier B split

**Tier A — shippable by Saturday, demo-visible:**
- Schema v2 types + `SquadsFileV2` (version:2) landed behind worker-7's adapter.
- **Migrate the 12 current nations to 2026 squads** in v2 (12 detailed positions,
  re-rated on the §3 decompressed scale, ~16 players each).
- **3 hero historical squads** (Brazil 2002 ✓ done, Brazil 1970, Argentina 1986) so the
  year-roll demos with real wow squads.
- Back-compat adapter: v2 → coarse-4 projection (default year 2026) so the *current*
  engine/draft/tests keep passing until engine-v2 lands.
- Steal pool reads full rolled squads (data layer: `squadByRef`).

**Tier B — post-hackathon, full vision:**
- Fill to ~20–40 squads across ~8 tournament years (P2–P4).
- Optional `peakRating` dual-rating mode (§3.5).
- Player-card flavor fields populated (fullName/club/shirt) at scale.
- Long-tail toward 7a0-scale archive.

---

## 9. Open decisions for Lucca (he knows ball — calibrate these)

**Rubric philosophy:**
- **Q1.** Absolute cross-era scale where prime Pelé/Messi share the 97–99 ceiling and we
  rate *quality not athleticism* — agree? (The alternative, era-relative, breaks cross-era
  matches; I recommend absolute.)
- **Q2.** Is **99 reserved for Pelé 1970 alone** (Maradona 86 = 98), or may a few peaks
  hit 99?
- **Q3.** Decompressed band **~70–99** for World Cup squads (vs today's 76–94) — right
  width, or go even wider (e.g. minnows into the 60s)?

**Contested individual ratings (calibrate the anchors):**
- **Q4.** **Gabriel Magalhães 2026 = 83.** Too low / about right / too high?
- **Q5.** **Prime Messi 2014 = 97 vs current Messi 2026 = 90** — is a 7-point
  prime→veteran drop correct, too steep, or too shallow?
- **Q6.** **R9 Ronaldo 2002 = 97 vs Mbappé 2022 = 94 vs a would-be Haaland 2026** —
  where does modern-#9 peak sit relative to R9? (And should Haaland-2026 even be ~91–93?)
- **Q6b.** **Elite-defender ceiling: Cannavaro 2006 = 92.** Can a CB reach 94
  (Baresi/Maldini), or should defenders cap lower than attackers on principle?
- **Q6c.** **GK ceiling** — should a peak keeper (Yashin/Buffon/Neuer) reach ~92, or cap
  keepers around 88–90?

**Schema:**
- **Q7.** Secondary positions: keep lightweight `altPos` (recommended), or drop it and let
  the affinity matrix do all the work?
- **Q8.** **Standard squad size 16–18** (I recommend 18) — or field a leaner 14–16 / a
  fuller 23? (Bigger = richer steal pool but more ratings to calibrate.)
- **Q9.** Add 38-0-style **`peakRating`** now (draft-by-peak mode later), or defer to Tier B?
- **Q10.** Coverage: is the **P0–P3 era spread** (2026 + 2002/1970/1986/1998/2014/2010/
  1974/1994/2022) the right first ~20 squads, or are there must-have squads I'm missing
  (e.g. Spain 2010 vs 2008-Euro, France 2006, Italy 2006, Germany 2014 talismen)?

---

## 10. Dependencies on other workstreams

- **worker-7 (CONTRACT.md)** — owns final `Position` union + **position-affinity matrix**
  (I assume the 12-position union in §2 and `altPos = affinity 1.0`; matrix VALUES are
  engine's). Owns `Manager.rolledSquads` for the steal pool (§6) and the v2→coarse adapter
  sequencing. Owns whether engine-v2 ships behind a flag for the demo.
- **hackathon-builder (engine)** — consumes `pos`/`altPos`/`rating`; owns the DetailedPos→
  zonal-strength math and the within-position/anti-scoring rules (§3.4 note). My ratings
  are *inputs*; goal-scaling is theirs.
- **bug-hunt (draft UI)** — consumes squads-by-(nation,year) for the year-roll and the
  free-pick legal-slot logic (`altPos` widens legal slots). Needs `squadByRef(nation,year)`.
- **test-hardening (QA)** — the decompressed ratings shift balance numbers (current
  headless medians assume the 76–94 band); rating recalibration will move the curve and
  the 54 existing tests' fixtures. Coordinate re-baselining.

**Assumptions stated for reconciliation (worker-7):** 12-position `Position` union (§2);
id scheme `${nation}-${year}-${slug}` (§2); `altPos` = natural/affinity-1.0 positions (§2);
`SquadEntry` keyed by (nation,year), 16–23 players (§2/§4); steal pool = deduped union of
eliminated managers' full rolled squads minus owned (§6).
