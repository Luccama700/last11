# RESEARCH — Testing Multiplayer Without Pain (QA)

**Scope-capped to one page** (Main, night-of): multi-client sim harness sketch,
input-log replay property test, clock-skew fuzz approach, cross-env
golden-timeline plan. Written after `MULTIPLAYER-PLAN.md` v1.0 landed, so this
targets the RESOLVED architecture (host-authoritative MVP, `kind:'timelines'`
default both tiers, `GameDriver`/`Intent`/`Server`/`RoomState` from
`RESEARCH-protocol.md` §3/§5) rather than re-litigating open questions.

## 1. Multi-client sim harness — N fake drivers, one fake authority, all vitest

No real transport needed. The protocol doc's TL;DR is the whole test strategy:
**the reducer already IS the room state machine.** So the harness is a
`FakeAuthority` that reimplements the authority's ordering/barrier/deadline
logic in-process, sitting on the *same* `reducer(state, action)` from
`game/state.ts` every client already uses — no mocks of it.

```ts
// sketch — lands once OnlineDriver/authority code exists; contract-tests
// against the types RESEARCH-protocol.md already froze (Intent/Server/RoomState).
class FakeAuthority {
  private log: Action[] = [];
  private clients = new Map<Seat, (msg: Server) => void>();
  connect(seat: Seat, onMsg: (msg: Server) => void) { this.clients.set(seat, onMsg); }
  submit(seat: Seat, intent: Intent) { /* validate, order, gate, seed/deadline-inject,
    convert accepted intent -> canonical Action, push to log, broadcast {t:'action',...} */ }
  advanceDeadline(phase: Phase) { /* emit deterministic fallback actions for AFK seats */ }
}

it('N clients converge to identical GameState from the same intent stream', () => {
  const authority = new FakeAuthority(seed);
  const clients = seats.map((s) => new FakeClient(s, authority)); // each runs its own
  //   reducer(state, action) fold over authority's broadcasts, driver-shaped
  driveADraftRound(clients);            // scripted intents incl. an AFK seat
  authority.advanceDeadline('draft');   // forces the auto-pick fallback path
  const states = clients.map((c) => c.state);
  states.forEach((s) => expect(s).toEqual(states[0]));  // convergence, not just no-crash
});
```

Key property to assert beyond "doesn't crash": **convergence** — every
client's independently-folded `GameState` is `toEqual` after any given
broadcast, including the AFK/deadline-fallback path (deterministic auto-pick)
and the atomic-apply paths (`STEALS_APPLIED`, round recording — already a
state invariant per night-batch-2, which is exactly what this needs). Also
worth a seat-scoped-RNG regression once `seatRng(seed, seat)` lands: seat A's
picks must be bit-identical regardless of what order seat B's intents arrive
in (§4.3's "no cross-player draft contention" claim, made assertable).

## 2. Input-log replay property test

Protocol §6: room state = `(seed, ordered action log)`; reconnect replays the
log through the reducer. That's a textbook replay-determinism property,
already the shape of `engine/invariants.v2.test.ts` (same seed ⇒ `toEqual`)
one layer up at the reducer instead of the engine core.

- **Property A (full replay):** for any legal action sequence, folding it
  through `reducer` from `initialState` twice yields identical terminal state.
- **Property B (prefix + rejoin):** replaying log[0..k] then continuing with
  log[k+1..n] reaches the *same* state as replaying log[0..n] in one pass, for
  every k. This is the actual thing `rejoin{sinceSeq}` depends on — testing it
  directly is cheap insurance the schema's reconnect story holds, not just the
  happy path.
- **Generation:** hand-roll a seeded legal-action generator reusing the
  codebase's existing `createRng` (already the pattern in `draft.v2.test.ts`,
  `balance.report.ts`) rather than adding `fast-check` as a new dependency —
  flagged as an open question below if shrinking/minimal-counterexample output
  turns out to matter once this is real.
- **Not this doc's job:** out-of-order/duplicate *delivery* at the wire layer
  (network can reorder/dupe; `seq` is the ordering spine per §5) — that's a
  transport-layer concern for whichever driver ships, not the reducer, which
  is already pure and gets a `seq`-ordered stream by contract.

## 3. Clock-skew fuzz approach

Skew hits two places, and they need different tests:

- **Deadline countdowns** (`deadlineAt`, server-epoch): fuzz the ping/pong
  offset estimator (`{t:'ping',clientNow}` → `{t:'pong',clientNow,serverNow}`,
  Cristian's-algorithm-style per protocol §10) against a fake network with
  configurable one-way latency (fixed / jittered / asymmetric) — assert the
  estimated offset converges within a bounded error after N round trips.
  Blocked on the estimator existing; this is a spec for match-sim's landing,
  not buildable today.
- **Playback sync** (`startAt`): NOT a skew-fuzz target — `sync-playback.md`
  already proves `pure(timeline, elapsed)` makes skew a cosmetic-only concern
  (a wrong clock just shifts perceived `elapsed`, never mutates the timeline).
  The useful fuzz here is adversarial-`elapsed` boundary testing on
  `projectMatch` directly: negative, far-past-`matchEndMs`, and exactly-at
  values (I already added the exact-boundary case in `playback.test.ts` this
  cycle) — extend that suite with a randomized elapsed-value sweep once late
  join/reconnect seek is wired, rather than building a separate skew harness.

## 4. Cross-env golden-timeline test — only needed for v2

Per `MULTIPLAYER-PLAN.md` §0's resolved verdict: **MVP is host-authoritative**
— exactly one browser computes the canonical timeline per round; clients only
ever play back what's shipped. There is no cross-environment agreement to
verify at MVP, so this test would be pure busywork there (same "don't
manufacture tests against a non-gap" call as Night Batch 2).

It earns its keep at **v2**, once the authority moves into a serverless
function (`RESEARCH-determinism.md`'s resolved `Math.exp` ~10⁻¹⁵ asterisk is
the reason, not a new worry — `timelines` mode already sidesteps needing
*novel* cross-browser identity). The real purpose there is a **golden-master
regression guard**: catch a silent float-output change from a runtime/Node
upgrade or a dependency bump touching the Poisson sampler, not prove browser
A agrees with browser B.

**Plan (v2, deferred — do not build now):** freeze a handful of
`(seed, round, inputs)` cases once the server-authority code exists; commit
their `simulateMatchTimeline` output as JSON fixtures; assert byte-identical
reproduction in CI on the pinned deploy runtime. Runs as an ordinary vitest
test — no actual multi-browser execution required, since v2 still only ever
has one canonical computer (the server); "cross-env" here means *this*
runtime vs the frozen fixture, catching drift over time rather than disputing
identity across engines at any one moment.

## Recommendation

Build (1) multi-client harness and (2) replay-property tests as soon as the
driver seam / `FakeAuthority`-equivalent lands — they're fully specified
against the types `RESEARCH-protocol.md` already froze, so they can be
written test-first alongside the implementation. (3) splits: the deadline/skew
estimator fuzz waits on that module; the `elapsed`-boundary sweep on
`projectMatch` can start now (I own that file). (4) is explicitly **v2-only,
deferred** — noted here so nobody builds it prematurely against MVP.

## Open questions

1. `fast-check` vs hand-rolled seeded generators for property tests — leaning
   hand-rolled to match the codebase's existing zero-new-dependency posture;
   revisit if shrinking output proves worth the addition once real bugs show up.
2. Does `FakeAuthority` in (1) get promoted into the *actual* MVP host-authority
   implementation (test harness IS the reference impl), or stay test-only with
   a separate production authority? Cheaper to converge them; architect's call
   once the driver seam lands.
3. Golden-timeline fixture count/cases for (4) — deferred with the feature,
   not decided now.
