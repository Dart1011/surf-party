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

export function playerColor(id) {
  const colors = ['#ffde59', '#ff7b72', '#7c83ff', '#46dfb0', '#ff9f43', '#f472d0', '#75e6ff', '#c4f26b'];
  let hash = 0;
  for (const char of String(id)) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

export function sanitizeProfile(profile) {
  return {
    name: cleanName(profile?.name),
    character: cleanCharacter(profile?.character),
  };
}

export function sanitizeInput(input) {
  return {
    left: input?.left === true,
    right: input?.right === true,
    up: input?.up === true,
    down: input?.down === true,
    boost: input?.boost === true,
  };
}
