import mqtt from 'mqtt';
import { MAX_PLAYERS, cleanCode, makeRoomCode, sanitizeProfile, sanitizeStats } from './protocol.js';

const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const TOPIC_PREFIX = 'surf-party/rooms/v2/';
const ERROR_MESSAGES = {
  network: 'Could not reach the room service. Check your connection and try again.',
  'browser-incompatible': 'This browser cannot open a room connection. Try the latest Chrome, Edge, Firefox, or Safari.',
};

function clientId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export class Room extends EventTarget {
  constructor() {
    super();
    this.isHost = false;
    this.localId = null;
    this.clientId = clientId();
    this.code = '';
    this.players = [];
    this.phase = 'home';
    this.raceProvider = null;
    this.destroyed = false;
    this.mqttClients = new Map();
    this.unavailableBrokers = new Set();
    this.messageSequence = 0;
    this.receivedMessageIds = new Set();
    this.nextSequences = new Map();
    this.pendingMessages = new Map();
    this.messageFlushTimers = new Map();
    this.hasConnected = false;
    this.hasWelcomed = false;
    this.lastSeen = new Map();
    this.hostLastSeen = 0;
    this.lastStatsSent = 0;
    this.statsDirty = false;
    this.timers = new Set();
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  error(error) {
    const kind = error?.type || error?.name;
    this.emit('error', ERROR_MESSAGES[kind] || error?.message || 'The connection failed. Please try again.');
  }

  every(milliseconds, callback) {
    const timer = setInterval(callback, milliseconds);
    this.timers.add(timer);
    return timer;
  }

  create(profile) {
    this.destroyed = false;
    this.isHost = true;
    this.phase = 'lobby';
    this.code = makeRoomCode();
    this.profile = sanitizeProfile(profile);
    this.localId = 'host';
    this.players = [{ id: 'host', ...this.profile, host: true }];
    this.hostLastSeen = Date.now();
    this.connect();
    this.every(3000, () => this.sendPresence());
    this.every(250, () => this.flushStats());
    this.every(5000, () => this.removeStalePlayers());
  }

  join(code, profile) {
    this.destroyed = false;
    this.isHost = false;
    this.phase = 'joining';
    this.code = cleanCode(code);
    this.profile = sanitizeProfile(profile);
    this.localId = this.clientId;
    this.players = [];
    this.hostLastSeen = Date.now();
    const timeout = setTimeout(() => {
      if (this.phase !== 'joining') return;
      this.leave();
      this.emit('error', 'The room did not respond. Check the code and make sure the host still has the room open.');
    }, 30000);
    this.timers.add(timeout);
    this.connect();
    this.every(4000, () => this.sendPresence());
    this.every(3000, () => {
      if (this.phase !== 'joining' && Date.now() - this.hostLastSeen > 25000) {
        const wasDestroyed = this.destroyed;
        this.leave();
        if (!wasDestroyed) this.emit('host-left');
      }
    });
  }

  connect() {
    if (this.destroyed) return;
    BROKERS.forEach((url, index) => this.connectBroker(url, index));
  }

  connectBroker(url, index) {
    const topic = `${TOPIC_PREFIX}${this.code}`;
    const client = mqtt.connect(url, {
      clientId: `surf-party-${this.clientId}`,
      clean: true,
      connectTimeout: 12000,
      reconnectPeriod: 2000,
      keepalive: 30,
    });
    this.mqttClients.set(index, client);
    client.on('connect', () => {
      if (this.destroyed || this.mqttClients.get(index) !== client) return;
      client.subscribe(topic, { qos: 0 }, error => {
        if (this.destroyed || this.mqttClients.get(index) !== client) return;
        if (error) {
          this.error(error);
          return;
        }
        this.unavailableBrokers.delete(index);
        this.hostLastSeen = Date.now();
        if (this.isHost) {
          if (!this.hasConnected) this.emit('ready', { code: this.code, players: this.players });
          this.sendPresence();
          this.broadcastLobby();
        } else {
          this.publish({ type: 'hello', profile: this.profile });
        }
        this.hasConnected = true;
      });
    });
    client.on('message', (receivedTopic, payload) => {
      if (this.destroyed || this.mqttClients.get(index) !== client || receivedTopic !== topic) return;
      try {
        this.enqueueMessage(JSON.parse(payload.toString()));
      } catch {}
    });
    const unavailable = () => {
      if (this.destroyed || this.mqttClients.get(index) !== client) return;
      if (!this.unavailableBrokers.has(index)) this.emit('status', 'Reconnecting to the room service…');
      this.unavailableBrokers.add(index);
    };
    client.on('close', unavailable);
    client.on('error', unavailable);
  }

  enqueueMessage(message) {
    if (!message || message.sender === this.clientId) return;
    if (message.target && message.target !== this.clientId) return;
    if (message.messageId) {
      if (this.receivedMessageIds.has(message.messageId)) return;
      this.receivedMessageIds.add(message.messageId);
      if (this.receivedMessageIds.size > 2048) {
        this.receivedMessageIds.delete(this.receivedMessageIds.values().next().value);
      }
    }
    if (!Number.isSafeInteger(message.sequence) || message.sequence < 1) {
      this.receive(message);
      return;
    }
    const next = this.nextSequences.get(message.sender) || 1;
    if (message.sequence < next) return;
    if (!this.pendingMessages.has(message.sender)) this.pendingMessages.set(message.sender, new Map());
    this.pendingMessages.get(message.sender).set(message.sequence, message);
    this.flushMessages(message.sender);
  }

  flushMessages(sender, skipMissing = false) {
    clearTimeout(this.messageFlushTimers.get(sender));
    this.timers.delete(this.messageFlushTimers.get(sender));
    this.messageFlushTimers.delete(sender);
    const pending = this.pendingMessages.get(sender);
    if (!pending) return;
    let next = this.nextSequences.get(sender) || 1;
    if (!pending.has(next)) {
      if (!skipMissing) {
        this.scheduleMessageFlush(sender);
        return;
      }
      next = Math.min(...pending.keys());
    }
    while (pending.has(next)) {
      const message = pending.get(next);
      pending.delete(next);
      this.receive(message);
      next += 1;
    }
    this.nextSequences.set(sender, next);
    if (pending.size) this.scheduleMessageFlush(sender);
    else this.pendingMessages.delete(sender);
  }

  scheduleMessageFlush(sender) {
    if (this.destroyed || this.messageFlushTimers.has(sender)) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.messageFlushTimers.delete(sender);
      this.flushMessages(sender, true);
    }, 100);
    this.messageFlushTimers.set(sender, timer);
    this.timers.add(timer);
  }

  publish(message, afterLeave = false) {
    if (this.destroyed && !afterLeave) return;
    this.messageSequence += 1;
    const body = JSON.stringify({
      ...message,
      sender: this.clientId,
      isHost: this.isHost,
      messageId: `${this.clientId}-${this.messageSequence}`,
      sequence: this.messageSequence,
    });
    for (const client of this.mqttClients.values()) {
      if (client.connected) client.publish(`${TOPIC_PREFIX}${this.code}`, body, { qos: 0, retain: false });
    }
  }

  broadcast(message) {
    return this.publish(message);
  }

  sendPresence() {
    if (this.destroyed) return;
    this.publish({ type: 'presence', phase: this.phase });
  }

  receive(message) {
    if (message.type === 'presence') {
      if (this.isHost) this.lastSeen.set(message.sender, Date.now());
      else if (message.isHost) this.hostLastSeen = Date.now();
      return;
    }
    if (this.isHost) {
      this.receiveAsHost(message);
      return;
    }
    if (message.isHost) this.hostLastSeen = Date.now();
    if (message.type === 'welcome') {
      const resuming = this.hasWelcomed;
      this.hasWelcomed = true;
      this.localId = message.id;
      this.phase = message.phase;
      this.players = message.players;
      if (!resuming) this.emit('ready', { code: this.code, players: this.players });
      this.emit('lobby', { players: this.players, phase: this.phase });
      if (message.race && !resuming) this.emit('start', message.race);
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
    if (message.type === 'stats-batch') {
      for (const [id, stats] of Object.entries(message.stats || {})) {
        const player = this.players.find(player => player.id === id);
        if (player) player.stats = sanitizeStats(stats);
        this.emit('stats', { id, stats: sanitizeStats(stats) });
      }
    }
    if (message.type === 'results') {
      this.phase = 'results';
      this.players = message.players;
      this.emit('results', message);
    }
    if (message.type === 'full') this.emit('error', 'That room is full. Rooms support up to 8 players.');
    if (message.type === 'host-left') this.emit('host-left');
  }

  receiveAsHost(message) {
    this.lastSeen.set(message.sender, Date.now());
    if (message.type === 'hello') {
      const existing = this.players.find(player => player.id === message.sender);
      if (!existing && this.players.length >= MAX_PLAYERS) {
        this.publish({ type: 'full', target: message.sender });
        return;
      }
      if (!existing) {
        this.players.push({ id: message.sender, ...sanitizeProfile(message.profile), host: false });
      }
      this.publish({
        type: 'welcome',
        target: message.sender,
        id: message.sender,
        code: this.code,
        phase: this.phase,
        players: this.publicPlayers(),
        race: this.phase === 'race' ? this.raceProvider?.() : null,
      });
      this.broadcastLobby();
      return;
    }
    if (message.type === 'stats') this.updateStats(message.sender, message.stats);
    if (message.type === 'profile') this.updatePlayer(message.sender, message.profile);
    if (message.type === 'leave') this.removePlayer(message.sender);
  }

  publicPlayers() {
    return this.players.map(({ id, name, character, host, stats }) => ({ id, name, character, host, stats }));
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
    else this.publish({ type: 'profile', profile: this.profile });
  }

  updateStats(id, value) {
    const player = this.players.find(player => player.id === id);
    if (!player) return;
    player.stats = sanitizeStats(value);
    this.statsDirty = true;
    this.emit('stats', { id, stats: player.stats });
  }

  sendStats(stats) {
    if (this.isHost) {
      this.updateStats(this.localId, stats);
      return;
    }
    const now = Date.now();
    if (now - this.lastStatsSent < 250 && !stats.over) return;
    this.lastStatsSent = now;
    this.publish({ type: 'stats', stats: sanitizeStats(stats) });
  }

  flushStats() {
    if (!this.isHost || !this.statsDirty || this.destroyed) return;
    this.statsDirty = false;
    const stats = Object.fromEntries(this.players.filter(player => player.stats).map(player => [player.id, player.stats]));
    this.broadcast({ type: 'stats-batch', stats });
  }

  startRace(race) {
    if (!this.isHost) return;
    this.phase = 'race';
    for (const player of this.players) delete player.stats;
    this.statsDirty = false;
    this.broadcast({ type: 'start', ...race });
  }

  finishRace() {
    if (!this.isHost) return;
    this.phase = 'results';
    this.flushStats();
    const message = { type: 'results', players: this.publicPlayers() };
    this.broadcast(message);
    this.emit('results', message);
  }

  broadcastLobby() {
    if (!this.isHost) return;
    const message = { type: 'lobby', phase: this.phase, players: this.publicPlayers() };
    this.broadcast(message);
    this.emit('lobby', message);
  }

  returnToLobby() {
    if (!this.isHost) return;
    this.phase = 'lobby';
    for (const player of this.players) delete player.stats;
    this.broadcastLobby();
  }

  removePlayer(id) {
    const player = this.players.find(player => player.id === id);
    if (!player) return;
    this.players = this.players.filter(player => player.id !== id);
    this.lastSeen.delete(id);
    this.nextSequences.delete(id);
    this.pendingMessages.delete(id);
    clearTimeout(this.messageFlushTimers.get(id));
    this.timers.delete(this.messageFlushTimers.get(id));
    this.messageFlushTimers.delete(id);
    this.emit('player-left', { id });
    this.broadcastLobby();
  }

  removeStalePlayers() {
    if (!this.isHost) return;
    const cutoff = Date.now() - 25000;
    for (const player of [...this.players]) {
      if (!player.host && (this.lastSeen.get(player.id) || 0) < cutoff) this.removePlayer(player.id);
    }
  }

  leave() {
    if (this.destroyed) return;
    const type = this.isHost ? 'host-left' : 'leave';
    this.publish({ type }, true);
    this.destroyed = true;
    this.phase = 'home';
    for (const timer of this.timers) {
      clearInterval(timer);
      clearTimeout(timer);
    }
    this.timers.clear();
    for (const client of this.mqttClients.values()) client.end();
    this.mqttClients.clear();
    this.messageFlushTimers.clear();
    this.pendingMessages.clear();
    this.players = [];
  }
}
