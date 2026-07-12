# Launch posts — drafts (2026-07-11)

Copy-paste bank, one custom post per venue. Voice: honest, humble, first person.
Nothing here overclaims: it's a free browser game, built in a hackathon weekend,
multiplayer is BETA.

**Before posting anything:** hackathon submission locked (post AFTER Sunday 9am
PST), production build green on last11.app, and play one full online room on
your phone. Nothing kills a launch like the top comment being "site's broken."

**How to run it:** don't post everywhere the same day. One or two venues per
day, and live in the comments for the first 2–3 hours after each post — reply
to everything, fix reported bugs fast and say so in-thread. Reddit rewards
that; it also makes the "humble solo dev" framing true rather than performed.
Check each subreddit's sidebar rules the day you post; several remove posts
that don't follow title formats.

Suggested order: r/WebGames → r/playmygame → r/ClaudeAI → r/futebol →
Show HN → r/SideProject → X thread pinned on the account.

---

## 1. r/WebGames

**Title:** Last11 — a football draft battle royale I built during a hackathon. 32 managers, draft an XI on a slot machine, bottom of the table gets cut every round. Free, no signup.

**Body:**

I've been hooked on the spin-to-draft football sims (38-0, 7a0 and their clones) and kept wishing one of them was a battle royale, so I built it during a hackathon last weekend.

You're one of 32 managers. Every spin lands on a national squad from World Cup history (Brazil '70, Spain '10, Germany '26...) and you take one player into any slot of your formation. Then rounds of matches happen and the bottom of the table goes home: 32 → 24 → 16 → 8 → 4 → 2 → 1. Between rounds you get one pit stop: re-slot, change tactics, and loot a player from someone who got eliminated. From 16 alive there are no draws — level matches go to penalties, full stakes.

There's also an online mode (20-player rooms with a room code) but it's in beta and rough in places, so bring patience or bring bots — empty seats fill with them.

It's free, browser-only, no account needed: https://last11.app

I'd honestly love feedback, especially on match pacing and whether the drafting feels fair. Made-up ratings debates also welcome, that's half the point.

**Notes:** check the sidebar for title format on the day. If a [free] or [multiplayer] tag convention exists, use it.

---

## 2. r/playmygame

**Title:** [Free] [Web] Last11 — football draft battle royale (draft under pressure, survive eliminations, steal from the fallen)

**Body:**

**Playable link:** https://last11.app — free, in-browser, no signup.

Built this at United Hacks V7 last weekend and kept polishing since. It's a battle-royale twist on the spin-to-draft football genre: 32 managers draft XIs from historical World Cup squads on a slot machine, weakest get cut each round, last manager standing wins. Online 20-player rooms exist but are beta; solo vs 31 bots is the polished path right now.

What I most want feedback on:

- Draft pacing — does the spin → pick loop stay fun for 11 rounds?
- Match playback — watchable or do you just want to skip?
- Ratings — they're hand-calibrated (Pelé '70 is the 97 ceiling) and I will absolutely take arguments about them.

Known rough edges: no reconnect in online rooms yet (a drop = bots take over), and mobile layout has some tight spots. I'll be in the comments.

**Notes:** r/playmygame expects genuine engagement — commit to replying. Some periods require feedback-for-feedback (play someone else's game too).

---

## 3. r/ClaudeAI

**Title:** I built a full multiplayer football battle royale in a hackathon weekend by running 6 Claude Code workers in parallel — some honest notes on what worked

**Body:**

Last weekend I entered a hackathon and shipped Last11 (https://last11.app), a football draft battle royale — deterministic match engine, 857-player historical database, online 20-player rooms on Supabase Realtime, 315 tests. The part I think this sub will find interesting: it was built essentially entirely with Claude Code, and not as one long chat.

The setup that actually worked:

- One orchestrator session ("Main") owned product decisions and all UI work, and dispatched six worker terminals (engine, database, draft UI, match sim, architecture, QA) with file-ownership lanes so they never collided.
- Research and implementation were separate phases. Workers first wrote plans only, one worker wrote a CONTRACT.md that caught 7 cross-plan conflicts before any code existed, then I ruled on the open decisions and implementation started against those rulings.
- QA's job included adversarially reviewing the other workers' plans, not just writing tests. It caught real design bugs.
- Overnight runs on defaults I could veto in the morning. I slept, woke up to a redesigned UI and a green suite.

Honest failures too: workers left residue in each other's terminal composers because of a send-script timing bug (phantom "stuck" states until we found it), and the first live playtest showed the multiplayer timers were badly wrong (10s picks became 30s after real humans touched it — the agents' guesses about human pacing were off).

Happy to answer questions about the orchestration setup. And if you want to see what the output feels like, the game is free in-browser, no signup.

**Notes:** this framing (workflow first, game second) fits the sub. Adapt the same post lightly for r/vibecoding or r/ChatGPTCoding if posting there — lead with the multi-agent workflow, keep the game link secondary. Space these AI-sub posts days apart; they have overlapping audiences.

---

## 4. r/futebol (em português)

**Título:** Fiz um battle royale de draft de futebol no estilo 7a0 — 32 técnicos, escala seu XI com seleções históricas de Copa, o pior da rodada é eliminado

**Corpo:**

Sou brasileiro morando no Canadá e viciei nos jogos de draft tipo 7a0 e 38-0 durante a Copa. Sentia falta de uma versão battle royale, então fiz uma num hackathon no fim de semana passado: Last11 (https://last11.app).

Funciona assim: 32 técnicos no lobby, cada giro da roleta cai numa seleção histórica (Brasil 70, Brasil 2002, Espanha 2010...) e você escolhe um jogador pra qualquer posição do seu esquema. Rodada de jogos, os piores da tabela vão embora, e entre rodadas você pode roubar um jogador de quem foi eliminado. Com 16 vivos não tem mais empate — vai pros pênaltis valendo tudo.

De graça, no navegador, sem cadastro. Tem modo online de 20 jogadores (beta, ainda meio cru) e modo solo contra bots.

As notas dos jogadores fui eu que calibrei (Pelé de 70 é o teto, 97) então pode vir brigar comigo nos comentários que eu aceito o debate.

**Notes:** verificar as regras do sub sobre autopromoção no dia; se houver thread diária de conversa, talvez postar lá primeiro e medir a reação. Do NOT post machine-stiff Portuguese anywhere else without checking; this one is written in Lucca's native register but he should read it over — it's his voice on the line.

---

## 5. Hacker News (Show HN)

**Title:** Show HN: Last11 – a football draft battle royale with a fully deterministic match engine

**Body (text field):**

I built this at a hackathon last weekend, mostly by orchestrating a fleet of Claude Code agents, and the part I'm proudest of is the engine: the whole tournament is a pure function of one seed. Poisson goals with an inverted Dixon–Coles correction (real football models add dull draws; a game wants fewer, so the correction is flipped), a 12×12 positional-affinity matrix generated from a 9×9 family table, penalty shootouts as an absorbing Markov chain, and every match seeded by hash(tournamentSeed, round, matchIndex) — so the animated match literally cannot disagree with the league table, and multiplayer ships seeds and inputs instead of state.

The math writeup is in the repo at docs/ENGINE-MATH.md if you just want to read that.

Game: 32 managers draft XIs from historical World Cup squads on a slot machine, the bottom of the table is eliminated each round, last manager standing wins. Free, browser-only, no signup: https://last11.app

Rough edges I know about: online rooms (20 players, Supabase Realtime, host-authoritative) have no reconnect yet, and the player ratings are hand-calibrated by one Brazilian with opinions.

**Notes:** HN will ask hard questions about the agent workflow and the determinism claims — answer them straight, it's the best audience for exactly that. If the repo is private, either make it public first or cut the docs/ENGINE-MATH.md line. Post morning PT on a weekday for best visibility.

---

## 6. r/SideProject

**Title:** Shipped a multiplayer football battle royale in a weekend (hackathon deadline is a hell of a drug)

**Body:**

Last weekend: hackathon starts Friday 7pm, submission Sunday noon. I'd had this idea sitting in my notes for a week — the spin-to-draft football sims (7a0, 38-0) are huge right now but nobody made the battle royale version.

So: Last11 (https://last11.app). 32 managers, draft an XI from historical World Cup squads, worst of the table eliminated every round, steal players from the fallen, last one standing. Free, browser, no signup. Online 20-player rooms in beta.

Things I learned shipping it: real playtesters destroyed my timer assumptions within minutes (picks went from 10s to 30s after the first live lobby), a deterministic engine made multiplayer a refactor instead of a rewrite, and "cut scope by ruling fast" beat every clever technical decision I made.

Happy to answer anything about the build. And genuinely curious whether the game holds people past one run — that's the metric I'm scared of.

---

## 7. X / Twitter launch thread (pin on the account)

**1/** I kept wishing the spin-to-draft football sims had a battle royale mode. Last weekend a hackathon gave me an excuse: Last11 — 32 managers, draft an XI from historical World Cup squads, bottom of the table eliminated every round. Free, in your browser: last11.app

**2/** Every spin is a squad from Copa history — Brazil '70, Spain '10, Germany '26. You take ONE player, any position of your shape. A 94 striker at CM might still beat your mediocre CM. You can never field the same person twice, even across years.

**3/** Between rounds: the pit stop. Re-slot, change tactics, and loot one player from whoever just got eliminated. The 31 bots are stealing too. From 16 alive, no draws — penalties, full stakes.

**4/** Online mode is live in beta: 20-player rooms, room code, empty seats fill with bots. Grab friends: last11.app

**5/** Built in a weekend with a fleet of Claude Code agents (six terminals in parallel + one orchestrator). The engine is one pure seeded function — the math writeup is honestly my favorite artifact of the whole thing. Ratings are hand-calibrated. Pelé '70 is the ceiling at 97. Fight me.

**Notes:** post the thread with a 20–30s clip of a penalty shootout or a dramatic elimination on tweet 1 — algorithmic reach on a zero-follower account comes from the clip, not the text.

---

## Where NOT to post (deliberately)

- **r/soccer** — heavily moderated against self-promo; a direct launch post likely gets removed and can burn the account. If the game picks up somewhere else first, someone may post it there for you, which is worth 10× anyway.
- **r/InternetIsBeautiful** — games are frequently removed under their interactive-content rules; not worth the removal risk on a young account.
- **r/games / r/gaming** — self-promo rules effectively require established community participation first.

## Venue rules recap (check sidebars day-of)

r/playmygame and r/IndieDev are the friendliest to dev launches; r/WebGames is the broadest browser-game audience; heavily-moderated subs reward devs who stick around in comments and punish drive-by links. Most discovery happens in the first 24h of a post.
