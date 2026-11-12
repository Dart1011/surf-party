import { Peer } from 'peerjs';
import { MAX_PLAYERS, cleanCode, hostPeerId, makeRoomCode, sanitizeProfile, sanitizeStats } from './protocol.js';

const ERROR_MESSAGES = {
  'peer-unavailable': 'That room was not found. Check the code and ask the host to keep their tab open.',
  'network': 'Could not reach the room service. Check your connection and try again.',
  'browser-incompatible': 'This browser does not support WebRTC. Try the latest Chrome, Edge, Firefox, or Safari.',
  'unavailable-id': 'That room code is already in use. Please try again.',
};

export class Room extends EventTarget {
  constructor() {
    super();
    this.peer = null;
    this.isHost = false;
    this.localId = null;
    this.code = '';
    this.players = [];
    this.phase = 'home';
    this.connections = new Map();
    this.hostConnection = null;
    this.raceProvider = null;
    this.nextPlayerId = 1;
    this.destroyed = false;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  error(error) {
    const kind = error?.type || error?.name;
    this.emit('error', ERROR_MESSAGES[kind] || error?.message || 'The connection failed. Please try again.');
  }

  create(profile, retries = 2) {
    this.destroyed = false;
    this.isHost = true;
    this.phase = 'lobby';
    this.code = makeRoomCode();
    this.profile = sanitizeProfile(profile);
    this.peer = new Peer(hostPeerId(this.code), { debug: 0 });
    this.peer.on('open', () => {
      this.localId = 'host';
      this.players = [{ id: 'host', ...this.profile, host: true }];
      this.emit('ready', { code: this.code, players: this.players });
    });
    this.peer.on('connection', connection => this.acceptConnection(connection));
    this.peer.on('error', error => {
      if (error?.type === 'unavailable-id' && retries > 0) {
        this.peer.destroy();
        this.create(this.profile, retries - 1);
      } else this.error(error);
    });
    this.peer.on('disconnected', () => this.reconnect());
  }

  join(code, profile) {
    this.destroyed = false;
    this.isHost = false;
    this.phase = 'joining';
    this.code = cleanCode(code);
    this.profile = sanitizeProfile(profile);
    this.peer = new Peer({ debug: 0 });
    const timeout = setTimeout(() => {
      if (this.phase === 'joining') this.emit('error', 'The room took too long to respond. Check the code and try again.');
    }, 15000);
    this.peer.on('open', () => {
      const connection = this.peer.connect(hostPeerId(this.code), {
        reliable: true,
        serialization: 'json',
        metadata: this.profile,
      });
      this.hostConnection = connection;
      connection.on('data', message => this.receive(message));
      connection.on('open', () => connection.send({ type: 'hello', profile: this.profile }));
      connection.on('close', () => {
        clearTimeout(timeout);
        if (!this.destroyed) this.emit('host-left');
      });
      connection.on('error', error => {
        clearTimeout(timeout);
        this.error(error);
      });
    });
    this.peer.on('error', error => {
      clearTimeout(timeout);
      this.error(error);
    });
    this.peer.on('disconnected', () => this.reconnect());
  }

  reconnect() {
    if (this.destroyed || !this.peer || this.peer.destroyed) return;
    this.emit('status', 'Reconnecting to the room service…');
    try {
      this.peer.reconnect();
    } catch {}
  }

  acceptConnection(connection) {
    let playerId = null;
    connection.on('data', message => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'hello' && !playerId) {
        if (this.players.length >= MAX_PLAYERS) {
          connection.send({ type: 'full' });
          setTimeout(() => connection.close(), 100);
          return;
        }
        playerId = `p${this.nextPlayerId++}`;
        this.connections.set(playerId, connection);
        const player = { id: playerId, ...sanitizeProfile(message.profile || connection.metadata), host: false };
        this.players.push(player);
        connection.send({
          type: 'welcome',
          id: playerId,
          code: this.code,
          phase: this.phase,
          players: this.players,
          race: this.phase === 'race' ? this.raceProvider?.() : null,
        });
        this.broadcastLobby();
        return;
      }
      if (!playerId) return;
      if (message.type === 'stats') this.updateStats(playerId, message.stats);
      if (message.type === 'profile') this.updatePlayer(playerId, message.profile);
    });
    const remove = () => {
      if (!playerId || !this.connections.has(playerId)) return;
      this.connections.delete(playerId);
      this.players = this.players.filter(player => player.id !== playerId);
      this.emit('player-left', { id: playerId });
      this.broadcastLobby();
    };
    connection.on('close', remove);
    connection.on('error', remove);
    connection.on('iceStateChanged', state => {
      if (state === 'failed' || state === 'closed') remove();
    });
  }

  receive(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'welcome') {
      this.localId = message.id;
      this.phase = message.phase;
      this.players = message.players;
      this.emit('ready', { code: this.code, players: this.players });
      this.emit('lobby', { players: this.players, phase: this.phase });
      if (message.race) this.emit('start', message.race);
      return;
    }
    if (message.type === 'lobby') {
      this.phase = message.phase;
      this.players = message.players;
      this.emit('lobby', message);
      if (message.phase === 'lobby') this.emit('return-lobby');
    }
    if (message.type === 'start') {
      this.phase = 'race';
      this.emit('start', message);
    }
    if (message.type === 'stats') this.emit('stats', message);
    if (message.type === 'results') {
      this.phase = 'results';
      this.players = message.players;
      this.emit('results', message);
    }
    if (message.type === 'full') this.emit('error', 'That room is full. Rooms support up to 8 players.');
  }

  updatePlayer(id, profile) {
    const player = this.players.find(player => player.id === id);
    if (!player) return;
    Object.assign(player, sanitizeProfile(profile));
    this.broadcastLobby();
  }

  updateProfile(profile) {
    this.profile = sanitizeProfile(profile);
    if (this.isHost) this.updatePlayer(this.localId, this.profile);
    else if (this.hostConnection?.open) this.hostConnection.send({ type: 'profile', profile: this.profile });
  }

  updateStats(id, value) {
    const player = this.players.find(player => player.id === id);
    if (!player) return;
    player.stats = sanitizeStats(value);
    const message = { type: 'stats', id, stats: player.stats };
    this.broadcast(message);
    this.emit('stats', message);
  }

  sendStats(stats) {
    if (this.isHost) this.updateStats(this.localId, stats);
    else if (this.hostConnection?.open) this.hostConnection.send({ type: 'stats', stats: sanitizeStats(stats) });
  }

  finishRace() {
    if (!this.isHost) return;
    this.phase = 'results';
    const message = { type: 'results', players: this.players };
    this.broadcast(message);
    this.emit('results', message);
  }

  broadcastLobby() {
    if (!this.isHost) return;
    this.broadcast({ type: 'lobby', phase: this.phase, players: this.players });
    this.emit('lobby', { phase: this.phase, players: this.players });
  }

  startRace(race) {
    this.phase = 'race';
    for (const player of this.players) delete player.stats;
    this.broadcast({ type: 'start', ...race });
  }

  returnToLobby() {
    if (!this.isHost) return;
    this.phase = 'lobby';
    for (const player of this.players) delete player.stats;
    this.broadcastLobby();
  }

  broadcast(message) {
    for (const connection of this.connections.values()) {
      if (connection.open) connection.send(message);
    }
  }

  leave() {
    this.destroyed = true;
    this.phase = 'home';
    for (const connection of this.connections.values()) connection.close();
    this.hostConnection?.close();
    this.peer?.destroy();
    this.connections.clear();
    this.players = [];
  }
}
