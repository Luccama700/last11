import { POSITION_ZONE, type Zone } from '../../engine/data/schema';
import type { XiSlotV2 } from '../../engine/types';

// Tier-A PROXY box score. Fixed attack/defense weights per zone give the 7a0-style
// contribution panel a real signal from the drafted XI before the engine's zonal
// numbers land (Tier-A Demo Contract: "draft's fixed-weight proxy"). When engineV2
// exposes `boxScore`, swap this computation for the real ZoneBox.
const WEIGHTS: Record<Zone, { att: number; def: number }> = {
  GK: { att: 0.0, def: 1.0 },
  DEF: { att: 0.15, def: 0.85 },
  MID: { att: 0.55, def: 0.45 },
  ATT: { att: 0.9, def: 0.1 },
};

const ZONES: Zone[] = ['GK', 'DEF', 'MID', 'ATT'];
const ZONE_LABEL: Record<Zone, string> = { GK: 'Keeper', DEF: 'Defense', MID: 'Midfield', ATT: 'Attack' };

function Bar(props: { value: number; max: number; tone: string }) {
  const pct = props.max > 0 ? Math.min(100, (props.value / props.max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-sm bg-band">
      <div className={`h-full rounded-sm ${props.tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function BoxScorePanel(props: { slate: readonly (XiSlotV2 | null)[] }) {
  const perZone = new Map<Zone, { att: number; def: number; count: number }>();
  for (const z of ZONES) perZone.set(z, { att: 0, def: 0, count: 0 });
  let totalAtt = 0;
  let totalDef = 0;
  for (const s of props.slate) {
    if (!s) continue;
    const z = POSITION_ZONE[s.position];
    const w = WEIGHTS[z];
    const att = s.player.rating * w.att;
    const def = s.player.rating * w.def;
    const cell = perZone.get(z)!;
    cell.att += att;
    cell.def += def;
    cell.count += 1;
    totalAtt += att;
    totalDef += def;
  }
  // max per-zone contribution for bar scaling (defense-heavy back line dominates)
  const maxZone = Math.max(1, ...ZONES.map((z) => perZone.get(z)!.att + perZone.get(z)!.def));

  return (
    <div className="border border-hairline bg-white p-3.5">
      <h2 className="condensed mb-3 border-b border-hairline pb-1 text-[11px] tracking-[0.2em] text-carbon-600">
        Box score
      </h2>
      <div className="space-y-2.5">
        {ZONES.map((z) => {
          const cell = perZone.get(z)!;
          return (
            <div key={z}>
              <div className="mb-1 flex items-baseline justify-between text-[11px]">
                <span className="condensed font-bold text-carbon">{ZONE_LABEL[z]}</span>
                <span className="tabular text-carbon-600">{cell.count} on pitch</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="condensed w-8 text-[10px] text-[#a91824]">ATK</span>
                <Bar value={cell.att} max={maxZone} tone="bg-scarlet" />
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="condensed w-8 text-[10px] text-[#24549e]">DEF</span>
                <Bar value={cell.def} max={maxZone} tone="bg-royal" />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-hairline pt-3 text-center">
        <div>
          <p className="condensed text-[10px] uppercase text-[#a91824]">Attack</p>
          <p className="tabular condensed text-lg font-bold text-carbon">{totalAtt.toFixed(0)}</p>
        </div>
        <div>
          <p className="condensed text-[10px] uppercase text-[#24549e]">Defense</p>
          <p className="tabular condensed text-lg font-bold text-carbon">{totalDef.toFixed(0)}</p>
        </div>
      </div>
      <p className="mt-2 text-[10px] leading-tight text-carbon-600">
        Estimated from your XI — live match ratings come from the engine.
      </p>
    </div>
  );
}
