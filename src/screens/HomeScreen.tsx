import { LOBBY_SIZE } from '../engine/tournament';

export default function HomeScreen(props: { onStart: () => void }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-6 px-6">
      <p className="text-xs font-bold uppercase tracking-[0.3em] text-emerald-400">
        Football draft battle royale
      </p>
      <h1 className="text-7xl font-black tracking-tight">
        Last<span className="text-emerald-400">11</span>
      </h1>
      <p className="max-w-md text-center text-slate-400">
        {LOBBY_SIZE} managers. One draft wheel. Every round the weakest teams go home —
        survive them all and be the last manager standing.
      </p>
      <div className="mt-2 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
        <Step n="1" title="Draft 🎡" text="11 spins of the wheel. Take the star off-position, or build nation chemistry?" />
        <Step n="2" title="Survive 📉" text="3 matches a round. The bottom of the table is eliminated: 32 → 24 → 16 → 8 → 4 → 2 → 1." />
        <Step n="3" title="Loot 💀" text="Between rounds, steal one player from a fallen squad. The bots are looting too." />
      </div>
      <button
        onClick={props.onStart}
        className="mt-4 rounded-xl bg-emerald-500 px-10 py-4 text-xl font-black text-slate-950 shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400 hover:shadow-emerald-400/30"
      >
        ENTER THE LOBBY
      </button>
      <p className="text-xs text-slate-600">11a0.com · United Hacks V7</p>
    </div>
  );
}

function Step(props: { n: string; title: string; text: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-left">
      <p className="text-xs font-black text-emerald-400">
        {props.n} · {props.title}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">{props.text}</p>
    </div>
  );
}
