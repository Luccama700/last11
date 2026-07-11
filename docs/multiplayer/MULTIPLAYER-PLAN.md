# Last11 Multiplayer — The Plan (Phase R2 synthesis)

Status: **DRAFT v0.1** (Main, 2026-07-12) — product design written; architecture
verdict, feasibility numbers and roadmap PENDING the six RESEARCH-*.md docs.

## 1. Product design (Main's lane — this section is the design)

### Mode select
The home screen becomes a fork: **SOLO RUN** (today's game, unchanged, instant)
and **BATTLE ROYALE ONLINE** → create room / join by code. One game, two entry
doors; everything after the lobby looks identical in both modes.

### Lobby
- Room code (5 letters, shareable link `11a0.com/r/GOLDN`). Host creates, picks
  lobby size cap and phase-timer profile (Casual / Fast).
- Seats fill with humans as they join; at kickoff every empty seat gets a bot
  (the funny names stay). 2 humans minimum, 32 seats always.
- Lobby shows crests + names joining live; host presses START — from that moment
  every phase runs on the shared room clock, nobody waits on stragglers.

### The shared-clock principle (the core UX decision)
Solo Last11 is turn-paced; online Last11 is PHASE-paced. Every phase has a fixed
window and a deterministic fallback, so one AFK player can never stall 31 others:
- **Setup** (formation/style): 45s → fallback: 4-3-3 balanced.
- **Draft**: everyone drafts SIMULTANEOUSLY on their own board — 11 picks inside
  one shared window (~3 min Casual) with per-pick soft deadlines; timeout =
  deterministic auto-pick (the bot policy, seeded, so it's fair and replayable).
  A live rail shows opponents' fill-progress (7/11...) for pressure.
- **Rounds**: results resolve at the deadline; everyone watches their own featured
  match simultaneously (same wall-clock duration — this is why we built fixed
  45s playback), rails tick the other matches live.
- **Steal window**: 30s, simultaneous, hidden picks (revealed together).
- **Between matches**: re-slot window 20s, or skip.

### Elimination → spectatorship
Getting cut must stay fun: eliminated humans become SPECTATORS — they see the
standings popup pinned, can watch any surviving match as their featured view
(the marquee mechanic), and get a "rooting for" pick that shows on the end
screen. They never get kicked to a lobby; they see the crowning.

### The end
Shared end screen: champion banner (human or bot), Golden Boot/Playmaker,
per-human placements, and the persistent HALL OF CHAMPIONS (already landing in
solo tonight) which in MP records the room's winner by name.

### What solo keeps
Solo remains exactly today's game (its own pace, skip buttons, speed controls —
those are removed only in MP). Same screens, same engine; the mode only changes
who supplies inputs and who owns the clock.

## 2. Architecture decision — PENDING RESEARCH
Two candidate shapes (the determinism audit decides):
- **A. Deterministic client replay**: server relays (seed + everyone's inputs +
  startAt); clients recompute matches locally. Cheapest bandwidth; requires
  bit-identical math across browsers (Math.exp risk — see RESEARCH-determinism).
- **B. Server-computed timelines**: one Node/Edge runtime runs the SAME pure
  engine, broadcasts full MatchTimelines (~KBs); clients only play back
  (pure(timeline, elapsed) — zero cross-browser risk). Slightly more bandwidth,
  radically fewer determinism footguns, and anti-cheat comes free.
Main's prior: **B for MVP** unless the determinism audit proves A trivially safe
— B also keeps the client dumb enough that phones/weak devices never desync.

## 3. Major changes inventory — PENDING RESEARCH-protocol
Known already: seed comes from the server not Math.random; rngRef/engineCtxRef
move behind a Driver interface (LocalDriver = today's handlers; OnlineDriver =
room channel); state machine gains WAITING/DEADLINE states + phase clock; App
timers respect server startAt; auth = anonymous session per room.

## 4. Feasibility & roadmap — PENDING (effort tiers land with research)
Expected shape: **MVP** = private rooms 2–8, casual trust, server timelines,
Supabase or PartyKit transport; **v2** = 32 seats, reconnect hardening,
certification/ranked; **v3** = matchmaking, persistent accounts.

## 5. Decisions for Lucca — collected here as research lands
1. MVP seat count (2–8 vs full 32 from day one)?
2. Casual trust vs commit-reveal in MVP?
3. Phase timer profiles (Casual/Fast values above — tune)?
4. Spectator "rooting for" mechanic — in or out?
