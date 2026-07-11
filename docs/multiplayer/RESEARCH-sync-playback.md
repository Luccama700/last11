# RESEARCH — Synchronized Playback (match-sim / MATCH-SIM)

**Scope:** synchronized viewing (`startAt` + client clock skew), late-join / reconnect
mid-match seek, spectator multi-match view, MP speed-control policy, penalty-beat
timing across clients. Measured against the *existing* playback core.

**Headline finding — playback.ts needs ZERO required changes for multiplayer.**
Every MP need is already satisfied by the pure signature `projectMatch(timeline, elapsedMs)`.
The work lives one layer up (the clock/driver in the screen, the transport, and a
small spectator-population tweak in the reducer) — none of it in the sim-owned pure
core. This doc proves that line by line and specifies exactly what the layer above
must supply.

Source of truth read for this doc: `src/game/playback.ts`,
`src/screens/MatchPlaybackScreen.tsx` (the clock), `src/game/state.ts` (`Matchday`,
`WATCH_MARQUEE`), `src/engine/types.ts` (`MatchTimeline`). Line refs are as of
2026-07-12.

---

## 1. Why the pure core is already MP-ready

`projectMatch(timeline, elapsedMs)` (`playback.ts:158`) is a total pure function:

- **No hidden clock.** It never calls `Date.now()`, reads no module state, and holds
  no `useRef`/`useState`. `elapsedMs` is the *only* time input.
- **Arbitrary elapsed is valid input, both ends.** `const el = Math.max(0, elapsedMs)`
  (`:161`) clamps pre-start (negative) elapsed to the opening frame; `finished =
  el >= matchEndMs(timeline)` (`:162`) makes any past-end elapsed render the final
  frame. So *any* real number is a legal seek — including one derived from a wall
  clock the function has never seen.
- **The frame is a deterministic fold over the timeline.** Score is "latest goal
  whose stamp ≤ regMs" (`:176`), ticker is a filter+slice (`:198`), the shootout
  reveal count is `Math.min(n, cur + …)` off `soEl / SHOOTOUT_KICK_MS` (`:212–215`).
  Same `(timeline, elapsed)` ⇒ same frame, on any machine, at any time, in any order.

**Consequence:** "seek to time T of this match" is *literally* `projectMatch(timeline, T)`.
There is no separate seek path to write, no scrub buffer to rebuild, no incremental
state to fast-forward. This is the single most important fact for MP sync and it is
already true.

The docstring already anticipated this (`playback.ts:4–7`): *"Hand two clients the same
`MatchTimeline` + start timestamp and every frame is identical."* MP is the case that
sentence was written for.

---

## 2. Synchronized viewing: `startAt` + the one real problem (clock skew)

### The model
Server (or host) broadcasts one message per match: `{ matchId, startAt }` where
`startAt` is a server-epoch millisecond timestamp. Every client renders each frame as:

```
elapsed = (clientNow + skewOffset) − startAt
frame   = projectMatch(timeline, elapsed)
```

When `elapsed ≥ matchEndMs(timeline)` (`playback.ts:146`) the client shows the final
frame and advances. Because `matchEndMs` is pure and identical across clients, they
converge on the end without any "match over" broadcast (though the protocol will send
one anyway as the authoritative round-advance trigger — see §5 open questions).

### The only genuine distributed-systems problem: `skewOffset`
`elapsed` depends on `clientNow` agreeing with `startAt`'s clock. Consumer device
clocks drift seconds from true time, so `skewOffset` must be *estimated*, not assumed
zero. This is the classic client/server clock-offset problem; two standard solutions:

- **Cristian's algorithm / NTP-style round-trip offset** (textbook; the algorithm NTP
  and Cristian 1989 formalize). Client stamps `t0`, server replies with its time
  `t_srv`, client stamps `t1` on receipt. Estimate:
  `offset ≈ t_srv − (t0 + t1) / 2`, with error bounded by `RTT/2 = (t1 − t0)/2`.
  Take the sample with the *smallest* RTT out of a handful of pings (lowest-RTT
  sample has the tightest bound). Refresh occasionally to track drift.
- **Server-timestamp-only (trust the transport).** If the transport already delivers a
  trusted server timestamp alongside messages (many managed realtime services do), a
  client can approximate `offset` from the gap between message `serverTs` and local
  receipt time, skipping an explicit ping. Coarser (includes one-way latency) but
  zero extra round-trips.

For our cadence this is forgiving: playback is a **45s or 57s** fixed wall-clock window
(`matchEndMs` = `MATCH_DURATION_MS` + `kicks × 6000`, `playback.ts:146–147`,
`SHOOTOUT_MS`/durations in `engine/types.ts`). A residual skew of 50–150ms is
**sub-perceptual** for watching dots move and a scoreboard tick — nobody notices their
client is 100ms ahead of a friend's. The one place tighter sync *reads* is the penalty
beat (§4), and even there the 6s-per-kick cadence swallows ±150ms trivially.

### Where this code lives
**Not in playback.ts.** `skewOffset` estimation and the `elapsed = now + offset − startAt`
substitution live in the clock hook (`useMatchClock`, currently
`MatchPlaybackScreen.tsx:109`) or, better, in an injected clock the driver supplies.
`projectMatch` receives the already-computed `elapsed` and neither knows nor cares
whether it came from a local delta-accumulator or a skew-corrected wall clock.

---

## 3. Late-join & reconnect: free

A human who opens the tab 30s into a 45s match, or reconnects after a drop, needs the
*current* frame immediately — no replay-from-zero, no catch-up animation.

With the §2 model this is automatic: on (re)join the client learns `startAt` (from room
state / rejoin payload), computes `elapsed = now + offset − startAt`, and the very first
`projectMatch(timeline, elapsed)` call is the correct in-progress frame. If `elapsed`
already exceeds `matchEndMs`, they see the finished frame and fall straight into the
next match — again with no special-casing, thanks to the `finished` clamp
(`playback.ts:162`).

This is verified by existing pure-core tests: `projectMatch` at an arbitrary mid-match
elapsed, at `elapsed = ∞` (headless final frame), and — as of my night-batch-2 lock —
at *exactly* `matchEndMs` (`playback.test.ts`, "reads finished at exactly matchEndMs").
Arbitrary seek is the property those tests already pin.

**playback.ts change for late-join: none.**

---

## 4. Penalty-beat timing across clients: already lockstep

Shootout kicks reveal one-by-one on a fixed 6s beat, and the reveal is a *pure function
of elapsed*: `cur = floor(soEl / SHOOTOUT_KICK_MS)`, `resultShown = within ≥ 0.58`,
`revealed = min(n, cur + (resultShown?1:0))` (`playback.ts:211–215`). `SHOOTOUT_KICK_MS`
is a shared module constant (`:140`).

So as long as clients agree on `elapsed` (§2), they reveal the same kick at the same
wall-clock instant *without any per-kick broadcast*. There is no "next kick now" event
to send — the beat falls out of the shared timeline + shared start. Skew shifts the beat
by `skewOffset`, which is << the 6s beat, so cross-client kick reveals stay visually
simultaneous. **No playback.ts change; no extra protocol messages for pens.**

---

## 5. Spectator multi-match: mostly already in the reducer

Requirement: an eliminated human becomes a spectator who can watch *other* players'
matches for the rest of the round.

What exists today:
- `Matchday.featured: MatchTimeline[]` (`state.ts:50`) already holds an **array** of
  full timelines with a selected `featuredIndex` (`:51`). It was built for "your 1–N
  matches this round" but the shape is just "N watchable timelines + a cursor."
- `rail` (`state.ts:52–53`) holds only **lightweight goal stamps** for every *other*
  match — enough to render the "Elsewhere this round" scoreboard, **not** enough to
  replay (no `ticks`, no full `events`). So rail alone can't feed `projectMatch`.
- **`WATCH_MARQUEE` already exists** (`state.ts:407–410`): it appends a `MatchTimeline`
  to `featured` and jumps `featuredIndex` to it. That is *exactly* the "click a match
  and start watching it" primitive — the spectator's core interaction is already a
  reducer action.

So spectator multi-match is **not a playback problem and barely a state problem**. What
it needs:
1. **Timeline availability.** To watch match X, the spectator must *have* match X's full
   `MatchTimeline` (not just its rail stamps). Two supply options:
   - **(a) Push all timelines to spectators.** Server includes every match's full
     timeline in the round broadcast. Simple; bandwidth cost is the number
     RESEARCH-determinism.md is already measuring (full round, 48 matches, gzipped).
   - **(b) Pull on demand.** Spectator taps a rail match → requests that one timeline →
     server sends it → `WATCH_MARQUEE`. Minimal bandwidth, one extra round-trip and a
     brief "loading" beat before playback. Recommended default; (a) is a fine upgrade
     if the gzipped round payload turns out cheap.
2. **A shared `startAt` per spectated match** so a spectator watching match X sees it at
   the same offset as its participants (reuse §2 exactly; the spectator is just another
   client with the same `startAt`).
3. **UX** (Main's): the rail becomes tappable in spectator mode; a "watching: A vs B"
   affordance; auto-follow options. Product surface, not sim.

**playback.ts change for spectatorship: none.** `Matchday` change: none to the *shape* —
`featured[]` + `WATCH_MARQUEE` already model it; only the *populator* changes (server
feeds timelines instead of the local `playRound`). Owned by architect/Main.

---

## 6. MP speed-control policy: disable = pin the clock, not touch the sim

Speed exists **only in the clock**, never in the pure core. `projectMatch` has no speed
parameter; the solo screen scales *elapsed accumulation* by `speedRef`
(`MatchPlaybackScreen.tsx` delta-accumulation `elapsedRef += dt * speed`). The clock's
own docstring states the MP intent outright: *"solo-only speed control is why we don't
use the pure (now−start) MP form here — under multiplayer the clock becomes
`elapsed = now − serverStartTs` at 1×."*

Therefore the MP policy is mechanical and already designed-for:
- **Shared viewing (participants + spectators of the live round): speed locked to 1×.**
  The MP clock is `elapsed = now + offset − startAt`; there is no speed term to expose.
  A 2× button under a shared wall clock is incoherent (it would desync viewers), so the
  driver simply hides/ignores speed in online mode. `projectMatch` is untouched.
- **Personal replay (after the fact, solo review of a finished match): speed is fine.**
  Nothing is shared, so the solo delta-accumulator (with 1×/2×) applies unchanged.

**playback.ts change: none.** This is a driver/screen policy (a boolean "allowSpeed").

---

## 7. The seam, precisely: LocalDriver vs OnlineDriver, and what each feeds the clock

The whole MP delta is a **clock-source swap behind an unchanged pure renderer**:

| Concern              | Solo (LocalDriver)                          | Online (OnlineDriver)                                   | In playback.ts? |
|----------------------|---------------------------------------------|---------------------------------------------------------|:---------------:|
| `elapsed` source     | rAF delta-accumulator × speed               | `now + skewOffset − startAt`, speed pinned 1×           | **no** (clock)  |
| `startAt`            | implicit "on mount"                         | server broadcast per match                              | **no**          |
| Clock skew           | n/a                                         | Cristian/NTP offset at join, refreshed                  | **no** (driver) |
| Speed buttons        | 1× / 2×                                      | hidden / ignored                                        | **no** (screen) |
| Late-join / seek     | n/a                                         | first `projectMatch(t, elapsed)` = current frame        | **no** (free)   |
| Pens beat            | pure from elapsed                           | pure from elapsed (same)                                | **no**          |
| Spectator timelines  | local `playRound` fills `featured`          | server fills `featured` (`WATCH_MARQUEE`)               | **no** (state)  |
| The frame itself     | `projectMatch(timeline, elapsed)`           | `projectMatch(timeline, elapsed)` — identical           | **the only call** |

Every row that changes is above the sim core. The bottom row — the actual pixels — is
byte-for-byte the same function call in both modes. **That is the proof: playback.ts is
mode-agnostic already; MP is an injection of a different `elapsed` into an unchanged
pure function.**

The clean refactor (architect-owned, not sim) is to make the clock *injectable* so the
screen doesn't hardcode the delta-accumulator: `useMatchClock` takes a `clock:
() => elapsedMs` (or a `{ startAt, now, offset, speed }` policy object). LocalDriver
passes the rAF accumulator; OnlineDriver passes the skew-corrected wall clock. `projectMatch`
sees only the number.

---

## 8. Cross-client visual determinism of `projectMatch` (honest caveat, low stakes)

RESEARCH-determinism.md owns the load-bearing question (is *engine* replay bit-identical
across browsers). One narrow slice touches me: if two clients each run `projectMatch` on
the same timeline, do they draw the same frame?

- **Gameplay-relevant outputs are integer/comparison-based and cross-client-identical:**
  score (`eventMs(minute) ≤ regMs`, `:177`), ticker membership (`:198–200`), shootout
  `revealed` count and `winner` (`:215–220`) all reduce to integer floors and
  comparisons on shared inputs. No transcendental decides *what happened* on screen.
- **Only cosmetic dot wobble uses transcendentals:** `dotView` adds
  `Math.sin/cos(elapsedMs · k + index)` at **±0.006** amplitude (`playback.ts:87–88`).
  ECMA-262 leaves `Math.sin/cos` precision implementation-defined, so V8/JSC/Gecko may
  differ in the last ULPs — meaning two clients could place a dot a **sub-pixel** apart.
  This is imperceptible and **non-authoritative** (dots are decoration; the ball, score,
  and events are not driven by the wobble).

**Verdict for sync:** playback rendering does **not** need bit-identical
transcendentals across clients, because the divergent term is sub-pixel cosmetic and
carries no game state. This is *independent* of the determinism doc's engine question
(can clients agree on the *timeline*); if that doc lands on "server-computed timelines"
(clients never recompute the engine), then clients share an identical timeline and even
the score/events question is moot — only the harmless wobble differs. Either way, no
playback.ts hardening is required for sync correctness. (If we ever wanted pixel-identical
recordings for e.g. shared clips, swap the wobble to a fixed-point/table-based
oscillator — a trivial, isolated change. Not needed for MP.)

---

## Options compared (sync-playback decisions)

| Decision | Options | Recommendation |
|---|---|---|
| Clock skew | (a) trust local clock; (b) Cristian/NTP ping offset; (c) transport server-ts | **(b)** at join + periodic refresh; fall back to **(c)** if the chosen transport (see RESEARCH-transport.md) already stamps trusted server time — then skip explicit pings |
| `startAt` distribution | per-match broadcast vs one round-level base + per-match delays | **Per-match `startAt` broadcast** — simplest, and matches "input-collection deadline → broadcast → play" in the protocol doc |
| Spectator timeline supply | (a) push all timelines; (b) pull-on-tap | **(b) pull-on-tap** for MVP (bandwidth-cheap, reuses `WATCH_MARQUEE`); reevaluate to (a) once determinism doc reports gzipped round-payload size |
| Speed in MP | allow / lock 1× | **Lock 1× in shared modes**, keep 1×/2× for solo + post-match personal replay |
| Clock injection | keep hardcoded in-screen clock / inject a clock source | **Inject** a clock provider so LocalDriver/OnlineDriver swap the `elapsed` source without forking the screen |

---

## Recommendation (one paragraph)

Ship MP playback as a **clock-source swap behind the unchanged pure core**. Server
broadcasts `{ matchId, startAt }`; each client renders `projectMatch(timeline, now +
skewOffset − startAt)`, with `skewOffset` from a lightweight NTP/Cristian offset estimate
at room join (or read from the transport's server timestamp if it provides one). Late-join,
reconnect, and penalty-beat sync all fall out of this formula for free and are already
covered by the pure-core seek tests. Spectator multi-match reuses the existing
`featured[] + WATCH_MARQUEE` machinery with server-supplied timelines (pull-on-tap). Speed
is pinned to 1× in shared modes. **Required changes to `src/game/playback.ts`: zero.** The
real work is an injectable clock (architect, in the screen/driver seam), a skew estimate
(driver + transport), and a spectator timeline feed (architect/state) — all above the sim
core, exactly as CONTRACT §5 intended.

---

## Open questions (for Main's synthesis / cross-doc)

1. **Round-advance authority.** Clients converge on `elapsed ≥ matchEndMs` locally, but
   who *authoritatively* ends the round and opens the steal/next-round phase — the server
   on a deadline, or the last client? (Protocol doc, RESEARCH-protocol.md, owns this; sync
   just needs the `startAt` for the *next* phase.)
2. **`startAt` in the future vs now.** Should `startAt` be "server time + small lead"
   (e.g. +500ms) so slower clients don't start mid-first-frame, or "now"? A small positive
   lead gives every client a moment to have the timeline in hand before elapsed goes
   positive. Recommend a **short lead**; exact value is a protocol tuning knob.
3. **Skew refresh cadence.** One estimate at join, or periodic? For a ≤57s match a single
   join-time estimate is plenty; a long room (many rounds) may want a refresh every few
   minutes to track drift. Cheap either way.
4. **Spectator payload size** blocks the push-vs-pull call — depends on
   RESEARCH-determinism.md's gzipped-round-timeline measurement. Flagging the dependency.
5. **Injectable-clock refactor ownership.** The clock currently lives in
   `MatchPlaybackScreen.tsx` (Main's file). The injectable-clock seam is small but crosses
   into the screen — confirm architect vs Main owns that edit. Sim will supply the exact
   `projectMatch` contract it must satisfy (it already does: any `elapsed` in, one frame
   out).

---

*Authored by MATCH-SIM (sim/playback core owner). No `src/` changes in this phase — this
file is the only artifact. Line references against `src/game/playback.ts`,
`src/game/state.ts`, `src/screens/MatchPlaybackScreen.tsx`, `src/engine/types.ts` as of
2026-07-12.*
