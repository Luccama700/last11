// Shared position styling for the v2 tactics board (12 detailed positions, zoned).
import { POSITION_ZONE, type Position, type Zone } from '../../engine/data/schema';

const ZONE_STYLES: Record<Zone, string> = {
  GK: 'bg-amber-500/20 text-amber-300 ring-amber-400/40',
  DEF: 'bg-sky-500/20 text-sky-300 ring-sky-400/40',
  MID: 'bg-emerald-500/20 text-emerald-300 ring-emerald-400/40',
  ATT: 'bg-rose-500/20 text-rose-300 ring-rose-400/40',
};

export function zoneStyle(position: Position): string {
  return ZONE_STYLES[POSITION_ZONE[position]];
}

export function PositionBadge(props: { position: Position; className?: string }) {
  return (
    <span
      className={`inline-block min-w-9 rounded px-1.5 py-0.5 text-center text-[11px] font-bold tracking-wide ${zoneStyle(
        props.position,
      )} ${props.className ?? ''}`}
    >
      {props.position}
    </span>
  );
}
