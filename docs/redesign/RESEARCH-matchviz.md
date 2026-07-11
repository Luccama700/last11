# Research: Live match visualization patterns (playtest follow-up)

Owner of decisions: **Main.** This doc is raw findings + citations only. Playtesters
loved the current presentation (2D top-down pitch, pseudo-moving dots from a pure
`(timeline, elapsedMs)` projection) but said **uniform dot movement kills immersion** —
all 22 dots ease toward the ball zone with the same pull factor plus a tiny shared
sinusoidal wobble (`dotView` in `src/game/playback.ts`), so every dot reads identical.
Everything below is filtered through one hard constraint: **any stealable idea must be
expressible as a closed-form function of `(timeline, elapsedMs)`** — deterministic, no
per-dot simulation state. The timeline already emits per-minute ticks
(`ballPosition`, `ballLane`, `momentum`, `possession`) and a minute-stamped event list.

---

## Pattern 1 — Role-differentiated off-ball movement (Football Manager modern ME)

**What it is.** FM's modern match engine makes dots read alive not through fidelity but
through *differentiation*: "players behave more intelligently, adjusting their position
based on the roles and movement of teammates" — a Mezzala moves differently than a
Box-to-Box mid, fullbacks make overlapping runs, defenders hold a line, a playmaker
"moves across to open new channels." FM26 layers "Motion Matching" + inverse kinematics
on top, and adds separate **in-possession vs out-of-possession shapes**.

**Why it reads as alive.** The eye reads *relative* motion. When a fullback pushes 20
yards up the touchline while the CB next to him stays put, the pitch looks like eleven
intentions, not one flock. Uniform pull toward the ball is exactly what FM's shape
system avoids.

**What it would take in a pure-projection model.** No sim needed — attach a per-slot
role tag (already implicit in the formation/position anchors) to a *phase-dependent
offset function*: e.g. attacking-phase fullbacks get a large forward `pullX`, CBs a
small one, wingers widen, a lone striker pins high. It's still `f(anchor, possession,
ballZone, elapsedMs)`, just with per-role coefficients instead of one shared `pull`.
Two shapes (in/out of possession) already map onto the existing `possession` tick.

Sources: [Truer Football Motion — FM26](https://www.footballmanager.com/features/truer-football-motion-match-authenticity-positional-play),
[FM24 match engine roles](https://www.footballmanagerblog.org/2023/09/fm24-3d-match-engine-revolution-tactical-depth-new-player-roles-fluidity.html),
[In & Out of Possession Formations](https://www.passion4fm.com/explaining-in-out-of-possession-formations/)

---

## Pattern 2 — Intensity-driven emphasis / dynamic highlighting (FM26 + Top Eleven 2D)

**What it is.** FM26's **Dynamic Highlight Mode** "adjusts the number of highlights you
see based on the context of the match" — a comfortable 4-0 shows fewer; a tight game
shows more. Top Eleven's 2D animated match went further: it showed **only highlights**,
an ~8-minute condensed bird's-eye view "with more or fewer animated sequences depending
on intensity." Both explicitly stop treating every minute as equal.

**Why it reads as alive.** Real matches breathe — lulls then surges. Uniform-energy
motion for 90 straight minutes flattens that; the current dot wobble has the same
amplitude at minute 3 and at a 90th-minute winner. Modulating *energy* by the match's
own intensity signal makes the surges land.

**What it would take in a pure-projection model.** The `momentum` magnitude per tick is
already an intensity proxy. Scale motion energy by it: wobble amplitude, dot pull, and
(optionally) a camera-zoom/vignette all keyed to `|momentum|` and proximity to an event
minute. Near a big event the pitch tightens and dots quicken; in a lull it settles.
Purely `f(momentum(elapsedMs), nearestEvent(elapsedMs))`.

Sources: [Where Storytelling Evolves — FM26 Match Day](https://www.footballmanager.com/fm26/features/where-storytelling-evolves-fm26s-match-day-experience),
[Top Eleven 2015 animated live match](https://forum.topeleven.com/top-eleven-announcements/36207-animated-live-match-live-ratings-available-top-eleven-2015-a.html)

---

## Pattern 3 — Threaded, suspenseful event build-up (Hattrick live viewer)

**What it is.** Hattrick's live viewer reports events "second by second," and events are
**threaded**: "events that start out the same way don't necessarily end the same way —
you won't know for sure how an event ends until the second it is over." It deliberately
removed "dead periods" and added a class of contextual commentary between events.

**Why it reads as alive.** Suspense comes from a *lead-in* before the outcome. A goal
that just pops is inert; a goal you watched build — ball driving toward the box, the
ticker teasing "chance!" — has a beat of tension. Uniform dots have no build-up phase.

**What it would take in a pure-projection model.** Each timeline event already has a
minute stamp. Give it a **lead-in window** (e.g. the ~2–3 virtual seconds before its
timestamp): during that window the ball projection drives toward the relevant third and
dots converge, then the result reveals on the stamp. All of it is a function of
`elapsedMs` relative to the event's fixed time — the outcome is predetermined by the
timeline (unlike Hattrick's genuine branching), but the *reveal* can still be staged.

Sources: [Introducing the new Live Viewer — Hattrick](https://wiki.hattrick.org/wiki/Introducing_the_new_Live_Viewer),
[New Live Viewer & More — Hattrick](https://wiki.hattrick.org/wiki/New_Live_Viewer_%26_More)

---

## Pattern 4 — Attack-momentum ribbon (SofaScore / FlashScore, powered by Opta)

**What it is.** A continuously rising/falling graph beside the pitch. Peaks up = home
mounting pressure (taller = more dominant), peaks down = away pushing; it "rises and
falls in real time" from progressive passes, shots, set pieces, counters. On a goal the
momentum visibly swings, which is itself a watchable beat.

**Why it reads as alive.** It gives a *second motion channel* that is unmistakably tied
to the game state, so even when the dots are quiet the screen is telling a live story.
It's the cheapest possible "aliveness" upgrade because it's abstract — no fidelity
expectation to violate.

**What it would take in a pure-projection model.** Nearly free: the timeline already
emits `momentum` per minute. Interpolating it into a scrolling ribbon or a symmetric
vertical bar is a direct read of existing data — arguably the lowest-effort, lowest-risk
item here, and it complements (rather than replaces) the dot fix.

Sources: [How Sofascore's Attack Momentum changed sport analysis](https://www.sofascore.com/news/how-sofascores-attack-momentum-changed-sport-analysis),
[How Live Attack Momentum works](https://www.sofascore.com/news/how-live-attack-momentum-works-at-the-world-cup),
[Understanding Attack Momentum & Big Chances](https://www.sofascore.com/news/understanding-football-match-stats-how-attack-momentum-and-big-chances-impact-performance)

---

## Pattern 5 — Deliberate abstraction / "the blobs" philosophy (FM classic 2D, 38-0 genre)

**What it is.** FM's 2D "blobs" survive because abstraction *helps* immersion: "the
closer FM got to looking real, the harder it became to lose oneself" — detailed 3D
"exposes unrealistic player behaviours." The 2D view is also clearer for reading the
state of play. The 38-0 / roadto38 genre goes fully minimal (draft + simulate, little or
no live pitch) and still hooks people on structure and stakes alone.

**Why it reads as alive.** Imagination fills the gap: believable *structure* plus a few
emphasis cues beats a literal-but-wrong render. The complaint isn't that the dots are
abstract — it's that they're *undifferentiated*. This pattern is the guardrail: fix the
motion model, don't chase 3D.

**What it would take in a pure-projection model.** Nothing to add — it argues for staying
inside the current architecture and spending effort on Patterns 1–4 rather than a
rendering overhaul. Abstraction is a feature to protect, not a limitation to escape.

Sources: [Why Football Manager will always be about the blobs](https://www1.videogamer.com/features/why-football-manager-will-always-be-about-the-blobs),
[FM26 2D vs 3D — why 2D still wins](https://www.footballmanagerblog.org/2025/12/fm26-2d-camera-vs-3d-nostalgia-tactics.html),
[RoadTo38](https://roadto38.com/)

---

## Recommendation

The immersion complaint is specifically about **undifferentiated** motion, not
abstraction, so the highest-leverage fix stays entirely inside the pure-projection model:
combine **Pattern 1 (role-differentiated off-ball offsets)** as the core change — replace
the single shared `pull`/wobble in `dotView` with per-role, in/out-of-possession offset
functions so eleven dots read as eleven intentions — with **Pattern 2 (intensity-scaled
energy)** so those movements surge and settle with `|momentum|` instead of running flat
for 90 minutes. Both are closed-form in data the timeline already emits and require no
new simulation state. **Pattern 4 (the momentum ribbon)** is the cheapest independent
win and can ship alongside as a second live channel with almost no risk, while **Pattern
3 (event lead-in windows)** is the natural next layer for making goals feel *built* rather
than *popped*. **Pattern 5** is the guardrail over all of it: the answer is a better
motion model, not more fidelity — keep the blobs. Creative and visual specifics (exact
coefficients, camera behavior, ribbon styling) are Main's call.
