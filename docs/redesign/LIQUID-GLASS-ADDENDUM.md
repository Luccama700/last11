# Liquid Glass addendum — the modern take (worktree-liquid-glass branch)

Author: Main (2026-07-14), from Lucca's ruling on the first FIFA 13 pass:
"this could be a lot better... I really dislike how slanted these are... a
modern take on FIFA 13, Apple level of design, liquid glass effects, some
pzazz." This branch keeps the FIFA 13 language (chrome/silver/paper, one red
one blue, condensed caps, jersey chips, position lines) and replaces the 2012
rendering with a 2026 material and motion system.

## What changed vs. the base vision

1. **The shear is dead.** `.blade` and friends are redefined as continuous
   rounded geometry (12px; chips are full pills). No clip-path slants remain
   on static UI. The only diagonals left are full-bleed hero panels (home
   slash, champion banner's inner slash) — FIFA DNA, not chip decoration.
2. **Materials are liquid glass.** All three core surfaces are frosted:
   - `.glass` — the workhorse light panel: translucent white gradient,
     `backdrop-filter: blur(18px) saturate(1.7)`, specular top edge, 16px
     radius, ambient depth shadow.
   - `.chrome-gloss` / `.glass-chrome` — dark frosted glass for bars, name
     plates, live tickers.
   - `.silver-gloss` — translucent silver with a specular edge; hover
     brightens and deepens the shadow, press sinks (`scale(.97)`).
   - `.paper-pane` — frosted for overlays (standings, shootout, hall).
3. **The backdrop is alive.** `.bg-arena` replaces flat paper on every screen
   root: slow-drifting pastel light blobs (blue/red/green/amber radials on
   two fixed layers, 26s/34s alternate) that read THROUGH the frosted panels.
   Tints are pastel so carbon text keeps WCAG AA everywhere.
4. **A motion system, not ad-hoc animation.**
   - Tokens: `--spring: cubic-bezier(.22,1.4,.36,1)`, `--ease-out`.
   - Entrances: `.animate-fade-up` (+ inline stagger delays) on every screen
     mount, hero elements, lobby seats, formation grid, results cards.
   - Attention: `.glint` specular sweep (hero CTAs, hurried countdown,
     champion banner), `.animate-count-thump` (final 5 seconds),
     `.pulse-live` (live pens, waiting states), `.animate-float` (crest,
     trophy), `.text-shine-scarlet` (the wordmark's 11).
   - Feedback: hover-lift (springy translate+shadow) on cards/nav/steps,
     press-sink on all gloss buttons, eased momentum-bar fills, ticker lines
     sliding in, turf light sweep (12s) across both pitches.
   - Every new animation is disabled under `prefers-reduced-motion`.
5. **Apple-grade details.** Global `:focus-visible` royal outline; glass
   loader rings on connecting/drawing states; drop shadows under jersey
   chips; backdrop blur behind modals; rounded reels and paylines on the
   slot cabinet.
6. **Behavior improvement found along the way:** home's QUICK PLAY now
   threads a quick-play intent through App → OnlineApp and auto-fires the
   public-lobby dive the moment the manager is named (it previously just
   opened the online entry).

## Type (updated 2026-07-14, "find better fonts")

Display/condensed: **Khand** 500/600/700 (self-hosted via @fontsource) replaces
Barlow Condensed — chosen by live side-by-side against Saira Condensed, Teko
and Oswald on the running app; it carries real scoreboard/broadcast DNA while
staying crisp at plate/chip sizes. Body stays **Inter** (tabular numerals,
unbeatable at small UI sizes). Legacy `--font-display` aliases Khand.

## Guardrail updates (supersede the base vision's list on this branch)

- Corners are continuous-rounded: pills for chips, 12px for buttons, 16px
  for panels. Nothing is sheared at chip scale.
- Blur is purposeful: panels frost the living backdrop; don't stack glass
  more than one level deep.
- Motion must mean something: entrances orient, glints advertise the primary
  action, thumps signal urgency. One or two moving accents per view.
- The two-accent rule survives: royal for values, scarlet for stakes.
