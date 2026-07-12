import { LOBBY_SIZE } from '../engine/tournament';

export default function HomeScreen(props: { onStart: () => void; onOnline?: () => void }) {
  return (
    <div className="bg-stadium flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-ink-100">
      <p className="headline text-xs tracking-[0.35em] text-gold-400">
        FOOTBALL DRAFT BATTLE ROYALE
      </p>
      <h1 className="headline text-7xl tracking-tight">
        <span className="text-ink-100">Last</span>
        <span className="headline-shine">11</span>
      </h1>
      <p className="max-w-md text-center text-ink-500">
        {LOBBY_SIZE} managers. One draft wheel. Every round the weakest teams go home —
        survive them all and be the last manager standing.
      </p>
      <div className="mt-2 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
        <Step n="1" title="Draft 🎡" text="Spin for a nation and a World Cup year — 1950 to 2026. Build your XI from history." />
        <Step n="2" title="Survive 📉" text="3 matches a round. The bottom of the table is eliminated: 32 → 24 → 16 → 8 → 4 → 2 → 1." />
        <Step n="3" title="Loot 💀" text="Between rounds, steal one player from a fallen squad. The bots are looting too." />
      </div>
      <div className="mt-4 flex flex-col items-center gap-3 sm:flex-row">
        <button
          onClick={props.onStart}
          className="btn-gold headline cursor-pointer rounded-xl px-12 py-4 text-xl"
        >
          ENTER THE LOBBY
        </button>
        {props.onOnline && (
          <button
            onClick={props.onOnline}
            className="headline cursor-pointer rounded-xl border border-gold-500/60 px-12 py-4 text-xl text-gold-300 transition hover:bg-gold-400/10"
          >
            PLAY ONLINE
          </button>
        )}
      </div>
      <p className="text-xs text-ink-500">11a0.com · United Hacks V7</p>
    </div>
  );
}

function Step(props: { n: string; title: string; text: string }) {
  return (
    <div className="card-gloss rounded-xl p-4 text-left">
      <p className="headline text-xs text-gold-300">
        {props.n} · {props.title}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-ink-500">{props.text}</p>
    </div>
  );
}
