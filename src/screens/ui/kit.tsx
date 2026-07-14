// FIFA 13 component kit — the shared visual grammar for every refit screen.
// Semantic layer over the primitives in index.css (@theme). Presentation only:
// no engine imports, no game state. See docs/redesign/FIFA13-REDESIGN-VISION.md.
import type { ReactNode } from 'react';

/* ── ChromeBar: glossy black header. Centered caps title, optional red accent
   ribbon underneath, optional right plaque (points/countdown). ─────────────── */
export function ChromeBar(props: {
  title: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  ribbon?: boolean;
  className?: string;
}) {
  return (
    <div className={props.className ?? ''}>
      <div className="chrome-gloss relative flex h-11 items-center justify-between px-3 text-white">
        <div className="z-10 flex min-w-0 items-center gap-2">{props.left}</div>
        <div className="condensed pointer-events-none absolute inset-x-0 text-center text-lg tracking-wide">
          {props.title}
        </div>
        <div className="z-10 flex items-center gap-2">{props.right}</div>
      </div>
      {props.ribbon && <div className="scarlet-gloss h-1" />}
    </div>
  );
}

/* Silver plaque for the ChromeBar right slot (money/points/countdown). */
export function Plaque(props: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`silver-gloss tabular condensed flex h-7 items-center gap-1 rounded-full px-4 text-sm ${props.className ?? ''}`}
    >
      {props.children}
    </div>
  );
}

/* ── TickerBar: glossy black footer — the voice of the game. Back blade bottom
   left, confirm blade bottom right, one helper sentence centered. ──────────── */
export function TickerBar(props: {
  children?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  onConfirm?: () => void;
  confirmLabel?: ReactNode;
  confirmDisabled?: boolean;
  className?: string;
}) {
  return (
    <div className={`chrome-gloss relative flex h-12 items-center text-white ${props.className ?? ''}`}>
      {props.onBack && (
        <button
          onClick={props.onBack}
          aria-label={props.backLabel ?? 'Back'}
          className="silver-gloss blade-r condensed h-full cursor-pointer px-6 text-xl"
        >
          <BackArrow />
        </button>
      )}
      <div className="flex-1 truncate px-3 text-center text-sm text-white/90">{props.children}</div>
      {props.onConfirm && (
        <button
          onClick={props.onConfirm}
          disabled={props.confirmDisabled}
          className="silver-gloss blade-l condensed h-full cursor-pointer px-6 text-xl disabled:cursor-default disabled:opacity-40"
        >
          {props.confirmLabel ?? <CheckMark />}
        </button>
      )}
    </div>
  );
}

function BackArrow() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-carbon" aria-hidden>
      <path d="M14.5 4 6 12l8.5 8v-4.5H20v-7h-5.5V4z" />
    </svg>
  );
}
function CheckMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-carbon" aria-hidden>
      <path d="M9.3 18.2 3.6 12.5l2.2-2.2 3.5 3.5 8.9-8.9 2.2 2.2z" />
    </svg>
  );
}

/* ── BladeButton: sheared silver slab. variant 'nav' = white-on-chrome item. ── */
export function BladeButton(props: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'silver' | 'danger' | 'blue';
  className?: string;
  disabled?: boolean;
}) {
  const text =
    props.variant === 'danger'
      ? 'text-scarlet'
      : props.variant === 'blue'
        ? 'text-royal'
        : 'text-carbon';
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className={`silver-gloss blade condensed cursor-pointer px-6 py-2 text-base ${text} disabled:cursor-default disabled:opacity-40 ${props.className ?? ''}`}
    >
      {props.children}
    </button>
  );
}

/* ── Position lines: every player surface derives its color from this. ─────── */
export type PosLine = 'GK' | 'DEF' | 'MID' | 'ATT';
export function lineOf(pos: string): PosLine {
  if (pos === 'GK') return 'GK';
  if (['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(pos)) return 'DEF';
  if (['CDM', 'CM', 'CAM', 'LM', 'RM'].includes(pos)) return 'MID';
  return 'ATT'; // ST, CF, LW, RW
}
export const LINE_FILL: Record<PosLine, string> = {
  GK: 'var(--color-gk)',
  DEF: 'var(--color-def)',
  MID: 'var(--color-mid)',
  ATT: 'var(--color-att)',
};

/* ── JerseyChip: glossy inline-SVG jersey, colored by line, number on chest.
   Numbers use a dark stroke (FIFA treatment) so they read on any fill. ─────── */
export function JerseyChip(props: {
  pos: string;
  number?: number | string;
  size?: number; // px, default 28
  className?: string;
}) {
  const size = props.size ?? 28;
  const fill = LINE_FILL[lineOf(props.pos)];
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={props.className}
      aria-hidden
      style={{ flex: 'none', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.28))' }}
    >
      {/* body + sleeves */}
      <path
        d="M13 4 L20 7 L27 4 L36 9 L32 17 L28 14 L28 36 L12 36 L12 14 L8 17 L4 9 Z"
        fill={fill}
        stroke="rgba(20,23,26,0.55)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* collar */}
      <path d="M13 4 L20 7 L27 4 L25 9 L20 11 L15 9 Z" fill="rgba(255,255,255,0.85)" />
      {/* gloss highlight */}
      <path d="M12 14 L28 14 L28 20 Q20 16 12 20 Z" fill="rgba(255,255,255,0.22)" />
      {props.number !== undefined && (
        <text
          x="20"
          y="29"
          textAnchor="middle"
          fontSize="14"
          fontWeight="700"
          fontFamily="var(--font-condensed)"
          fill="#ffffff"
          stroke="rgba(20,23,26,0.85)"
          strokeWidth="2.5"
          paintOrder="stroke"
        >
          {props.number}
        </text>
      )}
    </svg>
  );
}

/* ── NamePlate: the dark glossy lineup plate. POS left, rating right, name
   below, thin fit bar underneath (green natural / amber off-position). ─────── */
export function NamePlate(props: {
  name: string;
  pos: string;
  rating?: number | string; // omit to hide (Memory mode)
  fit?: number; // 0..1, default 1
  offPos?: boolean;
  className?: string;
}) {
  const fit = props.fit ?? 1;
  return (
    <div
      className={`plate-dark rounded-md px-1.5 pt-0.5 pb-1 text-white ${props.className ?? ''}`}
    >
      <div className="flex items-baseline justify-between gap-1 leading-none">
        <span className="condensed text-[9px] text-white/75">{props.pos}</span>
        {props.rating !== undefined && (
          <span className="tabular condensed text-[11px]">{props.rating}</span>
        )}
      </div>
      <div className="condensed truncate text-center text-[11px] leading-tight">{props.name}</div>
      <div className="mt-0.5 h-[3px] w-full rounded-sm bg-black/50">
        <div
          className="h-full rounded-sm"
          style={{
            width: `${Math.round(fit * 100)}%`,
            background: props.offPos ? 'var(--color-gk)' : '#7ee36a',
          }}
        />
      </div>
    </div>
  );
}

/* ── RosterRow: the one list row. Jersey chip + bold name + pipe-separated
   stat sub-row; right column is the blue value (points/rating). ────────────── */
export function RosterRow(props: {
  pos: string;
  number?: number | string;
  name: ReactNode;
  stats: ReactNode[]; // rendered joined by pipes
  value?: ReactNode; // right column, royal blue
  valueSub?: ReactNode; // small gray line under the value
  selected?: boolean;
  dimmed?: boolean;
  gold?: boolean; // best-pick trim
  onClick?: () => void;
  className?: string;
  testid?: string;
}) {
  const Tag = props.onClick ? 'button' : 'div';
  return (
    <Tag
      data-testid={props.testid}
      onClick={props.onClick}
      className={[
        'flex w-full items-center gap-2 border-b border-hairline px-2 py-1.5 text-left',
        props.onClick ? 'row-band cursor-pointer hover:bg-white/70' : 'row-band',
        props.selected ? 'row-selected' : '',
        props.dimmed ? 'opacity-45' : '',
        props.gold ? 'outline outline-1 -outline-offset-1 outline-gold-500' : '',
        props.className ?? '',
      ].join(' ')}
    >
      <JerseyChip pos={props.pos} number={props.number} size={30} />
      <div className="min-w-0 flex-1">
        <div className={`condensed truncate text-[15px] leading-tight ${props.selected ? '' : 'text-carbon'}`}>
          {props.name}
        </div>
        <div className="tabular flex items-center gap-1.5 text-[11px] leading-tight text-carbon-600">
          {props.stats.map((s, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-hairline">|</span>}
              {s}
            </span>
          ))}
        </div>
      </div>
      {props.value !== undefined && (
        <div className="text-right">
          <div className="tabular condensed text-[15px] font-bold text-royal">{props.value}</div>
          {props.valueSub && (
            <div className="condensed text-[9px] leading-tight text-carbon-600">{props.valueSub}</div>
          )}
        </div>
      )}
    </Tag>
  );
}

/* ── StarRating: 0–5 with halves (FIFA team stars). ────────────────────────── */
export function StarRating(props: { value: number; className?: string; size?: number }) {
  const size = props.size ?? 14;
  return (
    <div className={`flex items-center gap-[1px] ${props.className ?? ''}`} aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, props.value - i));
        return <Star key={i} fill={fill} size={size} />;
      })}
    </div>
  );
}
function Star(props: { fill: number; size: number }) {
  const id = `sf${Math.round(props.fill * 100)}`;
  return (
    <svg viewBox="0 0 20 20" width={props.size} height={props.size}>
      <defs>
        <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
          <stop offset={`${props.fill * 100}%`} stopColor="#3b4046" />
          <stop offset={`${props.fill * 100}%`} stopColor="#c4c9cf" />
        </linearGradient>
      </defs>
      <path
        d="M10 1.8l2.5 5.1 5.6.8-4 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-4 5.6-.8z"
        fill={`url(#${id})`}
      />
    </svg>
  );
}

/* ── MasterDetail: banded list left, spec pane right (sponsorship template).
   Mobile portrait: list full-width; detail becomes a slide-over sheet when
   `detailOpen` (parent controls it — tapping a row opens, back closes). ────── */
export function MasterDetail(props: {
  list: ReactNode;
  detail: ReactNode;
  detailOpen?: boolean;
  onCloseDetail?: () => void;
  className?: string;
}) {
  return (
    <div className={`relative flex min-h-0 flex-1 ${props.className ?? ''}`}>
      <div className="min-h-0 flex-1 overflow-y-auto bg-white lg:max-w-[46%] lg:border-r lg:border-hairline">
        {props.list}
      </div>
      <div className="paper-pane relative hidden min-h-0 flex-1 overflow-y-auto lg:block">
        <HexWatermark />
        <div className="relative">{props.detail}</div>
      </div>
      {/* mobile slide-over */}
      {props.detailOpen && (
        <div className="absolute inset-0 z-20 flex flex-col lg:hidden">
          <button
            aria-label="Close details"
            onClick={props.onCloseDetail}
            className="absolute inset-0 bg-black/45"
          />
          <div className="paper-pane relative mt-auto max-h-[85%] overflow-y-auto shadow-2xl">
            <HexWatermark />
            <div className="relative">{props.detail}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Watermarks: hex mesh + ghosted ball, ~4% carbon on paper. ─────────────── */
export function HexWatermark(props: { className?: string }) {
  return (
    <svg
      className={`pointer-events-none absolute inset-0 h-full w-full ${props.className ?? ''}`}
      aria-hidden
    >
      <defs>
        <pattern id="hexmesh" width="56" height="97" patternUnits="userSpaceOnUse">
          <path
            d="M28 0 L56 16 L56 48 L28 64 L0 48 L0 16 Z M28 64 L56 80 L56 97 M28 64 L0 80 L0 97"
            fill="none"
            stroke="rgba(43,47,51,0.05)"
            strokeWidth="1.5"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#hexmesh)" />
    </svg>
  );
}

export function BallWatermark(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 200"
      className={`pointer-events-none absolute ${props.className ?? 'right-[-40px] bottom-[-40px] h-64 w-64'}`}
      aria-hidden
    >
      <g fill="none" stroke="rgba(43,47,51,0.06)" strokeWidth="2">
        <circle cx="100" cy="100" r="96" />
        <path d="M100 40 L157 82 L135 148 L65 148 L43 82 Z" />
        <path d="M100 40 L100 4 M157 82 L191 71 M135 148 L157 177 M65 148 L43 177 M43 82 L9 71" />
      </g>
      <path d="M100 40 L157 82 L135 148 L65 148 L43 82 Z" fill="rgba(43,47,51,0.05)" />
    </svg>
  );
}
