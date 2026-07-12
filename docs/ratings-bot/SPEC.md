# Ratings Poll Bot — Spec v0.1

Status: **spec for review** (2026-07-11, drafted with Claude in Cowork; ruled by
Lucca: spec-first, delta-capped polls). No implementation yet.

## What it is

An X (Twitter) bot account that runs recurring "what should this player be
rated?" polls and applies the results in game. Purpose: a community-owns-the-
ratings loop that doubles as the marketing channel for last11.app — every poll
is content, every applied change is a reason to come back and draft.

## The loop

1. **Post** (cron): "Rate {PLAYER} ({NAT} '{YY}) — currently {R} ⭐️" with a
   native poll. Include the player's key stat line from the pool data and
   last11.app link in a reply (link in the poll post itself costs more, see §6).
2. **Close** (next cron run): read the finished poll, compute the winning
   option, queue the delta.
3. **Apply** (daily batch, one deploy): bot commits queued deltas to
   `src/engine/data/squads-v2.json`, Vercel auto-deploys. Bot posts the
   "ratings patch" summary: "Tonight's community patch: Vini 88→89, Kaká 91→90.
   Live now — last11.app".

## Poll design (delta-capped — the ruling)

- Options are **centered on the current rating, max drift ±2 per poll**:
  default 4 options `[R−1, R (keep), R+1, R+2]` when the queue flags the player
  as community-underrated (steal-rate/draft-rate signals), else
  `[R−2, R−1, R (keep), R+1]`.
- **Hard clamps**: post-delta rating stays in [75, 97]; the calibrated anchor
  players (RATINGS-LADDER.md: Pelé '70 = 97, Maradona '86 / Messi '14 /
  R9 '02 = 96, Messi '26 = 92, Magalhães '26 = 89–90) are **excluded from the
  poll queue** — the ladder is the measuring stick and doesn't get voted on.
- **Minimum turnout**: fewer than N votes (start N = 25) ⇒ no change; bot posts
  "hung jury, {PLAYER} stays {R}". Prevents 3-troll polls from moving data.
- **Cooldown**: a player can't be polled again for 30 days ⇒ max community
  drift ≈ ±2/month/player. Balance harness reruns on every batch as usual.

## Cadence

- **Launch: 3 polls/day** (every 8h; poll duration 7h). Every-2-hours (12/day,
  110-min polls) is the scale-up target once average turnout clears ~100 votes;
  cadence is config, not code.
- Player selection: rotating queue over the 857-player pool, prioritized by
  (a) played in a real World Cup match that day, (b) most-drafted / most-stolen
  in game, (c) manual override list (Lucca can front-run the discourse).

## Architecture

- **Vercel cron** (already the stack): one function on the poll cadence
  (close previous → queue delta → post next), one daily batch function.
- **State in Supabase** (already the stack): table `rating_polls`
  (id, player_id, tweet_id, options, opened_at, closes_at, votes, result,
  applied_in_commit). The delta queue is just rows with `result` and no
  `applied_in_commit`.
- **Apply step**: GitHub API commit to `squads-v2.json` on `preview` →
  auto-deploy; promote to production with the daily patch post. One deploy per
  day keeps the MP version handshake sane (rooms mid-tournament are unaffected;
  new rooms pick up the new build).
- **X API**: v2 create-post with poll object (user-context auth); poll results
  read via post lookup with poll fields. Account must be flagged "automated"
  in X settings (platform-manipulation policy) and needs a developer app on
  **pay-per-use** billing.

## Costs (X pay-per-use, as of 2026-02 pricing)

- Posts $0.015 each ($0.20 if the post body contains a link — put the link in a
  reply, or eat it); reads $0.005.
- 3/day: ~90 posts + ~90 result-replies + reads ⇒ **~$3–5/month**.
- 12/day: ~$10–15/month. Enterprise never needed at this scale.

## Risks / honest caveats

- **Turnout is the whole game.** Below ~50 followers, polls look dead and the
  min-turnout rule means nothing changes — which reads as a broken promise.
  Consider launching the bot AFTER the first Reddit/TikTok push, not before.
- Brigading within the cap is contained by design (±2, cooldown, clamps), but a
  coordinated group can still steer a fan favorite; that's arguably the fun.
- Third-party pricing reports, not verified against X's own console — confirm
  actual rates when creating the developer app.
- Player-name licensing exposure grows with a public bot naming real players
  every few hours (same standing risk as the game itself).

## Needs from Lucca before build

1. Create the X account (handle: @last11app? @Last11Game?) + developer app +
   billing; flag account as automated.
2. Confirm launch cadence (3/day recommended) and min-turnout N.
3. Confirm the apply window (nightly patch time, PT).
