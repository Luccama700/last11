# Last11 × FIFA 13 Mobile: the redesign vision

Author: Main (2026-07-14). Audience: the design agent executing this. Reference:
Lucca's seven FIFA 13 Mobile (iOS, 2012) screenshots: home, select team,
sponsorship offers, lineup pitch, manage contracts, transfer search, make an
offer. This document decodes that language and maps it onto every Last11
screen. It is the authority on intent; execution details are the design
agent's lane.

## Why this reference works for us

FIFA 13 Mobile is pre-flat iOS: glossy chrome, brushed metal, paper-white
content, and one loud red. It reads as "official football product" in a way
no flat UI does, and it is burned into the memory of exactly our audience.
Last11's current dark-neon look says "web game"; this says "EA Sports gave
you a career mode." The good news: the language is almost entirely
gradients, hairlines, sheared shapes, and condensed caps. No photography,
no licensed assets. All of it is buildable in Tailwind + inline SVG.

## The FIFA 13 language, decoded into ingredients

1. **Two worlds on one screen.** Heavy dark chrome (nav, headers, tickers)
   frames bright paper-light content (lists, tables, panes). The chrome is
   glossy near-black with a 1px top highlight; the content is #eef0f2 white
   with hairline rules. Nothing in the content area is ever dark.
2. **The blade.** Every tab, ribbon, and plaque is a parallelogram sheared
   ~14 degrees (clip-path). Tabs notch INTO bars (GAME SETTINGS / HELP &
   ABOUT). The back arrow and the confirm check each sit on their own
   silver blade at the bottom corners.
3. **Red is a slash, not a fill.** One signature red, used as a diagonal
   hero panel, a thin accent ribbon under the header, and alert text
   (CONTRACT EXPIRING). It never floods a whole screen.
4. **Condensed caps + link blue.** Headers, buttons, and labels are heavy
   condensed grotesk in ALL CAPS, charcoal or white. Every interactive or
   money-like VALUE is a specific link blue. Blue = "this number matters /
   tap me." That one rule does most of the visual work.
5. **The position color code.** Glossy jersey chips carry the whole roster
   UI: GK amber, DEF green, MID blue, ATT red, with the shirt number on
   the chest. Name, then a sub-row of stats separated by thin pipes
   (CB | OVR 79 | AGE 27). We adopt this everywhere a player appears.
6. **Master-detail panes.** List on the left (banded rows, selected row
   pops white with blue text), detail on the right (title, hairline
   underline, label/value spec table, one illustration). Sponsorship and
   contracts screens are the template.
7. **The ticker.** A black glossy bottom bar with one centered helper
   sentence ("Tap a player for info."). It is the voice of the game and
   the home of back/confirm blades.
8. **Watermarks.** Giant faded hexagon mesh and a huge ghosted football in
   content panes. Texture without noise; ~4% opacity charcoal on white.
9. **Pre-flat gloss.** Buttons are silver gradient slabs with etched 1px
   borders and an inner top highlight. The lineup screen even has a wooden
   bench strip. Restraint matters: two-stop gradients, square corners.
10. **Stars and plaques.** Half-star ratings under crests; a coin + amount
    on a silver plaque top-right. We have squad ratings and points to fill
    both slots.

## The global system for Last11

### Palette (CSS variables, swap the whole app onto these)

- `--chrome-900` #101214 → `--chrome-700` #23272b (glossy bar gradient,
  top inset highlight rgba(255,255,255,.16))
- `--silver-hi` #f6f8fa → `--silver-lo` #c7ccd2 (blades, buttons; bevel:
  1px #ffffff top, 1px #979ea6 bottom)
- `--paper` #eef0f2 content bg; banding #e3eaf1; hairline #c8cdd2
- `--ink` #2b2f33 (charcoal text)
- `--red` #d0202e (hero slash, accent ribbon, alerts, cut line)
- `--blue` #2f7bd6 (all interactive values, money/points, selected text)
- Position lines: GK #f2a71b · DEF #3f9c35 · MID #2f6fd0 · ATT #d0202e
- `--pitch` #4fae3d with 6% darker mow stripes
- Gold #c9a227 stays but is DEMOTED to trophies, champions, and the
  best-pick trim only. It is no longer the app's default accent.

### Type

Condensed heavy caps for all headers/buttons/labels: Barlow Condensed
600/700 (closest free stand-in for FIFA's DIN-flavored condensed; Oswald is
the fallback). Body and stats: Inter, with `font-variant-numeric:
tabular-nums` on every rating, score, and countdown. Self-host via
@fontsource so nothing loads from a CDN at runtime.

### The component kit (build these first, in src/screens/ui/)

- **ChromeBar**: glossy black header, centered ALL-CAPS title, optional red
  ribbon underneath, optional right-side plaque (points/coins).
- **TickerBar**: glossy black footer, one centered helper line; owns the
  BackBlade (left arrow on silver parallelogram) and ConfirmBlade (check).
- **BladeTab / BladeButton**: sheared silver slab, condensed caps, pressed
  state darkens the gradient. Primary variant = charcoal text; danger =
  red text; the nav variant is white-on-chrome with thin dividers.
- **JerseyChip**: inline SVG jersey, recolorable by position line, shirt
  number on chest. Sizes: list (28px), board (44px), featured (64px).
- **NamePlate**: the dark glossy plate from the lineup screen: POS left,
  rating right, bold white name, thin bar underneath (we repurpose the
  fitness bar as the affinity/fit bar: green when natural, amber off-pos).
- **RosterRow**: JerseyChip + name + pipe-separated stat sub-row + right
  value column in blue. One component drives draft options, loot list,
  leaderboard, and market-like lists.
- **MasterDetail**: left banded list + right spec pane with hex watermark;
  collapses on mobile to list → slide-over detail.
- **StarRating**: 0–5 with halves, derived from squad/XI rating bands.
- **HexWatermark / BallWatermark**: one inline SVG each, 4% opacity.

### Layout DNA

Every screen is the same sandwich: ChromeBar on top, paper content in the
middle, TickerBar on the bottom. Back always lives bottom-left, confirm
bottom-right, helper text center. This alone will make the app feel like
one product; today each screen improvises its own frame.

## Screen by screen

- **Home**: the hero moment. Paper-white hexagon-mesh backdrop, LAST11
  wordmark huge on the left in charcoal condensed with the "11" in red,
  and a red diagonal panel slicing in from the right carrying the pitch
  line ("32 walk in. 1 walks out.") in white. Bottom: the four-item chrome
  nav blade bar: SOLO RUN | PLAY ONLINE | QUICK PLAY | HALL OF CHAMPIONS,
  thin dividers, all caps. Under it a silver strip with two notched blue
  blade tabs (HOW IT WORKS, SETTINGS) around a centered welcome line, then
  a thin footer ticker with career stats (RUNS 14 · CROWNS 3 · last11.app).
  The three pitch cards (Draft/Survive/Loot) become three silver plaques
  inside the hero, not emoji cards.
- **Setup (formation / style / mode)**: the sponsorship template. Left
  list: ten formations as banded rows (selected row white + blue). Right
  pane: mini pitch preview with jersey dots, spec rows (LINES, WIDTH,
  BITE), and the style + Classic/Memory toggles as silver segmented
  blades. Confirm check bottom-right.
- **The Draw (solo + MP draft)**: the slot machine gets a chrome cabinet:
  glossy black frame, silver reel bezel, the nation+year result stamped on
  a red ribbon. Below, the squad's players as RosterRows: jersey chip,
  name, `ST | OVR 94 | AGE 25`, and the right column shows +POINTS in
  blue (our "value"), best pick keeps a thin gold trim. Sort-by-best is a
  small blue sort arrow in the list header, exactly like PLAYER DETAILS ▼.
- **The tactics board**: the lineup screenshot is our blueprint and we are
  already close. Brighten the pitch to FIFA green with mow stripes,
  trapezoid perspective if it survives our tap-targets, jersey chips
  colored by line with shirt numbers, NamePlates with POS/rating/name and
  the fit bar underneath. Formation stepper top-left as a silver blade
  with ◀ ▶. Empty slots are ghosted white jersey outlines.
- **Arena / standings / cut line**: paper table with hairline rows, pos
  number, manager name, W-D-L pips, PTS and GD in tabular nums. The cut
  line is a full-width red ribbon reading THE DROP with a downward notch.
  Your row is the white selected row with blue text.
- **Match playback**: the pitch stays the star; the frame changes. The
  scoreboard becomes a broadcast lower-third: chrome bar, both XI totals
  on silver plaques, formations in condensed caps, the clock in tabular
  nums on a red ribbon. Goal banners keep the team-aware color ramp but
  restyle as sheared broadcast straps sliding in from the side. The
  "Elsewhere this round" rail becomes a thin chrome ticker of mini
  scoreboards. Pens: each kick renders as a jersey chip + name plate with
  the keeper opposite, scored = green pip, missed = red pip.
- **Pit stop (solo + MP)**: manage-contracts, verbatim. Left: fallen
  players as RosterRows with their former manager's name in the sub-row;
  OWNED rows dim with a gray badge. Right: the selected player's spec pane
  (OVR, POS, secondaries, the +points delta in blue) and one chunky silver
  STEAL button; below it the board for re-slotting. The 45s countdown
  lives in the ChromeBar plaque and flips to the gold ALL LOCKED IN fuse.
- **Waiting room (MP)**: master-detail. Left: STILL PLAYING list, one row
  per live match with ticking scores and pens pips. Right: the spoiler-safe
  LIVE TABLE styled as the arena table with the red cut ribbon. Countdown
  to the next slot sits in the header plaque.
- **Lobby + public lobbies**: the select-team grid. Each manager is a cell:
  jersey-crest (their chosen formation as a mini pitch glyph), name in
  condensed caps, star rating once they lock a squad, blue READY state.
  Empty seats show ghosted BOT cells. PUBLIC/PRIVATE is a two-tab blade;
  QUICK PLAY on the home nav drops you here.
- **Spectator + rooting**: the watched match in the broadcast frame plus a
  bottom silver strip: ROOTING FOR + the survivor's chip; tap to change.
- **End screen / Hall of Champions**: the one gold-permitted screen.
  Champion banner on a red-to-chrome diagonal, trophy and coin
  illustrations in the FIFA gold-coin style (inline SVG), placements as a
  paper table, Hall of Champions as banded rows with star ratings.

## What we have at our disposal

- **Stack**: Tailwind 4 (define the palette as CSS vars in index.css and
  reference them from utilities), clip-path for every blade, two-stop
  CSS gradients for all gloss, inline SVG for jerseys/hex/ball/stars/coins
  (no asset pipeline needed), @fontsource for Barlow Condensed + Inter.
- **Installed design skills**: the repo carries a design toolkit under
  `.claude/skills/` that the executing agent should lean on:
  `ui-ux-pro-max` (styles/palettes/font-pairing intelligence, use it to
  pressure-test the palette and type choices above), `design-system`
  (three-layer token architecture: primitive → semantic → component; build
  the CSS variables through it), `ui-styling` (Tailwind execution
  patterns), and `brand` (keep the Last11 voice consistent while the skin
  changes). Run the token layer through `design-system` FIRST so every
  component reads from semantic tokens, not raw hexes.
- **Process**: build the component kit first, then refit screens in this
  order: Home (sets the language) → draft + board → match playback →
  arena/pit → online screens. Screenshot each against the reference with
  the Chrome tooling before moving on. No Figma detour needed; the kit IS
  the design system.
- **Hard constraints**: presentation-only. Do not touch src/engine or
  src/game/online/controller.ts; MP_ENGINE_VERSION must not change. The
  DOM test suite queries by visible text and roles, so keep labels and
  accessible names stable (ALL-CAPS via CSS text-transform, never by
  changing the strings). Draft and pit must still fit one screen with no
  scroll, mobile portrait first: the master-detail collapses to a stacked
  list + slide-over, and the blade nav becomes a bottom bar.
- **Suite stays green** and every step ships straight to main per the
  standing prod workflow.

## Guardrails (what would break the vibe)

- Dark is chrome only. If a content pane comes out dark, it is wrong.
- One red, one blue. If a second accent creeps in, cut it.
- Gold only on champions, trophies, best-pick trim, and the GK amber.
- Corners are square or sheared. No rounded-2xl anywhere in chrome.
- Gloss is subtle: two stops and a 1px highlight, never a plastic bubble.
- No EA/FIFA logos, crests, fonts, or trade dress copies. We are stealing
  the grammar, not the brand.
