import { layoutFormation } from './board-layout';
import type { Formation } from '../../engine/types';

/**
 * Mini formation preview: a pure SVG pitch with 11 dots from layoutFormation.
 * No labels — at thumbnail size the SHAPE is the information. Used by the
 * setup screen's formation picker and anywhere a small tactic glyph is needed.
 */
export default function FormationPreview(props: { formation: Formation; active?: boolean }) {
  const coords = layoutFormation(props.formation.slots);
  const dot = props.active ? '#ffffff' : 'rgba(255,255,255,0.75)';
  return (
    <svg viewBox="0 0 60 84" className="h-full w-full" role="img" aria-label={`${props.formation.name} formation`}>
      <rect x="1" y="1" width="58" height="82" rx="6" fill="var(--color-turf-500)" stroke="rgba(255,255,255,0.45)" />
      <line x1="1" y1="42" x2="59" y2="42" stroke="rgba(255,255,255,0.18)" />
      <circle cx="30" cy="42" r="6" fill="none" stroke="rgba(255,255,255,0.18)" />
      <rect x="19" y="1" width="22" height="8" fill="none" stroke="rgba(255,255,255,0.18)" />
      <rect x="19" y="75" width="22" height="8" fill="none" stroke="rgba(255,255,255,0.18)" />
      {coords.map((c) => (
        // y flipped: engine y=0 is own goal (bottom of the preview)
        <circle
          key={c.slotIndex}
          cx={4 + c.x * 52}
          cy={80 - c.y * 76}
          r={3}
          fill={c.position === 'GK' ? 'rgba(255,255,255,0.85)' : dot}
        />
      ))}
    </svg>
  );
}
