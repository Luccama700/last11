import { useMemo, useState } from 'react';
import { LOBBY_SIZE } from '../engine/tournament';
import { readChampions } from '../game/champions';
import { ChromeBar, HexWatermark, StarRating, TickerBar } from './ui/kit';

// FIFA 13 home: paper hero sliced by the red diagonal, chrome nav blade bar,
// silver strip with notched tabs, stats footer ticker. Layout DNA: chrome top,
// light content, chrome bottom. (docs/redesign/FIFA13-REDESIGN-VISION.md)
export default function HomeScreen(props: {
  onStart: () => void;
  onOnline?: () => void;
  onQuickPlay?: () => void;
}) {
  const [hallOpen, setHallOpen] = useState(false);
  const champions = useMemo(() => readChampions(), [hallOpen]);
  const crowns = champions.filter((c) => c.isHuman).length;

  return (
    <div className="flex min-h-dvh flex-col bg-arena">
      <ChromeBar
        ribbon
        title="FOOTBALL DRAFT BATTLE ROYALE"
        left={<Crest />}
        right={<span className="condensed hidden text-xs text-white/60 sm:block">EST. 2026</span>}
      />

      {/* Hero: paper + hex mesh, red diagonal panel slicing in from the right. */}
      <div className="relative flex-1 overflow-hidden">
        <HexWatermark />
        {/* red slash */}
        <div
          className="scarlet-gloss glint absolute inset-y-0 right-0 hidden w-[46%] sm:block"
          style={{ clipPath: 'polygon(34% 0, 100% 0, 100% 100%, 0 100%)' }}
        >
          <div className="flex h-full flex-col items-center justify-center gap-3 pl-[22%] pr-6 text-center">
            <p className="condensed animate-fade-up text-2xl leading-tight lg:text-3xl" style={{ animationDelay: '250ms' }}>
              {LOBBY_SIZE} managers walk in.
              <br />
              One walks out.
            </p>
            <p className="max-w-xs text-xs leading-relaxed text-white/85">
              Every round the bottom of the table goes home. Survive every cut and be the last
              manager standing.
            </p>
            <div className="mt-1 flex gap-1.5" aria-hidden>
              <span className="h-2 w-2 rounded-full bg-white" />
              <span className="h-2 w-2 rounded-full bg-white/40" />
              <span className="h-2 w-2 rounded-full bg-white/40" />
            </div>
          </div>
        </div>

        {/* wordmark + steps */}
        <div className="relative flex h-full flex-col justify-center gap-5 px-6 py-8 sm:max-w-[58%] lg:px-12">
          <div className="animate-fade-up">
            <p className="condensed text-xs tracking-[0.3em] text-carbon-600">
              96 YEARS OF WORLD CUP HISTORY
            </p>
            <h1 className="condensed text-7xl font-bold leading-none text-carbon lg:text-8xl">
              Last<span className="text-scarlet">11</span>
            </h1>
          </div>

          <p className="max-w-md text-sm leading-relaxed text-carbon-600 sm:hidden">
            {LOBBY_SIZE} managers. One draft wheel. Every round the weakest teams go home — survive
            them all and be the last manager standing.
          </p>

          <div className="grid max-w-xl grid-cols-1 gap-2 sm:grid-cols-3">
            <Step i={0} n="1" title="Draft" text="Spin for a nation and a World Cup year — 1930 to 2026. Build your XI from history." />
            <Step i={1} n="2" title="Survive" text="3 matches a round. The bottom of the table is eliminated: 32 → 24 → 16 → 8 → 4 → 2 → 1." />
            <Step i={2} n="3" title="Loot" text="Between rounds, steal one player from a fallen squad. The bots are looting too." />
          </div>
        </div>
      </div>

      {/* Nav blade bar */}
      <nav className="chrome-gloss grid grid-cols-2 sm:grid-cols-4">
        <NavItem onClick={props.onStart}>ENTER THE LOBBY</NavItem>
        {props.onOnline ? (
          <NavItem onClick={props.onOnline}>
            PLAY ONLINE
            <span className="ml-1.5 align-middle rounded-sm bg-scarlet px-1 py-px text-[9px] tracking-widest text-white">
              BETA
            </span>
          </NavItem>
        ) : (
          <span aria-hidden className="hidden sm:block" />
        )}
        {(props.onQuickPlay ?? props.onOnline) ? (
          <NavItem onClick={props.onQuickPlay ?? props.onOnline}>QUICK PLAY</NavItem>
        ) : (
          <span aria-hidden className="hidden sm:block" />
        )}
        <NavItem onClick={() => setHallOpen(true)}>HALL OF CHAMPIONS</NavItem>
      </nav>

      {/* Silver strip with notched tabs */}
      <div className="silver-gloss relative flex h-9 items-center justify-between overflow-hidden">
        <span className="chrome-gloss blade condensed ml-[-6px] flex h-full items-center px-5 text-xs text-white">
          UNITED HACKS V7
        </span>
        <span className="condensed truncate px-2 text-sm text-carbon">Welcome back, manager.</span>
        <span className="chrome-gloss blade condensed mr-[-6px] flex h-full items-center px-5 text-xs text-white">
          LAST11.APP
        </span>
      </div>

      {/* Stats footer ticker */}
      <div className="flex h-8 items-center justify-center gap-6 bg-chrome-950 text-[11px] text-white/75">
        <span className="condensed tabular">RUNS {champions.length}</span>
        <span className="condensed tabular flex items-center gap-1">
          <CrownGlyph /> CROWNS {crowns}
        </span>
        <span className="condensed tabular">{LOBBY_SIZE} MANAGERS PER LOBBY</span>
      </div>

      {hallOpen && <HallOverlay onClose={() => setHallOpen(false)} />}
    </div>
  );
}

function NavItem(props: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={props.onClick}
      className="condensed animate-fade-up cursor-pointer border-r border-white/10 px-2 py-3.5 text-center text-base text-white transition-[background,transform] duration-200 last:border-r-0 hover:bg-white/10 hover:-translate-y-0.5 active:translate-y-0 active:bg-black/30 lg:text-lg"
    >
      {props.children}
    </button>
  );
}

function Step(props: { i: number; n: string; title: string; text: string }) {
  return (
    <div
      className="silver-gloss blade hover-lift animate-fade-up p-3 text-left"
      style={{ animationDelay: `${120 + props.i * 90}ms` }}
    >
      <p className="condensed text-sm text-carbon">
        <span className="text-scarlet">{props.n}</span> · {props.title}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-carbon-600">{props.text}</p>
    </div>
  );
}

function Crest() {
  return (
    <span className="condensed animate-float flex h-7 w-7 items-center justify-center rounded-full bg-white text-sm font-bold text-carbon shadow-inner">
      11
    </span>
  );
}

function CrownGlyph() {
  return (
    <svg viewBox="0 0 20 14" className="h-3 w-3 fill-gold-400" aria-hidden>
      <path d="M1 4l4 4 5-6 5 6 4-4v8H1z" />
    </svg>
  );
}

/* Hall of Champions overlay — the one gold-permitted surface off the end screen. */
function HallOverlay(props: { onClose: () => void }) {
  const champions = readChampions();
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black/55">
      <div className="mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col p-4 sm:p-8">
        <ChromeBar ribbon title="HALL OF CHAMPIONS" />
        <div className="paper-pane relative min-h-0 flex-1 overflow-y-auto">
          <HexWatermark />
          <div className="relative">
            {champions.length === 0 && (
              <p className="p-6 text-center text-sm text-carbon-600">
                No crowns yet. Enter the lobby and take one.
              </p>
            )}
            {[...champions].reverse().map((c, i) => (
              <div
                key={i}
                className="row-band flex items-center gap-3 border-b border-hairline px-3 py-2"
              >
                <span className={c.isHuman ? 'text-gold-500' : 'text-hairline'}>
                  <svg viewBox="0 0 20 14" className="h-4 w-5 fill-current" aria-hidden>
                    <path d="M1 4l4 4 5-6 5 6 4-4v8H1z" />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="condensed truncate text-[15px] text-carbon">{c.name}</div>
                  <div className="text-[11px] text-carbon-600">
                    {new Date(c.date).toLocaleDateString()}
                    {c.placementOfHuman !== null && ` · you finished #${c.placementOfHuman}`}
                  </div>
                </div>
                <StarRating value={c.isHuman ? 5 : 3} />
              </div>
            ))}
          </div>
        </div>
        <TickerBar onBack={props.onClose}>Your crowns live here between runs.</TickerBar>
      </div>
    </div>
  );
}
