import { flagOf } from '../../game/flags';
import type { DraftMode } from '../../engine/types';
import type { Formation, XiSlotV2 } from '../../engine/types';
import { layoutFormation } from './board-layout';
import { JerseyChip, NamePlate } from '../ui/kit';

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
  // FIFA lineup treatment: glossy jersey colored by the slot's line, rating on
  // the chest (hidden in Memory), dark name plate with the fit bar beneath.
  const natural =
    slot !== null &&
    (slot.player.position === slot.position ||
      (slot.player.secondary ?? []).includes(slot.position));
  const accent = glow
    ? 'rounded-md ring-2 ring-white animate-pulse bg-white/10'
    : selected
      ? 'rounded-md ring-2 ring-gold-400 bg-black/10'
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
      {/* key = player id: a NEW occupant remounts, replaying the drop-pop. */}
      <span
        key={slot?.player.id ?? 'empty'}
        className={`flex flex-col items-center ${accent}${slot ? ' animate-slot-drop' : ''}`}
      >
        {slot ? (
          <>
            <JerseyChip
              pos={slot.position}
              number={!compact && props.mode !== 'memory' ? slot.player.rating : undefined}
              size={compact ? 22 : 40}
            />
            {!compact && (
              <NamePlate
                className="mt-[-4px] w-[5.2rem]"
                name={`${flagOf(slot.player.nation)} ${slot.player.name}`}
                pos={slot.position}
                rating={props.mode !== 'memory' ? slot.player.rating : undefined}
                offPos={!natural}
              />
            )}
          </>
        ) : (
          <>
            <GhostJersey size={compact ? 22 : 40} />
            {!compact && (
              <span className="condensed mt-0.5 rounded-sm bg-black/35 px-1.5 text-[10px] text-white">
                {props.position}
              </span>
            )}
          </>
        )}
      </span>
    </button>
  );
}

/** Empty slot: ghosted white jersey outline (the FIFA empty-lineup look). */
function GhostJersey(props: { size: number }) {
  return (
    <svg viewBox="0 0 40 40" width={props.size} height={props.size} aria-hidden>
      <path
        d="M13 4 L20 7 L27 4 L36 9 L32 17 L28 14 L28 36 L12 36 L12 14 L8 17 L4 9 Z"
        fill="rgba(255,255,255,0.14)"
        stroke="rgba(255,255,255,0.65)"
        strokeWidth="1.6"
        strokeDasharray="3 2.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The tactics-board pitch: FIFA-green turf with mow stripes, jersey chips per
 * slot, dark name plates. `glowSlots` highlights compatible open targets during
 * place-mode; `selectedSlot` marks a between-match selection.
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
      className={`turf-grass relative overflow-hidden rounded-sm ${compact ? 'aspect-[3/4] w-full' : 'aspect-[3/4] w-full lg:h-full lg:w-auto lg:max-w-full'}`}
      data-tour="tactics-pitch"
    >
      {/* pitch markings */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-2 border border-white/45" />
        <div className="absolute left-2 right-2 top-1/2 h-px bg-white/45" />
        <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/45" />
        <div className="absolute left-1/2 top-2 h-14 w-28 -translate-x-1/2 border border-t-0 border-white/45" />
        <div className="absolute bottom-2 left-1/2 h-14 w-28 -translate-x-1/2 border border-b-0 border-white/45" />
        <div className="absolute left-1/2 top-2 h-6 w-14 -translate-x-1/2 border border-t-0 border-white/45" />
        <div className="absolute bottom-2 left-1/2 h-6 w-14 -translate-x-1/2 border border-b-0 border-white/45" />
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
