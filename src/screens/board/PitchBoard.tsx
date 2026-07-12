import { flagOf } from '../../game/flags';
import type { DraftMode } from '../../engine/types';
import type { Formation, XiSlotV2 } from '../../engine/types';
import { layoutFormation } from './board-layout';
import { zoneStyle } from './position-ui';

interface BoardSlotProps {
  x: number;
  y: number;
  slot: XiSlotV2 | null;
  position: string;
  mode: DraftMode;
  glow: boolean;
  selected: boolean;
  compact: boolean;
  onClick?: () => void;
}

function BoardSlot(props: BoardSlotProps) {
  const { slot, glow, selected, compact } = props;
  const clickable = !!props.onClick;
  const size = compact ? 'h-7 w-7 text-[9px]' : 'h-14 w-14 text-xs';
  const base =
    'flex flex-col items-center justify-center rounded-full border-2 transition';
  const look = slot
    ? `${zoneStyle(props.position as never)} border-transparent ring-1`
    : 'border-dashed border-slate-600 bg-slate-900/60 text-slate-500';
  const accent = glow
    ? ' ring-2 ring-emerald-400 border-emerald-400 animate-pulse'
    : selected
      ? ' ring-2 ring-amber-400 border-amber-400'
      : '';
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={props.onClick}
      style={{ left: `${props.x * 100}%`, top: `${(1 - props.y) * 100}%` }}
      className={`absolute -translate-x-1/2 -translate-y-1/2 ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
      data-slot-position={props.position}
    >
      {/* key = player id: a NEW occupant remounts the circle, replaying the
          drop-pop + gold ring ripple (juice pass). */}
      <span
        key={slot?.player.id ?? 'empty'}
        className={`${base} ${size} ${look}${accent}${slot ? ' animate-slot-drop animate-ring-ripple' : ''}`}
      >
        {slot ? (
          <>
            <span className="text-base leading-none">{flagOf(slot.player.nation)}</span>
            {!compact && props.mode !== 'memory' && (
              <span className="font-black leading-none">{slot.player.rating}</span>
            )}
          </>
        ) : (
          <span className="font-bold">{props.position}</span>
        )}
      </span>
      {!compact && slot && (
        <span className="mt-0.5 block max-w-[5.5rem] truncate text-center text-[10px] font-semibold text-slate-200">
          {slot.player.name}
        </span>
      )}
    </button>
  );
}

/**
 * The tactics-board pitch: dashed circles laid out per formation, filled slots
 * showing flag + rating + name. `glowSlots` highlights compatible open targets
 * during place-mode; `selectedSlot` marks a between-match selection.
 */
export default function PitchBoard(props: {
  formation: Formation;
  slate: readonly (XiSlotV2 | null)[];
  mode: DraftMode;
  glowSlots?: ReadonlySet<number> | null;
  /** Slots that accept a click even if not glowing (e.g. off-position open slots
   *  in place-mode). Defaults to "glowing, selected, or already-filled". */
  clickableSlots?: ReadonlySet<number> | null;
  selectedSlot?: number | null;
  onSlotClick?: (slotIndex: number) => void;
  compact?: boolean;
}) {
  const coords = layoutFormation(props.formation.slots);
  const compact = props.compact ?? false;
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-emerald-900/40 ${compact ? 'aspect-[3/4] w-full' : 'aspect-[3/4] w-full lg:h-full lg:w-auto lg:max-w-full'}`}
      style={{
        background:
          'linear-gradient(0deg, #0b3d1f 0%, #0d4a26 50%, #0b3d1f 100%)',
      }}
      data-tour="tactics-pitch"
    >
      {/* pitch markings */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-0 right-0 top-1/2 h-px bg-white/15" />
        <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15" />
        <div className="absolute left-1/2 top-0 h-14 w-28 -translate-x-1/2 border border-t-0 border-white/15" />
        <div className="absolute bottom-0 left-1/2 h-14 w-28 -translate-x-1/2 border border-b-0 border-white/15" />
      </div>
      {coords.map((c) => {
        const slot = props.slate[c.slotIndex] ?? null;
        const glow = props.glowSlots?.has(c.slotIndex) ?? false;
        const selected = props.selectedSlot === c.slotIndex;
        // When clickableSlots is provided it is authoritative (draft place-mode:
        // only open target slots). Otherwise fall back to glow/selected/filled
        // (between-match swap, where tapping a filled slot is the interaction).
        const clickable =
          props.onSlotClick &&
          (props.clickableSlots ? props.clickableSlots.has(c.slotIndex) : glow || selected || !!slot);
        return (
          <BoardSlot
            key={c.slotIndex}
            x={c.x}
            y={c.y}
            slot={slot}
            position={c.position}
            mode={props.mode}
            glow={glow}
            selected={selected}
            compact={compact}
            onClick={clickable ? () => props.onSlotClick!(c.slotIndex) : undefined}
          />
        );
      })}
    </div>
  );
}
