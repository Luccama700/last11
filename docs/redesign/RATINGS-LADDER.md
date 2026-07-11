# RATINGS-LADDER.md — calibration sheet for Lucca

Every squad in `src/engine/data/squads-v2.json` with its **top-3 rated players**, so you
can red-pen the whole scale in one sitting. **27 squads / 475 players / 13 nations,
1970→2026.** Ratings are per-tournament snapshots on your DECISIONS.md anchors.

**Fixed anchors (binding, already applied):** Pelé 1970 = **97** (unique ceiling) ·
Maradona 1986 / Messi 2014* / R9 Ronaldo 2002 = **96** · Messi 2026 = **92** ·
Gabriel Magalhães 2026 = **89**. *(Messi 2014 not yet in data.)*
Band meaning: 96 = inner-circle GOAT peak · 95 = all-time-great peak · 91–94 = a top
team's talisman · 88–90 = very good starter · 85–87 = solid starter · 82–84 = squad
regular · ≤81 = depth. Tight top, high floor, defenders not punished.

## Historical squads (top 3 each)

| Squad | Result | Top 3 |
|---|---|---|
| **Brazil 1970** | 🏆 | Pelé **97** · Jairzinho 91 · Rivelino 90 |
| **Netherlands 1974** | 🥈 | Cruyff **95** · Neeskens 89 · van Hanegem 87 |
| **Argentina 1986** | 🏆 | Maradona **96** · Valdano 87 · Burruchaga 86 |
| **Brazil 1994** | 🏆 | Romário **95** · Bebeto 89 · Aldair 86 |
| **France 1998** | 🏆 | Zidane **95** · Desailly 88 · Thuram 88 |
| **Brazil 2002** | 🏆 | Ronaldo **96** · Rivaldo 93 · Roberto Carlos 91 |
| **Italy 2006** | 🏆 | Cannavaro **92** · Buffon 91 · Pirlo 89 |
| **Portugal 2006** | 4th | Cristiano Ronaldo **87** · Deco 86 · R. Carvalho 85 |
| **Spain 2010** | 🏆 | Xavi **93** · Iniesta 93 · Casillas 91 |
| **Germany 2014** | 🏆 | Neuer **91** · Kroos 90 · Müller 90 |
| **Croatia 2018** | 🥈 | Modrić **91** · Rakitić 86 · Mandžukić 84 |
| **England 2018** | 4th | Kane **88** · Sterling 85 · Walker 84 |
| **France 2018** | 🏆 | Mbappé **90** · Griezmann 89 · Kanté 88 |
| **Argentina 2022** | 🏆 | Messi **96** · Di María 89 · E. Martínez 89 |
| **Morocco 2022** | 4th | Hakimi **87** · Bounou 86 · Amrabat 84 |

## Current squads — 2026 (top 3 each, by squad ceiling)

| Squad | Top 3 |
|---|---|
| **France** | Mbappé **93** · Dembélé 91 · Saliba 89 |
| **Brazil** | Vinícius **92** · Raphinha 90 · Alisson 90 |
| **Argentina** | Messi **92** · J. Álvarez 90 · Lautaro 89 |
| **Spain** | Rodri **92** · Yamal 92 · Pedri 90 |
| **England** | Bellingham **91** · Kane 91 · Saka 90 |
| **Germany** | Musiala **91** · Wirtz 91 · ter Stegen 87 |
| **Belgium** | Courtois **90** · De Bruyne 88 · Doku 85 |
| **Portugal** | Rúben Dias **89** · Vitinha 88 · Bruno Fernandes 88 |
| **Netherlands** | van Dijk **89** · de Jong 89 · Reijnders 86 |
| **Morocco** | Hakimi **89** · Bounou 86 · Brahim Díaz 84 |
| **Croatia** | Gvardiol **88** · Modrić 86 · Kovačić 84 |
| **Japan** | Mitoma **86** · Kubo 85 · Endo 82 |

## Cross-year arcs (the same player across tournaments — the snapshot principle)

These are the sharpest calibration surface: the same name, rated at his age each year.

- **Ronaldo (R9):** 1994: **80** (unused 17-yo) → 2002: **96** (peak)
- **Cafu:** 1994: **84** (young rotation) → 2002: **91** (peak captain)
- **Messi:** 2022: **96** (Golden Ball) → 2026: **92** (veteran)
- **Mbappé:** 2018: **90** (teen) → 2026: **93** (peak)
- **Modrić:** 2018: **91** (Ballon d'Or peak) → 2026: **86** (age-40 veteran)
- **Cristiano Ronaldo:** 2006: **87** (young winger) → 2026: **85** (age-41 veteran)
- **Dembélé:** 2018: **83** → 2026: **91** (2025 Ballon d'Or form)
- **Kane:** 2018: **88** → 2026: **91** · **Lautaro:** 2022: 84 → 2026: 89 ·
  **Enzo Fernández:** 2022: 85 → 2026: 88 · **J. Álvarez:** 2022: 87 → 2026: 90
- **Hakimi:** 2022: 87 → 2026: 89 · **Amrabat:** 2022: 84 (career tournament) → 2026: 82
- (Flat by design: Bounou 86→86, E. Martínez 89→89, Aguerd/En-Nesyri/Tagliafico 82→82.)

## Where I'd expect the red pen (open calibration questions)

1. **96-tier company.** Only Maradona 86, R9 2002, Messi 22 hit 96. Should **Cruyff 74,
   Zidane 98, Romário 94 (all 95)** join them at 96, or is 95 correct for "all-time
   great but not the singular tournament"?
2. **Cannavaro 92 as Italy 2006's top man**, above Buffon 91 and every attacker — is a
   defender-led ceiling right, or should a GK (Buffon) top a defensive champion?
3. **2026 ceiling = Mbappé 93.** Nobody current hits 94+. Correct that the modern game
   has no 95, or should Mbappé/Yamal push higher?
4. **Spain 2026 has three at 90+ (Rodri 92, Yamal 92, Pedri 90)** — too stacked?
5. **Modrić −5 (91→86) over 8 years and CR7 −2 (87→85)** — are the veteran decays the
   right slope?
6. **Messi 2022 = 96 vs Messi 2026 = 92** (−4 in 4 yrs). Too steep / too shallow?
7. **Fourth-place sides (Portugal 06, England 18, Morocco 22) top out at 87–88.** Right
   that a semifinalist has no 90, or are Ronaldo-06 / Kane-18 / Hakimi-22 underrated?
8. **Historical depth floor is 77–78** (3rd keepers, minnow bench). Deep enough spread,
   or compress the bottom?

Change any number and I re-rate the squad + surrounding anchors to keep proportions sane.
