# PLAN — Match Sim / On-Screen Playback

**Owner:** codex-ui · **Phase:** R (research + plan only, no `src/` edits) · 2026-07-11

Consumes the engine's timeline; renders the watchable match. This plan is written
against the current code (`BattleScreen.tsx`, `game/state.ts`, `App.tsx`) and the
sibling briefs. Where I need a shared type I state the **ASSUMPTION** explicitly for
worker-7's `CONTRACT.md` to ratify — I do not silently invent conflicting shapes.

---

## 1. Findings (research)

### 1a. Prior art — how the genre presents a match

- **38-0** plays a **live 90′ match over two halves**, with one tactical swap before
  kick-off and another at half-time, on a **2D match engine with live commentary**,
  and markets a **deterministic** engine — "every result is earned, never random."
  This is almost exactly our target: fixed-duration, watchable, deterministic. Our
  differentiator is the **battle-royale rail** (many managers at once), which 38-0
  and 7a0 lack.
  ([App Store](https://apps.apple.com/us/app/38-0-soccer-sim/id6777858624),
  [380football.com](https://www.380football.com/))
- **7a0** reveals results as a **per-position attack/defense box score** after a
  simulate step — a static reveal, not a live playback. We keep that "deserved
  result" reveal energy but move the drama to **after** a short live playback (the
  brief's instruction, and it preserves BattleScreen's table-cascade).

### 1b. The momentum meter — what reads at a glance

- **SofaScore "Attack Momentum"** is the reference: a horizontal **per-minute bar
  graph**, one bar per minute, each bar a single value combining a team's most
  threatening attacking situations, showing **who dominated that period**; it updates
  **minute-by-minute** and lets a viewer grasp control "at a glance."
  ([SofaScore](https://www.sofascore.com/news/how-live-attack-momentum-works-at-the-world-cup),
  [analysis](https://www.sofascore.com/news/how-sofascores-attack-momentum-changed-sport-analysis))
- **Design lift:** a symmetric horizontal track — momentum toward **you** fills from
  the centre **leftward (emerald)**, toward the opponent **rightward (rose)**. Height
  ≈ pressure magnitude. Directly maps to the engine's per-minute `pressure ∈ [-1,+1]`.
- **Football Manager 2D** view is prized for **tactical readability** — "dots in
  structured lines," calm, easy to read over long sessions. Takeaway for us: **do not
  attempt 22 moving dots.** A single ball marker on a momentum track reads better at
  our scale and is cheap, deterministic, and mobile-legible.
  ([FM blog](https://www.footballmanagerblog.org/2025/12/fm26-2d-camera-vs-3d-nostalgia-tactics.html))

### 1c. Animation approach — CSS vs requestAnimationFrame

The multiplayer requirement (playback = pure function of `(timeline, elapsedMs)`,
no incremental local randomness) **dictates the architecture**, and it happens to be
the cleanest approach anyway:

- **One `requestAnimationFrame` loop** derives `elapsedMs = now − startTs` and calls a
  **pure `render(timeline, elapsedMs)`**. Time-based (not frame-based) so it's
  identical on 60 Hz and 120 Hz screens and survives a dropped frame.
  ([MDN rAF](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame),
  [CSS-Tricks rAF+hooks](https://css-tricks.com/using-requestanimationframe-with-react-hooks/))
- **CSS handles the discrete flourishes only** — goal flash `@keyframes`, the
  table-row cascade we already ship, chip transitions. No CSS animation is ever the
  source of truth for match *state*; state is always recomputed from `elapsedMs`.
- **Verdict:** rAF clock + pure render + CSS for celebrations. No new dependency
  (no GSAP/Framer). This is a strong case to add nothing to the Tailwind stack.

### 1d. Current-code constraints I must honour

- `App.tsx` already keeps the **rng in a ref**, consumed only in handlers; the reducer
  is pure. My playback clock follows the same pattern (a ref-held clock, never in the
  reducer) — so it stays StrictMode-safe and serialization-friendly.
- `animate={false}` must keep tests synchronous. The **headless instant path** is
  non-negotiable: with `animate=false`, playback is **skipped entirely** — the reducer
  jumps `intro → results` with zero timers, exactly as today.
- `BattleScreen`'s intro + results table + trash-talk all stay; I **insert** a playback
  view between them, I don't replace them.

---

## 2. Assumed timeline schema (for CONTRACT.md — engine owns the values)

The engine (hackathon-builder) produces this; I consume it. **ASSUMPTION** — flagged
for worker-7. Deterministic given `(homeXi, awayXi, tactics, seed)`.

```ts
// Coordinates: ballX 0 = YOUR goal line, 1 = opponent goal line. pressure > 0 = you.
export interface MomentumTick {
  minute: number;        // 0..90 integer, one sample per virtual minute (91 total)
  pressure: number;      // -1..+1  signed momentum: + toward home, - toward away
  ballX: number;         // 0..1    field position of the ball this minute
  possession: 'home' | 'away';
}

export type TimelineEventType =
  | 'kickoff' | 'chance' | 'shot' | 'save' | 'goal'
  | 'halftime' | 'fulltime' | 'card' | 'counter';

export interface TimelineEvent {
  minute: number;                 // 0..90
  type: TimelineEventType;
  team: 'home' | 'away' | null;   // null for kickoff/halftime/fulltime
  text: string;                   // ready-to-render ticker caption (engine writes copy)
  scoreAfter?: { home: number; away: number }; // REQUIRED on 'goal'
}

export interface MatchTimeline {
  matchId: string;
  homeId: string; awayId: string;
  finalScore: { home: number; away: number };
  durationMinutes: number;        // 90
  ticks: MomentumTick[];          // length durationMinutes + 1
  events: TimelineEvent[];        // sorted ascending by minute
}
```

> **Reconciliation note (CONTRACT.md landed mid-phase).** Worker-7's `CONTRACT.md §4`
> already defines an aligned shape — same pure `(timeline, elapsedMs)` contract, lazy
> generation for watched matches, 90 virtual min, `ticks` length = duration+1,
> minute-sorted events, table reveal *after* playback. Only names differ; adopt
> worker-7's as canonical: my `MomentumTick`→`TimelineTick`, `ballX`→`ballPosition`,
> `buildMatchTimeline`→`simulateMatchTimeline`, `projectMatch`/`MatchView`→
> `RenderPlayback`/`PlaybackState`. My `celebrating`/`ticker[]` map onto their
> `activeEvent` (I additionally keep a last-3 ticker window and a celebration-window
> flag — both pure-derived from `elapsedMs`, no schema change needed). No conflict.

Two consumption tiers to keep the BR fast (matches the engine brief's "lazy/on-demand
timeline for watched matches only"):

- **Full `MatchTimeline`** — generated **only for watched matches** (your ≤3, plus any
  marquee opened on demand). **ASSUMPTION:** engine exposes
  `buildMatchTimeline(home, away, tactics, seed): MatchTimeline`, callable on demand.
- **Lightweight goal stamps** for the ~45 other matches, so the scoreboard rail can
  tick without full momentum arrays. **ASSUMPTION:** each `MatchResult` gains
  `goals: { minute: number; team: 'home'|'away' }[]` (cheap; the engine already knows
  final goals — it just needs to stamp minutes). If the engine can't cheaply stamp
  them, fallback: distribute final goals across 90′ via the same seeded rng — but I'd
  rather the engine own it. **← open decision Q7.**

> Naming note for worker-7: `home`/`away` here are **per-match roles**, not the human.
> The UI maps "you" onto whichever role the human holds.

---

## 3. Screen flow

The round becomes a **matchday** with four beats. Today's flow is `intro → results`;
the new flow inserts playback + the rail in the middle.

```
┌── ROUND INTRO ────────────────────────────────────────────────┐
│ existing RoundIntro: "N will fall", your rank/strength,        │
│ trash-talk.  Button: PLAY ROUND ▶                              │  (unchanged)
└───────────────────────────────┬───────────────────────────────┘
                                 ▼
┌── MATCH PLAYBACK (new) ───────────────────────────────────────┐
│ Your 3 matches play out, one at a time, ~45s each.            │
│  • scoreboard (you vs opp, live clock)                        │
│  • momentum meter + ball marker (per-minute ticks)            │
│  • event ticker (chance/save/GOAL captions)                   │
│  • goal → flash + score bump + ball reset to centre           │
│  • other-managers rail ticking live underneath                │
│  • controls: 1× / 2× / skip   (solo only)                     │
│ After match 1 → auto-advance to match 2 → 3 (or "skip all").  │
└───────────────────────────────┬───────────────────────────────┘
                                 ▼
┌── ROUND RESULTS (existing, moved to AFTER) ───────────────────┐
│ existing RoundResults: your-matches recap + full table with   │
│ the row cascade + bottom-N elimination line.  → CONTINUE      │  (unchanged drama)
└───────────────────────────────┬───────────────────────────────┘
                                 ▼
        steal window  ·OR·  next round intro  ·OR·  end screen   (unchanged)
```

**What's watched vs summarized (BR at 32 managers × 3 matches ≈ 48 matches/round):**

- **Watched fully:** YOUR 3 matches (the featured card). ~45s each ⇒ ~135s of
  playback per round at 1×, and skippable.
- **Summarized live:** every other match on the **scoreboard rail** — a compact grid
  of `Home v Away  1–0` cells whose scores tick up at their goal minutes, driven by
  the **same clock** as your featured match (so the rail and your match agree on the
  virtual minute).
- **On demand:** 1–2 **marquee** bot matches (e.g. the top-2 seeds by strength, or the
  two managers on your elimination bubble) are tappable → swaps them into the featured
  card and plays their full timeline (built lazily on tap). **← open decision Q5.**

---

## 4. Wireframe

Self-contained, **runnable** mock at `docs/redesign/samples/match-playback.html`
(open in a browser — it animates a hard-coded demo timeline through the exact
`pure(timeline, elapsedMs)` contract). ASCII summary:

```
 Last11 · MATCHDAY · R2                              16 managers alive
 ┌───────────────────────────────────────────────────────────────┐
 │ [YOU]                          2 – 1                José Moan…  │
 │ You                             84'                 5-4-1 def   │
 │ 4-3-3 att                                                      │
 └───────────────────────────────────────────────────────────────┘
  ◀ You attacking        ball position & momentum     Moan… ▶
 ┌───────────────────────────────────────────────────────────────┐
 │▓▓▓▓▓▓▓▓▓░░░░░░░│░░░░░░░░░░░░░░░░           ● ← ball        │   │  momentum track
 └───────────────────────────────────────────────────────────────┘
 ┌───────────────────────────────────────────────────────────────┐
 │ 71' Big chance! Header rattles the bar.                        │  event ticker
 │ 84' GOAL! Late header wins it — the arena erupts!             │  (last ~3)
 └───────────────────────────────────────────────────────────────┘
              [ 1× ]  [ 2× ]  [ skip ▸▸ ]        (solo-only)

  Elsewhere this round · tap a marquee to watch
  ┌ Pep v Xavi   2–1 ▸watch ┐ ┌ Klopp v Zizou 0–1 ▸watch ┐
  ┌ Anceloco v Sime  2–0    ┐ ┌ Tuchill v Haggle  0–0    ┐  …
```

Momentum encoding: fill grows from centre — **leftward emerald** when momentum is
toward you, **rightward rose** toward the opponent; the white **ball** rides `ballX`
(your goal line ↔ their goal line) and **snaps to centre during a goal celebration**.

---

## 5. Component + state-machine change list

### 5a. `game/state.ts`

- Extend `BattleView`: `'intro' | 'playback' | 'results'` (add `'playback'`).
- `GameState` gains an optional **matchday** describing what to play:
  ```ts
  matchday: {
    // full timelines for watched matches (yours; marquee added on tap)
    featured: MatchTimeline[];       // 1..3 (your matches), played in order
    featuredIndex: number;           // which is on screen
    // lightweight goal stamps for the rail (all other matches this round)
    rail: { matchId: string; homeId: string; awayId: string;
            goals: { minute: number; team: 'home'|'away' }[] }[];
  } | null;
  ```
- New actions:
  - `ENTER_PLAYBACK` — set `battleView:'playback'`, `matchday` built by App (below).
  - `NEXT_FEATURED` — `featuredIndex + 1`; when past the last, `battleView:'results'`.
  - `WATCH_MARQUEE { timeline }` — push a lazily-built timeline into `featured` and
    focus it (returns to your matches after, or just replaces — **Q5**).
  - `PLAYBACK_DONE` — jump straight to `battleView:'results'` (skip-all / headless).
- **Purity preserved:** timelines are plain data in state (serializable → good for MP).
  The *clock* is NOT in the reducer.

### 5b. `App.tsx`

- On `PLAY ROUND`, keep calling `playRound(...)` to get the `RoundResult` (final table
  is already decided — playback only *reveals* it, never changes it). Then:
  - if `animate` → build `matchday` (call `buildMatchTimeline` for your ≤3 matches;
    collect goal stamps for the rest) and dispatch `ENTER_PLAYBACK`.
  - if **`!animate`** → dispatch `ROUND_PLAYED` directly to `results` (today's path,
    unchanged; **tests stay synchronous**).
- `buildMatchTimeline` is called from a handler using `rngRef` — same discipline as the
  existing `playRound`/steal calls. **ASSUMPTION:** it's a pure engine fn; its seed is
  derived deterministically from `(roundSeed, matchIndex)` so it's reproducible and
  MP-ready (**Q6**).

### 5c. New component `screens/MatchPlaybackScreen.tsx`

Owns the **only** stateful piece — the rAF clock — and renders purely from it.

```tsx
function MatchPlaybackScreen({ state, animate, onFeaturedDone, onSkipAll, onWatchMarquee }) {
  const timeline = state.matchday.featured[state.matchday.featuredIndex];
  const elapsed = useMatchClock(timeline, { speed, paused, animate }); // rAF, ref-held
  const view = projectMatch(timeline, elapsed);   // ← PURE, unit-testable, no rng
  // render scoreboard/meter/ticker/flash + <ScoreboardRail elapsed=… /> from `view`
  // when elapsed >= end → onFeaturedDone()
}
```

- `useMatchClock` — thin hook: `requestAnimationFrame` loop, `elapsed = (now−start)·speed`,
  cleanup on unmount, honours `paused`; **when `animate===false` it returns `end`
  immediately** (headless). Speed change re-anchors `start` to preserve elapsed.
- `projectMatch(timeline, elapsedMs) → MatchView` — **pure**, the testable core:
  ```ts
  interface MatchView {
    minute: number; clockLabel: string;      // "45' HT", "90' FT"
    score: { home: number; away: number };
    pressure: number; ballX: number;         // interpolated between ticks
    ticker: TimelineEvent[];                  // events with atMs ≤ elapsed, last 3
    celebrating: TimelineEvent | null;        // a goal within [t, t+CELEB_MS]
  }
  ```
  Sub-components (`MomentumMeter`, `EventTicker`, `Scoreboard`, `GoalFlash`,
  `ScoreboardRail`) are dumb — they take `MatchView` / `elapsed` and render.

### 5d. `screens/BattleScreen.tsx`

- Add the `battleView === 'playback'` branch → render `MatchPlaybackScreen`.
  `intro` and `results` branches are **unchanged** (drama preserved, just later).

### 5e. Timing constants (one module, `engine`- or `game`-level)

`MATCH_DURATION_MS = 45000` · `CELEBRATION_MS = 2600` · `VIRTUAL_MINUTES = 90`.
Canonical duration is a **shared constant** (MP clients must agree) — belongs in
CONTRACT, not buried in the component. **← Q1.**

---

## 6. Timeline-consumption API (the multiplayer seam)

The whole design is built so a server change is a **refactor, not a rewrite** (worker-7
owns the broader memo; this is my component-level contribution):

- **Playback = `projectMatch(timeline, elapsedMs)`** — a pure function. No rng, no
  incremental mutation, no gameplay decision in any component.
- The **only** local, stateful, non-deterministic input is the **clock start
  timestamp**. Today: `start = performance.now()` on mount. Under multiplayer: the
  server sends `{ timeline, startTs }` and the client sets `start = startTs`. **Every
  client that shares a timeline + startTs renders byte-identical frames.**
- Speed-up/skip are **solo-only** (they desync clients), so they live in the component,
  not the timeline. In MP the canonical 45s is enforced; the controls are hidden. This
  keeps the "every client sees the same wall-clock match" guarantee intact.
- Because timelines are plain serializable data in `GameState`, a future server can
  produce them (running the identical deterministic engine) and stream them; the reducer
  and components don't change.

**Interface I depend on from the engine (state for CONTRACT.md):**
1. `buildMatchTimeline(home: XI, away: XI, tactics: Tactics, seed: number): MatchTimeline` — pure, lazy.
2. Per-match `goals: {minute, team}[]` on `MatchResult` (rail ticking) — or an agreed fallback.
3. Deterministic per-match seed derivation from `(roundSeed, matchIndex)`.
4. Ticker `text` copy authored by the engine (it knows the event semantics); I render it verbatim.

---

## 7. Tier A vs Tier B

**Tier A — shippable Saturday night (small, safe, demo-visible).** The demo money shot
is watching your match swing and score.

- `MatchPlaybackScreen` for **YOUR matches only**, ~45s each, with: scoreboard + live
  clock, **momentum meter + ball marker**, **event ticker**, **goal flash + score bump
  + ball-reset-to-centre**.
- `projectMatch` pure + **unit-tested** (score/ball/ticker/celebration at sampled
  elapsed values) — keeps the project's test-discipline story.
- **1× / skip** controls. `animate={false}` headless path preserved (all 54 tests stay
  green, playback skipped).
- Static **scoreboard rail** of other matches showing **final** scores as a strip
  (no live ticking yet) so the BR scale is visible.
- Depends on: engine emitting a `MatchTimeline` for a single match (even a first-pass
  Poisson-derived one). If the engine timeline slips, I ship against a **thin adapter
  that fabricates a plausible timeline from the existing `MatchScore`** (distribute the
  known goals across 90′ on the seeded rng, sine-wave momentum) — so sim UI is not
  blocked on engine v2. **← Q8.**

**Tier B — post-hackathon (full vision).**

- **Live-ticking rail** synced to the featured clock; **marquee** matches watchable on
  demand (lazy timeline build + swap).
- **2× / 4×** and pause; per-match "skip to result."
- Richer momentum: half-time marker on the track, a sparkline history of momentum,
  possession %, shot counters.
- Goal celebration polish: scorer name, crowd SFX (Tier-2 sound was already deferred),
  camera-flash particles.
- Tactics-in-playback readout (formation shape mini-board beside the meter, tying into
  the draft/engine tactics work).
- The **server seam**: accept `{ timeline, startTs }` from a source other than the
  local engine (the actual transport is worker-7 / Tier 3).

---

## 8. Open decisions for Lucca

1. **Match duration.** Proposed **45s per match @ 1×** (90 virtual min). Your 3 matches
   = ~135s/round, skippable. Too long? (30s snappier for demo; 60s more dramatic.)
2. **What's skippable.** Proposed: **skip one match** (jump to its FT) and **skip all**
   (jump straight to the results table). Keep both, or just skip-all?
3. **How much of other managers' matches to show.** Proposed: live-ticking **score-only
   rail** for all; full playback only for **your** matches + tapped marquees. Enough, or
   do you want a mini momentum bar on rail cells too (costs the full timeline for all)?
4. **Reveal ordering.** Play your 3 matches **then** show the full table (drama at the
   end, per brief). Or reveal your standing live as the rail resolves? I recommend the
   former — it preserves the BattleScreen table cascade as the payoff.
5. **Marquee matches (Tier B).** Which non-you matches are "watchable on demand" — the
   **top-2 seeds**, the **elimination-bubble** pair, or a rival you pick? And after
   watching a marquee, return to your matches or stay?
6. **Duration for lost-human runs.** When you're eliminated and hit "SEE HOW IT ENDS,"
   today it fast-forwards headlessly. Keep that instant, or play a **highlights-speed**
   (e.g. 8×) montage of the remaining rounds?
7. **Rail goal stamps (engine dependency).** Do you want the engine to stamp goal
   minutes for *all* matches (nice ticking, tiny cost), or is a UI-side fabricated
   distribution acceptable for the non-watched ones?
8. **Engine-timeline fallback for the hackathon.** OK for me to ship Tier A against a
   **UI-side adapter** that fabricates a timeline from the existing `MatchScore` if
   engine v2's real timeline isn't merged by Saturday? (Keeps sim UI demoable and
   swaps to the real timeline transparently once it lands.)

---

## 9. Dependencies on other workstreams

| Need | From | Status / assumption |
|---|---|---|
| `MatchTimeline`, `MomentumTick`, `TimelineEvent` shapes ratified | worker-7 (CONTRACT) via engine | **assumed** in §2 — flagged for reconciliation |
| `buildMatchTimeline(...)` pure, lazy, deterministic | hackathon-builder (engine) | **assumed** in §5b/§6; Tier-A fallback adapter in §7 if it slips |
| Per-match `goals:{minute,team}[]` on `MatchResult` | engine | **assumed**; fallback = UI distributes goals (Q7) |
| Deterministic per-match seed `(roundSeed, matchIndex)` | engine / architecture | **assumed** (Q6) |
| `Tactics` type (formation, style, levers) passed into playback readout | draft + engine + CONTRACT | Tier B; only needs the *shape* for the mini-board |
| Multiplayer transport for `{timeline, startTs}` | worker-7 (memo) | Tier 3; my API is pre-shaped for it (§6) |
| Keep `animate={false}` headless contract | qa-balance / architecture | **honoured** — playback skipped, 54 tests unaffected |

**No conflicting shapes invented.** All new types are flagged ASSUMPTION for worker-7;
the only behaviour I add to `src/` (next phase) is a pure `projectMatch`, a ref-held
rAF clock, and presentational components — the engine and reducer stay authoritative.
