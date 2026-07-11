/**
 * Nation code -> flag emoji, for UI display only.
 *
 * Every nation code that appears in any squad (src/engine/data/*) MUST have an
 * entry here, or it renders as the white-flag fallback in `flagOf`. A test in
 * flags.test.ts enforces that invariant against the live squad data.
 *
 * Historical nations (defunct states that played in old World Cups) map to the
 * flag of their sensible modern successor state — documented per entry below.
 */
export const FLAGS: Record<string, string> = {
  // Current nations present in the squad DB.
  BRA: '🇧🇷',
  ARG: '🇦🇷',
  FRA: '🇫🇷',
  ENG: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  ESP: '🇪🇸',
  GER: '🇩🇪',
  POR: '🇵🇹',
  NED: '🇳🇱',
  BEL: '🇧🇪',
  CRO: '🇭🇷',
  MAR: '🇲🇦',
  JPN: '🇯🇵',
  CMR: '🇨🇲', // Cameroon
  COL: '🇨🇴', // Colombia
  HUN: '🇭🇺', // Hungary
  ITA: '🇮🇹', // Italy
  KOR: '🇰🇷', // South Korea
  SWE: '🇸🇪', // Sweden
  URU: '🇺🇾', // Uruguay
  USA: '🇺🇸', // United States

  // Historical nations -> modern-successor flag (defensive; may enter the DB in
  // later calibration passes covering older World Cups).
  FRG: '🇩🇪', // West Germany -> Germany
  GDR: '🇩🇪', // East Germany -> Germany
  URS: '🇷🇺', // Soviet Union -> Russia (FIFA record successor)
  TCH: '🇨🇿', // Czechoslovakia -> Czech Republic (Czechia)
  YUG: '🇷🇸', // Yugoslavia -> Serbia (FIFA record successor)
};

export function flagOf(code: string): string {
  return FLAGS[code] ?? '🏳️';
}
