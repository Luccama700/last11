/** Nation code -> flag emoji, for UI display only. */
export const FLAGS: Record<string, string> = {
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
};

export function flagOf(code: string): string {
  return FLAGS[code] ?? '🏳️';
}
