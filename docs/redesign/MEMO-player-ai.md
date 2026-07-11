# MEMO — Lightweight Player AI for the visual sim

**From:** architect (sim workstream) · **Status:** feasibility only, NO implementation
**Scope:** the dot layer of `MatchPlaybackScreen`, driven by `dotView` in `src/game/playback.ts`
**Decision owner for visual/feel:** Main. This memo describes *mechanisms and cost*, not aesthetics.

---

## 1. Where we are

Playtesters want the dots to "read as individually intelligent." Today every dot is
placed by `dotView(team, anchor, ball, possession, elapsedMs, index)` — a pure
function that:

- starts from the player's **formation anchor** (compressed into the team's operating
  band by `DOT_SPREAD`),
- **eases toward the ball** by a possession-dependent gain (`pullX` 0.2 attacking /
  0.12 defending; `pullY` 0.16 / 0.22),
- adds a small **per-index sine/cosine wobble** on `elapsedMs`,
- special-cases the GK, and point-reflects the away side.

So the pitch is *already* ball-reactive — but uniformly. Every outfield dot uses the
**same gains** and the **same wobble amplitude**, so all 22 read as one organism, not
eleven decision-makers. That uniformity is the whole problem, and it's also why the fix
is cheap: the seam already exists.

### The constraints that must hold (non-negotiable)

1. **Purity / determinism.** `projectMatch` and everything it calls must stay a pure
   function of `(timeline, elapsedMs)` — no randomness, no per-frame mutation, no
   integrated velocity. Two clients + same timeline ⇒ identical frames (CONTRACT §5).
   This is the constraint that rules out "real" steering AI (see §5).
2. **Wire format unchanged.** `MatchTimeline` should not have to grow fields.
3. **60fps with 22 dots.**

### Two architectural facts that make this easy (both verified in the tree)

- **Ratings are already available client-side, index-aligned to the anchors.**
  `MatchPlaybackScreen` already holds `managerOf(id).xi` (`XiSlotV2[]`, each with
  `player.rating`). The draft fills the slate by `formation.slots[slotIndex]`
  (`src/engine/draft.ts`) and `formationAnchors` reads the same `FORMATIONS[id].slots`,
  so **`xi[i]` and `formationAnchors(formationId)[i]` describe the same player.** A dot's
  rating is a plain index join — **no wire change, no engine change.** The only plumbing
  needed is passing `xi` into `Pitch` (it currently goes only to `LineupRail`) and on to
  `dotView`. *Invariant to assert:* `xi[i].position === anchor[i].position`; if XI
  rearrange ever breaks slot order, fall back to a neutral rating.

- **The ball position at any elapsed is a cheap, pure O(1) lerp** between the two
  bracketing `ticks[]`. That means we can evaluate the ball **at an earlier elapsed**
  (`elapsed − lagMs`) for free and statelessly — which is the entire trick behind
  rating-scaled reaction lag (§3). No history buffer required.

Everything below stays inside `dotView` (plus a tiny `ballAt(timeline, elapsed)` helper
factored out of the existing lerp). `projectMatch`'s shape is untouched.

---

## 2. Tier A — ball-reactive positioning *per player*

**What it takes.** Replace the two shared gains with **per-player gains** computed from
rating + role + phase, all pure math on data already in scope:

- **Rating-scaled decisiveness:** a higher-rated player uses a slightly higher pull
  (tracks the ball more purposefully and holds tighter lines); a lower-rated player uses
  a lower pull and a larger wobble amplitude (looser, more erratic). Map rating→gain with
  a fixed linear ramp over the known ~70–95 band.
- **Role-scaled pull split:** derive a coarse role from `anchor.position` (already on the
  anchor) — defenders weight `pullY`/shape retention, forwards weight `pullX` toward the
  ball in attack, midfield sits between. This is a lookup table keyed by position family.
- **Phase weighting:** reuse `possession` (already passed in) so attackers push toward the
  ball more when their team has it and defenders compress toward their own goal-side lane
  when they don't — differentiated, not the current single attacking/defending flag.

Signature grows to `dotView(team, anchor, ball, possession, elapsedMs, index, rating)`;
GK path unchanged.

**Effort:** ~0.5 day. Rewriting the interior of one pure function + threading `rating`
through `Pitch`, plus a handful of determinism/monotonicity unit tests alongside the
existing `dotView` coverage in `playback.test.ts`.

**Risk:** Low. Pure, bounded by the same `clamp`s, no new state, no wire change. The only
real failure mode is the alignment invariant above — cheaply defended with a fallback.

---

## 3. Tier B — weaker players react/move with more lag

**What it takes.** This is the highest-value-per-line change and it drops out of fact #2
almost for free. Instead of every dot chasing the **current** ball, each dot chases the
ball **as it was `lag(rating)` ms ago**:

```
target = ballAt(timeline, elapsedMs − lag(rating))      // lag: strong ≈ small, weak ≈ larger
dot     = anchor + (target − anchor) * gain(rating, role, phase)
```

`ballAt` is the existing tick-lerp evaluated at an earlier time — O(1), pure, no buffer.
A weak defender is visibly a beat behind the play; a strong one is glued to it. Because
the lag is a smooth function of a static rating, the frame is still a pure function of
`(timeline, elapsed)` and fully deterministic. Optionally fold a rating-scaled easing on
the *approach* (also expressible as a lagged target, so still stateless).

**Effort:** ~0.25 day **if built together with Tier A** (it reuses the same rating ramp
and the `ballAt` helper). Standalone it's still ~0.5 day because it needs `ballAt`
extracted and its own tests.

**Risk:** Low. One caveat to tune: large lags near a sharp ball turnover can put a slow
dot briefly "on the wrong side" of the ball — which is *exactly* the intended read
("caught out"), but the max lag needs a sane cap so dots don't visibly rubber-band. Pure
tuning constant, no architectural risk.

> Tiers A and B are one work item. Treat them as the shippable unit.

---

## 4. Tier C — role-aware runs

**What it takes.** A "run" is a role-specific, time-bounded displacement of a dot's target
*away* from pure ball-tracking — a fullback overlapping the flank, a striker peeling into
a channel, a winger holding width then cutting in. Keeping it pure means the run has to be
a **function of elapsed** rather than a triggered animation with state. The buildable
version:

- A **run phase** per player = a slow triangle/ramp wave over elapsed, **seeded by
  `index`** so teammates don't run in lockstep, that displaces the target along a
  **role-specific vector** (overlap = downfield along the touchline; channel run =
  diagonal into the half-space; etc.), keyed off `anchor.position`.
- **Gated on play, not random.** Only fire runs for attackers of the team in
  `possession`, and — a nice free hook — only when a nearby attacking `TimelineEvent`
  (`'counter'`/`'chance'`/`'shot'`, already client-side, **no wire change**) is inside its
  window. That ties runs to moments that actually matter and keeps the pitch calm the rest
  of the time.
- **Shape guard:** clamp run displacement so a running dot can't collapse into a teammate
  or vacate its band entirely.

Still pure, still deterministic, still no wire change.

**Effort:** ~1.5–3 days, and most of it is **visual tuning, not code** — the mechanism is
maybe a day; making it read as "intelligent run" instead of "dots oscillating" is the
rest.

**Risk:** Medium — the highest of the three, on two fronts. (1) It's the tier most likely
to look *worse* than today if under-tuned (dots overlapping, breaking the formation-shape
read, runs that fire at nothing). (2) **Honest limitation:** with no per-player event data
in the timeline, these runs are **procedural decoration** — correlated with play via the
event/possession gates, but not driven by what any specific player actually did in the
sim. Genuinely sim-driven off-ball movement ("player 9 made the run that created the
34' chance") would require enriching the timeline with per-player positional hints — a
wire-format + engine change that is explicitly out of scope here. Tier C should be sold as
*procedural flair gated on real events*, not as real off-ball intelligence.

---

## 5. What is NOT feasible under the constraints

**Full simulation-grade ball-reactive AI** — steering/pursuit with integrated velocity,
marking assignments, collision avoidance — **is more than a weekend and fights the
architecture.** Those algorithms are iterative: velocity accumulates frame over frame,
i.e. per-frame *state*. To keep the purity contract you'd have to either (a) recompute
every dot's whole trajectory from t=0 on every frame — O(frames²), which sinks 60fps — or
(b) bake per-player paths into the timeline at sim time, a real wire-format + engine
investment. Both are disproportionate to a *visual-polish* goal. **Recommendation: don't.**
The value playtesters are asking for ("reads as individually intelligent") is delivered by
Tiers A+B, which are pure, cheap, and wire-stable.

---

## 6. The cheapest version that still reads as intelligent (spec)

If we ship one thing, ship **Tiers A + B as a unit** — per-player attraction to the
interpolated ball with rating-scaled lag and gains. Concretely, `dotView` becomes pure
math on `(elapsed, rating, index, anchor, ball, possession)`:

```
role      = roleOf(anchor.position)                 // {DEF, MID, FWD} lookup
gain      = baseGain(role, possession)              // role/phase pull split (x,y)
          * ratingGainRamp(rating)                  // ↑rating ⇒ ↑decisiveness, linear over ~70–95
lagMs     = ratingLagRamp(rating)                   // ↑rating ⇒ ↓lag, capped
target    = ballAt(timeline, elapsed − lagMs)       // O(1) pure tick-lerp at an earlier time
wobbleAmp = baseWobble * inverseRatingRamp(rating)  // weaker ⇒ looser, seeded by index
x         = clamp(anchorX + (target.x − anchorX) * gain.x + wobble(elapsed, index, wobbleAmp), …)
y         = clamp(anchorY + (target.y − anchorY) * gain.y + wobble(…), …)
```

No new timeline fields; no per-frame state; deterministic; ~22 O(1) evaluations per frame
(trivially 60fps). Plumbing cost is one prop (`xi`) threaded `Pitch → dotView` plus the
`ballAt` extraction. The rating→gain, rating→lag, and role→pull tables are the only tuning
surface — hand those numbers to Main. **Total: ~0.5–1 day including tests.**

---

## 7. Recommendation

Build **Tiers A + B together** as the next sim work item: it's roughly half a day to a day,
stays fully pure and deterministic, needs **no wire-format or engine change** (ratings are
already client-side and index-aligned to the dots, and a lagged ball target is a free
consequence of the existing tick-lerp), and it directly answers the playtest note —
weaker players visibly a beat behind, stronger players decisive, each dot moving on its own
gains instead of one shared wobble. Hold **Tier C (role-aware runs)** as an optional
fast-follow only if A+B don't land the "intelligent" read; it's a further 1.5–3 days that's
mostly tuning, carries real risk of looking worse if rushed, and — with no per-player data
in the timeline — remains procedural flair gated on real events rather than true off-ball
intelligence. **Do not** pursue full steering-simulation AI: it either breaks the purity
contract or demands an engine + wire investment far out of proportion to a visual-polish
goal. The numeric feel of all ramps and role tables is Main's to set.
