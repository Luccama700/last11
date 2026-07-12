## Inspiration

The World Cup was on, and we kept having the argument every football fan has: could a squad drafted from all of history beat the best team of today? Fantasy football answers that slowly, over a season. We wanted to answer it in fifteen minutes, with elimination stakes: a battle royale where 32 managers draft across 96 years of World Cup history and only one survives. Then we set ourselves a harder goal: make it real-time multiplayer with no game server and no database.

## What it does

**Last11** ([last11.app](https://last11.app)) is a football sim battle royale:

- **Draft**: a slot machine deals you historic World Cup squads (57 squads, 1,038 players, 1930 to 2026: 97 Pelé, 86 Maradona, 94 CR7). You place picks on a tactics board across 10 formations. Off-position players pay an affinity penalty, and the game knows 2022 Messi and 2026 Messi are the same person.
- **Survive**: a simulated tournament with live match playback, momentum, event tickers, and penalty shootouts. The bottom of the table goes home each round: 32 → 24 → 16 → 8 → 4 → 2 → 1.
- **Loot**: between rounds, take one player from a fallen manager's squad, re-slot your XI, and change formation and style.

**Multiplayer**: 20-manager online rooms with public lobbies and quick play. Everyone drafts at the same time, watches matches in lockstep on a shared clock, and loots from real fallen opponents. Every player is globally unique across all 20 teams. Eliminated managers stay to spectate and pick a survivor to root for.

## How we built it

The core decision: the match engine is a pure function of a seed. Every match is deterministic TypeScript over a mulberry32 PRNG, so the same seed produces a byte-identical tournament on any device.

The math inside the engine:

- Each XI collapses to zonal strength indices (defence, midfield, attack) as convex combinations of affinity-weighted ratings, which set each side's expected goals $\lambda$. Scorelines are drawn from a Poisson process (Knuth's sampler) with an inverted Dixon-Coles correction that trims low-scoring draws, calibrated to about 3.4 goals a match.
- Goal minutes are rejection-sampled so no two goals share a minute, and scorers are drawn from a shot-weight distribution over the XI.
- Penalty shootouts are a Markov chain with an early-decision absorbing state, and each kick is taker vs keeper:

$$p = \mathrm{clamp}\big(0.75 + 0.010\,(\text{taker} - 75) - 0.008\,(\text{gk} - 75),\ 0.30,\ 0.95\big)$$

Determinism is what makes the multiplayer work. The host broadcasts one seed and one start time over a Supabase Realtime channel (broadcast and presence only, zero database tables). Every phone simulates the identical match locally and plays it on a shared wall clock, corrected by a median-of-samples clock-offset estimator. Twenty screens, one game, no server.

The rest of the multiplayer comes from number theory and hashing:

- Simultaneous drafting with no pick contention: squads are dealt by stride rotation, where seat $m$ gets squad $(20s + m) \bmod N$. Every spin's 20 squads are disjoint by construction, and $\gcd(N, 20) = 1$ means you never see the same squad twice.
- Every host message carries an FNV-1a hash of the entire game state, so any two phones either agree on everything or find out immediately.
- Public lobbies have no directory database: rooms announce themselves on a shared presence channel, so a listing lives exactly as long as its host's tab does.

Stack: React 19, TypeScript, Vite, Tailwind 4, Vitest (353 tests), Supabase Realtime, Vercel.

## Challenges we ran into

- **Broadcast messages get dropped.** Realtime channels don't replay missed messages, so guests could desync mid-tournament. We built a self-healing stack: the host keeps a durable event log, a desynced client requests a catch-up and replays the log through the same apply path, and a phase watchdog catches the one message (game end) that has no successor to reveal its loss. A reloaded phone rejoins mid-game into its own seat.
- **Two Pelés.** Players duplicated across teams through three separate holes: bots drafting from the wrong pool, looting without a same-person check, and the host trusting client-submitted squads. We closed all three. The host now enforces uniqueness at a trust boundary, so even a modified client can't field two Pelés.
- **Spoilers on the shared clock.** Every phone computes every result instantly, but the live table must only count matches that have finished on the shared clock, otherwise the standings leak your own next result.
- **Squad balance at scale.** With 20 humans draining one shared player pool, late seats got starved. We ran Monte Carlo simulations over 1,200 drafts and grew the database until under 25% of drafted XIs fell below our quality floor, then made that a permanent test.

## Accomplishments that we're proud of

Serverless real-time multiplayer that survives dropped messages, page reloads, and hostile clients, verified by full host-plus-guest tournaments running over an in-memory bus in CI and asserting both mirrors stay byte-identical. All of it built in one weekend.

## What we learned

Determinism pays for itself many times over: making the simulation a pure function turned netcode, testing, replay, and rejoin into the same problem with one solution. We also learned that distributed systems fail exactly the way the literature says they do (clocks drift, messages drop, clients lie), and each failure mode needs its own answer.

## What's next

32-seat online lobbies, host migration so a room outlives its host, commit-reveal drafting, and community rating polls to keep the 1,038-player database honest.
