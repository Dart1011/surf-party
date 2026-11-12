export const MAX_PLAYERS = 8;
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
  const coordinate = value => Number.isFinite(Number(value)) ? Math.max(-10000000, Math.min(10000000, Math.round(Number(value) * 10) / 10)) : 0;
  const pose = Number(stats?.pose);
  const character = Number(stats?.character);
  const air = Number(stats?.air);
  return {
    distance: Number.isFinite(distance) ? Math.max(0, Math.min(10000000, Math.floor(distance))) : 0,
    lives: Number.isFinite(lives) ? Math.max(0, Math.min(3, Math.floor(lives))) : 0,
    over: stats?.over === true,
    worldX: coordinate(stats?.worldX),
    worldY: coordinate(stats?.worldY),
    pose: Number.isInteger(pose) ? Math.max(1, Math.min(13, pose)) : 4,
    character: Number.isInteger(character) ? Math.max(1, Math.min(7, character)) : 4,
    air: Number.isFinite(air) ? Math.max(0, Math.min(10000, air)) : 0,
    sessionState: ['MENU', 'PLAY', 'PAUSE', 'OVER'].includes(stats?.sessionState) ? stats.sessionState : 'PLAY',
  };
}
