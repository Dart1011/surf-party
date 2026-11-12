import { Room } from './network.js';
import { cleanCode, cleanName, shareUrl } from './protocol.js';

const $ = id => document.getElementById(id);
const panels = {
  home: $('party-home'),
  lobby: $('party-lobby'),
  results: $('party-results'),
  spectator: $('party-spectator'),
};

let view = 'home';
let room;
let participants = [];
let runId = null;
let startAt = 0;
let runStarted = false;
let starting = false;
let lastStatSignature = '';
let completionTimer = null;
let countdownValue = null;
let toastTimer;

try {
  $('party-name').value = localStorage.getItem('surf-name') || `Surfer ${Math.floor(10 + Math.random() * 90)}`;
} catch {
  $('party-name').value = `Surfer ${Math.floor(10 + Math.random() * 90)}`;
}

room = createRoom();

function createRoom() {
  const next = new Room();
  next.raceProvider = () => ({
    raceId: runId,
    startAt,
    sentAt: Date.now(),
    players: participants,
  });
  next.addEventListener('ready', event => {
    setBusy(false);
    setView(next.phase === 'race' ? 'spectator' : 'lobby');
    renderLobby();
  });
  next.addEventListener('lobby', () => {
    renderLobby();
    renderLivePlayers();
  });
  next.addEventListener('return-lobby', () => showLobby());
  next.addEventListener('start', event => beginRun(event.detail));
  next.addEventListener('stats', event => {
    const player = next.players.find(player => player.id === event.detail.id);
    if (player) player.stats = event.detail.stats;
    renderLivePlayers();
    checkRunComplete();
  });
  next.addEventListener('results', event => showResults(event.detail.players));
  next.addEventListener('player-left', () => {
    renderLivePlayers();
    if (view === 'playing') toast('A surfer left the room.');
    checkRunComplete();
  });
  next.addEventListener('error', event => {
    setBusy(false);
    if (view === 'playing') toast(event.detail, 6000);
    else {
      setView('home');
      showError(event.detail);
    }
  });
  next.addEventListener('host-left', () => {
    next.leave();
    showHome('The host left, so this room has closed.');
  });
  next.addEventListener('status', event => toast(event.detail));
  return next;
}

function setView(next) {
  view = next;
  for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== next;
  $('party-root').hidden = next === 'playing' || next === 'countdown';
  $('party-toggle').hidden = next !== 'playing';
  if (next !== 'playing') $('party-roster').hidden = true;
  if (next !== 'countdown') $('party-countdown').hidden = true;
  if (next !== 'home') $('party-error').hidden = true;
}

function showHome(error = '') {
  const shouldReload = runStarted;
  runStarted = false;
  starting = false;
  participants = [];
  clearTimeout(completionTimer);
  const url = new URL(window.location.href);
  url.search = '';
  history.replaceState(null, '', url);
  if (shouldReload) {
    try {
      if (error) sessionStorage.setItem('party-message', error);
    } catch {}
    window.location.reload();
    return;
  }
  setView('home');
  resetOriginalToMenu();
  setBusy(false);
  if (error) showError(error);
}

function showLobby() {
  starting = false;
  runStarted = false;
  participants = [];
  setView('lobby');
  resetOriginalToMenu();
  renderLobby();
}

function profile() {
  const name = cleanName($('party-name').value);
  $('party-name').value = name;
  try {
    localStorage.setItem('surf-name', name);
  } catch {}
  return { name, character: 0 };
}

function setBusy(busy) {
  $('party-create').disabled = busy;
  $('party-join').disabled = busy;
  $('party-busy').hidden = !busy;
}

function showError(message) {
  $('party-error').textContent = message;
  $('party-error').hidden = false;
}

function clearError() {
  $('party-error').hidden = true;
  $('party-error').textContent = '';
}

function createRoomFromUI() {
  clearError();
  setBusy(true);
  room.leave();
  room = createRoom();
  room.create(profile());
}

function joinRoomFromUI() {
  const code = cleanCode($('party-code').value);
  if (code.length !== 6) {
    showError('Enter the six-character room code from your invite.');
    return;
  }
  clearError();
  setBusy(true);
  room.leave();
  room = createRoom();
  room.join(code, profile());
}

function renderLobby() {
  if (!room.code || view !== 'lobby') return;
  $('party-copy-code').textContent = room.code;
  $('party-share-link').value = shareUrl(room.code);
  $('party-player-count').textContent = `${room.players.length} / 8`;
  $('party-start').hidden = !room.isHost;
  $('party-start').disabled = starting;
  $('party-waiting').hidden = room.isHost;
  renderPlayerRows($('party-lobby-players'), room.players, false);
}

function startRun() {
  if (!room.isHost || starting) return;
  starting = true;
  document.activeElement?.blur();
  const data = {
    raceId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    startAt: Date.now() + 3300,
    sentAt: Date.now(),
    players: room.players.map(player => ({ id: player.id, name: player.name, character: player.character })),
  };
  room.startRace(data);
  beginRun(data);
}

function beginRun(data) {
  if (!data?.raceId || !Array.isArray(data.players)) return;
  runId = data.raceId;
  participants = data.players;
  startAt = room.isHost ? data.startAt : Date.now() + (data.startAt - (data.sentAt || Date.now()));
  runStarted = false;
  starting = false;
  lastStatSignature = '';
  countdownValue = null;
  clearTimeout(completionTimer);
  const participating = participants.some(player => player.id === room.localId);
  if (!participating) {
    setView('spectator');
    renderLivePlayers();
    return;
  }

  dispatchOriginalKey('Escape', 'Escape', 27);
  resetOriginalToMenu();
  setView('countdown');
  $('party-countdown').hidden = false;
  tickCountdown();
}

function tickCountdown() {
  if (view !== 'countdown') return;
  const remaining = startAt - Date.now();
  if (remaining > 0) {
    const value = Math.ceil(remaining / 1000);
    if (value !== countdownValue) {
      countdownValue = value;
      $('party-countdown').querySelector('span').textContent = value;
    }
    return;
  }
  runStarted = true;
  setView('playing');
  dispatchOriginalKey(' ', 'Space', 32);
  sendOriginalStats(true);
}

function resetOriginalToMenu() {
  if (document.querySelector('#ui-title')?.textContent === 'Surf again') dispatchOriginalKey(' ', 'Space', 32);
}

function dispatchOriginalKey(key, code, keyCode) {
  const down = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true });
  Object.defineProperties(down, {
    keyCode: { value: keyCode },
    which: { value: keyCode },
    partySynthetic: { value: true },
  });
  window.dispatchEvent(down);
  const up = new KeyboardEvent('keyup', { key, code, bubbles: true, cancelable: true });
  Object.defineProperties(up, {
    keyCode: { value: keyCode },
    which: { value: keyCode },
    partySynthetic: { value: true },
  });
  window.dispatchEvent(up);
}

function readOriginalStats() {
  const counter = document.querySelector('#counter-amount');
  const distance = Number.parseInt(counter?.textContent || '0', 10) || 0;
  const lives = document.querySelectorAll('#stats-lives .life-full, #stats-lives .shield').length;
  return {
    distance,
    lives,
    over: document.querySelector('#ui-title')?.textContent === 'Surf again',
  };
}

function sendOriginalStats(force = false) {
  if (!runStarted || view !== 'playing') return;
  const stats = readOriginalStats();
  const signature = JSON.stringify(stats);
  if (!force && signature === lastStatSignature) return;
  lastStatSignature = signature;
  const player = room.players.find(player => player.id === room.localId);
  if (player) player.stats = stats;
  room.sendStats(stats);
  renderLivePlayers();
  checkRunComplete();
}

function checkRunComplete() {
  if (!room.isHost || room.phase !== 'race' || participants.length === 0 || completionTimer) return;
  const complete = participants.every(participant => {
    const player = room.players.find(player => player.id === participant.id);
    return !player || player.stats?.over;
  });
  if (!complete) return;
  completionTimer = setTimeout(() => {
    completionTimer = null;
    if (room.phase === 'race') room.finishRace();
  }, 1400);
}

function showResults(players) {
  runStarted = false;
  starting = false;
  setView('results');
  const rows = participants.map(participant => {
    const player = players.find(player => player.id === participant.id);
    return { ...participant, stats: player?.stats || { distance: 0, lives: 0, over: true } };
  }).sort((a, b) => b.stats.distance - a.stats.distance);
  renderPlayerRows($('party-results-list'), rows, true);
  $('party-rematch').hidden = !room.isHost;
  $('party-back-lobby').hidden = !room.isHost;
  $('party-results-waiting').hidden = room.isHost;
}

function renderLivePlayers() {
  const rows = participants.map(participant => {
    const player = room.players.find(player => player.id === participant.id);
    return { ...participant, stats: player?.stats || { distance: 0, lives: 3, over: false }, disconnected: !player };
  }).sort((a, b) => b.stats.distance - a.stats.distance);
  $('party-toggle-count').textContent = room.players.length;
  renderPlayerRows($('party-live-players'), rows, true);
  renderPlayerRows($('party-spectator-list'), rows, true);
}

function renderPlayerRows(container, players, live) {
  container.replaceChildren();
  players.forEach((player, index) => {
    const row = document.createElement('div');
    row.className = `party-player-row${player.id === room.localId ? ' is-local' : ''}`;
    if (live) {
      const rank = document.createElement('span');
      rank.className = 'party-player-rank';
      rank.textContent = index + 1;
      row.append(rank);
    }
    const name = document.createElement('span');
    name.className = 'party-player-name';
    name.textContent = player.id === room.localId ? `${player.name} (you)` : player.name;
    const status = document.createElement('span');
    status.className = 'party-player-status';
    if (live) status.textContent = player.disconnected ? 'Left' : player.stats?.over ? `${player.stats.distance} m · out` : `${player.stats?.distance || 0} m · ${player.stats?.lives ?? 3} lives`;
    else status.textContent = player.host ? 'Host' : 'Ready';
    row.append(name, status);
    container.append(row);
  });
}

function toast(message, duration = 3000) {
  clearTimeout(toastTimer);
  $('party-toast').textContent = message;
  $('party-toast').hidden = false;
  toastTimer = setTimeout(() => { $('party-toast').hidden = true; }, duration);
}

async function copyInvite(codeOnly = false) {
  if (!room.code) return;
  const text = codeOnly ? room.code : shareUrl(room.code);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    $('party-share-link').select();
    document.execCommand('copy');
  }
  toast(codeOnly ? 'Room code copied.' : 'Invite link copied.');
}

function leaveRoom() {
  room.leave();
  showHome();
}

$('party-create').addEventListener('click', createRoomFromUI);
$('party-join').addEventListener('click', joinRoomFromUI);
$('party-code').addEventListener('input', event => { event.target.value = cleanCode(event.target.value); });
$('party-start').addEventListener('click', startRun);
$('party-rematch').addEventListener('click', startRun);
$('party-back-lobby').addEventListener('click', () => {
  room.returnToLobby();
  showLobby();
});
$('party-surfer').addEventListener('click', () => dispatchOriginalKey('ArrowRight', 'ArrowRight', 39));
$('party-copy-link').addEventListener('click', () => copyInvite());
$('party-copy-code').addEventListener('click', () => copyInvite(true));
for (const id of ['party-leave-lobby', 'party-leave-playing', 'party-leave-spectator']) $(id).addEventListener('click', leaveRoom);
$('party-toggle').addEventListener('click', () => {
  $('party-roster').hidden = !$('party-roster').hidden;
  renderLivePlayers();
});
$('party-close-roster').addEventListener('click', () => { $('party-roster').hidden = true; });

window.addEventListener('keydown', event => {
  if (event.partySynthetic) return;
  if (view === 'playing' && event.key === 'Tab') {
    event.preventDefault();
    event.stopImmediatePropagation();
    $('party-roster').hidden = !$('party-roster').hidden;
    return;
  }
  if (view === 'playing' || view === 'countdown') return;
  const partyTarget = event.target.closest?.('#party-root, #party-toggle, #party-roster');
  if (event.key === 'Enter' && event.target === $('party-code')) joinRoomFromUI();
  if (event.key === 'Enter' && event.target === $('party-name')) {
    if (cleanCode($('party-code').value).length === 6) joinRoomFromUI();
    else createRoomFromUI();
  }
  if (partyTarget || view === 'spectating' || [' ', 'Enter'].includes(event.key)) {
    event.stopImmediatePropagation();
    if (!partyTarget && event.key !== 'Tab') event.preventDefault();
  }
}, true);

for (const type of ['dblclick', 'touchend']) {
  window.addEventListener(type, event => {
    if (view === 'playing') return;
    if (!event.target.closest?.('#party-root, #party-toggle, #party-roster')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
}

setInterval(() => {
  tickCountdown();
  if (runStarted) sendOriginalStats();
}, 250);

const invite = cleanCode(new URLSearchParams(window.location.search).get('room'));
if (invite.length === 6) {
  $('party-code').value = invite;
  $('party-invite-code').textContent = invite;
  $('party-invite').hidden = false;
}

try {
  const message = sessionStorage.getItem('party-message');
  if (message) {
    sessionStorage.removeItem('party-message');
    showError(message);
  }
} catch {}

setView('home');
