import { CHARACTERS } from '../shared/config.js';
import type { CharacterId } from '../shared/types.js';

export const esc = (value: unknown) => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
export function icon(name: string, size = 20): string {
  const paths: Record<string, string> = {
    game: '<path d="M6 7h12l3 10-3 2-4-4h-4l-4 4-3-2 3-10Z"/><path d="M7 10v5m-2-2h4m7-2h.01m2 3h.01"/>',
    arrow: '<path d="m9 5 7 7-7 7M4 12h12"/>',
    play: '<path d="m7 4 13 8-13 8V4Z" fill="currentColor" stroke="none"/>',
    settings: '<path d="M4 7h16M4 17h16M8 3v8m8 2v8"/><rect x="6" y="5" width="4" height="4" fill="currentColor"/><rect x="14" y="15" width="4" height="4" fill="currentColor"/>',
    map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16"/>',
    heart: '<path d="M12 20 3 11V6l4-3 5 4 5-4 4 3v5l-9 9Z"/>',
    shuffle: '<path d="M3 6h4l10 12h4m-4-3 4 3-4 3M3 18h4l3-4m4-4 3-4h4m-4-3 4 3-4 3"/>',
    volume: '<path d="m11 4-5 4H3v8h3l5 4V4Z"/><path d="M15 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14"/>',
    mute: '<path d="m11 4-5 4H3v8h3l5 4V4Zm5 5 5 6m0-6-5 6"/>',
    expand: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3c-1 0-1 1-1 2m0 3h.01"/>',
    keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m3-11a3 3 0 0 0 0-6m1 11a5 5 0 0 1 3 4v2"/>',
    bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/>',
    box: '<path d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm-9 5 9 5 9-5m-9 5v9M7 6l10 5"/>',
    check: '<path d="m5 12 4 4L20 5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    reset: '<path d="M4 4v6h6M4 10a8 8 0 1 1 1 9"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.game}</svg>`;
}

export function portrait(id: CharacterId): string {
  const patterns: Record<CharacterId, string[]> = {
    uncle: ['....OOOO....','...OAAAOO...','..OSSSSSSO..','..OSKSSKSO..','..OSSSSSSO..','...OSSSSO...','..OCCCCCCO..','.OCCCCCCCCO.','OSOCCCCCCOGO','OSOCAAACCOGO','..OCAAACCO..','...OCOOCO...','..OAAOOAAO..'],
    slipper: ['....OOOO....','...OCCCCO...','..OCCCCCCO..','..OCSSSSCO..','..OSKSSKSO..','...OSSSSO...','..OCCCCCCO..','.OCCCCCCCCO.','OSOCCCCCCOSO','..OCCCCCCO..','...OAAAO....','...OAOAO....','..OCCOOCCO..'],
    chicken: ['.....RR.....','....RRRR....','...OWWWWO...','..OWWWWWWO..','..OWKWKWWO..','..OWWYYWWO..','...OWWWWO...','..OCCCCCCO..','.OCCKCCKCCO.','.OCCCCCCCCO.','..OWWWWWWO..','...OYOOYO...','..OYYOOYYO..'],
    raccoon: ['...O....O...','..OAO..OAO..','..OGGGGGGO..','..OGKKKKGO..','..OGWKKWGO..','...OGSSGO...','..OAAAAAAO..','.OAAAAAAAAO.','OGOAASSAAOGO','..OAAAAAAO..','...OGGGGO...','...OGOOGO...','..OAAOOAAO..'],
  };
  const character = CHARACTERS[id];
  const palette: Record<string, string> = { O: '#282d3d', A: character.accent, C: character.color, S: '#f4c89c', K: '#242438', W: '#fff9df', G: '#a3acba', Y: '#edac44', R: '#e26d73' };
  let cells = '';
  patterns[id].forEach((row, y) => [...row].forEach((c, x) => { if (palette[c]) cells += `<rect x="${x * 4 + 8}" y="${y * 4 + 4}" width="4" height="4" fill="${palette[c]}"/>`; }));
  return `<svg class="pixel-portrait" viewBox="0 0 64 64" shape-rendering="crispEdges" aria-hidden="true">${cells}</svg>`;
}
