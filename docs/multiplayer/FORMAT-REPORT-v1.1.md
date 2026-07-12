# Multiplayer Format Report — Lucca's locked spec vs the R2 plan

Status: **v1.1 input** (Main, 2026-07-11). Post-playtest workstream B.
Reviews `MULTIPLAYER-PLAN.md` v1.0 + all six RESEARCH docs against the now-locked
format spec. No implementation in this phase.

**The locked spec (verbatim intent):** Ready → lobby of 20 managers; auto-start at
20 seats or anyone presses "fill with bots to begin". Draft: after each spin, a 10s
pick timer, all 20 pick simultaneously; every spin assigns each manager a DISTINCT
team (20+ teams ⇒ disjoint pools); already-drafted players excluded from all future
spins (global uniqueness); no rerolls, ever; repositioning allowed during the timer.
Tournament then runs exactly like solo, and every manager watches playback at their
own speed. Overriding priority: **match speed, minimal waiting**.

---

## 1. Mapping onto the host-authoritative architecture

**Verdict: the spec fits the R2 architecture cleanly, and it SHRINKS the MVP.**

What holds unchanged from plan v1.0 / RESEARCH-protocol:
- **Host-authoritative room on Supabase Realtime** (Broadcast + Presence + input
  log). Nothing in the spec needs a server engine; the host still mints the seed,
  owns deadlines, orders actions, and broadcasts computed `MatchTimeline`s
  (`kind:'timelines'`, 3.6 KB gzipped per watched match — determinism verdict
  unchanged and still moot for clients).
- **Actions are the protocol, the reducer is the state machine** (protocol §3).
  The 10s pick window is just a per-pick `deadlineAt`; timeouts become authority-
  emitted actions like every other input. Reducer untouched.
- **The Driver seam** (`LocalDriver` = today's handlers, `OnlineDriver` = the room
  channel feeding the same reducer actions) is exactly as specced. Solo stays
  byte-identical behind `LocalDriver`.
- **Playback.ts: still ZERO changes** — in fact the own-speed ruling *depends* on
  the pure `projectMatch(timeline, elapsedMs)` property (sync doc §1). Own-speed
  viewing is the solo delta-accumulator clock, verbatim.

What the spec REMOVES from the R2 MVP (this is the big news):
- **Synchronized viewing is out** — no shared `startAt` for match playback, no
  clock-skew estimation (Cristian/NTP offset machinery), no speed-lock policy, no
  "pens beat lockstep across clients". That was the only genuine distributed-
  systems problem in the sync doc, and Lucca's own-speed ruling deletes it from
  the MVP entirely. Deadlines still use server-epoch timestamps, but a countdown
  that's 150ms off is invisible; nothing frame-accurate remains.
- **Respin plumbing is out** (no rerolls, ever). The `respin` intent and
  `respinTokens` never enter the MP protocol. (Solo keeps respins unless Lucca
  says otherwise — mode-specific rule, one flag.)

What the spec ADDS (all bounded):
- **Per-spin team assignment** — a pure function of the room seed (§2 below).
  Small, deterministic, no messages.
- **Global player-uniqueness filter** — spin pools exclude every drafted player.
  Derived from the action log, so it's deterministic and free (§2).
- **Lobby of 20** — today's engine is built around `LOBBY_SIZE = 32` and the cut
  ladder `[24,16,8,4,2,1]`. A true 20-seat tournament needs a 20-ladder (decision
  for Lucca, §6). This is the only *engine-adjacent* change the spec forces:
  parameterize lobby size + survivors table. Small, but it touches tested
  constants, so it's a deliberate change, not a config tweak.
- **Input-barrier round progression** (§4) — replaces the playback barrier the R2
  state machine had. Simpler than what it replaces.

**Updated estimate for "split `playRound()` behind a Driver interface":** the crux
is unchanged — solo resolves a whole round synchronously in a click handler; MP
splits it at the input-collection deadline (collect → authority resolves →
broadcast). That refactor is still the load-bearing ~day of careful work with the
solo test suite as the safety net. But the MVP *around* it got cheaper: no skew
estimation, no shared-clock playback, no speed policing, no respin protocol. R2
said "a focused weekend"; with this spec I'd say **a focused weekend with margin**,
and the risk concentrated in exactly one refactor instead of one refactor plus a
distributed-clock subsystem.

---

## 2. Pick contention: solved by construction — the assignment spec

Contention is designed out twice over: disjoint per-spin team pools (no two
managers ever pick from the same squad in the same window) and global uniqueness
(no player exists in two pools across time). **No conflict-resolution logic,
no optimistic locking, no race handling. Nothing to build.**

**Team-to-manager assignment per spin (my recommendation): seeded shuffle + stride
rotation.** Once per room, shuffle the squad list with `roomRng(seed)`. For spin
`k` (0-based), manager in seat `m` gets squad index `(k·20 + m) mod N` in the
shuffled list, where `N` = eligible squad count.

- **Disjoint within a spin** by construction: seats 0..19 hit 20 consecutive
  distinct indices.
- **No manager sees the same team twice across the draft** for free when 20 is
  invertible mod N (any N coprime with 20 — true for today's 57 squads):
  manager m's squads across spins are `k·20 + m mod N`, all distinct for
  k = 0..10. One shuffle + one formula = a Latin-rectangle draft with zero
  bookkeeping.
- **Deterministic from the room seed**: every client computes the same assignment
  table at draft start; the authority never broadcasts pools. Rotation beats
  "random without repeats" because it needs no rejection sampling and no state —
  and it's just as invisible to players after one shuffle.
- **Eligibility filter**: before applying the formula for spin k, drop squads
  with zero undrafted players (drained by global uniqueness). The drafted set is
  a pure fold over the ordered action log the authority already keeps, so the
  filtered list is identical on every client. If the filter breaks coprimality
  (N becomes a multiple of 2 or 5), fall back to "rotation, allow rare per-manager
  repeats" — a repeat shows the manager a squad with different players remaining,
  which is fine and worth zero engineering.
- Capacity check: 11 picks × 20 managers = 220 players drafted, out of 1,038 in
  57 squads (~18 each). Squads deplete but essentially never drain; the filter is
  a belt-and-suspenders edge case.

Confirmed: **pools stay deterministic from the room seed** — assignment is
`f(seed, spinIndex, seat)` and the exclusion set is `f(action log)`, both already
canonical in the protocol.

---

## 3. AFK inside the 10s timer

Reconciles directly with the R2 deterministic auto-pick (protocol §4.3), with the
pool rules layered in:

- The authority runs the per-pick `deadlineAt`. At timeout it emits a normal
  `PLACE` action computed by the existing greedy bot policy: **highest
  `effectiveRatingV2` legal pick from the manager's assigned squad this spin,
  into their best open slot** — respecting the assigned pool, global uniqueness,
  and the per-XI person rule. Same code path bots use; seeded; replayable.
- Clients never self-advance; they render the countdown (protocol §4.2). A
  manager who picked early just waits out the tail of the 10s — with all 20
  picking simultaneously, the spin cadence is fixed and the draft takes
  ~11 × (spin beat + 10s) ≈ **3 minutes flat** regardless of AFKs. No one can
  stall the room; the R2 property survives intact.
- Repositioning during the timer is `MOVE_PLACED` (already shipped for solo's
  between-match board) sent as an intent — legal until the pick deadline, ordered
  by the authority like everything else. An AFK manager never needs repositioning:
  auto-pick places into the best slot by construction.
- **Timer start (recommendation, mine to make as UX owner):** the 10s window
  starts when the reels SETTLE, not when the spin begins — the slot-machine beat
  is the hook, and docking its runtime from the think time would make the machine
  feel like a tax. Since spins are simultaneous and the animation is fixed-length,
  this costs ~3s per pick of shared ceremony, identical for everyone.

---

## 4. Own-speed viewing vs round progression

The question: does round N+1 wait for the slowest viewer? **No. Rounds barrier on
INPUTS, never on playback.**

Key insight from the codebase: playback is pure presentation over already-decided
results. The authority resolves ALL matches at the tactics barrier and broadcasts
the round (results + timelines). From that moment the only things round N+1
genuinely needs are each survivor's **decisions**: steal choice, re-slot, ready.
Watching is optional consumption of a thing that already happened — solo's skip
button is the existing proof.

**Recommended model — the decision-deadline round:**

1. Authority broadcasts round N (results + the manager's featured timelines).
2. Each client plays its own featured matches on the LOCAL clock — 1×, 2×, or
   skip, exactly like solo. No shared match clock exists.
3. One **round input window** runs in parallel, generous enough to watch at 1×
   and still decide: featured playback (≤57s worst case with pens) + steal/re-slot
   time ⇒ **~85–90s deadline** (Casual profile), measured from the broadcast.
4. The barrier fires at `deadlineAt` OR **the moment all live humans have
   submitted** — whichever comes first. A room of skippers rips through rounds in
   ~20s each; a room of watchers never feels rushed. Missing inputs at deadline
   get the deterministic fallbacks (keep-XI, no steal, previous tactics).
5. A viewer still mid-playback when the barrier fires is NOT yanked: round N+1's
   broadcast arrives and queues; their screen finishes the current match, then
   offers "next round is ready →". They can also keep a slow pace indefinitely —
   they're only ever spending their own time, because their inputs already
   defaulted. (Their view catches up by playing from the queue; timelines are
   tiny, so buffering rounds is free.)
6. Elimination: you always get to watch your own doom — the transition to
   spectator happens when YOUR playback of the fatal round ends, not when the
   server decides it. Spectators inherit the same own-speed rights over any
   surviving manager's timeline (pull-on-tap per the sync doc §5).

This is the maximum-speed shape: **the tournament advances at the pace of
decisions, and decisions have hard deadlines; watching can never block anyone,
including yourself.** It also deletes the last reason the R2 plan had a PLAYBACK
barrier in the room state machine — the phase diagram simplifies to
LOBBY → DRAFT → (RESOLVE → INPUT-WINDOW)×rounds → END.

---

## 5. Nearby format variants (explored, with verdicts)

**(a) The Shared Finale.** All-async viewing for rounds 1–4, but the FINAL plays
synchronized: one broadcast `startAt`, all 20 (2 finalists + 18 spectators
"rooting") watch the same 45–57s together, pens beats landing simultaneously for
everyone. This is the one moment where shared tension beats convenience, and it's
where the rooting-for mechanic pays off. Cost: it resurrects a *single-use* slice
of the sync machinery — but the tolerant version (viewers within ±1s is fine, no
NTP, trust the transport timestamp) is nearly free. **Verdict: recommend — flag
as the one exception to own-speed, pending Lucca.**

**(b) Contested spins (shared pool, first-tap-wins).** Instead of disjoint pools,
all 20 managers see the SAME squad each spin and race to claim players. Maximum
chaos and "he took my guy!" energy, and it's how most fantasy drafts create drama.
But it reintroduces everything the locked spec just deleted: claim races, conflict
resolution, latency sensitivity (the fastest connection wins ties, which reads as
unfair), and per-claim broadcasts. Directly hostile to the minimal-waiting
priority. **Verdict: reject for this game; the slot machine + disjoint pools is
the better identity.**

**(c) Blitz profile.** Same format, tightened dials: 5s picks, 2× default
playback, 45s input windows ⇒ a full 20-manager tournament in ~8–10 minutes.
Since every number involved is already a timer-profile config in the R2 protocol
(deadlines are data, not code), this is a lobby toggle, not a feature. **Verdict:
ship the dials as a host option (Casual/Blitz) — nearly free, and it's the
"one more run" button for a hackathon demo.**

**(d) Duel room (2 humans + 18 bots).** Already free by construction — "fill with
bots to begin" at 2 humans IS this mode. No design work; just make sure the lobby
copy doesn't make 2-player rooms feel like a failure state. **Verdict: no work,
market it as a mode.**

---

## 6. Decisions for Lucca

Carried from v1.0 (now the only two left standing from that list):
1. **Trust vs commit–reveal for tactics in MVP.** Recommendation stands: trust
   for friends-rooms MVP; commit–reveal is additive later (protocol §4.4).
2. **The "rooting for" spectator mechanic** — in or out? (Pairs naturally with
   variant (a)'s Shared Finale.)

New, surfaced by this spec:
3. **The 20-manager cut ladder.** Today's engine ladder is 32→[24,16,8,4,2,1].
   For a 20-lobby I recommend **20 → 16 → 8 → 4 → 2 → 1** (five rounds, all even,
   pens active from 16 alive per the ≤16 rule, same 6-round *feel* as solo).
   Alternative: keep the engine at 32 and fill 12 extra bot seats invisibly —
   zero engine change but 20 humans + 12 ghosts muddies the standings. I
   recommend the real 20-ladder.
4. **Shared Finale — yes/no** (variant a).
5. **Slow-watcher policy at the barrier**: my recommended default is "never
   yank, queue the next round" (§4.5); the alternative is auto-skip to results
   when the barrier fires. Confirm the default.
6. **Does solo keep respins?** MP has none by spec; I recommend solo keeps them
   (they're a fun solo luxury, and it's one mode flag either way).

---

## 6b. RULINGS (Lucca, 2026-07-11 — supersede the open items above)

1. **Viewing model: LOCKSTEP, not own-speed.** One steady simulation speed for
   everyone on a shared clock; §4's decision-deadline/own-speed model is
   SUPERSEDED. Cycle: 3 synced match slots → one synced pit stop → repeat.
   Speed buttons/skip do not exist in MP (solo keeps them). Coarse clock sync
   (transport timestamps, ±150ms tolerance) returns to scope; NTP-grade sync
   still unnecessary. Shared finale comes free; slow-watcher policy is moot.
2. **The pit stop is COMBINED — 45s** (wave-2 retune; the original 20s proved too tight in the first live playtest, and picks went 10s → 30s): loot steal + re-slotting +
   formation/style changes in one window. Fallbacks at deadline: no steal,
   keep arrangement, keep tactics.
3. **Solo gets the combined pit stop too** — formation/style changes join
   re-slotting on the between-match board (solo is untimed). Feature queued.
4. **MP match slots run 30s** (not 45) to cut tournament time. Duration becomes
   a mode parameter: solo playback stays 45s unless Lucca says otherwise.
   Round ≈ 3×~30–42s (pens add 6s/kick) + 45s pit ≈ **~2.5 min; tournament ≈ 10–12 min**.
5. **Cut ladder confirmed: 20 → 16 → 8 → 4 → 2 → 1.**
6. **Rooting-for mechanic: IN** — eliminated players pick a survivor to back;
   shown during pit stops and on the end screen.
7. **Solo keeps respins** (MP has none, per the locked spec).
8. **Trust vs commit–reveal: RULED (Lucca, 2026-07-11) — TRUST for the MVP,
   commit–reveal ships as a LATER FEATURE** (additive on the same message
   schema, per protocol §4.4; flip on for ranked/public rooms). With this,
   every multiplayer design decision is closed — the format is fully locked.
9. **All-locked-in fast-forward (Lucca, 2026-07-11, from lobby feedback in the
   wave-2 playtest):** the moment EVERY human in the room has locked in a pick
   (or, in the pit stop, every surviving human has submitted), the countdown
   snaps to a 5s fuse (`MP_HURRY_MS`) instead of running out the full window.
   The host pulls its deadline forward and broadcasts a `hurry` message so all
   countdowns jump together; the timer label flips to a gold "ALL LOCKED IN".
   The pick/pit windows are ceilings for slow lobbies, not mandatory waits.
10. **Picks retuned 30s → 20s (Lucca, 2026-07-11, wave-3 playtest).** With the
    5s all-locked-in fuse absorbing fast lobbies, 30s was dead air; 20s keeps
    pressure on without punishing phones. `MP_PICK_MS = 20_000`.
11. **Public lobbies + QUICK PLAY: IN (Lucca, 2026-07-11).** A host can flip a
    private lobby public; quick play joins the fullest open public lobby or
    creates a new public one. Directory = a shared presence channel, no
    database; a listing dies with its host's tab.
12. **Global player uniqueness across ALL seats is FINAL (Lucca, 2026-07-11,
    engine mp-6).** One shared drafted set for humans and bots alike — once
    anyone drafts a player, he's gone for the whole room; loot obeys the
    same-person rule; the host enforces both at a trust boundary against
    doctored clients. (Supersedes the brief mp-4 solo-parity experiment where
    bots drafted from a private pool.) The 57-squad / 1,038-player data pass
    is what makes the shared drain affordable.

## 7. What this means for plan v1.1

When Lucca rules on §6, plan v1.0 §1 (product design) gets rewritten around:
mode fork → Ready → 20-seat lobby with fill-bots button → simultaneous
slot-machine draft (10s picks, stride-assigned disjoint pools, no rerolls) →
decision-deadline rounds with own-speed playback → (optional shared finale) →
END + Hall of Champions. The architecture section survives verbatim minus the
synchronized-viewing subsystem, which moves to an appendix gated on variant (a).
Effort: MVP still a focused weekend; the deleted skew/sync work is the margin.
