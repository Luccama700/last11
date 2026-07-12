# Last11 — demo video run-of-show (every feature, solo → multiplayer)

Recording order below = reveal order. **Bold** = say it on camera; the
parentheticals are the details that make judges lean in. Hard refresh every
device first (engine `last11-mp-6`).

## Cold open (10s)

- last11.app on screen. **"Every draft football sim is single-player. Nobody
  has built the battle royale — so we did, in a weekend."**
- Home screen: the three-step pitch cards (Draft 🎡 / Survive 📉 / Loot 💀).

## Act 1 — SINGLE PLAYER

1. **Pre-draft setup** — pick your formation (**10 real shapes**, 4-3-3 to
   4-1-2-1-2 wide), playing style (defensive / balanced / attacking), and
   mode: **Classic** (ratings shown) or **Memory** (ratings hidden — trust
   your football knowledge).
2. **The slot-machine draft** — spin THE DRAW: it lands on a nation AND a
   World Cup year, **1930 to 2026, 57 historic squads, 1,038 players**
   (Brazil 1970 Pelé 97, Argentina 1986 Maradona, Portugal 2018 CR7 94,
   Belgium 2018 De Bruyne…). Squad card ranks every option by the points
   it adds to YOUR board right now; best pick wears gold trim.
3. **The board is a real tactics board** — tap-to-place on the pitch,
   reposition mid-draft, off-position players cost affinity (wingers can
   play wide-mid, a striker in goal cannot); "no same person twice" —
   the game knows 2022 Messi and 2026 Messi are the same human.
4. **3 re-spin tokens** — hate the roll, burn one.
5. **The tournament** — 32 managers, 3 matches a round, the table's bottom
   goes home: **32 → 24 → 16 → 8 → 4 → 2 → 1**.
6. **The match engine** (linger here — it's the technical meat):
   - pure deterministic TypeScript, seeded — same seed, byte-identical
     tournament, provable by our test suite (353 tests)
   - xG-calibrated scoring (~3.4 goals/match), tactics matter both ways,
     morale carries between rounds
   - live pitch with player dots, momentum bar, ticker with **fouls,
     corners, goal kicks, throw-ins** attributed to the right players
   - **team-aware goal banners**: your goals climb gold → lime → cyan →
     purple for multi-goal bursts; enemy goals descend into darker reds
   - scoreboard shows **formations + total XI rating** for both teams;
     lineups flank the pitch (stacked below on mobile)
   - "Elsewhere this round" live-score rail — shows ONLY the matches from
     the same slot you're playing (no spoilers)
   - penalty shootouts: taker-vs-keeper math (**94 CR7 vs an 80 GK ≈ 90%,
     80 taker vs a 93 wall ≈ 65%**), takers named as they step up,
     no-spoiler reveal kick by kick
7. **The pit stop** — between rounds, one combined board: **loot one player
   from a fallen squad** (bots are looting too, in seat order), re-slot
   your XI, change formation AND style.
8. **End screen** — placement, run summary, **Hall of Champions**
   (persistent local history of your crowns).

## Act 2 — MULTIPLAYER (the headline — say "no game in this genre has this")

9. **PLAY ONLINE** → rooms with 5-letter codes, OR the **PUBLIC LOBBIES**
   system: host flips a lobby public, anyone on **QUICK PLAY** drops into
   the fullest open lobby — nobody waits alone. Empty seats become bots at
   kickoff (20-manager rooms).
10. **Lobby** — set your shape & style while you wait; live presence chips.
11. **Simultaneous slot-machine draft** — all 20 managers spin AT ONCE;
    every spin deals each manager a **different squad** (disjoint by
    construction) and **every player in the room is globally unique** —
    once anyone drafts him, he's gone for all 20 teams. 20s picks, and the
    moment every human has locked in, the countdown **snaps to 5s** ("ALL
    LOCKED IN").
12. **Lockstep viewing** — everyone watches together on a shared clock at
    1.5×, no skips: 3 synced match slots, per-slot live scores of every
    other match at the bottom.
13. **The waiting room** — finish early and you see your full-time score,
    every other match still ticking **including their penalty shootouts
    kick-by-kick**, a countdown to your next match, and the **spoiler-safe
    LIVE TABLE** with the pulsing red cut line — it only counts matches
    that have finished on the shared clock.
14. **Synced pit stop** — 45s, loot + re-slot + tactics on one board, loot
    from real fallen opponents (players you already own show OWNED).
15. **Eliminated ≠ gone** — spectators get standings and pick a survivor
    to **root for**; it shows on the end screen.
16. **Cut ladder 20 → 16 → 8 → 4 → 2 → 1** to a single champion; victory
    screen + Hall of Champions entry.

## The architecture flex (30s, over B-roll of two phones in sync)

- **No game server, no database.** Host-authoritative over Supabase
  Realtime — the wire carries only seeds, picks and deadlines; every
  client derives bots, pairings, scores and timelines **deterministically**
  from the room seed. The engine IS the netcode.
- Real phones have clocks seconds off NTP — every message carries the host
  clock and clients keep a median offset, so the lockstep never drifts.
- Every message carries a **mirror checksum**; a dropped broadcast is
  detected AND **self-heals**: the client requests the host's message log
  and replays the whole game through the same apply path. A **reloaded
  phone rejoins mid-game into its own seat**. A phase watchdog rescues
  even a lost final whistle.
- 353 tests: full host+guest tournaments over an in-memory bus asserting
  the two mirrors stay **byte-identical**, drafted-XI balance ceilings,
  affinity invariants over the whole 1,038-player DB.

## Close (10s)

- Champion screen. **"Last11. Twenty managers walk in. One walks out.
  last11.app — come take the crown."**

## Pre-recording checklist

- [ ] Hard refresh every device (mp-6) — stale tabs can't join new rooms
- [ ] Vercel env vars set (online won't connect in prod without them)
- [ ] Phone + laptop side by side for the lockstep/sync shot
- [ ] One staged desync if you're brave: background the phone mid-round,
      bring it back — banner flashes, game heals itself on camera
