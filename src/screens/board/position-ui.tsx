// Shared position styling for the v2 tactics board (12 detailed positions, zoned).
// FIFA 13 re-skin: chips carry the position-line color code (GK amber · DEF green ·
// MID blue · ATT red) on the paper world — text variants darkened for AA contrast.
import { POSITION_ZONE, type Position, type Zone } from '../../engine/data/schema';

const ZONE_STYLES: Record<Zone, string> = {
  GK: 'bg-gk/15 text-[#8a5f00]',
  DEF: 'bg-def/15 text-[#2e7527]',
  MID: 'bg-mid/15 text-[#24549e]',
  ATT: 'bg-att/15 text-[#a91824]',
};

export function zoneStyle(position: Position): string {
  return ZONE_STYLES[POSITION_ZONE[position]];
}

export function PositionBadge(props: { position: Position; className?: string }) {
  return (
    <span
      className={`condensed inline-block min-w-9 rounded-sm px-1.5 py-0.5 text-center text-[11px] font-bold ${zoneStyle(
        props.position,
      )} ${props.className ?? ''}`}
    >
      {props.position}
    </span>
  );
}
