# RESEARCH — Multiplayer UX Precedents (RESEARCH-mp-ux-precedents.md)

**Owner:** draft-page · **Phase:** Multiplayer R2 (research only) · **Date:** 2026-07-11

Scope (per `docs/multiplayer/README.md`): how comparable games run multiplayer
flows — the 38-0 family (38-0 / 380football / 38nil, roadto38), plus generic
room-code and turn-timer precedents (Kahoot, Jackbox, chess.com Daily, Sleeper
drafts). For each: **lobby flow, timer lengths, AFK handling, disconnect policy,
spectator features, seat limits.**

> **These are raw findings with sources. Product/UX decisions are Main's.** Where a
> fact could not be verified from crawlable text it is marked _[unverified]_ rather
> than guessed. Several primary sites (roadto38.com, hitc.com, Jackbox support) are
> Cloudflare/JS-gated and returned HTTP 403 to automated fetch; those rows lean on
> search-surfaced snippets and are flagged.

---

## 1. The 38-0 family (direct genre peers)

**Important framing:** "38-0" is a viral format with **many near-identical
clones** on different domains (380football.com, 38-0.org, 38-0.app, 38nil.app,
38nil.fun, 38-0-0 app, 38-0.io, …). Feature claims below are attributed to the
specific domain they were found on; they do **not** all ship the same multiplayer.

### 1a. 38-0 / 380football.com / 38nil — solo + casual multiplayer

**Core loop (all clones):** a wheel lands on a real club + season (you don't choose
it); you draft one player from *that exact squad* into your XI; repeat until 11
positions filled; if a star lands with nowhere to play you can shuffle an
already-drafted player into another eligible spot to open a slot. Then the XI is
simulated across a full 38-game season.
Sources: [380football.com](https://www.380football.com/),
[38nil.fun](https://38nil.fun/), [HITC how-to](https://www.hitc.com/footballs-wordle-how-to-play-the-viral-soccer-game-that-is-all-over-social-media/).

- **Shared-seed / daily mode (load-bearing pattern):** "every day, everyone in the
  world gets the **same dice rolls**, and players draft the best XI they can from
  them and play the season once to compare on the global leaderboard."
  Source: [38-0.org](https://www.38-0.org/).
- **1v1 ranked PvP (380football):** "Start a private match, send them a **link or a
  short code**, and draft your XIs against each other. **Both teams get the same
  draft selections** to ensure skill comes into play for PvP ranked matches."
  → join by link **or** short code; fairness via identical draft pool (shared seed).
  Source: [380football.com](https://www.380football.com/).
- **Private leagues (380football):** "Start a league and **invite up to 10 friends
  with a single code**. Everyone **snake drafts from the same spins**… Pick your own
  formation. **Host settings: show or hide ratings while drafting, and fill any empty
  seats with bots.** Draft real squads together **in real time**, then watch your XI
  projected across a full 38-game season. Highest table wins."
  Source: [380football.com](https://www.380football.com/).

| Dimension | Finding |
|---|---|
| **Lobby flow** | Private match via shareable **link or short code**; league via **single invite code**. Host configures rules before draft. |
| **Seat limits** | **Up to 10 friends** per private league (≈11 incl. host); 1v1 for ranked. |
| **Bot fill** | **Yes — host setting to fill empty seats with bots** (matches Last11's stated intent). |
| **Shared draft** | 1v1 "both teams get the same draft selections"; league "snake drafts from the same spins"; daily "same dice rolls for everyone." Deterministic shared seed across the whole genre. |
| **Host options** | Show/hide ratings during draft; own formation; bot fill. |
| **Timer lengths** | _[unverified]_ — not published in crawlable text. "In real time" implies a live per-pick clock but no number was found. |
| **AFK handling** | _[unverified]_ (bot-fill exists for *empty* seats; whether an AFK *human* is auto-picked/bot-substituted mid-draft is not documented). |
| **Disconnect policy** | _[unverified]_. |
| **Spectator** | Not documented as a live feature. Async "**share any finished season and challenge friends to beat it**" is the closest social/spectate analog. Source: [380football.com](https://www.380football.com/). |

### 1b. roadto38.com — competitive brackets + Champions rooms

_[Site is Cloudflare-gated — 403 on direct fetch; findings from search-surfaced
snippets of roadto38.com and roadto38.com/multiplayer.]_

- **Weekly 64-player bracket:** draft your squad in **"Football-IQ mode"** and
  "compete against **64 players every 3 days**"; a **live bracket** shows "all 64
  slots filling up in real time," rendered as an **SVG connector-line bracket with
  your team highlighted in gold.**
- **Champions Online (Beta):** "create a room for **up to 8 players**, each drafts an
  XI, and a full **Champions League is simulated to a champion**." Also: "**challenge
  a friend directly**" or "**create a Champions League room**."
  Source: [roadto38.com](https://roadto38.com/), [roadto38.com/multiplayer](https://roadto38.com/multiplayer/).

| Dimension | Finding |
|---|---|
| **Lobby flow** | Two shapes: (a) **enter the weekly 64-player bracket** (open pool, 3-day cadence); (b) **create/join a Champions room** or **challenge a friend**. |
| **Seat limits** | **64** (weekly bracket), **8** (Champions room), 2 (direct challenge). |
| **Cadence** | Bracket runs **every 3 days** → strongly implies an **asynchronous submission window**, not a synchronous live lobby (64 humans rarely co-present; "fills up in real time" = live-updating standings, not necessarily simultaneous play). _[inference, flagged]_ |
| **Playback** | Champions room simulates a **full bracket to a single champion** from the submitted XIs — resolution is server/deterministic once inputs are in. |
| **Timer lengths / AFK / disconnect** | _[unverified]_ — the 3-day window is the *entry* deadline; per-pick clocks not published. |
| **Spectator** | The **live bracket view** (all 64 slots, gold-highlighted own team) is itself a spectate/standings surface; no explicit "watch another player's match" feature documented. |

### Genre takeaways (factual, for Main)

1. **Shared deterministic draft is universal** here — daily "same dice rolls," 1v1
   "same draft selections," league "same spins." This aligns with Last11's
   pure/deterministic engine + canonical `matchSeed`; the whole genre already frames
   fairness as *same inputs, different choices*.
2. **Bot-fill for empty seats is an established, shipped pattern** (380football host
   setting) — matches the README's "bots fill empty seats" intent.
3. **Two distinct multiplayer shapes coexist:** small **live-ish rooms** (1v1, ≤8,
   ≤10) joined by **code/link**, and **large async pools/brackets** (64) on a
   **multi-day cadence**. They imply different timer models (live per-pick vs
   multi-day entry window).
4. **Published per-pick timer, AFK, and disconnect specifics are essentially absent**
   from these sites' public text — a real gap; if precise numbers matter, they'd need
   hands-on capture in-app (out of scope for this research pass).

---

## 2. Generic room-code lobby precedents

### 2a. Kahoot — PIN lobby, host-driven

| Dimension | Finding | Source |
|---|---|---|
| **Lobby flow** | Players go to kahoot.it / app, enter **Game PIN**, then a **nickname**; host sees names populate and starts the game. | [support.kahoot.com](https://support.kahoot.com/hc/en-us/articles/115003072287-How-many-participants-can-play-a-kahoot) |
| **Seat limits** | Free personal: **10 players** (2026 cap); free *business* account: **3**; education: **1,000**; Event plans: **200 / 1,000 / 2,000 / 5,000**; hard technical max **4,000 per Game PIN**. Join screen **blocks** additional players once the cap is hit. | [triviaanywhere](https://www.triviaanywhere.com/blog/kahoot-free-player-limit), [support.kahoot.com](https://support.kahoot.com/hc/en-us/articles/115003072287-How-many-participants-can-play-a-kahoot) |
| **Timer lengths** | **Per-question** time limit, host-configured (not a per-player turn clock); all players answer the same question against the same countdown. | [Live game settings](https://support.kahoot.com/hc/en-us/articles/115016055107-Live-game-settings) |
| **AFK / disconnect** | No per-player turn deadline; a missing answer simply scores 0 for that question. (Explicit reconnect policy _[unverified]_.) | — |
| **Spectator** | Shared **host screen** is the canonical "everyone watches the same thing" surface; no separate player-spectator role. | — |

### 2b. Jackbox — 4-letter room, VIP start, audience

| Dimension | Finding | Source |
|---|---|---|
| **Lobby flow** | Join at **jackbox.tv** with a **room code + name**. **First to join = VIP**; VIP presses **"Everybody's In"** to start. That button **only appears once the minimum player count has joined.** | [Jackbox room-code guide](https://cms.nucleusnetwork.com/urban-beat/jackbox-tv-room-codes-your-guide-to-joining-the-party-1764797795), [@jackboxgames](https://x.com/jackboxgames/status/1243526644222042122) |
| **Seat limits** | Per-game caps **vary** (many core games ~1–8, some up to 10–16); **audience** can be very large (historically up to ~10,000 who play along). _[exact per-game table unverified — support page 403'd.]_ | [How many players](https://support.jackboxgames.com/hc/en-us/articles/15794756085015-How-many-players-can-join-each-game) |
| **Lobby lock** | Some games **lock the room once started** — new players can't join until the next game. | [Jackbox room-code guide](https://cms.nucleusnetwork.com/urban-beat/jackbox-tv-room-codes-your-guide-to-joining-the-party-1764797795) |
| **Disconnect (host)** | If the **host** drops mid-game, the game **"pauses" for 5 minutes** to let them reconnect; **game data and players are not lost.** | [Party Pack 9 features](https://www.jackboxgames.com/blog/the-ability-to-kick-players-and-other-new-features-coming-to-party-pack-9) |
| **Kick / moderation** | Party Pack 9+: moderators kick via **mod.jackbox.tv**, only **above minimum player count**; kicked players **remain visually present but disconnected and cannot rejoin.** | [Party Pack 9 features](https://www.jackboxgames.com/blog/the-ability-to-kick-players-and-other-new-features-coming-to-party-pack-9), [How moderation works](https://support.jackboxgames.com/hc/en-us/articles/15794773430295-How-does-Moderation-work) |
| **Spectator (Audience)** | Dedicated **Audience** role: non-players watch and **play along**; can **leave and rejoin any time**; joinable inside Twitch via the **Audience Kit** extension. | [Audience Kit](https://www.jackboxgames.com/blog/the-jackbox-audience-kit-twitch-extension-is-now-available) |

**Jackbox takeaways (factual):** the **VIP/"Everybody's In"** manual-start gated on a
minimum count; a **large play-along Audience** distinct from seated players (a direct
precedent for the README's "eliminated → spectator" intent); a **host-drop 5-minute
grace pause**; and **kicked ≠ removed-from-view** (visually retained, connection
severed) as a disconnect-state pattern.

---

## 3. Turn-timer precedents (async + draft clocks)

### 3a. chess.com "Daily" (correspondence) — async per-move deadlines

| Dimension | Finding | Source |
|---|---|---|
| **Time control** | **Days-per-move** (common default **3 days/move**; also 1/5/7/10/14-day; tournament formats like **30 days / 10 moves**). | [chess.com forums](https://www.chess.com/forum/view/suggestions/alternative-time-control-for-daily-chess) |
| **Timeout** | Miss the per-move window → **lose on time**; opponent auto-wins **unless** they disabled auto-win, which turns it into a manual **"Claim Win."** **Hard cap: no move in 60 days = timeout** regardless of settings. | [support.chess.com](https://support.chess.com/en/articles/8705363-how-can-i-prevent-getting-wins-based-on-timeouts) |
| **AFK grace ("Vacation")** | Players bank **vacation time** to pause games: Basic **2 days/mo**, Gold **3**, Diamond/Platinum **5**; **minimum 24h** per vacation; premium **auto-timeout protection** auto-enables vacation when **< 90 min** remain in a Daily game. | [support.chess.com](https://support.chess.com/en/articles/8583943-how-does-vacation-work-how-much-time-do-i-get) |

**Relevance:** the model for a **multi-day async competition** (cf. roadto38's 3-day
bracket) — generous deadlines, an explicit **grace/pause reserve**, and a
**timeout→forfeit** rule with an opponent-side "claim" fallback.

### 3b. Sleeper — fantasy **draft** clock (per-pick, autopick, pause)

| Dimension | Finding | Source |
|---|---|---|
| **Timer model** | Two regimes: **fast draft** (short per-pick clock) vs **slow draft** (hours/pick). Exact seconds/hours **not stated** in the cited article. | [support.sleeper.com](https://support.sleeper.com/en/articles/4029085-how-does-the-draft-timer-work) |
| **Expiry (autopick ON)** | Auto-drafts from the team's **queue**; if none, considers **roster needs** and takes a **higher-ranked available** player. | [support.sleeper.com](https://support.sleeper.com/en/articles/4029085-how-does-the-draft-timer-work) |
| **Expiry (autopick OFF)** | **"Soft" timer** — nothing happens on expiry (used as an **overnight pause** so no auto-picks fire). | [support.sleeper.com](https://support.sleeper.com/en/articles/4029085-how-does-the-draft-timer-work) |
| **Pause** | **Commissioner can pause anytime**; can also **auto-pause at specified times**. | [support.sleeper.com](https://support.sleeper.com/en/articles/4029085-how-does-the-draft-timer-work) |

**Relevance:** the canonical **draft-clock → deterministic autopick** pattern the
README's protocol section needs for AFK ("deterministic auto-pick for AFK"). Sleeper's
**queue-then-best-available** autopick and **soft-timer/commissioner-pause** are the
two levers most reusable for a draft phase.

---

## 4. Cross-precedent comparison

| Game | Join | Seat cap | Timer model | AFK / timeout | Disconnect | Spectator |
|---|---|---|---|---|---|---|
| 380football (league) | single code | ~10 | "real time" _[len unverified]_ | bot-fill for *empty* seats; AFK-human _[unverified]_ | _[unverified]_ | share finished season (async) |
| 380football (1v1) | link/short code | 2 | _[unverified]_ | _[unverified]_ | _[unverified]_ | — |
| roadto38 (weekly) | open pool | **64** | **3-day** entry window | miss window → out _[inferred]_ | async, low exposure | **live bracket** (own team gold) |
| roadto38 (Champions) | room / challenge | **8** / 2 | _[unverified]_ | _[unverified]_ | _[unverified]_ | bracket-to-champion view |
| Kahoot | Game PIN + name | 10 free → 4,000 max | **per-question** host clock | miss = 0 pts | _[unverified]_ | host screen only |
| Jackbox | 4-letter code + name | ~8 seats + ~10k audience | per-prompt | prompt scored empty | **host drop = 5-min pause**; kicked = visible-but-severed | **Audience** plays along, leave/rejoin |
| chess.com Daily | matchmaking/challenge | 2 | **days/move** (def 3) | **timeout→forfeit** (or "Claim Win"); **60-day** hard cap | async; **vacation** pause bank | game is public/watchable |
| Sleeper draft | league invite | league size | fast (per-pick) / slow (hrs) | **autopick** (queue→best-avail) or soft-timer | commissioner **pause** | league draft board |

---

## 5. Open questions / verification gaps

1. **Exact per-pick timer lengths for 38-0 / roadto38 are unpublished.** Their sites
   are JS-rendered + Cloudflare-gated (403 to automated fetch), and the marketing
   copy says "in real time" without numbers. Getting real values needs **hands-on
   in-app capture** (record a live 1v1 / Champions room) — a follow-up task, not
   web-researchable.
2. **AFK-human handling in the 38-0 family is undocumented.** Bot-fill covers *empty*
   seats pre-draft; whether an AFK human mid-draft is auto-picked, bot-substituted, or
   simply stalls the room is unknown. (Sleeper's autopick + Jackbox's kick are the
   nearest *documented* patterns.)
3. **Disconnect/reconnect policy in the peer games is undocumented.** Only Jackbox
   gives a concrete number (host-drop **5-min pause**); no peer states a *player*
   reconnect grace.
4. **roadto38's 64-player bracket is likely asynchronous** (3-day cadence, "fills up
   in real time" = live standings) but I could not confirm whether any phase is
   *synchronously* co-present. Flagged as inference.
5. **Jackbox exact per-game player-count table unverified** (support page 403'd);
   only the well-known ranges (~1–8 seats, up to ~10k audience) are cited.
6. **Anti-cheat / info-hiding in shared-seed PvP:** peers advertise "same draft for
   both," but whether picks are hidden until reveal (commit-reveal) vs visible live is
   not documented — overlaps RESEARCH-protocol's "tactics lock" question; noted, not
   researched here.

---

## Sources

- 380football (official 38-0): https://www.380football.com/
- 38-0.org (daily shared-seed): https://www.38-0.org/
- 38nil.fun: https://38nil.fun/ · 38nil.app: https://38nil.app/
- 38-0-0 app (App Store): https://apps.apple.com/us/app/38-0-0-football-squad-draft/id6776756035
- HITC how-to (403 to fetch; via search): https://www.hitc.com/footballs-wordle-how-to-play-the-viral-soccer-game-that-is-all-over-social-media/
- roadto38 (403 to fetch; via search): https://roadto38.com/ · https://roadto38.com/multiplayer/
- Kahoot participant limits: https://support.kahoot.com/hc/en-us/articles/115003072287-How-many-participants-can-play-a-kahoot
- Kahoot free 10-player cap (2026): https://www.triviaanywhere.com/blog/kahoot-free-player-limit
- Kahoot live game settings: https://support.kahoot.com/hc/en-us/articles/115016055107-Live-game-settings
- Jackbox room-code guide: https://cms.nucleusnetwork.com/urban-beat/jackbox-tv-room-codes-your-guide-to-joining-the-party-1764797795
- Jackbox Party Pack 9 (kick / host-pause): https://www.jackboxgames.com/blog/the-ability-to-kick-players-and-other-new-features-coming-to-party-pack-9
- Jackbox moderation: https://support.jackboxgames.com/hc/en-us/articles/15794773430295-How-does-Moderation-work
- Jackbox Audience Kit: https://www.jackboxgames.com/blog/the-jackbox-audience-kit-twitch-extension-is-now-available
- Jackbox player counts (403 to fetch): https://support.jackboxgames.com/hc/en-us/articles/15794756085015-How-many-players-can-join-each-game
- chess.com vacation: https://support.chess.com/en/articles/8583943-how-does-vacation-work-how-much-time-do-i-get
- chess.com timeout / claim-win: https://support.chess.com/en/articles/8705363-how-can-i-prevent-getting-wins-based-on-timeouts
- Sleeper draft timer: https://support.sleeper.com/en/articles/4029085-how-does-the-draft-timer-work
