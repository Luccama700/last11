# Last11 — demo video run-of-show (every feature, solo → multiplayer)

Recording order below = reveal order. **Bold** = say it on camera; the
parentheticals are the details that make judges lean in. Hard refresh every
device first (engine `last11-mp-6`).

## Cold open (10s)

- last11.app on screen. **"Hey! My name is Lucca, and I'm Johnny, and with all the World Cup fun going on, we decided to build a football sim battle royale, in one weekend!"**
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
6. **The match engine** (linger here — it's the technical meat; the mathy
   words are accurate, use them):
   - **a pure function of a seed** — every match is deterministic TypeScript
     over a **mulberry32 PRNG**: same seed, **byte-identical tournament**,
     provable by our 353-test suite
   - each XI collapses to **zonal strength indices** (defence / midfield /
     attack as **convex combinations** of affinity-weighted ratings), which
     set each side's **expected goals λ**; scorelines are drawn from a
     **Poisson process** (Knuth's sampler) with an **inverted Dixon–Coles
     correction** trimming the boring low-scoring draws — calibrated to
     ~3.4 goals a match
   - off-position players pay an **affinity operator** penalty; morale
     carries between rounds as a multiplier
   - goal minutes are **rejection-sampled** so no two goals share a minute;
     goalscorers are drawn from a **shot-weight distribution** over the XI
     (your strikers score more, your keeper never does)
   - live pitch with player dots, momentum bar, ticker with **fouls,
     corners, goal kicks, throw-ins** attributed to the right players
   - **team-aware goal banners**: your goals climb gold → lime → cyan →
     purple for multi-goal bursts; enemy goals descend into darker reds
   - scoreboard shows **formations + total XI rating** for both teams;
     lineups flank the pitch (stacked below on mobile)
   - "Elsewhere this round" live-score rail — shows ONLY the matches from
     the same slot you're playing (no spoilers)
   - penalty shootouts are a **Markov chain** with an early-decision
     absorbing state (mathematically impossible comebacks end the shootout
     early, like real ones); takers step up in **order statistics** of shot
     weight, and each kick is **taker-vs-keeper**: conversion = 75% + 1.0%
     per taker point over 75 − 0.8% per keeper point (**94 CR7 vs an 80 GK
     ≈ 90%, an 80 taker vs a 93 wall ≈ 65%**), revealed kick by kick with
     no spoilers
7. **The pit stop** — between rounds, one combined board: **loot one player
   from a fallen squad** (bots are looting too, in seat order), re-slot
   your XI, change formation AND style.
8. **End screen** — placement, run summary, **Hall of Champions**
   (persistent local history of your crowns).

## Act 2 — MULTIPLAYER (the headline — say "no game in this genre has this",
then explain HOW it works as you play; the system is the story)

9. **PLAY ONLINE** → rooms with 5-letter codes, OR the **PUBLIC LOBBIES**
   system: host flips a lobby public, anyone on **QUICK PLAY** drops into
   the fullest open lobby — nobody waits alone. (**How:** there's no lobby
   database — public rooms announce themselves on a **shared presence
   channel**, so a listing lives exactly as long as its host does; close
   the tab and it's gone. Nothing can go stale.) Empty seats become bots
   at kickoff (20-manager rooms).
10. **Lobby** — set your shape & style while you wait; live presence chips.
11. **Simultaneous slot-machine draft** — all 20 managers spin AT ONCE.
    (**How:** squads are dealt by **stride rotation in modular arithmetic**
    — seat m gets squad (spin·20 + m) mod N — so every spin's 20 squads are
    **disjoint by construction**, no pick contention possible; and the
    squad count being **coprime with 20** means you never see the same
    squad twice.) **Every player in the room is globally unique** — one
    shared drafted set across all 20 teams; once anyone takes him, he's
    gone for everyone. 20s picks, and the moment every human has locked
    in, the countdown **snaps to 5s** ("ALL LOCKED IN").
12. **Lockstep viewing** — everyone watches together at 1.5×, no skips:
    3 synced match slots, per-slot live scores at the bottom. (**How:**
    nobody streams video to anybody. The host broadcasts one seed and one
    start time; every phone **simulates the identical match locally** and
    just plays it on a shared wall clock — corrected by a
    **median-of-samples clock-offset estimator**, because real phones sit
    seconds off NTP. Twenty screens, one game, zero servers.)
13. **The waiting room** — finish early and you see your full-time score,
    every other match still ticking **including their penalty shootouts
    kick-by-kick**, a countdown to your next match, and the **spoiler-safe
    LIVE TABLE** with the pulsing red cut line — it only counts matches
    that have finished on the shared clock, so your own next result is
    never leaked even though every phone already computed it.
14. **Synced pit stop** — 45s, loot + re-slot + tactics on one board, loot
    from real fallen opponents (players you already own show OWNED —
    uniqueness is enforced at the host's trust boundary, so even a
    doctored client can't field two Pelés).
15. **Bulletproof by design** — say it over gameplay: every message
    carries an **FNV-1a hash of the entire game state**, so any two phones
    either agree on everything or know it instantly; a dropped broadcast
    **self-heals by event-log replay**, and a **reloaded phone rejoins
    mid-game into its own seat**. (Stage it if you're brave: background
    the phone, come back, watch it heal.)
16. **Eliminated ≠ gone** — spectators get standings and pick a survivor
    to **root for**; it shows on the end screen.
17. **Cut ladder 20 → 16 → 8 → 4 → 2 → 1** to a single champion; victory
    screen + Hall of Champions entry.

## The architecture recap (20s, over B-roll of two phones in sync — the
one-breath version of everything Act 2 explained in place)

- **"No game server. No database. The simulation is a pure function of a
  seed, so the engine IS the netcode — we ship coordinates of the game,
  not the game. Twenty phones each run the identical tournament and an
  FNV-1a checksum on every message proves they never disagree."**
- 353 tests: full host+guest tournaments over an in-memory bus asserting
  the two mirrors stay **byte-identical**, a **Monte-Carlo balance ceiling**
  over 1,200 simulated drafts, affinity invariants over the whole
  1,038-player DB.

## Close (10s)

- Champion screen. **"Last11. Twenty managers walk in. One walks out.
  last11.app — come take the crown."**

## Pre-recording checklist

- [ ] Hard refresh every device (mp-6) — stale tabs can't join new rooms
- [ ] Vercel env vars set (online won't connect in prod without them)
- [ ] Phone + laptop side by side for the lockstep/sync shot
- [ ] One staged desync if you're brave: background the phone mid-round,
      bring it back — banner flashes, game heals itself on camera
