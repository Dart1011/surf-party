export const MAX_PLAYERS = 8;
export const ROOM_PREFIX = 'surf-party-v1-';
export const CHARACTERS = 7;

export function cleanName(value) {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return name || 'Surfer';
}

export function cleanCode(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function cleanCharacter(value) {
  const character = Number(value);
  return Number.isInteger(character) && character >= 0 && character < CHARACTERS ? character : 0;
}

export function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
}

export function hostPeerId(code) {
  return `${ROOM_PREFIX}${cleanCode(code).toLowerCase()}`;
}

export function shareUrl(code) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', cleanCode(code));
  return url.href;
}

export function sanitizeProfile(profile) {
  return {
    name: cleanName(profile?.name),
    character: cleanCharacter(profile?.character),
  };
}

export function sanitizeStats(stats) {
  const distance = Number(stats?.distance);
  const lives = Number(stats?.lives);
  return {
    distance: Number.isFinite(distance) ? Math.max(0, Math.min(10000000, Math.floor(distance))) : 0,
    lives: Number.isFinite(lives) ? Math.max(0, Math.min(3, Math.floor(lives))) : 0,
    over: stats?.over === true,
  };
}
